import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { closeDb, db } from '../../src/db/client'
import { activityEvents, comments, notifications } from '../../src/db/schema'
import { ApiError } from '../../src/http/errors'
import { addComment, listActivity } from '../../src/services/items'
import { resetDb, seedItem, seedMembership, seedTeam, seedUser } from '../helpers/db'
import type { Actor } from '../../src/domain/types'

describe('comments service - addComment (Task 4.8)', () => {
  beforeEach(resetDb)
  afterAll(closeDb)

  it('member comments: 200, comment row created, comment_added event with metadata.body', async () => {
    const member = await seedUser()
    const team = await seedTeam()
    await seedMembership(member.id, team.id, 'member')

    const item = await seedItem(team.id, {
      createdBy: member.id,
      title: 'Item to comment on',
    })

    const actor: Actor = { id: member.id, isAdmin: false }
    const comment = await addComment(actor, item.id, 'Investigating root cause in power distribution unit')

    expect(comment.id).toBeGreaterThan(0)
    expect(comment.workItemId).toBe(item.id)
    expect(comment.authorId).toBe(member.id)
    expect(comment.body).toBe('Investigating root cause in power distribution unit')
    expect(comment.createdAt).toBeInstanceOf(Date)

    // Verify row in comments table
    const commentRows = await db
      .select()
      .from(comments)
      .where(eq(comments.workItemId, item.id))

    expect(commentRows).toHaveLength(1)
    expect(commentRows[0]?.id).toBe(comment.id)
    expect(commentRows[0]?.body).toBe('Investigating root cause in power distribution unit')

    // Verify event in activity_events table
    const events = await db
      .select()
      .from(activityEvents)
      .where(eq(activityEvents.workItemId, item.id))

    expect(events).toHaveLength(1)
    expect(events[0]?.type).toBe('comment_added')
    expect(events[0]?.actorId).toBe(member.id)
    expect(events[0]?.metadata).toEqual({
      body: 'Investigating root cause in power distribution unit',
    })
  })

  it('comment appears in listActivity timeline', async () => {
    const member = await seedUser()
    const team = await seedTeam()
    await seedMembership(member.id, team.id, 'member')

    const item = await seedItem(team.id, {
      createdBy: member.id,
    })

    const actor: Actor = { id: member.id, isAdmin: false }
    await addComment(actor, item.id, 'Timeline visible comment')

    const { events } = await listActivity(actor, item.id)
    expect(events).toHaveLength(1)
    expect(events[0]?.type).toBe('comment_added')
    expect(events[0]?.metadata).toEqual({ body: 'Timeline visible comment' })
    expect(events[0]?.actor?.id).toBe(member.id)
  })

  it('empty or whitespace body throws 422 VALIDATION_ERROR and creates no rows', async () => {
    const member = await seedUser()
    const team = await seedTeam()
    await seedMembership(member.id, team.id, 'member')

    const item = await seedItem(team.id, { createdBy: member.id })
    const actor: Actor = { id: member.id, isAdmin: false }

    let caughtEmpty: unknown
    try {
      await addComment(actor, item.id, '')
    } catch (e) {
      caughtEmpty = e
    }
    expect(caughtEmpty).toBeInstanceOf(ApiError)
    expect((caughtEmpty as ApiError).code).toBe('VALIDATION_ERROR')
    expect((caughtEmpty as ApiError).status).toBe(422)

    let caughtWhitespace: unknown
    try {
      await addComment(actor, item.id, '    \n  \t ')
    } catch (e) {
      caughtWhitespace = e
    }
    expect(caughtWhitespace).toBeInstanceOf(ApiError)
    expect((caughtWhitespace as ApiError).code).toBe('VALIDATION_ERROR')

    // Verify no comments or events in DB
    const commentRows = await db.select().from(comments).where(eq(comments.workItemId, item.id))
    expect(commentRows).toHaveLength(0)
    const events = await db.select().from(activityEvents).where(eq(activityEvents.workItemId, item.id))
    expect(events).toHaveLength(0)
  })

  it('body exceeding 10,000 characters throws 422 VALIDATION_ERROR', async () => {
    const member = await seedUser()
    const team = await seedTeam()
    await seedMembership(member.id, team.id, 'member')

    const item = await seedItem(team.id, { createdBy: member.id })
    const actor: Actor = { id: member.id, isAdmin: false }

    const oversized = 'a'.repeat(10001)

    let caughtError: unknown
    try {
      await addComment(actor, item.id, oversized)
    } catch (e) {
      caughtError = e
    }

    expect(caughtError).toBeInstanceOf(ApiError)
    expect((caughtError as ApiError).code).toBe('VALIDATION_ERROR')

    // 10,000 characters is allowed
    const maxAllowed = 'a'.repeat(10000)
    const comment = await addComment(actor, item.id, maxAllowed)
    expect(comment.body).toBe(maxAllowed)
  })

  it('viewer of team gets 403 FORBIDDEN on comment', async () => {
    const viewer = await seedUser()
    const team = await seedTeam()
    await seedMembership(viewer.id, team.id, 'viewer')

    const item = await seedItem(team.id)
    const actor: Actor = { id: viewer.id, isAdmin: false }

    let caughtError: unknown
    try {
      await addComment(actor, item.id, 'Viewer comment')
    } catch (e) {
      caughtError = e
    }

    expect(caughtError).toBeInstanceOf(ApiError)
    expect((caughtError as ApiError).code).toBe('FORBIDDEN')
  })

  it('foreign-team item returns 404 NOT_FOUND', async () => {
    const outsider = await seedUser()
    const member = await seedUser()
    const team = await seedTeam()
    await seedMembership(member.id, team.id, 'member')

    const item = await seedItem(team.id, { createdBy: member.id })
    const actor: Actor = { id: outsider.id, isAdmin: false }

    let caughtError: unknown
    try {
      await addComment(actor, item.id, 'Outsider comment')
    } catch (e) {
      caughtError = e
    }

    expect(caughtError).toBeInstanceOf(ApiError)
    expect((caughtError as ApiError).code).toBe('NOT_FOUND')
  })

  it('member commenting on another member item enqueues comment_added notification for creator', async () => {
    const creator = await seedUser()
    const commenter = await seedUser()
    const team = await seedTeam()
    await seedMembership(creator.id, team.id, 'member')
    await seedMembership(commenter.id, team.id, 'member')

    const item = await seedItem(team.id, { createdBy: creator.id })
    const actor: Actor = { id: commenter.id, isAdmin: false }
    await addComment(actor, item.id, 'Investigating alongside you')

    const notifs = await db
      .select()
      .from(notifications)
      .where(eq(notifications.recipientUserId, creator.id))
    expect(notifs).toHaveLength(1)
    expect(notifs[0]?.type).toBe('comment_added')
  })
})
