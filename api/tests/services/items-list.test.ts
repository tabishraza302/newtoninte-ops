import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { closeDb } from '../../src/db/client'
import { ApiError } from '../../src/http/errors'
import { getItem, listItems } from '../../src/services/items'
import { resetDb, seedItem, seedMembership, seedTeam, seedUser } from '../helpers/db'
import type { Actor, ItemType, Priority, Status } from '../../src/domain/types'

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

describe('items service - listItems & getItem (Task 3.1)', () => {
  beforeEach(resetDb)
  afterAll(closeDb)

  it('team scoping: user with no teams returns empty list with null cursor', async () => {
    const user = await seedUser()
    const team = await seedTeam()
    await seedItem(team.id, { createdBy: user.id })

    const actor: Actor = { id: user.id, isAdmin: false }
    const result = await listItems(actor, {})

    expect(result.items).toEqual([])
    expect(result.nextCursor).toBeNull()
  })

  it('team scoping: user only sees items from teams they belong to', async () => {
    const user = await seedUser()
    const otherUser = await seedUser()
    const teamA = await seedTeam({ name: 'Team A', slug: 'team-a' })
    const teamB = await seedTeam({ name: 'Team B', slug: 'team-b' })

    await seedMembership(user.id, teamA.id, 'member')

    const itemA = await seedItem(teamA.id, { createdBy: user.id, title: 'Item on Team A' })
    await seedItem(teamB.id, { createdBy: otherUser.id, title: 'Item on Team B' })

    const actor: Actor = { id: user.id, isAdmin: false }
    const result = await listItems(actor, {})

    expect(result.items).toHaveLength(1)
    expect(result.items[0]?.id).toBe(itemA.id)
    expect(result.items[0]?.teamId).toBe(teamA.id)
  })

  it('team scoping: query.team for foreign team throws NOT_FOUND', async () => {
    const user = await seedUser()
    const teamA = await seedTeam({ name: 'Team A', slug: 'team-a' })
    const teamB = await seedTeam({ name: 'Team B', slug: 'team-b' })

    await seedMembership(user.id, teamA.id, 'member')

    const actor: Actor = { id: user.id, isAdmin: false }
    expect(await errorCode(() => listItems(actor, { team: teamB.id }))).toBe('NOT_FOUND')
  })

  it('team scoping: query.team narrows to requested team when actor is a member of multiple teams', async () => {
    const user = await seedUser()
    const teamA = await seedTeam({ name: 'Team A', slug: 'team-a' })
    const teamB = await seedTeam({ name: 'Team B', slug: 'team-b' })

    await seedMembership(user.id, teamA.id, 'member')
    await seedMembership(user.id, teamB.id, 'member')

    const itemA = await seedItem(teamA.id, { createdBy: user.id, title: 'A Item' })
    const itemB = await seedItem(teamB.id, { createdBy: user.id, title: 'B Item' })

    const actor: Actor = { id: user.id, isAdmin: false }

    const resA = await listItems(actor, { team: teamA.id })
    expect(resA.items.map((i) => i.id)).toEqual([itemA.id])

    const resB = await listItems(actor, { team: teamB.id })
    expect(resB.items.map((i) => i.id)).toEqual([itemB.id])
  })

  it('filters: status, priority, assignee, type narrow correctly', async () => {
    const user = await seedUser()
    const assignee1 = await seedUser({ displayName: 'Assignee One' })
    const assignee2 = await seedUser({ displayName: 'Assignee Two' })
    const team = await seedTeam()

    await seedMembership(user.id, team.id, 'member')
    await seedMembership(assignee1.id, team.id, 'member')
    await seedMembership(assignee2.id, team.id, 'member')

    const target = await seedItem(team.id, {
      createdBy: user.id,
      assigneeId: assignee1.id,
      status: 'in_progress',
      priority: 'urgent',
      type: 'incident',
      title: 'Target Item',
    })

    await seedItem(team.id, {
      createdBy: user.id,
      assigneeId: assignee2.id,
      status: 'open',
      priority: 'high',
      type: 'task',
      title: 'Other Item',
    })

    const actor: Actor = { id: user.id, isAdmin: false }

    const byStatus = await listItems(actor, { status: 'in_progress' as Status })
    expect(byStatus.items.map((i) => i.id)).toEqual([target.id])

    const byPriority = await listItems(actor, { priority: 'urgent' as Priority })
    expect(byPriority.items.map((i) => i.id)).toEqual([target.id])

    const byAssignee = await listItems(actor, { assignee: assignee1.id })
    expect(byAssignee.items.map((i) => i.id)).toEqual([target.id])

    const byType = await listItems(actor, { type: 'incident' as ItemType })
    expect(byType.items.map((i) => i.id)).toEqual([target.id])

    const combined = await listItems(actor, {
      status: 'in_progress' as Status,
      priority: 'urgent' as Priority,
      assignee: assignee1.id,
      type: 'incident' as ItemType,
    })
    expect(combined.items.map((i) => i.id)).toEqual([target.id])
  })

  it('keyset pagination: orders priority DESC, created_at DESC, id DESC', async () => {
    const user = await seedUser()
    const team = await seedTeam()
    await seedMembership(user.id, team.id, 'member')

    const t1 = new Date('2026-10-18T10:00:00.000Z')
    const t2 = new Date('2026-10-18T11:00:00.000Z')

    const itemLow = await seedItem(team.id, { createdBy: user.id, priority: 'low', createdAt: t2 })
    const itemMedium = await seedItem(team.id, { createdBy: user.id, priority: 'medium', createdAt: t1 })
    const itemHighOlder = await seedItem(team.id, { createdBy: user.id, priority: 'high', createdAt: t1 })
    const itemHighNewer = await seedItem(team.id, { createdBy: user.id, priority: 'high', createdAt: t2 })
    const itemUrgent = await seedItem(team.id, { createdBy: user.id, priority: 'urgent', createdAt: t1 })

    const actor: Actor = { id: user.id, isAdmin: false }
    const result = await listItems(actor, {})

    const expectedOrder = [
      itemUrgent.id,
      itemHighNewer.id,
      itemHighOlder.id,
      itemMedium.id,
      itemLow.id,
    ]
    expect(result.items.map((i) => i.id)).toEqual(expectedOrder)
  })

  it('keyset pagination: pages cleanly without overlap or missing rows', async () => {
    const user = await seedUser()
    const team = await seedTeam()
    await seedMembership(user.id, team.id, 'member')

    const baseTime = new Date('2026-10-18T10:00:00.000Z')
    const items = []
    for (let i = 0; i < 5; i++) {
      const item = await seedItem(team.id, {
        createdBy: user.id,
        priority: 'medium',
        createdAt: new Date(baseTime.getTime() + i * 1000),
      })
      items.push(item)
    }

    const actor: Actor = { id: user.id, isAdmin: false }

    const page1 = await listItems(actor, { limit: 2 })
    expect(page1.items).toHaveLength(2)
    expect(page1.nextCursor).not.toBeNull()

    const page2 = await listItems(actor, { limit: 2, cursor: page1.nextCursor ?? undefined })
    expect(page2.items).toHaveLength(2)
    expect(page2.nextCursor).not.toBeNull()

    const page3 = await listItems(actor, { limit: 2, cursor: page2.nextCursor ?? undefined })
    expect(page3.items).toHaveLength(1)
    expect(page3.nextCursor).toBeNull()

    const allIds = [
      ...page1.items.map((i) => i.id),
      ...page2.items.map((i) => i.id),
      ...page3.items.map((i) => i.id),
    ]

    expect(new Set(allIds).size).toBe(5)
  })

  it('keyset pagination: handles identical priority and identical createdAt correctly', async () => {
    const user = await seedUser()
    const team = await seedTeam()
    await seedMembership(user.id, team.id, 'member')

    const sameTime = new Date('2026-10-18T12:00:00.000Z')
    const item1 = await seedItem(team.id, { createdBy: user.id, priority: 'urgent', createdAt: sameTime })
    const item2 = await seedItem(team.id, { createdBy: user.id, priority: 'urgent', createdAt: sameTime })
    const item3 = await seedItem(team.id, { createdBy: user.id, priority: 'urgent', createdAt: sameTime })

    const actor: Actor = { id: user.id, isAdmin: false }

    const page1 = await listItems(actor, { limit: 2 })
    expect(page1.items).toHaveLength(2)
    expect(page1.items.map((i) => i.id)).toEqual([item3.id, item2.id])
    expect(page1.nextCursor).not.toBeNull()

    const page2 = await listItems(actor, { limit: 2, cursor: page1.nextCursor ?? undefined })
    expect(page2.items).toHaveLength(1)
    expect(page2.items.map((i) => i.id)).toEqual([item1.id])
    expect(page2.nextCursor).toBeNull()
  })

  it('keyset pagination: cursor scope mismatch throws VALIDATION_ERROR', async () => {
    const user = await seedUser()
    const teamA = await seedTeam({ name: 'Team A', slug: 'team-a' })
    const teamB = await seedTeam({ name: 'Team B', slug: 'team-b' })
    await seedMembership(user.id, teamA.id, 'member')
    await seedMembership(user.id, teamB.id, 'member')

    await seedItem(teamA.id, { createdBy: user.id })
    await seedItem(teamA.id, { createdBy: user.id })
    await seedItem(teamB.id, { createdBy: user.id })

    const actor: Actor = { id: user.id, isAdmin: false }

    const page1 = await listItems(actor, { team: teamA.id, limit: 1 })
    expect(page1.nextCursor).not.toBeNull()

    expect(
      await errorCode(() => listItems(actor, { team: teamB.id, cursor: page1.nextCursor ?? undefined })),
    ).toBe('VALIDATION_ERROR')
  })

  it('validation: invalid limits and malformed cursors throw VALIDATION_ERROR', async () => {
    const user = await seedUser()
    const team = await seedTeam()
    await seedMembership(user.id, team.id, 'member')
    const actor: Actor = { id: user.id, isAdmin: false }

    expect(await errorCode(() => listItems(actor, { limit: 0 }))).toBe('VALIDATION_ERROR')
    expect(await errorCode(() => listItems(actor, { limit: 101 }))).toBe('VALIDATION_ERROR')
    expect(await errorCode(() => listItems(actor, { limit: -5 }))).toBe('VALIDATION_ERROR')
    expect(await errorCode(() => listItems(actor, { limit: 2.5 }))).toBe('VALIDATION_ERROR')

    expect(await errorCode(() => listItems(actor, { cursor: 'not-base64-json' }))).toBe('VALIDATION_ERROR')
  })

  it('getItem: returns item with creator and assignee info', async () => {
    const creator = await seedUser({ displayName: 'Creator User', email: 'creator@example.test' })
    const assignee = await seedUser({ displayName: 'Assignee User', email: 'assignee@example.test' })
    const team = await seedTeam()

    await seedMembership(creator.id, team.id, 'member')
    await seedMembership(assignee.id, team.id, 'member')

    const item = await seedItem(team.id, {
      createdBy: creator.id,
      assigneeId: assignee.id,
      title: 'Detailed Item',
      description: 'Item description',
    })

    const actor: Actor = { id: creator.id, isAdmin: false }
    const fetched = await getItem(actor, item.id)

    expect(fetched.id).toBe(item.id)
    expect(fetched.title).toBe('Detailed Item')
    expect(fetched.description).toBe('Item description')
    expect(fetched.creator).toEqual({
      id: creator.id,
      displayName: 'Creator User',
      email: 'creator@example.test',
    })
    expect(fetched.assignee).toEqual({
      id: assignee.id,
      displayName: 'Assignee User',
      email: 'assignee@example.test',
    })
  })

  it('getItem: unassigned item returns assignee: null', async () => {
    const creator = await seedUser()
    const team = await seedTeam()
    await seedMembership(creator.id, team.id, 'member')

    const item = await seedItem(team.id, {
      createdBy: creator.id,
      assigneeId: null,
      title: 'Unassigned Item',
    })

    const actor: Actor = { id: creator.id, isAdmin: false }
    const fetched = await getItem(actor, item.id)

    expect(fetched.assignee).toBeNull()
  })

  it('getItem: outsider throws NOT_FOUND (404), hiding item existence', async () => {
    const creator = await seedUser()
    const outsider = await seedUser()
    const team = await seedTeam()
    await seedMembership(creator.id, team.id, 'member')

    const item = await seedItem(team.id, { createdBy: creator.id })

    const outsiderActor: Actor = { id: outsider.id, isAdmin: false }
    expect(await errorCode(() => getItem(outsiderActor, item.id))).toBe('NOT_FOUND')

    expect(await errorCode(() => getItem(outsiderActor, 999999))).toBe('NOT_FOUND')
  })

  it('getItem: non-member admin throws NOT_FOUND (admin has no work-item superpower)', async () => {
    const creator = await seedUser()
    const adminUser = await seedUser()
    const team = await seedTeam()
    await seedMembership(creator.id, team.id, 'member')

    const item = await seedItem(team.id, { createdBy: creator.id })

    const adminActor: Actor = { id: adminUser.id, isAdmin: true }
    expect(await errorCode(() => getItem(adminActor, item.id))).toBe('NOT_FOUND')
  })
})
