import { asc, eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { closeDb, db } from '../../src/db/client'
import { activityEvents } from '../../src/db/schema'
import { withTransaction } from '../../src/db/tx'
import { FIELD_EVENT, recordActivity, recordFieldChanges } from '../../src/services/activity'
import { resetDb, seedItem, seedMembership, seedTeam, seedUser } from '../helpers/db'

describe('activity service (Task 4.1)', () => {
  beforeEach(resetDb)
  afterAll(closeDb)

  it('exports expected FIELD_EVENT mapping', () => {
    expect(FIELD_EVENT).toEqual({
      title: 'title_changed',
      description: 'description_changed',
      type: 'type_changed',
      due_at: 'due_changed',
      priority: 'priority_changed',
    })
  })

  it('recordActivity inserts into activity_events correctly', async () => {
    const user = await seedUser()
    const team = await seedTeam()
    await seedMembership(user.id, team.id, 'lead')
    const item = await seedItem(team.id, { createdBy: user.id })

    await withTransaction(async (tx) => {
      await recordActivity(tx, {
        workItemId: item.id,
        actorId: user.id,
        type: 'created',
        fromValue: null,
        toValue: 'Initial',
        metadata: { source: 'test' },
      })
    })

    const rows = await db
      .select()
      .from(activityEvents)
      .where(eq(activityEvents.workItemId, item.id))

    expect(rows).toHaveLength(1)
    const row = rows[0]
    expect(row).toBeDefined()
    if (!row) return
    expect(row.workItemId).toBe(item.id)
    expect(row.actorId).toBe(user.id)
    expect(row.type).toBe('created')
    expect(row.fromValue).toBeNull()
    expect(row.toValue).toBe('Initial')
    expect(row.metadata).toEqual({ source: 'test' })
  })

  it('passing { title: "a" } -> { title: "b" } writes exactly one title_changed with from="a", to="b"', async () => {
    const user = await seedUser()
    const team = await seedTeam()
    await seedMembership(user.id, team.id, 'lead')
    const item = await seedItem(team.id, { createdBy: user.id })

    await withTransaction(async (tx) => {
      await recordFieldChanges(tx, item.id, user.id, { title: 'a' }, { title: 'b' })
    })

    const rows = await db
      .select()
      .from(activityEvents)
      .where(eq(activityEvents.workItemId, item.id))

    expect(rows).toHaveLength(1)
    const row = rows[0]
    expect(row).toBeDefined()
    if (!row) return
    expect(row.type).toBe('title_changed')
    expect(row.fromValue).toBe('a')
    expect(row.toValue).toBe('b')
    expect(row.actorId).toBe(user.id)
  })

  it('passing an unchanged field writes nothing', async () => {
    const user = await seedUser()
    const team = await seedTeam()
    await seedMembership(user.id, team.id, 'lead')
    const item = await seedItem(team.id, { createdBy: user.id })

    await withTransaction(async (tx) => {
      await recordFieldChanges(
        tx,
        item.id,
        user.id,
        { title: 'same', description: 'unchanged' },
        { title: 'same', description: 'unchanged' },
      )
    })

    const rows = await db
      .select()
      .from(activityEvents)
      .where(eq(activityEvents.workItemId, item.id))

    expect(rows).toHaveLength(0)
  })

  it('two changed fields write two rows', async () => {
    const user = await seedUser()
    const team = await seedTeam()
    await seedMembership(user.id, team.id, 'lead')
    const item = await seedItem(team.id, { createdBy: user.id })

    await withTransaction(async (tx) => {
      await recordFieldChanges(
        tx,
        item.id,
        user.id,
        { title: 'old title', priority: 'low' },
        { title: 'new title', priority: 'high' },
      )
    })

    const rows = await db
      .select()
      .from(activityEvents)
      .where(eq(activityEvents.workItemId, item.id))
      .orderBy(asc(activityEvents.id))

    expect(rows).toHaveLength(2)

    const titleEvent = rows.find((r) => r.type === 'title_changed')
    expect(titleEvent).toBeDefined()
    if (!titleEvent) return
    expect(titleEvent.fromValue).toBe('old title')
    expect(titleEvent.toValue).toBe('new title')

    const priorityEvent = rows.find((r) => r.type === 'priority_changed')
    expect(priorityEvent).toBeDefined()
    if (!priorityEvent) return
    expect(priorityEvent.fromValue).toBe('low')
    expect(priorityEvent.toValue).toBe('high')
  })

  it('Date due_at and its replacement are formatted and stored as ISO strings', async () => {
    const user = await seedUser()
    const team = await seedTeam()
    await seedMembership(user.id, team.id, 'lead')
    const item = await seedItem(team.id, { createdBy: user.id })

    const dateBefore = new Date('2026-10-18T10:00:00.000Z')
    const dateAfter = new Date('2026-10-25T15:30:00.000Z')

    await withTransaction(async (tx) => {
      await recordFieldChanges(
        tx,
        item.id,
        user.id,
        { due_at: dateBefore },
        { due_at: dateAfter },
      )
    })

    const rows = await db
      .select()
      .from(activityEvents)
      .where(eq(activityEvents.workItemId, item.id))

    expect(rows).toHaveLength(1)
    const row = rows[0]
    expect(row).toBeDefined()
    if (!row) return
    expect(row.type).toBe('due_changed')
    expect(row.fromValue).toBe(dateBefore.toISOString())
    expect(row.toValue).toBe(dateAfter.toISOString())
  })
})
