import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { and, eq } from 'drizzle-orm'
import { createApp } from '../../src/app'
import { closeDb, db } from '../../src/db/client'
import { memberships, notifications, workItems } from '../../src/db/schema'
import { resetDb, seedItem, seedMembership, seedTeam, seedUser } from '../helpers/db'
import { signAccessToken } from '../../src/services/tokens'

interface ErrorResponseBody {
  error: {
    code: string
    message: string
    details?: unknown
  }
}

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

describe('Concurrency & Workflow routes (§13)', () => {
  const app = createApp()

  beforeEach(resetDb)
  afterAll(closeDb)

  it('(a) §13 Concurrent claim: N=8 parallel POST /items/:id/claim -> exactly one 200, seven 409 ALREADY_CLAIMED, exactly one assignee_id set in DB', async () => {
    const team = await seedTeam()
    const creator = await seedUser()
    await seedMembership(creator.id, team.id, 'lead')

    const item = await seedItem(team.id, {
      title: 'Claim race target item',
      status: 'open',
      assigneeId: null,
      version: 1,
      createdBy: creator.id,
    })

    const claimants = await Promise.all([
      seedUser(),
      seedUser(),
      seedUser(),
      seedUser(),
      seedUser(),
      seedUser(),
      seedUser(),
      seedUser(),
    ])

    for (const claimant of claimants) {
      await seedMembership(claimant.id, team.id, 'member')
    }

    const tokens = await Promise.all(claimants.map((user) => signAccessToken(user.id)))

    const responses = await Promise.all(
      tokens.map((token) =>
        request(app)
          .post(`/items/${item.id}/claim`)
          .set('Authorization', `Bearer ${token}`),
      ),
    )

    const successes = responses.filter((res) => res.status === 200)
    const conflicts = responses.filter((res) => res.status === 409)

    expect(successes).toHaveLength(1)
    expect(conflicts).toHaveLength(7)

    for (const res of conflicts) {
      const body = res.body as ErrorResponseBody
      expect(body.error).toBeDefined()
      expect(body.error.code).toBe('ALREADY_CLAIMED')
    }

    const winningBody = successes[0]?.body as ItemResponseBody
    expect(winningBody.item).toBeDefined()
    expect(winningBody.item.status).toBe('in_progress')
    expect(winningBody.item.assigneeId).not.toBeNull()

    const [persisted] = await db
      .select()
      .from(workItems)
      .where(eq(workItems.id, item.id))
      .limit(1)

    expect(persisted).toBeDefined()
    expect(persisted?.status).toBe('in_progress')
    expect(persisted?.assigneeId).toBe(winningBody.item.assigneeId)
    expect(claimants.some((c) => c.id === persisted?.assigneeId)).toBe(true)
  })

  it('(b) §13 Stale update: PATCH with old version -> 409 VERSION_CONFLICT, row unchanged', async () => {
    const team = await seedTeam()
    const user = await seedUser()
    await seedMembership(user.id, team.id, 'lead')
    const token = await signAccessToken(user.id)

    const item = await seedItem(team.id, {
      title: 'Initial Title',
      status: 'open',
      version: 1,
      createdBy: user.id,
    })

    const firstPatchRes = await request(app)
      .patch(`/items/${item.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'Updated Title',
        version: 1,
      })

    expect(firstPatchRes.status).toBe(200)
    const firstBody = firstPatchRes.body as ItemResponseBody
    expect(firstBody.item.version).toBe(2)
    expect(firstBody.item.title).toBe('Updated Title')

    const stalePatchRes = await request(app)
      .patch(`/items/${item.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'Stale Overwrite Attempt',
        version: 1,
      })

    expect(stalePatchRes.status).toBe(409)
    const staleBody = stalePatchRes.body as ErrorResponseBody
    expect(staleBody.error).toBeDefined()
    expect(staleBody.error.code).toBe('VERSION_CONFLICT')

    const [persisted] = await db
      .select()
      .from(workItems)
      .where(eq(workItems.id, item.id))
      .limit(1)

    expect(persisted).toBeDefined()
    expect(persisted?.title).toBe('Updated Title')
    expect(persisted?.version).toBe(2)
  })

  it('(c) §13 Per-field authz: member PATCH { priority } -> 403; member PATCH { description } -> 200', async () => {
    const team = await seedTeam()
    const lead = await seedUser()
    const member = await seedUser()
    await seedMembership(lead.id, team.id, 'lead')
    await seedMembership(member.id, team.id, 'member')

    const item = await seedItem(team.id, {
      title: 'Authz Item',
      description: 'Initial description',
      priority: 'medium',
      status: 'open',
      version: 1,
      createdBy: lead.id,
    })

    const memberToken = await signAccessToken(member.id)

    const forbiddenRes = await request(app)
      .patch(`/items/${item.id}`)
      .set('Authorization', `Bearer ${memberToken}`)
      .send({
        priority: 'urgent',
        version: 1,
      })

    expect(forbiddenRes.status).toBe(403)
    const forbiddenBody = forbiddenRes.body as ErrorResponseBody
    expect(forbiddenBody.error).toBeDefined()
    expect(forbiddenBody.error.code).toBe('FORBIDDEN')

    const allowedRes = await request(app)
      .patch(`/items/${item.id}`)
      .set('Authorization', `Bearer ${memberToken}`)
      .send({
        description: 'Updated description by member',
        version: 1,
      })

    expect(allowedRes.status).toBe(200)
    const allowedBody = allowedRes.body as ItemResponseBody
    expect(allowedBody.item.description).toBe('Updated description by member')
    expect(allowedBody.item.priority).toBe('medium')
    expect(allowedBody.item.version).toBe(2)
  })

  it('(d) §13 Workflow rules: open -> closed -> 422; non-lead approve -> 403', async () => {
    const team = await seedTeam()
    const lead = await seedUser()
    const member = await seedUser()
    await seedMembership(lead.id, team.id, 'lead')
    await seedMembership(member.id, team.id, 'member')

    const leadToken = await signAccessToken(lead.id)
    const memberToken = await signAccessToken(member.id)

    const item = await seedItem(team.id, {
      title: 'Workflow Item',
      status: 'open',
      version: 1,
      createdBy: lead.id,
    })

    const illegalTransitionRes = await request(app)
      .post(`/items/${item.id}/transition`)
      .set('Authorization', `Bearer ${leadToken}`)
      .send({
        to: 'closed',
      })

    expect(illegalTransitionRes.status).toBe(422)
    const illegalBody = illegalTransitionRes.body as ErrorResponseBody
    expect(illegalBody.error).toBeDefined()
    expect(illegalBody.error.code).toBe('INVALID_TRANSITION')

    await request(app)
      .post(`/items/${item.id}/claim`)
      .set('Authorization', `Bearer ${memberToken}`)

    await request(app)
      .post(`/items/${item.id}/transition`)
      .set('Authorization', `Bearer ${memberToken}`)
      .send({
        to: 'awaiting_approval',
      })

    const forbiddenApproveRes = await request(app)
      .post(`/items/${item.id}/transition`)
      .set('Authorization', `Bearer ${memberToken}`)
      .send({
        to: 'resolved',
      })

    expect(forbiddenApproveRes.status).toBe(403)
    const forbiddenBody = forbiddenApproveRes.body as ErrorResponseBody
    expect(forbiddenBody.error).toBeDefined()
    expect(forbiddenBody.error.code).toBe('FORBIDDEN')
  })

  it('(e) §13 Transition race: two leads approve concurrently -> one 200, the other 409 STALE_STATE', async () => {
    const team = await seedTeam()
    const lead1 = await seedUser()
    const lead2 = await seedUser()
    const worker = await seedUser()

    await seedMembership(lead1.id, team.id, 'lead')
    await seedMembership(lead2.id, team.id, 'lead')
    await seedMembership(worker.id, team.id, 'member')

    const item = await seedItem(team.id, {
      title: 'Approval Race Item',
      status: 'awaiting_approval',
      assigneeId: worker.id,
      version: 2,
      createdBy: worker.id,
    })

    const lead1Token = await signAccessToken(lead1.id)
    const lead2Token = await signAccessToken(lead2.id)

    const [res1, res2] = await Promise.all([
      request(app)
        .post(`/items/${item.id}/transition`)
        .set('Authorization', `Bearer ${lead1Token}`)
        .send({ to: 'resolved' }),
      request(app)
        .post(`/items/${item.id}/transition`)
        .set('Authorization', `Bearer ${lead2Token}`)
        .send({ to: 'resolved' }),
    ])

    const statuses = [res1.status, res2.status].sort()
    expect(statuses).toEqual([200, 409])

    const successRes = res1.status === 200 ? res1 : res2
    const staleRes = res1.status === 409 ? res1 : res2

    const successBody = successRes.body as ItemResponseBody
    expect(successBody.item.status).toBe('resolved')

    const staleBody = staleRes.body as ErrorResponseBody
    expect(staleBody.error).toBeDefined()
    expect(staleBody.error.code).toBe('STALE_STATE')

    const [persisted] = await db
      .select()
      .from(workItems)
      .where(eq(workItems.id, item.id))
      .limit(1)

    expect(persisted).toBeDefined()
    expect(persisted?.status).toBe('resolved')
    expect(persisted?.version).toBe(3)

    const notifs = await db
      .select()
      .from(notifications)
      .where(eq(notifications.recipientUserId, worker.id))
    expect(notifs).toHaveLength(1)
    expect(notifs[0]?.type).toBe('workflow_decision')
  })

  it('(f) §13 Idempotency: same Idempotency-Key twice -> one item, byte-identical response', async () => {
    const team = await seedTeam()
    const user = await seedUser()
    await seedMembership(user.id, team.id, 'lead')
    const token = await signAccessToken(user.id)

    const key = `idem-key-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const payload = {
      teamId: team.id,
      title: 'Idempotency Keyed Item',
      type: 'task',
      priority: 'high',
      description: 'First attempt body',
    }

    const res1 = await request(app)
      .post('/items')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', key)
      .send(payload)

    expect(res1.status).toBe(201)
    const body1 = res1.body as ItemResponseBody
    expect(body1.item).toBeDefined()
    expect(body1.item.title).toBe('Idempotency Keyed Item')

    const res2 = await request(app)
      .post('/items')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', key)
      .send(payload)

    expect(res2.status).toBe(201)
    expect(res2.text).toBe(res1.text)

    const itemsInDb = await db
      .select()
      .from(workItems)
      .where(eq(workItems.teamId, team.id))

    expect(itemsInDb).toHaveLength(1)
    expect(itemsInDb[0]?.id).toBe(body1.item.id)
  })

  it('(g) §13 Authorization: viewer cannot increment version/timestamp via version-only PATCH', async () => {
    const team = await seedTeam()
    const lead = await seedUser()
    const viewer = await seedUser()
    const member = await seedUser()
    await seedMembership(lead.id, team.id, 'lead')
    await seedMembership(viewer.id, team.id, 'viewer')
    await seedMembership(member.id, team.id, 'member')

    const item = await seedItem(team.id, {
      title: 'Protected item',
      status: 'open',
      version: 1,
      createdBy: lead.id,
    })

    const viewerToken = await signAccessToken(viewer.id)
    const memberToken = await signAccessToken(member.id)

    // Viewer version-only PATCH must fail with 403 FORBIDDEN
    const viewerRes = await request(app)
      .patch(`/items/${item.id}`)
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ version: 1 })

    expect(viewerRes.status).toBe(403)
    const viewerBody = viewerRes.body as ErrorResponseBody
    expect(viewerBody.error).toBeDefined()
    expect(viewerBody.error.code).toBe('FORBIDDEN')

    const [persistedAfterViewer] = await db
      .select()
      .from(workItems)
      .where(eq(workItems.id, item.id))
      .limit(1)

    expect(persistedAfterViewer?.version).toBe(1)
    expect(persistedAfterViewer?.updatedAt.getTime()).toBe(item.updatedAt.getTime())

    // Member version-only PATCH succeeds
    const memberRes = await request(app)
      .patch(`/items/${item.id}`)
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ version: 1 })

    expect(memberRes.status).toBe(200)
    const memberBody = memberRes.body as ItemResponseBody
    expect(memberBody.item.version).toBe(2)
  })

  it('(h) §13 Idempotency replay authz: removed or demoted actor cannot retrieve or create item via cached receipt', async () => {
    const team = await seedTeam()
    const user = await seedUser()
    await seedMembership(user.id, team.id, 'member')
    const token = await signAccessToken(user.id)

    const key = `idem-replay-authz-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const payload = {
      teamId: team.id,
      title: 'Original Keyed Item',
      type: 'task',
      priority: 'medium',
    }

    // 1. Initial creation succeeds and caches receipt
    const res1 = await request(app)
      .post('/items')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', key)
      .send(payload)

    expect(res1.status).toBe(201)
    const body1 = res1.body as ItemResponseBody
    expect(body1.item.id).toBeDefined()

    // 2. Demote user to viewer -> replay must be rejected with 403 FORBIDDEN
    await db
      .update(memberships)
      .set({ role: 'viewer' })
      .where(and(eq(memberships.userId, user.id), eq(memberships.teamId, team.id)))

    const demotedRes = await request(app)
      .post('/items')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', key)
      .send(payload)

    expect(demotedRes.status).toBe(403)
    const demotedBody = demotedRes.body as ErrorResponseBody
    expect(demotedBody.error.code).toBe('FORBIDDEN')

    // 3. Remove user from team entirely -> replay must be rejected with 404 NOT_FOUND
    await db
      .delete(memberships)
      .where(and(eq(memberships.userId, user.id), eq(memberships.teamId, team.id)))

    const removedRes = await request(app)
      .post('/items')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', key)
      .send(payload)

    expect(removedRes.status).toBe(404)
    const removedBody = removedRes.body as ErrorResponseBody
    expect(removedBody.error.code).toBe('NOT_FOUND')

    // 4. Restore membership as member -> replay returns original receipt without creating new item
    await seedMembership(user.id, team.id, 'member')

    const replayedRes = await request(app)
      .post('/items')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', key)
      .send(payload)

    expect(replayedRes.status).toBe(201)
    const replayedBody = replayedRes.body as ItemResponseBody
    expect(replayedBody.item.id).toBe(body1.item.id)

    const allItems = await db
      .select()
      .from(workItems)
      .where(eq(workItems.teamId, team.id))

    expect(allItems).toHaveLength(1)
  })
})
