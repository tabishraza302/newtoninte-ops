import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { closeDb, db } from '../../src/db/client'
import { activityEvents, workItems } from '../../src/db/schema'
import { ApiError } from '../../src/http/errors'
import { patchItem, type WorkItemRow } from '../../src/services/items'
import { resetDb, seedItem, seedMembership, seedTeam, seedUser } from '../helpers/db'
import type { Actor, ItemType, Priority } from '../../src/domain/types'

describe('items service - patchItem (Task 4.4)', () => {
  beforeEach(resetDb)
  afterAll(closeDb)

  it('member edits description: 200, version+1, one description_changed event', async () => {
    const member = await seedUser()
    const team = await seedTeam()
    await seedMembership(member.id, team.id, 'member')

    const item = await seedItem(team.id, {
      createdBy: member.id,
      title: 'Original title',
      description: 'Original description',
      version: 1,
    })

    const actor: Actor = { id: member.id, isAdmin: false }
    const updated = await patchItem(actor, item.id, {
      description: 'Updated description',
      version: 1,
    })

    expect(updated.id).toBe(item.id)
    expect(updated.description).toBe('Updated description')
    expect(updated.version).toBe(2)

    const events = await db
      .select()
      .from(activityEvents)
      .where(eq(activityEvents.workItemId, item.id))

    expect(events).toHaveLength(1)
    expect(events[0]?.type).toBe('description_changed')
    expect(events[0]?.actorId).toBe(member.id)
    expect(events[0]?.fromValue).toBe('Original description')
    expect(events[0]?.toValue).toBe('Updated description')
  })

  it('member sending priority is FORBIDDEN and row is unchanged', async () => {
    const member = await seedUser()
    const team = await seedTeam()
    await seedMembership(member.id, team.id, 'member')

    const item = await seedItem(team.id, {
      createdBy: member.id,
      priority: 'low',
      version: 1,
    })

    const actor: Actor = { id: member.id, isAdmin: false }

    let caughtError: unknown
    try {
      await patchItem(actor, item.id, {
        priority: 'urgent',
        version: 1,
      })
    } catch (e) {
      caughtError = e
    }

    expect(caughtError).toBeInstanceOf(ApiError)
    expect((caughtError as ApiError).code).toBe('FORBIDDEN')

    // Confirm database row is unchanged
    const [row] = await db.select().from(workItems).where(eq(workItems.id, item.id)).limit(1)
    expect(row?.priority).toBe('low')
    expect(row?.version).toBe(1)
  })

  it('lead edits priority: 200, version+1, one priority_changed event', async () => {
    const lead = await seedUser()
    const team = await seedTeam()
    await seedMembership(lead.id, team.id, 'lead')

    const item = await seedItem(team.id, {
      createdBy: lead.id,
      priority: 'low',
      version: 1,
    })

    const actor: Actor = { id: lead.id, isAdmin: false }
    const updated = await patchItem(actor, item.id, {
      priority: 'high',
      version: 1,
    })

    expect(updated.priority).toBe('high')
    expect(updated.version).toBe(2)

    const events = await db
      .select()
      .from(activityEvents)
      .where(eq(activityEvents.workItemId, item.id))

    expect(events).toHaveLength(1)
    expect(events[0]?.type).toBe('priority_changed')
    expect(events[0]?.fromValue).toBe('low')
    expect(events[0]?.toValue).toBe('high')
  })

  it('stale version returns 409 VERSION_CONFLICT with current item in details and row unchanged', async () => {
    const lead = await seedUser()
    const team = await seedTeam()
    await seedMembership(lead.id, team.id, 'lead')

    const item = await seedItem(team.id, {
      createdBy: lead.id,
      title: 'Current title',
      version: 3,
    })

    const actor: Actor = { id: lead.id, isAdmin: false }

    let caughtError: unknown
    try {
      await patchItem(actor, item.id, {
        title: 'New title with stale version',
        version: 2,
      })
    } catch (e) {
      caughtError = e
    }

    expect(caughtError).toBeInstanceOf(ApiError)
    const apiErr = caughtError as ApiError
    expect(apiErr.code).toBe('VERSION_CONFLICT')
    expect(apiErr.status).toBe(409)

    // Current item is in details
    expect(apiErr.details).toBeDefined()
    const currentInDetails = apiErr.details as WorkItemRow
    expect(currentInDetails.id).toBe(item.id)
    expect(currentInDetails.version).toBe(3)
    expect(currentInDetails.title).toBe('Current title')

    // Confirm database row is unchanged
    const [row] = await db.select().from(workItems).where(eq(workItems.id, item.id)).limit(1)
    expect(row?.title).toBe('Current title')
    expect(row?.version).toBe(3)

    // Confirm no activity events recorded
    const events = await db.select().from(activityEvents).where(eq(activityEvents.workItemId, item.id))
    expect(events).toHaveLength(0)
  })

  it('two fields changed generates two events', async () => {
    const lead = await seedUser()
    const team = await seedTeam()
    await seedMembership(lead.id, team.id, 'lead')

    const item = await seedItem(team.id, {
      createdBy: lead.id,
      title: 'Before title',
      type: 'task',
      version: 1,
    })

    const actor: Actor = { id: lead.id, isAdmin: false }
    const updated = await patchItem(actor, item.id, {
      title: 'After title',
      type: 'incident',
      version: 1,
    })

    expect(updated.title).toBe('After title')
    expect(updated.type).toBe('incident')
    expect(updated.version).toBe(2)

    const events = await db
      .select()
      .from(activityEvents)
      .where(eq(activityEvents.workItemId, item.id))

    expect(events).toHaveLength(2)
    const types = events.map((e) => e.type)
    expect(types).toContain('title_changed')
    expect(types).toContain('type_changed')
  })

  it('sending unchanged field value writes NO activity event', async () => {
    const member = await seedUser()
    const team = await seedTeam()
    await seedMembership(member.id, team.id, 'member')

    const item = await seedItem(team.id, {
      createdBy: member.id,
      title: 'Same title',
      version: 1,
    })

    const actor: Actor = { id: member.id, isAdmin: false }
    const updated = await patchItem(actor, item.id, {
      title: 'Same title',
      version: 1,
    })

    expect(updated.version).toBe(2)

    const events = await db
      .select()
      .from(activityEvents)
      .where(eq(activityEvents.workItemId, item.id))

    expect(events).toHaveLength(0)
  })

  it('rejects status in body with 422 VALIDATION_ERROR', async () => {
    const member = await seedUser()
    const team = await seedTeam()
    await seedMembership(member.id, team.id, 'member')

    const item = await seedItem(team.id, { createdBy: member.id, version: 1 })
    const actor: Actor = { id: member.id, isAdmin: false }

    let caughtError: unknown
    try {
      await patchItem(actor, item.id, {
        status: 'in_progress',
        version: 1,
      } as unknown as { version: number })
    } catch (e) {
      caughtError = e
    }

    expect(caughtError).toBeInstanceOf(ApiError)
    expect((caughtError as ApiError).code).toBe('VALIDATION_ERROR')
    expect((caughtError as ApiError).status).toBe(422)
  })

  it('rejects assignee in body with 422 VALIDATION_ERROR', async () => {
    const lead = await seedUser()
    const team = await seedTeam()
    await seedMembership(lead.id, team.id, 'lead')

    const item = await seedItem(team.id, { createdBy: lead.id, version: 1 })
    const actor: Actor = { id: lead.id, isAdmin: false }

    let caughtError: unknown
    try {
      await patchItem(actor, item.id, {
        assigneeId: lead.id,
        version: 1,
      } as unknown as { version: number })
    } catch (e) {
      caughtError = e
    }

    expect(caughtError).toBeInstanceOf(ApiError)
    expect((caughtError as ApiError).code).toBe('VALIDATION_ERROR')
    expect((caughtError as ApiError).status).toBe(422)
  })

  it('rejects unknown field in body with 422 VALIDATION_ERROR', async () => {
    const member = await seedUser()
    const team = await seedTeam()
    await seedMembership(member.id, team.id, 'member')

    const item = await seedItem(team.id, { createdBy: member.id, version: 1 })
    const actor: Actor = { id: member.id, isAdmin: false }

    let caughtError: unknown
    try {
      await patchItem(actor, item.id, {
        someRandomField: 'unexpected',
        version: 1,
      } as unknown as { version: number })
    } catch (e) {
      caughtError = e
    }

    expect(caughtError).toBeInstanceOf(ApiError)
    expect((caughtError as ApiError).code).toBe('VALIDATION_ERROR')
    expect((caughtError as ApiError).status).toBe(422)
  })

  it('requires version in input', async () => {
    const member = await seedUser()
    const team = await seedTeam()
    await seedMembership(member.id, team.id, 'member')

    const item = await seedItem(team.id, { createdBy: member.id, version: 1 })
    const actor: Actor = { id: member.id, isAdmin: false }

    let caughtError: unknown
    try {
      await patchItem(actor, item.id, {
        title: 'New title without version',
      } as unknown as { version: number })
    } catch (e) {
      caughtError = e
    }

    expect(caughtError).toBeInstanceOf(ApiError)
    expect((caughtError as ApiError).code).toBe('VALIDATION_ERROR')
  })

  it('viewer of team gets FORBIDDEN on patch', async () => {
    const viewer = await seedUser()
    const lead = await seedUser()
    const team = await seedTeam()
    await seedMembership(viewer.id, team.id, 'viewer')
    await seedMembership(lead.id, team.id, 'lead')

    const item = await seedItem(team.id, { createdBy: lead.id, version: 1 })
    const actor: Actor = { id: viewer.id, isAdmin: false }

    let caughtError: unknown
    try {
      await patchItem(actor, item.id, {
        title: 'Viewer trying to edit',
        version: 1,
      })
    } catch (e) {
      caughtError = e
    }

    expect(caughtError).toBeInstanceOf(ApiError)
    expect((caughtError as ApiError).code).toBe('FORBIDDEN')
  })

  it('non-member gets NOT_FOUND on patch', async () => {
    const outsider = await seedUser()
    const lead = await seedUser()
    const team = await seedTeam()
    await seedMembership(lead.id, team.id, 'lead')

    const item = await seedItem(team.id, { createdBy: lead.id, version: 1 })
    const actor: Actor = { id: outsider.id, isAdmin: false }

    let caughtError: unknown
    try {
      await patchItem(actor, item.id, {
        title: 'Outsider trying to edit',
        version: 1,
      })
    } catch (e) {
      caughtError = e
    }

    expect(caughtError).toBeInstanceOf(ApiError)
    expect((caughtError as ApiError).code).toBe('NOT_FOUND')
  })

  it('long description edit (>255 chars) succeeds, records full description_changed event, and clears to null', async () => {
    const lead = await seedUser()
    const team = await seedTeam()
    await seedMembership(lead.id, team.id, 'lead')

    const item = await seedItem(team.id, {
      createdBy: lead.id,
      title: 'Initial item',
      description: 'Initial short description',
      version: 1,
    })

    const actor: Actor = { id: lead.id, isAdmin: false }
    const longDescription = 'Detailed operational incident report section. '.repeat(15) // ~690 chars > 255

    const updated = await patchItem(actor, item.id, {
      description: longDescription,
      version: 1,
    })

    expect(updated.description).toBe(longDescription)
    expect(updated.version).toBe(2)

    // Check event in activity_events
    const events = await db
      .select()
      .from(activityEvents)
      .where(eq(activityEvents.workItemId, item.id))

    const descEvent = events.find((e) => e.type === 'description_changed')
    expect(descEvent).toBeDefined()
    expect(descEvent?.fromValue).toBe('Initial short description')
    expect(descEvent?.toValue).toBe(longDescription)

    // Clear description to null
    const cleared = await patchItem(actor, item.id, {
      description: null,
      version: 2,
    })

    expect(cleared.description).toBeNull()
    expect(cleared.version).toBe(3)

    const eventsAfterClear = await db
      .select()
      .from(activityEvents)
      .where(eq(activityEvents.workItemId, item.id))

    const clearEvent = eventsAfterClear.find((e) => e.type === 'description_changed' && e.toValue === null)
    expect(clearEvent).toBeDefined()
    expect(clearEvent?.fromValue).toBe(longDescription)
    expect(clearEvent?.toValue).toBeNull()
  })

  it('description exceeding 65,535 bytes throws 422 VALIDATION_ERROR', async () => {
    const lead = await seedUser()
    const team = await seedTeam()
    await seedMembership(lead.id, team.id, 'lead')

    const item = await seedItem(team.id, {
      createdBy: lead.id,
      title: 'Valid item',
      version: 1,
    })

    const actor: Actor = { id: lead.id, isAdmin: false }
    // 20,000 4-byte emojis = 80,000 bytes > 65,535 bytes
    const oversizedEmojiDesc = '🚀'.repeat(20000)

    let caughtError: unknown
    try {
      await patchItem(actor, item.id, {
        description: oversizedEmojiDesc,
        version: 1,
      })
    } catch (e) {
      caughtError = e
    }

    expect(caughtError).toBeInstanceOf(ApiError)
    expect((caughtError as ApiError).code).toBe('VALIDATION_ERROR')
    expect((caughtError as ApiError).status).toBe(422)
  })
})
