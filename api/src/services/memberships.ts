import { and, asc, eq, gt, sql } from 'drizzle-orm'
import { db } from '../db/client'
import { memberships, membershipEvents, teams, users } from '../db/schema'
import { withTransaction } from '../db/tx'
import { ApiError } from '../http/errors'
import { buildPage, decodeCursor, DEFAULT_LIMIT, MAX_LIMIT } from '../http/cursor'
import { authorize, can } from '../policy'
import type { Actor, Role } from '../domain/types'

export interface MemberUser {
  id: number
  displayName: string
  email: string
}

export interface MemberRow {
  id: number
  userId: number
  teamId: number
  role: Role
  createdAt: Date
  updatedAt: Date
  user?: MemberUser
}

/**
 * Direct-adds an existing user to a team. Admin-only per spec §7.1.
 * Throws 409 ALREADY_MEMBER if the user is already a member.
 * Appends a 'joined' event to `membership_events`.
 */
export async function addMember(
  actor: Actor,
  teamId: number,
  userId: number,
  role: Role,
): Promise<void> {
  const allowed = await can(actor, 'team:member:add')
  if (!allowed) {
    throw ApiError.of('FORBIDDEN')
  }

  await withTransaction(async (tx) => {
    // Check for existing membership
    const [existing] = await tx
      .select({ id: memberships.id })
      .from(memberships)
      .where(and(eq(memberships.teamId, teamId), eq(memberships.userId, userId)))
      .limit(1)

    if (existing) {
      throw ApiError.of('ALREADY_MEMBER', 'User is already a member of this team')
    }

    // Check team exists
    const [team] = await tx
      .select({ id: teams.id })
      .from(teams)
      .where(eq(teams.id, teamId))
      .limit(1)

    if (!team) {
      throw ApiError.of('NOT_FOUND', 'Team not found')
    }

    // Check user exists
    const [user] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)

    if (!user) {
      throw ApiError.of('NOT_FOUND', 'User not found')
    }

    await tx.insert(memberships).values({
      teamId,
      userId,
      role,
    })

    await tx.insert(membershipEvents).values({
      teamId,
      actorId: actor.id,
      subjectUserId: userId,
      action: 'joined',
      fromRole: null,
      toRole: role,
    })
  })
}

/**
 * Lists members of a team, paginated by keyset (`id ASC`).
 * Requires 'team:read' permission (throws 404 for outsiders).
 */
export async function listMembers(
  actor: Actor,
  teamId: number,
  cursor?: string,
  limit?: number,
): Promise<{ members: MemberRow[]; nextCursor: string | null }> {
  await authorize(actor, 'team:read', { kind: 'team', teamId })

  const scope = `team:${teamId}:members`
  const decoded = decodeCursor(cursor, scope)
  const effectiveLimit = Math.min(Math.max(1, limit ?? DEFAULT_LIMIT), MAX_LIMIT)

  const conditions = [eq(memberships.teamId, teamId)]
  if (decoded && typeof decoded.id === 'number') {
    conditions.push(gt(memberships.id, decoded.id))
  }

  const rows = await db
    .select({
      id: memberships.id,
      userId: memberships.userId,
      teamId: memberships.teamId,
      role: memberships.role,
      createdAt: memberships.createdAt,
      updatedAt: memberships.updatedAt,
      userDisplayName: users.displayName,
      userEmail: users.email,
    })
    .from(memberships)
    .innerJoin(users, eq(memberships.userId, users.id))
    .where(and(...conditions))
    .orderBy(asc(memberships.id))
    .limit(effectiveLimit + 1)

  const { page, nextCursor } = buildPage(
    rows,
    effectiveLimit,
    (r) => ({ id: r.id }),
    scope,
  )

  const members: MemberRow[] = page.map((r) => ({
    id: r.id,
    userId: r.userId,
    teamId: r.teamId,
    role: r.role,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    user: {
      id: r.userId,
      displayName: r.userDisplayName,
      email: r.userEmail,
    },
  }))

  return { members, nextCursor }
}

/**
 * Updates a member's role on a team. Lead only.
 * Enforces LAST_LEAD guard (422) if demoting the only lead.
 * Appends a 'role_changed' event with from_role and to_role.
 */
export async function setMemberRole(
  actor: Actor,
  teamId: number,
  userId: number,
  role: Role,
): Promise<void> {
  await authorize(actor, 'membership:manage', { kind: 'team', teamId })

  await withTransaction(async (tx) => {
    const [target] = await tx
      .select()
      .from(memberships)
      .where(and(eq(memberships.teamId, teamId), eq(memberships.userId, userId)))
      .for('update')

    if (!target) {
      throw ApiError.of('NOT_FOUND', 'Member not found')
    }

    if (target.role === role) {
      return
    }

    if (target.role === 'lead' && role !== 'lead') {
      const [leadCountRow] = await tx
        .select({ count: sql<number>`count(*)` })
        .from(memberships)
        .where(and(eq(memberships.teamId, teamId), eq(memberships.role, 'lead')))
        .for('update')

      if ((leadCountRow?.count ?? 0) <= 1) {
        throw ApiError.of('LAST_LEAD', 'Cannot demote the last lead of a team')
      }
    }

    await tx
      .update(memberships)
      .set({ role })
      .where(eq(memberships.id, target.id))

    await tx.insert(membershipEvents).values({
      teamId,
      actorId: actor.id,
      subjectUserId: userId,
      action: 'role_changed',
      fromRole: target.role,
      toRole: role,
    })
  })
}

/**
 * Removes a user from a team. Lead only.
 * Enforces LAST_LEAD guard (422) if removing the only lead.
 * Appends a 'removed' event with from_role.
 */
export async function removeMember(
  actor: Actor,
  teamId: number,
  userId: number,
): Promise<void> {
  await authorize(actor, 'membership:manage', { kind: 'team', teamId })

  await withTransaction(async (tx) => {
    const [target] = await tx
      .select()
      .from(memberships)
      .where(and(eq(memberships.teamId, teamId), eq(memberships.userId, userId)))
      .for('update')

    if (!target) {
      throw ApiError.of('NOT_FOUND', 'Member not found')
    }

    if (target.role === 'lead') {
      const [leadCountRow] = await tx
        .select({ count: sql<number>`count(*)` })
        .from(memberships)
        .where(and(eq(memberships.teamId, teamId), eq(memberships.role, 'lead')))
        .for('update')

      if ((leadCountRow?.count ?? 0) <= 1) {
        throw ApiError.of('LAST_LEAD', 'Cannot remove the last lead of a team')
      }
    }

    await tx.delete(memberships).where(eq(memberships.id, target.id))

    await tx.insert(membershipEvents).values({
      teamId,
      actorId: actor.id,
      subjectUserId: userId,
      action: 'removed',
      fromRole: target.role,
      toRole: null,
    })
  })
}
