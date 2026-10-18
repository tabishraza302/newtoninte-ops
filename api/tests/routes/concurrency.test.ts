import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { eq } from 'drizzle-orm'
import { createApp } from '../../src/app'
import { closeDb, db } from '../../src/db/client'
import { workItems } from '../../src/db/schema'
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
})
