import { and, asc, eq, gt, isNull, sql } from 'drizzle-orm'
import { config } from '../config'
import { db } from '../db/client'
import { invitations, memberships, membershipEvents, teams, users, type UserRow } from '../db/schema'
import { withTransaction } from '../db/tx'
import { ApiError } from '../http/errors'
import { buildPage, decodeIdCursor, DEFAULT_LIMIT, MAX_LIMIT } from '../http/cursor'
import { authorize } from '../policy'
import { hashPassword, randomToken, sha256, verifyPassword } from './crypto'
import { enqueue } from './outbox'
import { issueFamily } from './sessions'
import { signAccessToken } from './tokens'
import { toPublicUser, type PublicUser } from './users'
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
    maxUses: 1,
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
  input: { email: string; role: Role },
): Promise<InvitationView> {
  await authorize(actor, 'invitation:manage', { kind: 'team', teamId })

  const normalizedEmail = input.email.trim().toLowerCase()
  if (!normalizedEmail || !normalizedEmail.includes('@')) {
    throw ApiError.of('VALIDATION_ERROR', 'Invalid email address')
  }

  return withTransaction(async (tx) => {
    const [team] = await tx
      .select({ id: teams.id, name: teams.name })
      .from(teams)
      .where(eq(teams.id, teamId))
      .limit(1)
      .for('update')

    if (!team) {
      throw ApiError.of('NOT_FOUND', 'Team not found')
    }

    await authorize(actor, 'invitation:manage', { kind: 'team', teamId }, tx)

    const token = randomToken()
    const codeHash = sha256(token)

    const [inserted] = await tx.insert(invitations).values({
      teamId,
      role: input.role,
      email: normalizedEmail,
      codeHash,
      maxUses: 1,
      uses: 0,
      expiresAt: sql`DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL ${config.inviteTtlDays} DAY)`,
      createdBy: actor.id,
    })

    await enqueue(tx, {
      type: 'email.invite',
      payload: {
        to: normalizedEmail,
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
  const cursorId = decodeIdCursor(cursor, scope)
  const effectiveLimit = Math.min(Math.max(1, limit ?? DEFAULT_LIMIT), MAX_LIMIT)

  const conditions = [eq(invitations.teamId, teamId)]
  if (cursorId !== null) {
    conditions.push(gt(invitations.id, cursorId))
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
  return withTransaction(async (tx) => {
    const [inv] = await tx
      .select({ id: invitations.id, teamId: invitations.teamId, revokedAt: invitations.revokedAt })
      .from(invitations)
      .where(eq(invitations.id, invitationId))
      .limit(1)
      .for('update')

    if (!inv) {
      throw ApiError.of('NOT_FOUND', 'Invitation not found')
    }

    await authorize(actor, 'invitation:manage', { kind: 'team', teamId: inv.teamId }, tx)

    if (inv.revokedAt !== null) {
      return
    }

    await tx
      .update(invitations)
      .set({ revokedAt: sql`CURRENT_TIMESTAMP(3)` })
      .where(eq(invitations.id, invitationId))
  })
}

export interface RedeemInput {
  code: string
  email?: string | undefined
  password?: string | undefined
  displayName?: string | undefined
}

export interface RedeemResult {
  user: PublicUser
  teamId: number
  role: Role
  accessToken: string
  refreshToken: string
}

/**
 * Redeems an invitation per spec §8.8 / §11.2:
 * 1. Finds invitation by `sha256(code)`.
 * 2. Matches email on both branches (unauthenticated input.email vs authenticated actor's stored email).
 * 3. Resolves user: authenticated -> actor; unauthenticated -> verifies password if account exists or creates new user.
 * 4. Checks if already a member of the team -> throws ALREADY_MEMBER (uses not consumed).
 * 5. Atomic CAS increment on invitations uses.
 * 6. Inserts membership and records 'joined' membership_event.
 * 7. Issues access and refresh tokens.
 */
export async function redeem(
  actor: Actor | null,
  input: RedeemInput,
): Promise<RedeemResult> {
  const codeHash = sha256(input.code)

  return withTransaction(async (tx) => {
    // 1. Find invitation by codeHash
    const [invitation] = await tx
      .select()
      .from(invitations)
      .where(eq(invitations.codeHash, codeHash))
      .for('update')

    if (!invitation) {
      throw ApiError.of('NOT_FOUND', 'Invitation not found')
    }

    const inviteEmail = invitation.email.toLowerCase()

    // 2. Email match on both branches
    if (actor === null) {
      if (!input.email || input.email.trim().toLowerCase() !== inviteEmail) {
        throw ApiError.of('FORBIDDEN')
      }
    } else {
      const [actorUser] = await tx
        .select()
        .from(users)
        .where(eq(users.id, actor.id))
        .limit(1)

      if (!actorUser || actorUser.status === 'disabled' || actorUser.email.toLowerCase() !== inviteEmail) {
        throw ApiError.of('FORBIDDEN')
      }
    }

    // 3. Resolve user
    let user: UserRow
    if (actor !== null) {
      const [actorUser] = await tx
        .select()
        .from(users)
        .where(eq(users.id, actor.id))
        .limit(1)

      if (!actorUser) {
        throw ApiError.of('NOT_FOUND', 'User not found')
      }
      if (actorUser.status === 'disabled') {
        throw ApiError.of('FORBIDDEN')
      }
      user = actorUser
    } else {
      const targetEmail = inviteEmail
      const [existingUser] = await tx
        .select()
        .from(users)
        .where(eq(users.email, targetEmail))
        .limit(1)

      if (existingUser) {
        if (existingUser.status === 'disabled') {
          throw ApiError.of('FORBIDDEN')
        }
        if (!input.password) {
          throw ApiError.of('FORBIDDEN')
        }
        const ok = await verifyPassword(input.password, existingUser.passwordHash)
        if (!ok) {
          throw ApiError.of('FORBIDDEN')
        }
        user = existingUser
      } else {
        if (!input.password) {
          throw ApiError.of('VALIDATION_ERROR', 'Password is required to create an account')
        }
        if (input.password.length < 8) {
          throw ApiError.of('VALIDATION_ERROR', 'Password must be at least 8 characters')
        }
        if (Buffer.byteLength(input.password, 'utf8') > 72) {
          throw ApiError.of('VALIDATION_ERROR', 'Password must not exceed 72 bytes')
        }
        const passwordHash = await hashPassword(input.password)
        const displayName = input.displayName?.trim() || targetEmail.split('@')[0] || 'User'
        const [inserted] = await tx.insert(users).values({
          email: targetEmail,
          passwordHash,
          displayName,
          isAdmin: false,
          status: 'active',
        })
        const [newUser] = await tx
          .select()
          .from(users)
          .where(eq(users.id, inserted.insertId))
          .limit(1)

        if (!newUser) {
          throw ApiError.of('INTERNAL_ERROR', 'Failed to retrieve created user')
        }
        user = newUser
      }
    }

    // 4. Check if already a member (uses not consumed)
    const [existingMember] = await tx
      .select({ id: memberships.id })
      .from(memberships)
      .where(and(eq(memberships.teamId, invitation.teamId), eq(memberships.userId, user.id)))
      .limit(1)

    if (existingMember) {
      throw ApiError.of('ALREADY_MEMBER', 'User is already a member of this team')
    }

    // 5. Atomic CAS update on invitations
    const [casResult] = await tx
      .update(invitations)
      .set({ uses: sql`uses + 1` })
      .where(
        and(
          eq(invitations.id, invitation.id),
          eq(invitations.uses, 0),
          isNull(invitations.revokedAt),
          gt(invitations.expiresAt, sql`CURRENT_TIMESTAMP(3)`),
        ),
      )

    if (casResult.affectedRows === 0) {
      // Re-read row to classify error precisely
      const [latest] = await tx
        .select()
        .from(invitations)
        .where(eq(invitations.id, invitation.id))
        .limit(1)

      if (!latest || latest.revokedAt !== null) {
        throw ApiError.of('INVITE_REVOKED')
      }
      if (latest.uses >= 1) {
        throw ApiError.of('INVITE_EXHAUSTED')
      }
      throw ApiError.of('INVITE_EXPIRED')
    }

    // 6. Insert membership + membership_events
    await tx.insert(memberships).values({
      teamId: invitation.teamId,
      userId: user.id,
      role: invitation.role,
    })

    await tx.insert(membershipEvents).values({
      teamId: invitation.teamId,
      actorId: user.id,
      subjectUserId: user.id,
      action: 'joined',
      fromRole: null,
      toRole: invitation.role,
    })

    // 7. Issue session tokens
    const accessToken = await signAccessToken(user.id)
    const session = await issueFamily(user.id, {}, tx)

    return {
      user: toPublicUser(user),
      teamId: invitation.teamId,
      role: invitation.role,
      accessToken,
      refreshToken: session.refreshToken,
    }
  })
}
