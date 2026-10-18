import { and, asc, eq, gt, sql } from 'drizzle-orm'
import { config } from '../config'
import { db } from '../db/client'
import { invitations, teams } from '../db/schema'
import { withTransaction } from '../db/tx'
import { ApiError } from '../http/errors'
import { buildPage, decodeCursor, DEFAULT_LIMIT, MAX_LIMIT } from '../http/cursor'
import { authorize } from '../policy'
import { randomToken, sha256 } from './crypto'
import { enqueue } from './outbox'
import type { Actor, Role } from '../domain/types'

export interface InvitationView {
  id: number
  teamId: number
  role: Role
  email: string
  maxUses: number
  uses: number
  expiresAt: Date
  createdBy: number
  revokedAt: Date | null
  createdAt: Date
}

function toInvitationView(row: typeof invitations.$inferSelect): InvitationView {
  return {
    id: row.id,
    teamId: row.teamId,
    role: row.role,
    email: row.email,
    maxUses: row.maxUses,
    uses: row.uses,
    expiresAt: row.expiresAt,
    createdBy: row.createdBy,
    revokedAt: row.revokedAt,
    createdAt: row.createdAt,
  }
}

/**
 * Creates an invitation for an email address to join a team with a specific role.
 * Requires lead permissions on the team.
 * Generates a random CSPRNG token, stores sha256(token) at rest, and enqueues
 * an email.invite job into the transactional outbox on the same transaction.
 * Never exposes codeHash on the returned view.
 */
export async function createInvitation(
  actor: Actor,
  teamId: number,
  input: { email: string; role: Role; maxUses?: number },
): Promise<InvitationView> {
  await authorize(actor, 'invitation:manage', { kind: 'team', teamId })

  return withTransaction(async (tx) => {
    const [team] = await tx
      .select({ name: teams.name })
      .from(teams)
      .where(eq(teams.id, teamId))
      .limit(1)

    if (!team) {
      throw ApiError.of('NOT_FOUND', 'Team not found')
    }

    const token = randomToken()
    const codeHash = sha256(token)

    const [inserted] = await tx.insert(invitations).values({
      teamId,
      role: input.role,
      email: input.email,
      codeHash,
      maxUses: input.maxUses ?? 1,
      uses: 0,
      expiresAt: sql`DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL ${config.inviteTtlDays} DAY)`,
      createdBy: actor.id,
    })

    await enqueue(tx, {
      type: 'email.invite',
      payload: {
        to: input.email,
        teamName: team.name,
        code: token,
      },
      dedupeKey: `invite:${inserted.insertId}`,
    })

    const [row] = await tx
      .select()
      .from(invitations)
      .where(eq(invitations.id, inserted.insertId))
      .limit(1)

    if (!row) {
      throw ApiError.of('INTERNAL_ERROR', 'Failed to retrieve created invitation')
    }

    return toInvitationView(row)
  })
}

/**
 * Lists invitations for a team, paginated by keyset (`id ASC`).
 * Requires lead permissions on the team.
 * Never exposes codeHash in the returned views.
 */
export async function listInvitations(
  actor: Actor,
  teamId: number,
  cursor?: string,
  limit?: number,
): Promise<{ invitations: InvitationView[]; nextCursor: string | null }> {
  await authorize(actor, 'invitation:manage', { kind: 'team', teamId })

  const scope = `team:${teamId}:invitations`
  const decoded = decodeCursor(cursor, scope)
  const effectiveLimit = Math.min(Math.max(1, limit ?? DEFAULT_LIMIT), MAX_LIMIT)

  const conditions = [eq(invitations.teamId, teamId)]
  if (decoded && typeof decoded.id === 'number') {
    conditions.push(gt(invitations.id, decoded.id))
  }

  const rows = await db
    .select()
    .from(invitations)
    .where(and(...conditions))
    .orderBy(asc(invitations.id))
    .limit(effectiveLimit + 1)

  const { page, nextCursor } = buildPage(
    rows,
    effectiveLimit,
    (r) => ({ id: r.id }),
    scope,
  )

  return {
    invitations: page.map(toInvitationView),
    nextCursor,
  }
}

/**
 * Revokes an invitation, setting `revoked_at = NOW(3)`.
 * Requires lead permissions on the invitation's team.
 */
export async function revokeInvitation(
  actor: Actor,
  invitationId: number,
): Promise<void> {
  const [inv] = await db
    .select({ id: invitations.id, teamId: invitations.teamId, revokedAt: invitations.revokedAt })
    .from(invitations)
    .where(eq(invitations.id, invitationId))
    .limit(1)

  if (!inv) {
    throw ApiError.of('NOT_FOUND', 'Invitation not found')
  }

  await authorize(actor, 'invitation:manage', { kind: 'team', teamId: inv.teamId })

  if (inv.revokedAt !== null) {
    return
  }

  await db
    .update(invitations)
    .set({ revokedAt: sql`CURRENT_TIMESTAMP(3)` })
    .where(eq(invitations.id, invitationId))
}
