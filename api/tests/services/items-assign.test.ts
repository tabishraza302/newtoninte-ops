import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { closeDb, db } from '../../src/db/client'
import { activityEvents, notifications, outboxJobs, workItems } from '../../src/db/schema'
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
    expect(jobs[0]?.payload).toEqual({
      to: member.email,
      itemTitle: 'Inspect thruster valve',
      teamName: 'Flight Ops',
      itemId: item.id,
    })

    const notifs = await db.select().from(notifications).where(eq(notifications.recipientUserId, member.id))
    expect(notifs).toHaveLength(1)
    expect(notifs[0]?.type).toBe('assigned')
  })

  it('assigning B then C enqueues separate correct email payloads; duplicate/noop does not enqueue false event or job', async () => {
    const lead = await seedUser()
    const member1 = await seedUser({ displayName: 'Member One', email: 'm1@example.test' })
    const member2 = await seedUser({ displayName: 'Member Two', email: 'm2@example.test' })
    const team = await seedTeam({ name: 'Flight Ops' })
    await seedMembership(lead.id, team.id, 'lead')
    await seedMembership(member1.id, team.id, 'member')
    await seedMembership(member2.id, team.id, 'member')

    const item = await seedItem(team.id, {
      createdBy: lead.id,
      version: 1,
      title: 'Inspect thruster valve',
    })

    const actor: Actor = { id: lead.id, isAdmin: false }

    // First assignment to member1
    const res1 = await assignItem(actor, item.id, member1.id, 1)
    expect(res1.assigneeId).toBe(member1.id)
    expect(res1.version).toBe(2)

    // Stale no-op assignment to same member with old version (1) still throws 409 STALE_STATE
    let caughtStaleNoop: unknown
    try {
      await assignItem(actor, item.id, member1.id, 1)
    } catch (e) {
      caughtStaleNoop = e
    }
    expect(caughtStaleNoop).toBeInstanceOf(ApiError)
    expect((caughtStaleNoop as ApiError).code).toBe('STALE_STATE')
    expect((caughtStaleNoop as ApiError).status).toBe(409)

    // Fresh no-op assignment to same member with current version (2) leaves state, history, and jobs unchanged
    const resNoop = await assignItem(actor, item.id, member1.id, 2)
    expect(resNoop.assigneeId).toBe(member1.id)
    expect(resNoop.version).toBe(2)

    const eventsAfterNoop = await db
      .select()
      .from(activityEvents)
      .where(eq(activityEvents.workItemId, item.id))
    expect(eventsAfterNoop).toHaveLength(1) // Only original assignment event

    const jobsAfterNoop = await db.select().from(outboxJobs)
    expect(jobsAfterNoop).toHaveLength(1) // Only original email job

    // Second assignment to member2 (version 2) enqueues separate notification with member2 payload
    const res2 = await assignItem(actor, item.id, member2.id, 2)
    expect(res2.assigneeId).toBe(member2.id)
    expect(res2.version).toBe(3)

    const allEvents = await db
      .select()
      .from(activityEvents)
      .where(eq(activityEvents.workItemId, item.id))
    expect(allEvents).toHaveLength(2)
    expect(allEvents[1]?.fromValue).toBe(String(member1.id))
    expect(allEvents[1]?.toValue).toBe(String(member2.id))

    const allJobs = await db.select().from(outboxJobs)
    expect(allJobs).toHaveLength(2)
    const recipientEmails = allJobs.map((j) => {
      const payload = j.payload
      if (payload && typeof payload === 'object' && 'to' in payload && typeof payload.to === 'string') {
        return payload.to
      }
      return null
    })
    expect(recipientEmails).toContain(member1.email)
    expect(recipientEmails).toContain(member2.email)
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
