import { asc, eq, inArray } from 'drizzle-orm'
import { db } from '../db/client'
import { teams } from '../db/schema'
import { ApiError } from '../http/errors'
import { authorize, can, scopeTeamIds } from '../policy'
import type { Actor } from '../domain/types'

export type TeamRow = typeof teams.$inferSelect

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

  const [result] = await db.insert(teams).values({
    name: input.name,
    slug: input.slug,
  })

  const [row] = await db
    .select()
    .from(teams)
    .where(eq(teams.id, result.insertId))
    .limit(1)

  if (!row) {
    throw ApiError.of('INTERNAL_ERROR', 'Failed to retrieve created team')
  }

  return row
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
