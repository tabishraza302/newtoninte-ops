import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { closeDb, db } from '../../src/db/client'
import { activityEvents, outboxJobs, workItems } from '../../src/db/schema'
import { ApiError } from '../../src/http/errors'
import { assignItem } from '../../src/services/items'
import { resetDb, seedItem, seedMembership, seedTeam, seedUser } from '../helpers/db'
import type { Actor } from '../../src/domain/types'

describe('items service - assignItem (Task 4.6)', () => {
  beforeEach(resetDb)
  afterAll(closeDb)

  it('lead assigns a member: 200, version+1, one event, one email.assigned', async () => {
    const lead = await seedUser()
    const member = await seedUser()
    const team = await seedTeam({ name: 'Flight Ops' })
    await seedMembership(lead.id, team.id, 'lead')
    await seedMembership(member.id, team.id, 'member')

    const item = await seedItem(team.id, {
      createdBy: lead.id,
      title: 'Inspect thruster valve',
      version: 1,
      assigneeId: null,
    })

    const actor: Actor = { id: lead.id, isAdmin: false }
    const updated = await assignItem(actor, item.id, member.id, 1)

    expect(updated.id).toBe(item.id)
    expect(updated.assigneeId).toBe(member.id)
    expect(updated.assignee?.id).toBe(member.id)
    expect(updated.version).toBe(2)

    // Verify activity event
    const events = await db
      .select()
      .from(activityEvents)
      .where(eq(activityEvents.workItemId, item.id))

    expect(events).toHaveLength(1)
    expect(events[0]?.type).toBe('assignee_changed')
    expect(events[0]?.actorId).toBe(lead.id)
    expect(events[0]?.fromValue).toBeNull()
    expect(events[0]?.toValue).toBe(String(member.id))

    // Verify outbox job
    const jobs = await db.select().from(outboxJobs)
    expect(jobs).toHaveLength(1)
    expect(jobs[0]?.type).toBe('email.assigned')
    expect(jobs[0]?.dedupeKey).toBe(`assigned:item:${item.id}`)
    expect(jobs[0]?.payload).toEqual({
      to: member.email,
      itemTitle: 'Inspect thruster valve',
      teamName: 'Flight Ops',
      itemId: item.id,
    })
  })

  it('assigning again with right version does not duplicate outbox email (dedupe_key)', async () => {
    const lead = await seedUser()
    const member1 = await seedUser()
    const member2 = await seedUser()
    const team = await seedTeam({ name: 'Flight Ops' })
    await seedMembership(lead.id, team.id, 'lead')
    await seedMembership(member1.id, team.id, 'member')
    await seedMembership(member2.id, team.id, 'member')

    const item = await seedItem(team.id, {
      createdBy: lead.id,
      version: 1,
    })

    const actor: Actor = { id: lead.id, isAdmin: false }
    await assignItem(actor, item.id, member1.id, 1)
    await assignItem(actor, item.id, member2.id, 2)

    // Dedupe key is assigned:item:<id> so duplicate job is ignored
    const jobs = await db
      .select()
      .from(outboxJobs)
      .where(eq(outboxJobs.dedupeKey, `assigned:item:${item.id}`))

    expect(jobs).toHaveLength(1)
  })

  it('lead assigning themselves does not enqueue email.assigned', async () => {
    const lead = await seedUser()
    const team = await seedTeam()
    await seedMembership(lead.id, team.id, 'lead')

    const item = await seedItem(team.id, {
      createdBy: lead.id,
      version: 1,
      assigneeId: null,
    })

    const actor: Actor = { id: lead.id, isAdmin: false }
    const updated = await assignItem(actor, item.id, lead.id, 1)

    expect(updated.assigneeId).toBe(lead.id)
    expect(updated.version).toBe(2)

    const jobs = await db.select().from(outboxJobs)
    expect(jobs).toHaveLength(0)
  })

  it('member calling assignItem is FORBIDDEN and row unchanged', async () => {
    const member = await seedUser()
    const other = await seedUser()
    const team = await seedTeam()
    await seedMembership(member.id, team.id, 'member')
    await seedMembership(other.id, team.id, 'member')

    const item = await seedItem(team.id, {
      createdBy: member.id,
      version: 1,
      assigneeId: null,
    })

    const actor: Actor = { id: member.id, isAdmin: false }

    let caughtError: unknown
    try {
      await assignItem(actor, item.id, other.id, 1)
    } catch (e) {
      caughtError = e
    }

    expect(caughtError).toBeInstanceOf(ApiError)
    expect((caughtError as ApiError).code).toBe('FORBIDDEN')

    const [row] = await db.select().from(workItems).where(eq(workItems.id, item.id)).limit(1)
    expect(row?.assigneeId).toBeNull()
    expect(row?.version).toBe(1)
  })

  it('Review Focus #4: assigneeId referencing a non-member is rejected with 422 and row is unchanged', async () => {
    const lead = await seedUser()
    const outsider = await seedUser()
    const team = await seedTeam()
    await seedMembership(lead.id, team.id, 'lead')

    const item = await seedItem(team.id, {
      createdBy: lead.id,
      version: 1,
      assigneeId: null,
    })

    const actor: Actor = { id: lead.id, isAdmin: false }

    let caughtError: unknown
    try {
      await assignItem(actor, item.id, outsider.id, 1)
    } catch (e) {
      caughtError = e
    }

    expect(caughtError).toBeInstanceOf(ApiError)
    const err = caughtError as ApiError
    expect(err.code).toBe('VALIDATION_ERROR')
    expect(err.status).toBe(422)

    // Verify row is unchanged
    const [row] = await db.select().from(workItems).where(eq(workItems.id, item.id)).limit(1)
    expect(row?.assigneeId).toBeNull()
    expect(row?.version).toBe(1)

    // No activity events or outbox jobs
    const events = await db.select().from(activityEvents).where(eq(activityEvents.workItemId, item.id))
    expect(events).toHaveLength(0)
    const jobs = await db.select().from(outboxJobs)
    expect(jobs).toHaveLength(0)
  })

  it('assigneeId referencing a viewer in team is rejected with 422 VALIDATION_ERROR', async () => {
    const lead = await seedUser()
    const viewer = await seedUser()
    const team = await seedTeam()
    await seedMembership(lead.id, team.id, 'lead')
    await seedMembership(viewer.id, team.id, 'viewer')

    const item = await seedItem(team.id, {
      createdBy: lead.id,
      version: 1,
      assigneeId: null,
    })

    const actor: Actor = { id: lead.id, isAdmin: false }

    let caughtError: unknown
    try {
      await assignItem(actor, item.id, viewer.id, 1)
    } catch (e) {
      caughtError = e
    }

    expect(caughtError).toBeInstanceOf(ApiError)
    expect((caughtError as ApiError).code).toBe('VALIDATION_ERROR')

    const [row] = await db.select().from(workItems).where(eq(workItems.id, item.id)).limit(1)
    expect(row?.assigneeId).toBeNull()
  })

  it('stale version throws 409 STALE_STATE and row is unchanged', async () => {
    const lead = await seedUser()
    const member = await seedUser()
    const team = await seedTeam()
    await seedMembership(lead.id, team.id, 'lead')
    await seedMembership(member.id, team.id, 'member')

    const item = await seedItem(team.id, {
      createdBy: lead.id,
      version: 2,
      assigneeId: null,
    })

    const actor: Actor = { id: lead.id, isAdmin: false }

    let caughtError: unknown
    try {
      await assignItem(actor, item.id, member.id, 1)
    } catch (e) {
      caughtError = e
    }

    expect(caughtError).toBeInstanceOf(ApiError)
    const err = caughtError as ApiError
    expect(err.code).toBe('STALE_STATE')
    expect(err.status).toBe(409)

    // Row is unchanged
    const [row] = await db.select().from(workItems).where(eq(workItems.id, item.id)).limit(1)
    expect(row?.assigneeId).toBeNull()
    expect(row?.version).toBe(2)
  })

  it('foreign-team item returns NOT_FOUND', async () => {
    const outsider = await seedUser()
    const member = await seedUser()
    const team = await seedTeam()
    await seedMembership(member.id, team.id, 'member')

    const item = await seedItem(team.id, {
      createdBy: member.id,
      version: 1,
    })

    const actor: Actor = { id: outsider.id, isAdmin: false }

    let caughtError: unknown
    try {
      await assignItem(actor, item.id, member.id, 1)
    } catch (e) {
      caughtError = e
    }

    expect(caughtError).toBeInstanceOf(ApiError)
    expect((caughtError as ApiError).code).toBe('NOT_FOUND')
  })
})
