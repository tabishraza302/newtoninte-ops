import { ApiError } from '../http/errors'
import { and, eq } from 'drizzle-orm'
import { db } from '../db/client'
import { memberships } from '../db/schema'
import type { Actor, Role } from '../domain/types'

export type { Actor } from '../domain/types'

// Membership reads for authorization. Roles are always read live from the
// `memberships` table on each request — never trusted from the token — so a
// role change takes effect on the actor's very next request.

/**
 * The role `userId` holds on `teamId`, read from `memberships`.
 * Returns `null` when the user is not a member of that team.
 */
export async function roleIn(userId: number, teamId: number): Promise<Role | null> {
  const [row] = await db
    .select({ role: memberships.role })
    .from(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.teamId, teamId)))
    .limit(1)
  return row?.role ?? null
}

/** Every team `userId` belongs to, with the role held on each. */
export async function membershipsOf(userId: number): Promise<Array<{ teamId: number; role: Role }>> {
  return db
    .select({ teamId: memberships.teamId, role: memberships.role })
    .from(memberships)
    .where(eq(memberships.userId, userId))
}

// Authorization decisions. `can` is the single resource-level permission
// check in the API — services and routes must not ad-hoc their own.
//
// Roles come from `roleIn` and decide every membership-scoped action;
// `isAdmin` decides only the narrow admin set (spec §7.1) and grants no
// work-item or team-read superpower.

export type Action =
  | 'team:read' | 'team:create' | 'team:listAll' | 'team:member:add'
  | 'item:read' | 'item:create' | 'item:comment' | 'item:editContent' | 'item:editPriority'
  | 'item:claim' | 'item:assign' | 'item:submit' | 'item:sendBack' | 'item:approve'
  | 'item:close' | 'item:reopen' | 'item:cancel'
  | 'invitation:manage' | 'membership:manage' | 'job:manage'

export type ItemResource = { kind: 'item'; teamId: number; creatorId: number; assigneeId: number | null }
export type TeamResource = { kind: 'team'; teamId: number }

/**
 * The single resource-level authorization decision (spec §7 + §7.1 + §6).
 * `resource` is required for every membership-scoped action; when omitted
 * the answer is `false` because no team can be resolved for the actor.
 */
export async function can(
  actor: Actor,
  action: Action,
  resource?: ItemResource | TeamResource,
): Promise<boolean> {
  switch (action) {
    // Admin-only — true on `isAdmin` alone, team membership ignored (§7.1).
    case 'team:create':
    case 'team:listAll':
    case 'team:member:add':
    case 'job:manage':
      return actor.isAdmin
  }

  if (resource === undefined) return false
  const role = await roleIn(actor.id, resource.teamId)

  switch (action) {
    // Any membership role may read.
    case 'team:read':
    case 'item:read':
      return role !== null
    // Members and leads.
    case 'item:comment':
    case 'item:create':
    case 'item:editContent':
    case 'item:claim':
      return role === 'member' || role === 'lead'
    // Lead only.
    case 'item:editPriority':
    case 'item:assign':
    case 'item:approve':
    case 'item:sendBack':
    case 'item:close':
    case 'item:reopen':
    case 'invitation:manage':
    case 'membership:manage':
      return role === 'lead'
    // Assignee / creator dependent (§6): a lead may always do these. The
    // assignee/creator clause requires member standing — permission is
    // resolved for the resource's team, never once for the user (§7), and
    // the viewer column is — for both transitions.
    case 'item:submit':
      return role === 'lead' || (role === 'member' && resource.kind === 'item' && actor.id === resource.assigneeId)
    case 'item:cancel':
      return role === 'lead' || (role === 'member' && resource.kind === 'item' && actor.id === resource.creatorId)
    default: {
      const exhaustive: never = action
      return exhaustive
    }
  }
}

/**
 * Returns all team IDs the actor is a member of.
 * Never returns all teams for an admin — an admin does not see others' work items (§7.1).
 */
export async function scopeTeamIds(actor: Actor): Promise<number[]> {
  const memberships = await membershipsOf(actor.id)
  return memberships.map((m) => m.teamId)
}

/**
 * Authorizes `actor` for `action` on `resource`.
 * Throws `NOT_FOUND` (404) if the actor has no membership in the resource's team.
 * Throws `FORBIDDEN` (403) if the actor is a member but lacks permission.
 */
export async function authorize(
  actor: Actor,
  action: Action,
  resource: ItemResource | TeamResource,
): Promise<void> {
  const allowed = await can(actor, action, resource)
  if (allowed) return

  const role = await roleIn(actor.id, resource.teamId)
  if (role === null) {
    throw ApiError.of('NOT_FOUND')
  }
  throw ApiError.of('FORBIDDEN')
}
