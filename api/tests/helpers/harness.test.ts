import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { resetDb, seedUser, seedTeam, seedMembership } from './db'  // re-exported from helpers
import { closeDb } from '../../src/db/client'

describe('harness', () => {
  beforeEach(resetDb)
  afterAll(closeDb)
  it('seeds a user and a team with a membership', async () => {
    const u = await seedUser({ email: 'a@x.test' })
    const t = await seedTeam({ slug: 'ops' })
    await seedMembership(u.id, t.id, 'lead')
    expect(u.id).toBeGreaterThan(0)
  })
})
