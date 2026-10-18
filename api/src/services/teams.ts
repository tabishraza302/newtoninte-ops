import { and, asc, eq, gt, inArray, or, sql } from 'drizzle-orm'
import { db } from '../db/client'
import { membershipEvents, memberships, teams, users } from '../db/schema'
import { withTransaction } from '../db/tx'
import { buildPage, decodeIdCursor, DEFAULT_LIMIT, MAX_LIMIT } from '../http/cursor'
import { ApiError } from '../http/errors'
import { authorize, can, scopeTeamIds } from '../policy'
import type { Actor, Role } from '../domain/types'
import { recordAdminAudit } from './adminAudit'

export type TeamRow = typeof teams.$inferSelect

function isDupEntry(err: unknown): boolean {
  const target = err && typeof err === 'object' && 'cause' in err && err.cause ? err.cause : err
  if (target && typeof target === 'object') {
    const code = 'code' in target ? target.code : undefined
    const errno = 'errno' in target ? target.errno : undefined
    return code === 'ER_DUP_ENTRY' || errno === 1062
  }
  return false
}
function escapeLike(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_')
}

/**
 * Creates a new team in the system. Admin-only per spec §7.1.
 */
export async function createTeam(
  actor: Actor,
  input: { name: string; slug: string },
): Promise<TeamRow> {
  const allowed = await can(actor, 'team:create')
  if (!allowed) {
    throw ApiError.of('FORBIDDEN')
  }

  const name = input.name.trim()
  const slug = input.slug.trim().toLowerCase()
  if (name.length < 1 || name.length > 120) {
    throw ApiError.of('VALIDATION_ERROR', 'Team name must be between 1 and 120 characters')
  }
  if (slug.length < 1 || slug.length > 80) {
    throw ApiError.of('VALIDATION_ERROR', 'Team slug must be between 1 and 80 characters')
  }

  try {
    return await withTransaction(async (tx) => {
      const [result] = await tx.insert(teams).values({
        name,
        slug,
      })

      const [row] = await tx
        .select()
        .from(teams)
        .where(eq(teams.id, Number(result.insertId)))
        .limit(1)

      if (!row) {
        throw ApiError.of('INTERNAL_ERROR', 'Failed to retrieve created team')
      }

      await recordAdminAudit(tx, {
        actorId: actor.id,
        action: 'team_created',
        targetType: 'team',
        targetId: row.id,
        metadata: {
          name: row.name,
          slug: row.slug,
        },
      })

      return row
    })
  } catch (err) {
    if (isDupEntry(err)) {
      throw ApiError.of('VALIDATION_ERROR', 'A team with this slug already exists')
    }
    throw err
  }
}

export interface ListAdminTeamsQuery {
  q?: string
  cursor?: string
  limit?: number
}

export interface ListAdminTeamsResult {
  teams: TeamRow[]
  nextCursor: string | null
}

/**
 * Administrator team discovery with literal search and keyset pagination (id ASC).
 */
export async function listAdminTeams(
  actor: Actor,
  query?: ListAdminTeamsQuery,
): Promise<ListAdminTeamsResult> {
  const allowed = await can(actor, 'team:listAll')
  if (!allowed) {
    throw ApiError.of('FORBIDDEN')
  }

  const effectiveLimit = query?.limit ?? DEFAULT_LIMIT
  if (!Number.isInteger(effectiveLimit) || effectiveLimit < 1 || effectiveLimit > MAX_LIMIT) {
    throw ApiError.of('VALIDATION_ERROR', `limit must be an integer between 1 and ${MAX_LIMIT}`)
  }

  const q = query?.q?.trim() ?? ''
  const scope = `admin:teams:q=${q}`

  const cursorId = decodeIdCursor(query?.cursor, scope)

  const conditions = []
  if (cursorId !== null) {
    conditions.push(gt(teams.id, cursorId))
  }

  if (q !== '') {
    const escaped = escapeLike(q)
    const pattern = `%${escaped}%`
    conditions.push(
      or(
        sql`${teams.name} LIKE ${pattern} ESCAPE '\\\\'`,
        sql`${teams.slug} LIKE ${pattern} ESCAPE '\\\\'`,
      )!,
    )
  }

  const rows = await db
    .select()
    .from(teams)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(asc(teams.id))
    .limit(effectiveLimit + 1)

  const { page, nextCursor } = buildPage(
    rows,
    effectiveLimit,
    (r) => ({ id: r.id }),
    scope,
  )

  return { teams: page, nextCursor }
}

/**
 * Lists teams.
 * - Defaults to teams the actor is a member of (scoped by team memberships).
 * - `opts.all = true` lists all teams in the system (admin-only; non-admin gets 403).
 */
