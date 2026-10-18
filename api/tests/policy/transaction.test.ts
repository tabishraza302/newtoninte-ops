import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { db, closeDb } from '../../src/db/client'
import { memberships } from '../../src/db/schema'
import { withTransaction } from '../../src/db/tx'
import { authorize } from '../../src/policy'
import { resetDb, seedMembership, seedTeam, seedUser } from '../helpers/db'

describe('transaction-local authorization', () => {
  beforeEach(resetDb)
  afterAll(closeDb)

  it('rejects a demoted actor even after the transaction established an older snapshot', async () => {
    const user = await seedUser()
    const team = await seedTeam()
    await seedMembership(user.id, team.id, 'member')
    const actor = { id: user.id, isAdmin: false }

    await withTransaction(async (tx) => {
      const predicate = and(eq(memberships.userId, user.id), eq(memberships.teamId, team.id))
      const [before] = await tx.select({ role: memberships.role }).from(memberships).where(predicate)
      expect(before?.role).toBe('member')
      await db.update(memberships).set({ role: 'viewer' }).where(predicate)
      await expect(authorize(actor, 'item:create', { kind: 'team', teamId: team.id }, tx))
        .rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' })
    })
  })
})
