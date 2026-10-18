import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { closeDb, db } from '../../src/db/client'
import { activityEvents, workItems } from '../../src/db/schema'
import { ApiError } from '../../src/http/errors'
import { claimItem } from '../../src/services/items'
import { resetDb, seedItem, seedMembership, seedTeam, seedUser } from '../helpers/db'
import type { Actor } from '../../src/domain/types'

describe('items service - claimItem (Task 4.5)', () => {
  beforeEach(resetDb)
  afterAll(closeDb)

  it('claims open unowned item: in_progress, assignee=actor, version+1, two events', async () => {
    const user = await seedUser()
    const team = await seedTeam()
    await seedMembership(user.id, team.id, 'member')

    const item = await seedItem(team.id, {
      createdBy: user.id,
      status: 'open',
      assigneeId: null,
      version: 1,
    })

    const actor: Actor = { id: user.id, isAdmin: false }
    const claimed = await claimItem(actor, item.id)

    expect(claimed.id).toBe(item.id)
    expect(claimed.status).toBe('in_progress')
    expect(claimed.assigneeId).toBe(user.id)
    expect(claimed.assignee?.id).toBe(user.id)
    expect(claimed.version).toBe(2)

    const events = await db
      .select()
      .from(activityEvents)
      .where(eq(activityEvents.workItemId, item.id))

    expect(events).toHaveLength(2)

    const assigneeEvent = events.find((e) => e.type === 'assignee_changed')
    expect(assigneeEvent).toBeDefined()
    expect(assigneeEvent?.fromValue).toBeNull()
    expect(assigneeEvent?.toValue).toBe(String(user.id))
    expect(assigneeEvent?.actorId).toBe(user.id)

    const statusEvent = events.find((e) => e.type === 'status_changed')
    expect(statusEvent).toBeDefined()
    expect(statusEvent?.fromValue).toBe('open')
    expect(statusEvent?.toValue).toBe('in_progress')
    expect(statusEvent?.actorId).toBe(user.id)
  })

  it('claiming an already claimed item throws 409 ALREADY_CLAIMED', async () => {
    const user1 = await seedUser()
    const user2 = await seedUser()
    const team = await seedTeam()
    await seedMembership(user1.id, team.id, 'member')
    await seedMembership(user2.id, team.id, 'member')

    const item = await seedItem(team.id, {
      createdBy: user1.id,
      status: 'open',
      assigneeId: null,
      version: 1,
    })

    const actor1: Actor = { id: user1.id, isAdmin: false }
    const actor2: Actor = { id: user2.id, isAdmin: false }

    await claimItem(actor1, item.id)

    let caughtError: unknown
    try {
      await claimItem(actor2, item.id)
    } catch (e) {
      caughtError = e
    }

    expect(caughtError).toBeInstanceOf(ApiError)
    const err = caughtError as ApiError
    expect(err.code).toBe('ALREADY_CLAIMED')
    expect(err.status).toBe(409)

    // Ensure item still belongs to user1
    const [row] = await db.select().from(workItems).where(eq(workItems.id, item.id)).limit(1)
    expect(row?.assigneeId).toBe(user1.id)
    expect(row?.status).toBe('in_progress')
  })

  it('claiming an open item already assigned to someone else throws 409 ALREADY_CLAIMED', async () => {
    const user1 = await seedUser()
    const user2 = await seedUser()
    const team = await seedTeam()
    await seedMembership(user1.id, team.id, 'member')
    await seedMembership(user2.id, team.id, 'member')

    const item = await seedItem(team.id, {
      createdBy: user1.id,
      status: 'open',
      assigneeId: user1.id,
      version: 1,
    })

    const actor2: Actor = { id: user2.id, isAdmin: false }

    let caughtError: unknown
    try {
      await claimItem(actor2, item.id)
    } catch (e) {
      caughtError = e
    }

    expect(caughtError).toBeInstanceOf(ApiError)
    expect((caughtError as ApiError).code).toBe('ALREADY_CLAIMED')
  })

  it('claiming an item not in open status throws 409 ALREADY_CLAIMED', async () => {
    const user = await seedUser()
    const team = await seedTeam()
    await seedMembership(user.id, team.id, 'member')

    const item = await seedItem(team.id, {
      createdBy: user.id,
      status: 'resolved',
      assigneeId: null,
      version: 1,
    })

    const actor: Actor = { id: user.id, isAdmin: false }

    let caughtError: unknown
    try {
      await claimItem(actor, item.id)
    } catch (e) {
      caughtError = e
    }

    expect(caughtError).toBeInstanceOf(ApiError)
    expect((caughtError as ApiError).code).toBe('ALREADY_CLAIMED')
  })

  it('viewer of team gets FORBIDDEN on claim', async () => {
    const viewer = await seedUser()
    const team = await seedTeam()
    await seedMembership(viewer.id, team.id, 'viewer')

    const item = await seedItem(team.id, {
      status: 'open',
      assigneeId: null,
      version: 1,
    })

    const actor: Actor = { id: viewer.id, isAdmin: false }

    let caughtError: unknown
    try {
      await claimItem(actor, item.id)
    } catch (e) {
      caughtError = e
    }

    expect(caughtError).toBeInstanceOf(ApiError)
    expect((caughtError as ApiError).code).toBe('FORBIDDEN')
  })

  it('foreign-team item returns NOT_FOUND', async () => {
    const outsider = await seedUser()
    const member = await seedUser()
    const team = await seedTeam()
    await seedMembership(member.id, team.id, 'member')

    const item = await seedItem(team.id, {
      createdBy: member.id,
      status: 'open',
      assigneeId: null,
      version: 1,
    })

    const actor: Actor = { id: outsider.id, isAdmin: false }

    let caughtError: unknown
    try {
      await claimItem(actor, item.id)
    } catch (e) {
      caughtError = e
    }

    expect(caughtError).toBeInstanceOf(ApiError)
    expect((caughtError as ApiError).code).toBe('NOT_FOUND')
  })

  it('non-existent item returns NOT_FOUND', async () => {
    const user = await seedUser()
    const actor: Actor = { id: user.id, isAdmin: false }

    let caughtError: unknown
    try {
      await claimItem(actor, 999999)
    } catch (e) {
      caughtError = e
    }

    expect(caughtError).toBeInstanceOf(ApiError)
    expect((caughtError as ApiError).code).toBe('NOT_FOUND')
  })
})
