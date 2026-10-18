import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { resetDb, seedUser, seedTeam, seedMembership } from '../helpers/db'
import { roleIn, membershipsOf } from '../../src/policy'
import { closeDb } from '../../src/db/client'

describe('roleIn', () => {
  beforeEach(resetDb); afterAll(closeDb)
  it('returns the role, or null when not a member', async () => {
    const u = await seedUser(); const t = await seedTeam(); const other = await seedTeam({ slug: 'other' })
    await seedMembership(u.id, t.id, 'member')
    expect(await roleIn(u.id, t.id)).toBe('member')
    expect(await roleIn(u.id, other.id)).toBeNull()
  })
  it('lists memberships', async () => {
    const u = await seedUser(); const t = await seedTeam()
    await seedMembership(u.id, t.id, 'lead')
    expect(await membershipsOf(u.id)).toEqual([{ teamId: t.id, role: 'lead' }])
  })
})
