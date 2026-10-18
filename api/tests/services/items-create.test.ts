import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { closeDb, db } from '../../src/db/client'
import { activityEvents, outboxJobs, workItems } from '../../src/db/schema'
import { ApiError } from '../../src/http/errors'
import { createItem, emailAssigned } from '../../src/services/items'
import { resetDb, seedMembership, seedTeam, seedUser } from '../helpers/db'
import type { Actor, ItemType, Priority } from '../../src/domain/types'

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

describe('items service - createItem (Task 4.3)', () => {
  beforeEach(resetDb)
  afterAll(closeDb)

  it('create unassigned: status=open, version=1, created event with metadata, no outbox job', async () => {
    const creator = await seedUser()
    const team = await seedTeam({ name: 'Alpha Ops' })
    await seedMembership(creator.id, team.id, 'member')

    const actor: Actor = { id: creator.id, isAdmin: false }
    const now = new Date('2026-10-18T12:00:00.000Z')

    const item = await createItem(actor, {
      teamId: team.id,
      title: 'Fix broken turbine',
      description: 'Turbine #4 vibration warning',
      type: 'incident',
      priority: 'high',
      dueAt: now,
    })

    expect(item.id).toBeGreaterThan(0)
    expect(item.teamId).toBe(team.id)
    expect(item.title).toBe('Fix broken turbine')
    expect(item.description).toBe('Turbine #4 vibration warning')
    expect(item.type).toBe('incident')
    expect(item.priority).toBe('high')
    expect(item.status).toBe('open')
    expect(item.assigneeId).toBeNull()
    expect(item.assignee).toBeNull()
    expect(item.version).toBe(1)
    expect(item.createdBy).toBe(creator.id)

    // Verify activity event
    const events = await db
      .select()
      .from(activityEvents)
      .where(eq(activityEvents.workItemId, item.id))

    expect(events).toHaveLength(1)
    expect(events[0]?.type).toBe('created')
    expect(events[0]?.actorId).toBe(creator.id)
    expect(events[0]?.metadata).toEqual({
      title: 'Fix broken turbine',
      description: 'Turbine #4 vibration warning',
      type: 'incident',
      priority: 'high',
      status: 'open',
      assigneeId: null,
      dueAt: now.toISOString(),
      createdBy: creator.id,
    })

    // Verify no outbox jobs
    const jobs = await db.select().from(outboxJobs)
    expect(jobs).toHaveLength(0)
  })

  it('member self-assigning writes created + assignee_changed events, does not email self', async () => {
    const member = await seedUser()
    const team = await seedTeam()
    await seedMembership(member.id, team.id, 'member')

    const actor: Actor = { id: member.id, isAdmin: false }
    const item = await createItem(actor, {
      teamId: team.id,
      title: 'Self-assigned task',
      type: 'task',
      priority: 'medium',
      assigneeId: member.id,
    })

    expect(item.status).toBe('open')
    expect(item.assigneeId).toBe(member.id)

    const events = await db
      .select()
      .from(activityEvents)
      .where(eq(activityEvents.workItemId, item.id))

    expect(events).toHaveLength(2)
    const types = events.map((e) => e.type)
    expect(types).toContain('created')
    expect(types).toContain('assignee_changed')

    const assigneeEvent = events.find((e) => e.type === 'assignee_changed')
    expect(assigneeEvent?.fromValue).toBeNull()
    expect(assigneeEvent?.toValue).toBe(String(member.id))

    // Self-assignment does not enqueue email to self
    const jobs = await db.select().from(outboxJobs)
    expect(jobs).toHaveLength(0)
  })

  it('lead assigning a member enqueues email.assigned outbox job', async () => {
    const lead = await seedUser()
    const member = await seedUser()
    const team = await seedTeam({ name: 'Alpha Squad' })
    await seedMembership(lead.id, team.id, 'lead')
    await seedMembership(member.id, team.id, 'member')

    const actor: Actor = { id: lead.id, isAdmin: false }
    const item = await createItem(actor, {
      teamId: team.id,
      title: 'Lead assigned task',
      type: 'task',
      priority: 'urgent',
      assigneeId: member.id,
    })

    expect(item.assigneeId).toBe(member.id)

    const jobs = await db.select().from(outboxJobs)
    expect(jobs).toHaveLength(1)
    const job = jobs[0]
    expect(job).toBeDefined()
    if (!job) return

    expect(job.type).toBe('email.assigned')
    expect(job.payload).toEqual({
      to: member.email,
      itemTitle: 'Lead assigned task',
      teamName: 'Alpha Squad',
      itemId: item.id,
    })
  })

  it('member assigning another member is FORBIDDEN', async () => {
    const member1 = await seedUser()
    const member2 = await seedUser()
    const team = await seedTeam()
    await seedMembership(member1.id, team.id, 'member')
    await seedMembership(member2.id, team.id, 'member')

    const actor: Actor = { id: member1.id, isAdmin: false }
    const code = await errorCode(() =>
      createItem(actor, {
        teamId: team.id,
        title: 'Unauthorized assignment',
        type: 'task',
        priority: 'low',
        assigneeId: member2.id,
      }),
    )

    expect(code).toBe('FORBIDDEN')

    const count = await db.select().from(workItems)
    expect(count).toHaveLength(0)
  })

  it('Review Focus #4: assigneeId for a non-member is rejected and NO item row created', async () => {
    const lead = await seedUser()
    const outsider = await seedUser()
    const team = await seedTeam()
    await seedMembership(lead.id, team.id, 'lead')

    const actor: Actor = { id: lead.id, isAdmin: false }
    const code = await errorCode(() =>
      createItem(actor, {
        teamId: team.id,
        title: 'Foreign assignee item',
        type: 'task',
        priority: 'medium',
        assigneeId: outsider.id,
      }),
    )

    expect(code).toBe('VALIDATION_ERROR')

    // Confirm no row was created in work_items
    const allItems = await db.select().from(workItems)
    expect(allItems).toHaveLength(0)

    // Confirm no activity events recorded
    const allEvents = await db.select().from(activityEvents)
    expect(allEvents).toHaveLength(0)
  })

  it('assigneeId for a viewer in the team is rejected with VALIDATION_ERROR and no item created', async () => {
    const lead = await seedUser()
    const viewer = await seedUser()
    const team = await seedTeam()
    await seedMembership(lead.id, team.id, 'lead')
    await seedMembership(viewer.id, team.id, 'viewer')

    const actor: Actor = { id: lead.id, isAdmin: false }
    const code = await errorCode(() =>
      createItem(actor, {
        teamId: team.id,
        title: 'Viewer assignee item',
        type: 'task',
        priority: 'low',
        assigneeId: viewer.id,
      }),
    )

    expect(code).toBe('VALIDATION_ERROR')
    const allItems = await db.select().from(workItems)
    expect(allItems).toHaveLength(0)
  })

  it('non-member of team gets NOT_FOUND', async () => {
    const user = await seedUser()
    const team = await seedTeam()

    const actor: Actor = { id: user.id, isAdmin: false }
    const code = await errorCode(() =>
      createItem(actor, {
        teamId: team.id,
        title: 'Outsider item',
        type: 'task',
        priority: 'low',
      }),
    )

    expect(code).toBe('NOT_FOUND')
  })

  it('viewer of team gets FORBIDDEN', async () => {
    const viewer = await seedUser()
    const team = await seedTeam()
    await seedMembership(viewer.id, team.id, 'viewer')

    const actor: Actor = { id: viewer.id, isAdmin: false }
    const code = await errorCode(() =>
      createItem(actor, {
        teamId: team.id,
        title: 'Viewer item',
        type: 'task',
        priority: 'low',
      }),
    )

    expect(code).toBe('FORBIDDEN')
  })

  it('validates required fields (title, type, priority, dueAt)', async () => {
    const lead = await seedUser()
    const team = await seedTeam()
    await seedMembership(lead.id, team.id, 'lead')
    const actor: Actor = { id: lead.id, isAdmin: false }

    // Empty title
    expect(
      await errorCode(() =>
        createItem(actor, {
          teamId: team.id,
          title: '   ',
          type: 'task',
          priority: 'medium',
        }),
      ),
    ).toBe('VALIDATION_ERROR')

    // Invalid type
    expect(
      await errorCode(() =>
        createItem(actor, {
          teamId: team.id,
          title: 'Valid title',
          type: 'invalid_type' as ItemType,
          priority: 'medium',
        }),
      ),
    ).toBe('VALIDATION_ERROR')

    // Invalid priority
    expect(
      await errorCode(() =>
        createItem(actor, {
          teamId: team.id,
          title: 'Valid title',
          type: 'task',
          priority: 'extreme' as Priority,
        }),
      ),
    ).toBe('VALIDATION_ERROR')

    // Invalid dueAt date
    expect(
      await errorCode(() =>
        createItem(actor, {
          teamId: team.id,
          title: 'Valid title',
          type: 'task',
          priority: 'medium',
          dueAt: 'not-a-date',
        }),
      ),
    ).toBe('VALIDATION_ERROR')
  })

  it('exports emailAssigned function', () => {
    expect(typeof emailAssigned).toBe('function')
  })
})
