import { and, eq } from 'drizzle-orm'
import { db } from '../db/client'
import { memberships } from '../db/schema'
import type { Role } from '../domain/types'

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
