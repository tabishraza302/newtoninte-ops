import { eq } from 'drizzle-orm'
import { db } from '../../src/db/client'
import { memberships, teams, users, workItems } from '../../src/db/schema'
import type {
  NewTeam,
  NewUser,
  NewWorkItem,
  TeamRow,
  UserRow,
  WorkItemRow,
} from '../../src/db/schema'
import type { Role } from '../../src/domain/types'

// Defaults must stay unique across a test file even though `resetDb` truncates
// rows, so every defaulted value is derived from a monotonic counter.
let seq = 0
function nextSeq(): number {
  seq += 1
  return seq
}

/** Inserts a user, defaulting every required column to a unique test value. */
export async function seedUser(o: Partial<NewUser> = {}): Promise<UserRow> {
  const n = nextSeq()
  const [inserted] = await db
    .insert(users)
    .values({
      email: `user${n}@test.local`,
      passwordHash: 'test-password-hash',
      displayName: `Test User ${n}`,
      ...o,
    })
    .$returningId()
  const id = inserted?.id
  if (id === undefined) throw new Error('seedUser: insert returned no id')
  const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1)
  if (row === undefined) throw new Error('seedUser: inserted row could not be read back')
  return row
}

/** Inserts a team, defaulting every required column to a unique test value. */
export async function seedTeam(o: Partial<NewTeam> = {}): Promise<TeamRow> {
  const n = nextSeq()
  const [inserted] = await db
    .insert(teams)
    .values({
      name: `Test Team ${n}`,
      slug: `team-${n}`,
      ...o,
    })
    .$returningId()
  const id = inserted?.id
  if (id === undefined) throw new Error('seedTeam: insert returned no id')
  const [row] = await db.select().from(teams).where(eq(teams.id, id)).limit(1)
  if (row === undefined) throw new Error('seedTeam: inserted row could not be read back')
  return row
}

/** Grants `role` on `teamId` to `userId`. */
export async function seedMembership(userId: number, teamId: number, role: Role): Promise<void> {
  await db.insert(memberships).values({ userId, teamId, role })
}

/**
 * Inserts a work item on `teamId`. `work_items.created_by` is NOT NULL, so when
 * the caller does not supply one a throwaway creator user is seeded first.
 */
export async function seedItem(teamId: number, o: Partial<NewWorkItem> = {}): Promise<WorkItemRow> {
  const createdBy = o.createdBy ?? (await seedUser()).id
  const [inserted] = await db
    .insert(workItems)
    .values({
      title: 'Seeded work item',
      type: 'task',
      priority: 'medium',
      ...o,
      teamId,
      createdBy,
    })
    .$returningId()
  const id = inserted?.id
  if (id === undefined) throw new Error('seedItem: insert returned no id')
  const [row] = await db.select().from(workItems).where(eq(workItems.id, id)).limit(1)
  if (row === undefined) throw new Error('seedItem: inserted row could not be read back')
  return row
}
