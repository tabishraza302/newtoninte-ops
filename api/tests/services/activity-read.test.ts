import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { closeDb, db } from '../../src/db/client'
import { activityEvents } from '../../src/db/schema'
import { ApiError } from '../../src/http/errors'
import { listActivity } from '../../src/services/items'
import { resetDb, seedItem, seedMembership, seedTeam, seedUser } from '../helpers/db'
import type { NewActivityEvent } from '../../src/db/schema'
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

async function seedActivity(
  workItemId: number,
  o: Partial<NewActivityEvent> = {},
) {
  const [inserted] = await db
    .insert(activityEvents)
    .values({
      workItemId,
      type: 'created',
      ...o,
    })
    .$returningId()
  const id = inserted?.id
  if (id === undefined) throw new Error('seedActivity: insert returned no id')
  const [row] = await db.select().from(activityEvents).where(eq(activityEvents.id, id)).limit(1)
  if (!row) throw new Error('seedActivity: inserted row could not be read back')
  return row
}

describe('items service - activity read timeline (Task 3.4)', () => {
  beforeEach(resetDb)
  afterAll(closeDb)

  it('authorizes item:read first: outsider gets NOT_FOUND (404)', async () => {
    const creator = await seedUser()
    const outsider = await seedUser()
    const team = await seedTeam()
    await seedMembership(creator.id, team.id, 'member')

    const item = await seedItem(team.id, { createdBy: creator.id })
    await seedActivity(item.id, { actorId: creator.id, type: 'created' })

    const outsiderActor: Actor = { id: outsider.id, isAdmin: false }
    expect(await errorCode(() => listActivity(outsiderActor, item.id))).toBe('NOT_FOUND')
  })

  it('returns NOT_FOUND for non-existent item id', async () => {
    const user = await seedUser()
    const team = await seedTeam()
    await seedMembership(user.id, team.id, 'member')

    const actor: Actor = { id: user.id, isAdmin: false }
    expect(await errorCode(() => listActivity(actor, 999999))).toBe('NOT_FOUND')
  })

  it('non-member admin gets NOT_FOUND (no admin work-item superpower)', async () => {
    const creator = await seedUser()
    const admin = await seedUser()
    const team = await seedTeam()
    await seedMembership(creator.id, team.id, 'member')

    const item = await seedItem(team.id, { createdBy: creator.id })
    await seedActivity(item.id, { actorId: creator.id, type: 'created' })

    const adminActor: Actor = { id: admin.id, isAdmin: true }
    expect(await errorCode(() => listActivity(adminActor, item.id))).toBe('NOT_FOUND')
  })

  it('returns events oldest-first (id ASC) with actor info', async () => {
    const creator = await seedUser({ displayName: 'Creator User', email: 'creator@example.test' })
    const updater = await seedUser({ displayName: 'Updater User', email: 'updater@example.test' })
    const team = await seedTeam()
    await seedMembership(creator.id, team.id, 'member')
    await seedMembership(updater.id, team.id, 'member')

    const item = await seedItem(team.id, { createdBy: creator.id })

    const ev1 = await seedActivity(item.id, { actorId: creator.id, type: 'created' })
    const ev2 = await seedActivity(item.id, {
      actorId: updater.id,
      type: 'status_changed',
      fromValue: 'open',
      toValue: 'in_progress',
    })
    const ev3 = await seedActivity(item.id, {
      actorId: null,
      type: 'due_changed',
      toValue: '2026-10-25T00:00:00.000Z',
    })

    const actor: Actor = { id: creator.id, isAdmin: false }
    const result = await listActivity(actor, item.id)

    expect(result.events).toHaveLength(3)
    expect(result.events.map((e) => e.id)).toEqual([ev1.id, ev2.id, ev3.id])

    expect(result.events[0]?.actor).toEqual({
      id: creator.id,
      displayName: 'Creator User',
      email: 'creator@example.test',
    })
    expect(result.events[1]?.actor).toEqual({
      id: updater.id,
      displayName: 'Updater User',
      email: 'updater@example.test',
    })
    expect(result.events[2]?.actor).toBeNull()
  })

  it('includes comment_added event with metadata.body', async () => {
    const user = await seedUser()
    const team = await seedTeam()
    await seedMembership(user.id, team.id, 'member')

    const item = await seedItem(team.id, { createdBy: user.id })

    await seedActivity(item.id, {
      actorId: user.id,
      type: 'comment_added',
      metadata: { body: 'Investigating this issue now.' },
    })

    const actor: Actor = { id: user.id, isAdmin: false }
    const result = await listActivity(actor, item.id)

    expect(result.events).toHaveLength(1)
    const commentEvent = result.events[0]
    expect(commentEvent?.type).toBe('comment_added')
    expect(commentEvent?.metadata).toEqual({ body: 'Investigating this issue now.' })
  })

  it('paginates timeline with keyset cursor and limit', async () => {
    const user = await seedUser()
    const team = await seedTeam()
    await seedMembership(user.id, team.id, 'member')

    const item = await seedItem(team.id, { createdBy: user.id })

    const events = []
    for (let i = 0; i < 5; i++) {
      const ev = await seedActivity(item.id, {
        actorId: user.id,
        type: 'comment_added',
        metadata: { body: `Comment #${i + 1}` },
      })
      events.push(ev)
    }

    const actor: Actor = { id: user.id, isAdmin: false }

    const page1 = await listActivity(actor, item.id, undefined, 2)
    expect(page1.events).toHaveLength(2)
    expect(page1.events.map((e) => e.id)).toEqual([events[0]?.id, events[1]?.id])
    expect(page1.nextCursor).not.toBeNull()

    const page2 = await listActivity(actor, item.id, page1.nextCursor ?? undefined, 2)
    expect(page2.events).toHaveLength(2)
    expect(page2.events.map((e) => e.id)).toEqual([events[2]?.id, events[3]?.id])
    expect(page2.nextCursor).not.toBeNull()

    const page3 = await listActivity(actor, item.id, page2.nextCursor ?? undefined, 2)
    expect(page3.events).toHaveLength(1)
    expect(page3.events.map((e) => e.id)).toEqual([events[4]?.id])
    expect(page3.nextCursor).toBeNull()
  })

  it('rejects cursor minted for another item with VALIDATION_ERROR', async () => {
    const user = await seedUser()
    const team = await seedTeam()
    await seedMembership(user.id, team.id, 'member')

    const itemA = await seedItem(team.id, { createdBy: user.id })
    const itemB = await seedItem(team.id, { createdBy: user.id })

    await seedActivity(itemA.id, { actorId: user.id, type: 'created' })
    await seedActivity(itemA.id, { actorId: user.id, type: 'comment_added' })
    await seedActivity(itemB.id, { actorId: user.id, type: 'created' })

    const actor: Actor = { id: user.id, isAdmin: false }

    const page1 = await listActivity(actor, itemA.id, undefined, 1)
    expect(page1.nextCursor).not.toBeNull()

    expect(
      await errorCode(() => listActivity(actor, itemB.id, page1.nextCursor ?? undefined, 1)),
    ).toBe('VALIDATION_ERROR')
  })

  it('validates limits and cursors', async () => {
    const user = await seedUser()
    const team = await seedTeam()
    await seedMembership(user.id, team.id, 'member')

    const item = await seedItem(team.id, { createdBy: user.id })
    const actor: Actor = { id: user.id, isAdmin: false }

    expect(await errorCode(() => listActivity(actor, item.id, undefined, 0))).toBe('VALIDATION_ERROR')
    expect(await errorCode(() => listActivity(actor, item.id, undefined, 101))).toBe('VALIDATION_ERROR')
    expect(await errorCode(() => listActivity(actor, item.id, undefined, -1))).toBe('VALIDATION_ERROR')
    expect(await errorCode(() => listActivity(actor, item.id, 'bad-cursor'))).toBe('VALIDATION_ERROR')
  })
})
