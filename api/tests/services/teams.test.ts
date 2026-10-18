import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { resetDb, seedUser, seedTeam, seedMembership } from '../helpers/db'
import { closeDb } from '../../src/db/client'
import { createTeam, listTeams, getTeam } from '../../src/services/teams'
import { ApiError } from '../../src/http/errors'
import type { Actor } from '../../src/domain/types'

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

describe('teams service', () => {
  beforeEach(resetDb)
  afterAll(closeDb)

  it('createTeam: non-admin throws FORBIDDEN, admin creates and returns team row', async () => {
    const nonAdmin: Actor = { id: (await seedUser()).id, isAdmin: false }
    const admin: Actor = { id: (await seedUser()).id, isAdmin: true }

    expect(await errorCode(() => createTeam(nonAdmin, { name: 'Apollo', slug: 'apollo' }))).toBe('FORBIDDEN')

    const created = await createTeam(admin, { name: 'Apollo', slug: 'apollo' })
    expect(created.id).toBeGreaterThan(0)
    expect(created.name).toBe('Apollo')
    expect(created.slug).toBe('apollo')
    expect(created.createdAt).toBeInstanceOf(Date)
    expect(created.updatedAt).toBeInstanceOf(Date)
  })

  it('createTeam: duplicate slug throws VALIDATION_ERROR', async () => {
    const admin: Actor = { id: (await seedUser()).id, isAdmin: true }
    await createTeam(admin, { name: 'First Team', slug: 'unique-slug' })

    expect(
      await errorCode(() => createTeam(admin, { name: 'Second Team', slug: 'unique-slug' })),
    ).toBe('VALIDATION_ERROR')
  })

  it('listTeams: returns only teams the actor belongs to, unless admin with all: true', async () => {
    const user1 = await seedUser({ email: 'user1@example.test' })
    const user2 = await seedUser({ email: 'user2@example.test' })
    const adminUser = await seedUser({ email: 'admin@example.test' })

    const teamA = await seedTeam({ name: 'Team Alpha', slug: 'alpha' })
    const teamB = await seedTeam({ name: 'Team Beta', slug: 'beta' })
    const teamC = await seedTeam({ name: 'Team Gamma', slug: 'gamma' })

    await seedMembership(user1.id, teamA.id, 'member')
    await seedMembership(user1.id, teamB.id, 'lead')
    await seedMembership(user2.id, teamC.id, 'viewer')

    const actor1: Actor = { id: user1.id, isAdmin: false }
    const actor2: Actor = { id: user2.id, isAdmin: false }
    const adminActor: Actor = { id: adminUser.id, isAdmin: true }

    const list1 = await listTeams(actor1)
    expect(list1.map((t) => t.id)).toEqual([teamA.id, teamB.id])

    const list2 = await listTeams(actor2)
    expect(list2.map((t) => t.id)).toEqual([teamC.id])

    // Non-admin attempting all: true gets FORBIDDEN
    expect(await errorCode(() => listTeams(actor1, { all: true }))).toBe('FORBIDDEN')

    // Admin with all: true gets all teams in the system
    const allList = await listTeams(adminActor, { all: true })
    const allIds = allList.map((t) => t.id)
    expect(allIds).toContain(teamA.id)
    expect(allIds).toContain(teamB.id)
    expect(allIds).toContain(teamC.id)
  })

  it('getTeam: 404s for foreign team, returns team row for member', async () => {
    const member = await seedUser({ email: 'member@example.test' })
    const outsider = await seedUser({ email: 'outsider@example.test' })
    const team = await seedTeam({ name: 'Secret Squad', slug: 'secret-squad' })

    await seedMembership(member.id, team.id, 'member')

    const memberActor: Actor = { id: member.id, isAdmin: false }
    const outsiderActor: Actor = { id: outsider.id, isAdmin: false }

    // Foreign team -> NOT_FOUND (404) per spec §7 rule 3
    expect(await errorCode(() => getTeam(outsiderActor, team.id))).toBe('NOT_FOUND')

    // Non-existent team -> NOT_FOUND
    expect(await errorCode(() => getTeam(memberActor, 999999))).toBe('NOT_FOUND')

    // Member -> returns team row
    const fetched = await getTeam(memberActor, team.id)
    expect(fetched.id).toBe(team.id)
    expect(fetched.name).toBe('Secret Squad')
    expect(fetched.slug).toBe('secret-squad')
  })
})
