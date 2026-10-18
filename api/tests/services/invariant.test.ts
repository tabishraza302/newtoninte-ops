import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { eq } from 'drizzle-orm'
import { createApp } from '../../src/app'
import { closeDb, db } from '../../src/db/client'
import { activityEvents, idempotencyKeys, workItems } from '../../src/db/schema'
import type { Actor, ItemType, Priority, Status } from '../../src/domain/types'
import { ApiError } from '../../src/http/errors'
import {
  addComment,
  assignItem,
  claimItem,
  createItem,
  patchItem,
  transitionItem,
} from '../../src/services/items'
import { signAccessToken } from '../../src/services/tokens'
import { resetDb, seedItem, seedMembership, seedTeam, seedUser } from '../helpers/db'
import { replay } from '../helpers/replay'

interface ItemResponseBody {
  item: {
    id: number
    teamId: number
    title: string
    description: string | null
    type: string
    priority: string
    status: string
    assigneeId: number | null
    createdBy: number
    version: number
  }
}

describe('Invariant & Review Focus tests (§13, Task 4.11)', () => {
  const app = createApp()

  beforeEach(resetDb)
  afterAll(closeDb)

  it('(a) §13 Invariant: history matches state: drive item through full lifecycle and assert replay matches DB field-by-field', async () => {
    const team = await seedTeam()
    const member = await seedUser()
    const lead = await seedUser()
    await seedMembership(member.id, team.id, 'member')
    await seedMembership(lead.id, team.id, 'lead')

    const memberActor: Actor = { id: member.id, isAdmin: false }
    const leadActor: Actor = { id: lead.id, isAdmin: false }

    // 1. create (unassigned)
    const initialItem = await createItem(memberActor, {
      teamId: team.id,
      title: 'Original Title',
      description: 'Original Description',
      type: 'task',
      priority: 'low',
    })
    expect(initialItem.status).toBe('open')
    expect(initialItem.assigneeId).toBeNull()

    // 2. patch title
    const patchedTitleItem = await patchItem(memberActor, initialItem.id, {
      title: 'Patched Title',
      version: initialItem.version,
    })
    expect(patchedTitleItem.title).toBe('Patched Title')

    // 3. claim (member claims unassigned item: sets assignee to member, status to in_progress)
    const claimedItem = await claimItem(memberActor, patchedTitleItem.id)
    expect(claimedItem.status).toBe('in_progress')
    expect(claimedItem.assigneeId).toBe(member.id)

    // 4. self-assign by lead (re-assigns item to lead)
    const assignedItem = await assignItem(leadActor, claimedItem.id, lead.id, claimedItem.version)
    expect(assignedItem.assigneeId).toBe(lead.id)

    // 5. submit (in_progress -> awaiting_approval)
    const submittedItem = await transitionItem(leadActor, assignedItem.id, 'awaiting_approval')
    expect(submittedItem.status).toBe('awaiting_approval')

    // 6. send back (awaiting_approval -> in_progress with reason)
    const sentBackItem = await transitionItem(
      leadActor,
      submittedItem.id,
      'in_progress',
      'Needs additional test coverage',
    )
    expect(sentBackItem.status).toBe('in_progress')

    // Re-submit (in_progress -> awaiting_approval) to allow approval
    const resubmittedItem = await transitionItem(leadActor, sentBackItem.id, 'awaiting_approval')
    expect(resubmittedItem.status).toBe('awaiting_approval')

    // 7. approve (awaiting_approval -> resolved)
    const approvedItem = await transitionItem(leadActor, resubmittedItem.id, 'resolved')
    expect(approvedItem.status).toBe('resolved')

    // 8. priority change (patch priority to urgent)
    const reprioritizedItem = await patchItem(leadActor, approvedItem.id, {
      priority: 'urgent',
      version: approvedItem.version,
    })
    expect(reprioritizedItem.priority).toBe('urgent')

    // 9. comment
    await addComment(leadActor, reprioritizedItem.id, 'Item approved and prioritized for release')

    // Read back all activity events in chronological order
    const events = await db
      .select()
      .from(activityEvents)
      .where(eq(activityEvents.workItemId, reprioritizedItem.id))

    const createdEvent = events.find((e) => e.type === 'created')
    expect(createdEvent).toBeDefined()
    expect(createdEvent?.metadata).toBeDefined()

    const createdMetadata = createdEvent?.metadata as Record<string, unknown>
    const replayed = replay(createdMetadata, events)

    // Fetch live row from DB
    const [row] = await db
      .select()
      .from(workItems)
      .where(eq(workItems.id, reprioritizedItem.id))
      .limit(1)

    expect(row).toBeDefined()

    // Assert field-by-field equality between replayed history and live DB state
    expect(replayed.status).toBe(row?.status)
    expect(replayed.assigneeId).toBe(row?.assigneeId)
    expect(replayed.priority).toBe(row?.priority)
    expect(replayed.title).toBe(row?.title)
    expect(replayed.type).toBe(row?.type)
    expect(replayed.description).toBe(row?.description)
    expect(replayed.dueAt).toBe(row?.dueAt ? row.dueAt.toISOString() : null)

    // Verify all expected event types exist in history audit log
    const eventTypes = events.map((e) => e.type)
    expect(eventTypes).toContain('created')
    expect(eventTypes).toContain('title_changed')
    expect(eventTypes).toContain('assignee_changed')
    expect(eventTypes).toContain('status_changed')
    expect(eventTypes).toContain('priority_changed')
    expect(eventTypes).toContain('comment_added')
  })

  it('(b) Review Focus #4: assignItem with non-member -> 422 and no row change', async () => {
    const team = await seedTeam()
    const lead = await seedUser()
    const currentAssignee = await seedUser()
    const nonMember = await seedUser()

    await seedMembership(lead.id, team.id, 'lead')
    await seedMembership(currentAssignee.id, team.id, 'member')

    const item = await seedItem(team.id, {
      title: 'Valid Member Task',
      status: 'in_progress',
      assigneeId: currentAssignee.id,
      version: 1,
      createdBy: lead.id,
    })

    const leadActor: Actor = { id: lead.id, isAdmin: false }

    let caughtError: unknown
    try {
      await assignItem(leadActor, item.id, nonMember.id, 1)
    } catch (e: unknown) {
      caughtError = e
    }

    expect(caughtError).toBeInstanceOf(ApiError)
    const apiError = caughtError as ApiError
    expect(apiError.code).toBe('VALIDATION_ERROR')
    expect(apiError.status).toBe(422)

    // Verify no row change in DB
    const [persisted] = await db
      .select()
      .from(workItems)
      .where(eq(workItems.id, item.id))
      .limit(1)

    expect(persisted).toBeDefined()
    expect(persisted?.assigneeId).toBe(currentAssignee.id)
    expect(persisted?.version).toBe(1)
    expect(persisted?.updatedAt.getTime()).toBe(item.updatedAt.getTime())

    // Verify no activity events were written
    const events = await db
      .select()
      .from(activityEvents)
      .where(eq(activityEvents.workItemId, item.id))

    expect(events.filter((e) => e.type === 'assignee_changed')).toHaveLength(0)
  })

  it('(c) Review Focus #3: N=6 parallel requests with same Idempotency-Key on POST /items -> exactly one item row, all responses identical, no 500', async () => {
    const team = await seedTeam()
    const user = await seedUser()
    await seedMembership(user.id, team.id, 'lead')
    const token = await signAccessToken(user.id)

    const key = `idem-parallel-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const payload = {
      teamId: team.id,
      title: 'Parallel Idempotent Item',
      type: 'task' as ItemType,
      priority: 'high' as Priority,
      description: 'Concurrent creation test with identical key',
    }

    const responses = await Promise.all(
      Array.from({ length: 6 }, () =>
        request(app)
          .post('/items')
          .set('Authorization', `Bearer ${token}`)
          .set('Idempotency-Key', key)
          .send(payload),
      ),
    )

    // No request should return 500
    for (const res of responses) {
      expect(res.status).not.toBe(500)
    }

    // All requests should succeed with 201
    for (const res of responses) {
      expect(res.status).toBe(201)
    }

    // All responses must be byte-identical
    const firstText = responses[0]?.text
    expect(firstText).toBeDefined()
    for (const res of responses) {
      expect(res.text).toBe(firstText)
    }

    // Response body item must match payload
    const firstBody = responses[0]?.body as ItemResponseBody
    expect(firstBody.item.title).toBe('Parallel Idempotent Item')
    expect(firstBody.item.priority).toBe('high')

    // Exactly one item row persisted in DB
    const itemsInDb = await db
      .select()
      .from(workItems)
      .where(eq(workItems.teamId, team.id))

    expect(itemsInDb).toHaveLength(1)
    expect(itemsInDb[0]?.id).toBe(firstBody.item.id)
    expect(itemsInDb[0]?.title).toBe('Parallel Idempotent Item')

    // Exactly one idempotency key row persisted in DB
    const keyRows = await db
      .select()
      .from(idempotencyKeys)
      .where(eq(idempotencyKeys.key, key))

    expect(keyRows).toHaveLength(1)
    expect(keyRows[0]?.resourceId).toBe(itemsInDb[0]?.id)
  })
})