export async function listTeams(
  actor: Actor,
  opts?: { all?: boolean },
): Promise<TeamRow[]> {
  if (opts?.all) {
    const allowed = await can(actor, 'team:listAll')
    if (!allowed) {
      throw ApiError.of('FORBIDDEN')
    }
    return db.select().from(teams).orderBy(asc(teams.id))
  }

  const teamIds = await scopeTeamIds(actor)
  if (teamIds.length === 0) {
    return []
  }

  return db
    .select()
    .from(teams)
    .where(inArray(teams.id, teamIds))
    .orderBy(asc(teams.id))
}

/**
 * Fetches a single team by ID.
 * Respects the 404/403 rule: throws 404 NOT_FOUND if the actor is not a member of the team
 * (or if the team does not exist), hiding the resource's existence from outsiders (§7 rule 3).
 */
export async function getTeam(actor: Actor, teamId: number): Promise<TeamRow> {
  await authorize(actor, 'team:read', { kind: 'team', teamId })

  const [row] = await db
    .select()
    .from(teams)
    .where(eq(teams.id, teamId))
    .limit(1)

  if (!row) {
    throw ApiError.of('NOT_FOUND')
  }

  return row
}

export interface AdminTeamMember {
  id: number
  userId: number
  teamId: number
  role: Role
  createdAt: Date
  user: {
    id: number
    email: string
    displayName: string
  }
}

export interface AdminListTeamMembersResult {
  members: AdminTeamMember[]
  nextCursor: string | null
}

/**
 * Admin-only inspection of team roster (spec §7.1).
 * Lists members of a team paginated by keyset (`memberships.id ASC`).
 */
export async function adminListTeamMembers(
  actor: Actor,
  teamId: number,
  query?: { cursor?: string | undefined; limit?: number | undefined } | undefined,
): Promise<AdminListTeamMembersResult> {
  const allowed = await can(actor, 'user:manage')
  if (!allowed) {
    throw ApiError.of('FORBIDDEN')
  }

  const [team] = await db
    .select({ id: teams.id })
    .from(teams)
    .where(eq(teams.id, teamId))
    .limit(1)

  if (!team) {
    throw ApiError.of('NOT_FOUND', 'Team not found')
  }

  const scope = `admin:team:${teamId}:members`
  const cursorId = decodeIdCursor(query?.cursor, scope)
  const limit = query?.limit ?? DEFAULT_LIMIT
  const effectiveLimit = Math.min(Math.max(1, limit), MAX_LIMIT)

  const conditions = [eq(memberships.teamId, teamId)]
  if (cursorId !== null) {
    conditions.push(gt(memberships.id, cursorId))
  }

  const rows = await db
    .select({
      id: memberships.id,
      userId: memberships.userId,
      teamId: memberships.teamId,
      role: memberships.role,
      createdAt: memberships.createdAt,
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

  const members: AdminTeamMember[] = page.map((r) => ({
    id: r.id,
    userId: r.userId,
    teamId: r.teamId,
    role: r.role,
    createdAt: r.createdAt,
    user: {
      id: r.userId,
      email: r.userEmail,
      displayName: r.userDisplayName,
    },
  }))

  return { members, nextCursor }
}

/**
 * Admin removal of a member from a team (spec §7.1).
 * Enforces LAST_LEAD guard (422) if removing the only lead.
 * Appends a 'removed' event to membershipEvents.
 */
export async function adminRemoveTeamMember(
  actor: Actor,
  teamId: number,
  userId: number,
): Promise<void> {
  const allowed = await can(actor, 'user:manage')
  if (!allowed) {
    throw ApiError.of('FORBIDDEN')
  }

  await withTransaction(async (tx) => {
    const [team] = await tx
      .select({ id: teams.id, name: teams.name })
      .from(teams)
      .where(eq(teams.id, teamId))
      .for('update')

    if (!team) {
      throw ApiError.of('NOT_FOUND', 'Team not found')
    }

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
        throw ApiError.of('LAST_LEAD', 'Cannot remove the last lead from a team')
      }
    }

    const [subjectUser] = await tx
      .select({ email: users.email, displayName: users.displayName })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)

    await tx.delete(memberships).where(eq(memberships.id, target.id))

    await tx.insert(membershipEvents).values({
      teamId,
      actorId: actor.id,
      subjectUserId: userId,
      action: 'removed',
      fromRole: target.role,
      toRole: null,
    })

    await recordAdminAudit(tx, {
      actorId: actor.id,
      action: 'membership_removed',
      targetType: 'membership',
      targetId: target.id,
      metadata: {
        teamId,
        teamName: team.name,
        userId,
        email: subjectUser?.email ?? '',
        displayName: subjectUser?.displayName ?? '',
        fromRole: target.role,
        toRole: null,
      },
    })
  })
}
