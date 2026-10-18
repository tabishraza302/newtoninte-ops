import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { closeDb } from '../../src/db/client'
import { ApiError } from '../../src/http/errors'
import { listItems } from '../../src/services/items'
import { resetDb, seedItem, seedMembership, seedTeam, seedUser } from '../helpers/db'
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

describe('items service - escaped LIKE search (Task 3.3)', () => {
  beforeEach(resetDb)
  afterAll(closeDb)

  it('Review Focus #1: escapes % and _ properly in LIKE queries', async () => {
    const user = await seedUser()
    const team = await seedTeam()
    await seedMembership(user.id, team.id, 'member')

    const item100 = await seedItem(team.id, { createdBy: user.id, title: '100% done' })
    const itemAB = await seedItem(team.id, { createdBy: user.id, title: 'a_b' })
    const itemAXB = await seedItem(team.id, { createdBy: user.id, title: 'axb' })
    const itemPlain = await seedItem(team.id, { createdBy: user.id, title: 'plain' })

    const actor: Actor = { id: user.id, isAdmin: false }

    const resPercent = await listItems(actor, { q: '%' })
    expect(resPercent.items.map((i) => i.id)).toEqual([item100.id])

    const resUnderscore = await listItems(actor, { q: 'a_b' })
    expect(resUnderscore.items.map((i) => i.id)).toEqual([itemAB.id])

    const resAXB = await listItems(actor, { q: 'axb' })
    expect(resAXB.items.map((i) => i.id)).toEqual([itemAXB.id])

    const resPlain = await listItems(actor, { q: 'plain' })
    expect(resPlain.items.map((i) => i.id)).toEqual([itemPlain.id])
  })

  it('escapes backslash characters properly in LIKE queries', async () => {
    const user = await seedUser()
    const team = await seedTeam()
    await seedMembership(user.id, team.id, 'member')

    const itemSlash = await seedItem(team.id, { createdBy: user.id, title: 'path\\to\\file' })
    const itemNormal = await seedItem(team.id, { createdBy: user.id, title: 'pathtofile' })

    const actor: Actor = { id: user.id, isAdmin: false }

    const resSlash = await listItems(actor, { q: '\\to\\' })
    expect(resSlash.items.map((i) => i.id)).toEqual([itemSlash.id])

    const resNormal = await listItems(actor, { q: 'pathto' })
    expect(resNormal.items.map((i) => i.id)).toEqual([itemNormal.id])
  })

  it('rejects queries longer than 100 characters with VALIDATION_ERROR', async () => {
    const user = await seedUser()
    const team = await seedTeam()
    await seedMembership(user.id, team.id, 'member')

    const actor: Actor = { id: user.id, isAdmin: false }
    const longQuery = 'a'.repeat(101)

    expect(await errorCode(() => listItems(actor, { q: longQuery }))).toBe('VALIDATION_ERROR')

    const exactLimitQuery = 'a'.repeat(100)
    const result = await listItems(actor, { q: exactLimitQuery })
    expect(result.items).toEqual([])
  })

  it('search respects team scoping and does not leak items from foreign teams', async () => {
    const user = await seedUser()
    const otherUser = await seedUser()
    const myTeam = await seedTeam({ name: 'My Team', slug: 'my-team' })
    const foreignTeam = await seedTeam({ name: 'Foreign Team', slug: 'foreign-team' })

    await seedMembership(user.id, myTeam.id, 'member')

    await seedItem(myTeam.id, { createdBy: user.id, title: 'Secret Database Migration' })
    await seedItem(foreignTeam.id, { createdBy: otherUser.id, title: 'Secret Nuclear Launch Codes' })

    const actor: Actor = { id: user.id, isAdmin: false }
    const res = await listItems(actor, { q: 'Secret' })

    expect(res.items).toHaveLength(1)
    expect(res.items[0]?.title).toBe('Secret Database Migration')
  })

  it('search composes with filters and pagination', async () => {
    const user = await seedUser()
    const team = await seedTeam()
    await seedMembership(user.id, team.id, 'member')

    const openBug1 = await seedItem(team.id, {
      createdBy: user.id,
      title: 'Bug in authentication',
      status: 'open',
      priority: 'high',
    })
    const openBug2 = await seedItem(team.id, {
      createdBy: user.id,
      title: 'Bug in billing',
      status: 'open',
      priority: 'low',
    })
    await seedItem(team.id, {
      createdBy: user.id,
      title: 'Bug in dashboard',
      status: 'closed',
      priority: 'high',
    })

    const actor: Actor = { id: user.id, isAdmin: false }

    const res = await listItems(actor, { q: 'Bug', status: 'open', limit: 1 })
    expect(res.items).toHaveLength(1)
    expect(res.items[0]?.id).toBe(openBug1.id)
    expect(res.nextCursor).not.toBeNull()

    const page2 = await listItems(actor, { q: 'Bug', status: 'open', limit: 1, cursor: res.nextCursor ?? undefined })
    expect(page2.items).toHaveLength(1)
    expect(page2.items[0]?.id).toBe(openBug2.id)
    expect(page2.nextCursor).toBeNull()
  })
})
