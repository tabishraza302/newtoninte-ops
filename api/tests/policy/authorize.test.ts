import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { resetDb, seedUser, seedTeam, seedMembership, seedItem } from '../helpers/db'
import { authorize, scopeTeamIds } from '../../src/policy'
import { ApiError } from '../../src/http/errors'
import { closeDb } from '../../src/db/client'

async function errorCode(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn()
    return 'NO_THROW'
  } catch (e: unknown) {
    if (e instanceof ApiError) {
      return e.code
    }
    throw e
  }
}

describe('authorize / scopeTeamIds', () => {
  beforeEach(resetDb)
  afterAll(closeDb)

  it('404s a non-member, 403s an under-privileged member', async () => {
    const team = await seedTeam()
    const member = await seedUser()
    const outsider = await seedUser({ email: 'outsider@example.test' })
    await seedMembership(member.id, team.id, 'member')
    const item = await seedItem(team.id, { createdBy: member.id })
    const res = {
      kind: 'item' as const,
      teamId: team.id,
      creatorId: item.createdBy,
      assigneeId: item.assigneeId,
    }

    expect(await errorCode(() => authorize({ id: outsider.id, isAdmin: false }, 'item:read', res))).toBe('NOT_FOUND')
    expect(await errorCode(() => authorize({ id: member.id, isAdmin: false }, 'item:approve', res))).toBe('FORBIDDEN')
  })

  it('scopeTeamIds lists only my teams', async () => {
    const a = await seedUser({ email: 'user_a@example.test' })
    const t1 = await seedTeam({ slug: 'team-1' })
    const t2 = await seedTeam({ slug: 'team-2' })
    await seedMembership(a.id, t1.id, 'viewer')

    expect(await scopeTeamIds({ id: a.id, isAdmin: false })).toEqual([t1.id])
    expect(await scopeTeamIds({ id: a.id, isAdmin: false })).not.toContain(t2.id)
  })
})
