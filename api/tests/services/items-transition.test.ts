import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { closeDb, db } from '../../src/db/client'
import { activityEvents, comments, workItems } from '../../src/db/schema'
import { ApiError } from '../../src/http/errors'
import { transitionItem } from '../../src/services/items'
import { resetDb, seedItem, seedMembership, seedTeam, seedUser } from '../helpers/db'
import type { Actor } from '../../src/domain/types'

describe('items service - transitionItem (Task 4.7)', () => {
  beforeEach(resetDb)
  afterAll(closeDb)

  it('open -> closed is an illegal transition (422 INVALID_TRANSITION)', async () => {
    const lead = await seedUser()
    const team = await seedTeam()
    await seedMembership(lead.id, team.id, 'lead')

    const item = await seedItem(team.id, {
      createdBy: lead.id,
      status: 'open',
    })

    const actor: Actor = { id: lead.id, isAdmin: false }

    let caughtError: unknown
    try {
      await transitionItem(actor, item.id, 'closed')
    } catch (e) {
      caughtError = e
    }

    expect(caughtError).toBeInstanceOf(ApiError)
    const err = caughtError as ApiError
    expect(err.code).toBe('INVALID_TRANSITION')
    expect(err.status).toBe(422)
  })

  it('open -> in_progress on an unassigned item is rejected (422 INVALID_TRANSITION)', async () => {
    const lead = await seedUser()
    const team = await seedTeam()
    await seedMembership(lead.id, team.id, 'lead')

    const item = await seedItem(team.id, {
      createdBy: lead.id,
      status: 'open',
      assigneeId: null,
    })

    const actor: Actor = { id: lead.id, isAdmin: false }

    let caughtError: unknown
    try {
      await transitionItem(actor, item.id, 'in_progress')
    } catch (e) {
      caughtError = e
    }

    expect(caughtError).toBeInstanceOf(ApiError)
    const err = caughtError as ApiError
    expect(err.code).toBe('INVALID_TRANSITION')
    expect(err.message).toContain('claimed')
  })

  it('open -> in_progress on an assigned item allowed for assignee and lead, forbidden for others', async () => {
    const lead = await seedUser()
    const assignee = await seedUser()
    const other = await seedUser()
    const team = await seedTeam()
    await seedMembership(lead.id, team.id, 'lead')
    await seedMembership(assignee.id, team.id, 'member')
    await seedMembership(other.id, team.id, 'member')

    const item = await seedItem(team.id, {
      createdBy: lead.id,
      status: 'open',
      assigneeId: assignee.id,
      version: 1,
    })

    // Other member cannot start it
    let caughtOther: unknown
    try {
      await transitionItem({ id: other.id, isAdmin: false }, item.id, 'in_progress')
    } catch (e) {
      caughtOther = e
    }
    expect(caughtOther).toBeInstanceOf(ApiError)
    expect((caughtOther as ApiError).code).toBe('FORBIDDEN')

    // Assignee can start it
    const updated = await transitionItem(
      { id: assignee.id, isAdmin: false },
      item.id,
      'in_progress',
    )
    expect(updated.status).toBe('in_progress')
    expect(updated.version).toBe(2)
  })

  it('in_progress -> awaiting_approval allowed for assignee, forbidden for unrelated member', async () => {
    const assignee = await seedUser()
    const other = await seedUser()
    const team = await seedTeam()
    await seedMembership(assignee.id, team.id, 'member')
    await seedMembership(other.id, team.id, 'member')

    const item = await seedItem(team.id, {
      createdBy: assignee.id,
      status: 'in_progress',
      assigneeId: assignee.id,
      version: 1,
    })

    // Other member gets 403
    let caughtOther: unknown
    try {
      await transitionItem({ id: other.id, isAdmin: false }, item.id, 'awaiting_approval')
    } catch (e) {
      caughtOther = e
    }
    expect(caughtOther).toBeInstanceOf(ApiError)
    expect((caughtOther as ApiError).code).toBe('FORBIDDEN')

    // Assignee succeeds
    const updated = await transitionItem(
      { id: assignee.id, isAdmin: false },
      item.id,
      'awaiting_approval',
    )
    expect(updated.status).toBe('awaiting_approval')
  })

  it('awaiting_approval -> resolved (approve): non-lead gets 403 FORBIDDEN', async () => {
    const member = await seedUser()
    const team = await seedTeam()
    await seedMembership(member.id, team.id, 'member')

    const item = await seedItem(team.id, {
      createdBy: member.id,
      status: 'awaiting_approval',
      assigneeId: member.id,
    })

    const actor: Actor = { id: member.id, isAdmin: false }

    let caughtError: unknown
    try {
      await transitionItem(actor, item.id, 'resolved')
    } catch (e) {
      caughtError = e
    }

    expect(caughtError).toBeInstanceOf(ApiError)
    expect((caughtError as ApiError).code).toBe('FORBIDDEN')
  })

  it('awaiting_approval -> resolved (approve) with reason: status=resolved, comment created, comment_added event carrying reason', async () => {
    const lead = await seedUser()
    const member = await seedUser()
    const team = await seedTeam()
    await seedMembership(lead.id, team.id, 'lead')
    await seedMembership(member.id, team.id, 'member')

    const item = await seedItem(team.id, {
      createdBy: member.id,
      status: 'awaiting_approval',
      assigneeId: member.id,
      version: 1,
    })

    const actor: Actor = { id: lead.id, isAdmin: false }
    const updated = await transitionItem(
      actor,
      item.id,
      'resolved',
      'All compliance criteria verified and passed',
    )

    expect(updated.status).toBe('resolved')
    expect(updated.version).toBe(2)

    // Verify comment row in comments table
    const commentRows = await db
      .select()
      .from(comments)
      .where(eq(comments.workItemId, item.id))

    expect(commentRows).toHaveLength(1)
    expect(commentRows[0]?.body).toBe('All compliance criteria verified and passed')
    expect(commentRows[0]?.authorId).toBe(lead.id)

    // Verify activity events: status_changed and comment_added
    const events = await db
      .select()
      .from(activityEvents)
      .where(eq(activityEvents.workItemId, item.id))

    expect(events).toHaveLength(2)

    const statusEvent = events.find((e) => e.type === 'status_changed')
    expect(statusEvent).toBeDefined()
    expect(statusEvent?.fromValue).toBe('awaiting_approval')
    expect(statusEvent?.toValue).toBe('resolved')

    const commentEvent = events.find((e) => e.type === 'comment_added')
    expect(commentEvent).toBeDefined()
    expect(commentEvent?.metadata).toEqual({
      body: 'All compliance criteria verified and passed',
    })
  })

  it('awaiting_approval -> in_progress (send back) by lead with reason', async () => {
    const lead = await seedUser()
    const member = await seedUser()
    const team = await seedTeam()
    await seedMembership(lead.id, team.id, 'lead')
    await seedMembership(member.id, team.id, 'member')

    const item = await seedItem(team.id, {
      createdBy: member.id,
      status: 'awaiting_approval',
      assigneeId: member.id,
      version: 1,
    })

    const actor: Actor = { id: lead.id, isAdmin: false }
    const updated = await transitionItem(
      actor,
      item.id,
      'in_progress',
      'Missing audit signatures',
    )

    expect(updated.status).toBe('in_progress')
    expect(updated.version).toBe(2)

    const commentRows = await db.select().from(comments).where(eq(comments.workItemId, item.id))
    expect(commentRows).toHaveLength(1)
    expect(commentRows[0]?.body).toBe('Missing audit signatures')
  })

  it('resolved -> closed by lead, forbidden for member', async () => {
    const lead = await seedUser()
    const member = await seedUser()
    const team = await seedTeam()
    await seedMembership(lead.id, team.id, 'lead')
    await seedMembership(member.id, team.id, 'member')

    const item = await seedItem(team.id, {
      createdBy: member.id,
      status: 'resolved',
      version: 1,
    })

    // Member gets 403
    let caughtMember: unknown
    try {
      await transitionItem({ id: member.id, isAdmin: false }, item.id, 'closed')
    } catch (e) {
      caughtMember = e
    }
    expect(caughtMember).toBeInstanceOf(ApiError)
    expect((caughtMember as ApiError).code).toBe('FORBIDDEN')

    // Lead succeeds
    const updated = await transitionItem({ id: lead.id, isAdmin: false }, item.id, 'closed')
    expect(updated.status).toBe('closed')
    expect(updated.version).toBe(2)
  })

  it('resolved -> in_progress (reopen) by lead', async () => {
    const lead = await seedUser()
    const team = await seedTeam()
    await seedMembership(lead.id, team.id, 'lead')

    const item = await seedItem(team.id, {
      createdBy: lead.id,
      status: 'resolved',
      version: 1,
    })

    const updated = await transitionItem({ id: lead.id, isAdmin: false }, item.id, 'in_progress')
    expect(updated.status).toBe('in_progress')
  })

  it('cancel by creator (a member) succeeds', async () => {
    const creator = await seedUser()
    const team = await seedTeam()
    await seedMembership(creator.id, team.id, 'member')

    const item = await seedItem(team.id, {
      createdBy: creator.id,
      status: 'open',
      version: 1,
    })

    const updated = await transitionItem({ id: creator.id, isAdmin: false }, item.id, 'cancelled')
    expect(updated.status).toBe('cancelled')
    expect(updated.version).toBe(2)
  })

  it('cancel by unrelated member is FORBIDDEN', async () => {
    const creator = await seedUser()
    const unrelated = await seedUser()
    const team = await seedTeam()
    await seedMembership(creator.id, team.id, 'member')
    await seedMembership(unrelated.id, team.id, 'member')

    const item = await seedItem(team.id, {
      createdBy: creator.id,
      status: 'open',
      version: 1,
    })

    let caughtError: unknown
    try {
      await transitionItem({ id: unrelated.id, isAdmin: false }, item.id, 'cancelled')
    } catch (e) {
      caughtError = e
    }

    expect(caughtError).toBeInstanceOf(ApiError)
    expect((caughtError as ApiError).code).toBe('FORBIDDEN')
  })

  it('cancel from resolved is 422 INVALID_TRANSITION', async () => {
    const lead = await seedUser()
    const team = await seedTeam()
    await seedMembership(lead.id, team.id, 'lead')

    const item = await seedItem(team.id, {
      createdBy: lead.id,
      status: 'resolved',
      version: 1,
    })

    let caughtError: unknown
    try {
      await transitionItem({ id: lead.id, isAdmin: false }, item.id, 'cancelled')
    } catch (e) {
      caughtError = e
    }

    expect(caughtError).toBeInstanceOf(ApiError)
    expect((caughtError as ApiError).code).toBe('INVALID_TRANSITION')
  })

  it('terminal states (closed, cancelled) reject any further transition (422 INVALID_TRANSITION)', async () => {
    const lead = await seedUser()
    const team = await seedTeam()
    await seedMembership(lead.id, team.id, 'lead')

    const closedItem = await seedItem(team.id, {
      createdBy: lead.id,
      status: 'closed',
    })

    let caughtClosed: unknown
    try {
      await transitionItem({ id: lead.id, isAdmin: false }, closedItem.id, 'open')
    } catch (e) {
      caughtClosed = e
    }
    expect(caughtClosed).toBeInstanceOf(ApiError)
    expect((caughtClosed as ApiError).code).toBe('INVALID_TRANSITION')

    const cancelledItem = await seedItem(team.id, {
      createdBy: lead.id,
      status: 'cancelled',
    })

    let caughtCancelled: unknown
    try {
      await transitionItem({ id: lead.id, isAdmin: false }, cancelledItem.id, 'open')
    } catch (e) {
      caughtCancelled = e
    }
    expect(caughtCancelled).toBeInstanceOf(ApiError)
    expect((caughtCancelled as ApiError).code).toBe('INVALID_TRANSITION')
  })
})
