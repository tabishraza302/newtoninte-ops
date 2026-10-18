import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import request from 'supertest'
import { createApp } from '../../src/app'
import { closeDb, pool } from '../../src/db/client'
import { resetDb, seedItem, seedMembership, seedTeam, seedUser } from '../helpers/db'
import { signAccessToken } from '../../src/services/tokens'

describe('Items write routes', () => {
  const app = createApp()

  beforeEach(resetDb)
  afterAll(closeDb)

  describe('POST /items', () => {
    it('requires authentication (401)', async () => {
      const res = await request(app).post('/items').send({ title: 'Task' })
      expect(res.status).toBe(401)
      expect(res.body.error?.code).toBe('UNAUTHENTICATED')
    })

    it('missing Idempotency-Key still creates item (returns 201 { item })', async () => {
      const team = await seedTeam()
      const user = await seedUser()
      await seedMembership(user.id, team.id, 'lead')
      const token = await signAccessToken(user.id)

      const payload = {
        teamId: team.id,
        title: 'New Feature Task',
        description: 'Detailed description of the feature',
        type: 'task',
        priority: 'high',
      }

      const res = await request(app)
        .post('/items')
        .set('Authorization', `Bearer ${token}`)
        .send(payload)

      expect(res.status).toBe(201)
      expect(res.body.item).toBeDefined()
      expect(res.body.item.title).toBe('New Feature Task')
      expect(res.body.item.description).toBe('Detailed description of the feature')
      expect(res.body.item.priority).toBe('high')
      expect(res.body.item.type).toBe('task')
      expect(res.body.item.status).toBe('open')
      expect(res.body.item.version).toBe(1)
      expect(res.body.item.createdBy).toBe(user.id)

      const [rows] = await pool.query('SELECT COUNT(*) as count FROM work_items WHERE team_id = ?', [team.id])
      const countRows = rows as Array<{ count: number | bigint }>
      expect(Number(countRows[0]?.count)).toBe(1)
    })

    it('repeated POST with same Idempotency-Key replays response without duplicate', async () => {
      const team = await seedTeam()
      const user = await seedUser()
      await seedMembership(user.id, team.id, 'lead')
      const token = await signAccessToken(user.id)

      const payload = {
        teamId: team.id,
        title: 'Idempotent Item',
        description: 'Ensuring idempotency works',
        type: 'incident',
        priority: 'urgent',
      }
      const idemKey = 'item-create-key-12345'

      const res1 = await request(app)
        .post('/items')
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', idemKey)
        .send(payload)

      expect(res1.status).toBe(201)
      expect(res1.body.item).toBeDefined()
      const itemId = res1.body.item.id

      // Repeat identical request with same key
      const res2 = await request(app)
        .post('/items')
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', idemKey)
        .send(payload)

      expect(res2.status).toBe(201)
      expect(res2.body.item).toBeDefined()
      expect(res2.body.item.id).toBe(itemId)
      expect(res2.body.item.title).toBe('Idempotent Item')

      // Exactly 1 row in work_items
      const [rows] = await pool.query('SELECT COUNT(*) as count FROM work_items WHERE team_id = ?', [team.id])
      const countRows = rows as Array<{ count: number | bigint }>
      expect(Number(countRows[0]?.count)).toBe(1)

      // Same key with different payload returns 422 IDEMPOTENCY_KEY_MISMATCH
      const resMismatch = await request(app)
        .post('/items')
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', idemKey)
        .send({ ...payload, title: 'Different Title' })

      expect(resMismatch.status).toBe(422)
      expect(resMismatch.body.error?.code).toBe('IDEMPOTENCY_KEY_MISMATCH')
    })

    it('Idempotency-Key exceeding 255 chars returns 422 VALIDATION_ERROR', async () => {
      const team = await seedTeam()
      const user = await seedUser()
      await seedMembership(user.id, team.id, 'lead')
      const token = await signAccessToken(user.id)

      const payload = {
        teamId: team.id,
        title: 'Task with long idem key',
        type: 'task',
        priority: 'high',
      }

      const res = await request(app)
        .post('/items')
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', 'k'.repeat(256))
        .send(payload)

      expect(res.status).toBe(422)
      expect(res.body.error?.code).toBe('VALIDATION_ERROR')
    })
  })

  describe('PATCH /items/:id', () => {
    it('requires authentication (401)', async () => {
      const team = await seedTeam()
      const item = await seedItem(team.id)
      const res = await request(app).patch(`/items/${item.id}`).send({ title: 'New' })
      expect(res.status).toBe(401)
      expect(res.body.error?.code).toBe('UNAUTHENTICATED')
    })

    it('patches item fields with version in body (returns 200 { item })', async () => {
      const team = await seedTeam()
      const user = await seedUser()
      await seedMembership(user.id, team.id, 'lead')
      const item = await seedItem(team.id, {
        title: 'Original Title',
        description: 'Original Description',
        priority: 'low',
        type: 'task',
        createdBy: user.id,
      })
      const token = await signAccessToken(user.id)

      const res = await request(app)
        .patch(`/items/${item.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          version: item.version,
          title: 'Updated Title',
          description: 'Updated Description',
          priority: 'urgent',
          type: 'compliance',
        })

      expect(res.status).toBe(200)
      expect(res.body.item).toBeDefined()
      expect(res.body.item.id).toBe(item.id)
      expect(res.body.item.title).toBe('Updated Title')
      expect(res.body.item.description).toBe('Updated Description')
      expect(res.body.item.priority).toBe('urgent')
      expect(res.body.item.type).toBe('compliance')
      expect(res.body.item.version).toBe(2)
    })

    it('If-Match header is honoured as version', async () => {
      const team = await seedTeam()
      const user = await seedUser()
      await seedMembership(user.id, team.id, 'lead')
      const item = await seedItem(team.id, {
        title: 'Header Version Item',
        createdBy: user.id,
      })
      const token = await signAccessToken(user.id)

      const res = await request(app)
        .patch(`/items/${item.id}`)
        .set('Authorization', `Bearer ${token}`)
        .set('If-Match', `"${item.version}"`)
        .send({
          title: 'Updated with If-Match',
        })

      expect(res.status).toBe(200)
      expect(res.body.item).toBeDefined()
      expect(res.body.item.title).toBe('Updated with If-Match')
      expect(res.body.item.version).toBe(2)
    })

    it('throws 422 VALIDATION_ERROR when version is missing from both body and If-Match', async () => {
      const team = await seedTeam()
      const user = await seedUser()
      await seedMembership(user.id, team.id, 'lead')
      const item = await seedItem(team.id, { createdBy: user.id })
      const token = await signAccessToken(user.id)

      const res = await request(app)
        .patch(`/items/${item.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          title: 'No Version Provided',
        })

      expect(res.status).toBe(422)
      expect(res.body.error?.code).toBe('VALIDATION_ERROR')
    })

    it('throws 422 VALIDATION_ERROR when status or assigneeId is present in body', async () => {
      const team = await seedTeam()
      const user = await seedUser()
      await seedMembership(user.id, team.id, 'lead')
      const item = await seedItem(team.id, { createdBy: user.id })
      const token = await signAccessToken(user.id)

      // Test with status
      const resStatus = await request(app)
        .patch(`/items/${item.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          version: item.version,
          status: 'in_progress',
        })
      expect(resStatus.status).toBe(422)
      expect(resStatus.body.error?.code).toBe('VALIDATION_ERROR')

      // Test with assigneeId
      const resAssignee = await request(app)
        .patch(`/items/${item.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          version: item.version,
          assigneeId: user.id,
        })
      expect(resAssignee.status).toBe(422)
      expect(resAssignee.body.error?.code).toBe('VALIDATION_ERROR')
    })

    it('409 VERSION_CONFLICT carries current item in details', async () => {
      const team = await seedTeam()
      const user = await seedUser()
      await seedMembership(user.id, team.id, 'lead')
      const item = await seedItem(team.id, {
        title: 'Current State Item',
        description: 'Original',
        createdBy: user.id,
      })
      const token = await signAccessToken(user.id)

      const res = await request(app)
        .patch(`/items/${item.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          version: 999, // Stale version
          title: 'Conflicting Edit',
        })

      expect(res.status).toBe(409)
      expect(res.body.error?.code).toBe('VERSION_CONFLICT')
      expect(res.body.error?.details).toBeDefined()
      const details = res.body.error.details as {
        item?: { id: number; version: number; title: string }
        id?: number
        version?: number
        title?: string
      }
      const currentItem = details.item ?? details
      expect(currentItem.id).toBe(item.id)
      expect(currentItem.version).toBe(item.version)
      expect(currentItem.title).toBe('Current State Item')
    })

    it('PATCH /items/:id with unknown field returns 422 VALIDATION_ERROR', async () => {
      const team = await seedTeam()
      const user = await seedUser()
      await seedMembership(user.id, team.id, 'lead')
      const item = await seedItem(team.id, {
        title: 'Original',
        createdBy: user.id,
      })
      const token = await signAccessToken(user.id)

      const res = await request(app)
        .patch(`/items/${item.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          version: 1,
          title: 'New Title',
          bogusField: 'unexpected',
        })

      expect(res.status).toBe(422)
      expect(res.body.error?.code).toBe('VALIDATION_ERROR')
    })

  })

  describe('POST /items/:id/claim', () => {
    it('requires authentication (401)', async () => {
      const team = await seedTeam()
      const item = await seedItem(team.id)
      const res = await request(app).post(`/items/${item.id}/claim`)
      expect(res.status).toBe(401)
      expect(res.body.error?.code).toBe('UNAUTHENTICATED')
    })

    it('claims an open item and sets status to in_progress (returns 200 { item })', async () => {
      const team = await seedTeam()
      const user = await seedUser()
      await seedMembership(user.id, team.id, 'member')
      const item = await seedItem(team.id, {
        status: 'open',
        assigneeId: null,
      })
      const token = await signAccessToken(user.id)

      const res = await request(app)
        .post(`/items/${item.id}/claim`)
        .set('Authorization', `Bearer ${token}`)

      expect(res.status).toBe(200)
      expect(res.body.item).toBeDefined()
      expect(res.body.item.id).toBe(item.id)
      expect(res.body.item.status).toBe('in_progress')
      expect(res.body.item.assigneeId).toBe(user.id)
      expect(res.body.item.version).toBe(2)
    })

    it('returns 409 ALREADY_CLAIMED when item is already claimed', async () => {
      const team = await seedTeam()
      const user1 = await seedUser()
      const user2 = await seedUser()
      await seedMembership(user1.id, team.id, 'member')
      await seedMembership(user2.id, team.id, 'member')
      const item = await seedItem(team.id, {
        status: 'open',
        assigneeId: null,
      })
      const token1 = await signAccessToken(user1.id)
      const token2 = await signAccessToken(user2.id)

      // First claim succeeds
      const res1 = await request(app)
        .post(`/items/${item.id}/claim`)
        .set('Authorization', `Bearer ${token1}`)
      expect(res1.status).toBe(200)

      // Second claim fails
      const res2 = await request(app)
        .post(`/items/${item.id}/claim`)
        .set('Authorization', `Bearer ${token2}`)
      expect(res2.status).toBe(409)
      expect(res2.body.error?.code).toBe('ALREADY_CLAIMED')
    })
  })

  describe('POST /items/:id/assign', () => {
    it('requires authentication (401)', async () => {
      const team = await seedTeam()
      const item = await seedItem(team.id)
      const res = await request(app).post(`/items/${item.id}/assign`).send({ assigneeId: 1, expectedVersion: 1 })
      expect(res.status).toBe(401)
      expect(res.body.error?.code).toBe('UNAUTHENTICATED')
    })

    it('assigns item using expectedVersion in body (returns 200 { item })', async () => {
      const team = await seedTeam()
      const lead = await seedUser()
      const member = await seedUser()
      await seedMembership(lead.id, team.id, 'lead')
      await seedMembership(member.id, team.id, 'member')
      const item = await seedItem(team.id, {
        status: 'open',
        assigneeId: null,
        createdBy: lead.id,
      })
      const token = await signAccessToken(lead.id)

      const res = await request(app)
        .post(`/items/${item.id}/assign`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          assigneeId: member.id,
          expectedVersion: item.version,
        })

      expect(res.status).toBe(200)
      expect(res.body.item).toBeDefined()
      expect(res.body.item.id).toBe(item.id)
      expect(res.body.item.assigneeId).toBe(member.id)
      expect(res.body.item.version).toBe(2)
    })

    it('assigns item using If-Match header as version', async () => {
      const team = await seedTeam()
      const lead = await seedUser()
      const member = await seedUser()
      await seedMembership(lead.id, team.id, 'lead')
      await seedMembership(member.id, team.id, 'member')
      const item = await seedItem(team.id, {
        status: 'open',
        assigneeId: null,
        createdBy: lead.id,
      })
      const token = await signAccessToken(lead.id)

      const res = await request(app)
        .post(`/items/${item.id}/assign`)
        .set('Authorization', `Bearer ${token}`)
        .set('If-Match', `"${item.version}"`)
        .send({
          assigneeId: member.id,
        })

      expect(res.status).toBe(200)
      expect(res.body.item).toBeDefined()
      expect(res.body.item.id).toBe(item.id)
      expect(res.body.item.assigneeId).toBe(member.id)
      expect(res.body.item.version).toBe(2)
    })

    it('returns 409 STALE_STATE on expectedVersion mismatch', async () => {
      const team = await seedTeam()
      const lead = await seedUser()
      const member = await seedUser()
      await seedMembership(lead.id, team.id, 'lead')
      await seedMembership(member.id, team.id, 'member')
      const item = await seedItem(team.id, {
        status: 'open',
        createdBy: lead.id,
      })
      const token = await signAccessToken(lead.id)

      const res = await request(app)
        .post(`/items/${item.id}/assign`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          assigneeId: member.id,
          expectedVersion: 999,
        })

      expect(res.status).toBe(409)
      expect(res.body.error?.code).toBe('STALE_STATE')
    })
  })

  describe('POST /items/:id/transition', () => {
    it('requires authentication (401)', async () => {
      const team = await seedTeam()
      const item = await seedItem(team.id)
      const res = await request(app).post(`/items/${item.id}/transition`).send({ to: 'in_progress' })
      expect(res.status).toBe(401)
      expect(res.body.error?.code).toBe('UNAUTHENTICATED')
    })

    it('transitions item from in_progress to awaiting_approval (returns 200 { item })', async () => {
      const team = await seedTeam()
      const user = await seedUser()
      await seedMembership(user.id, team.id, 'lead')
      const item = await seedItem(team.id, {
        status: 'in_progress',
        assigneeId: user.id,
        createdBy: user.id,
      })
      const token = await signAccessToken(user.id)

      const res = await request(app)
        .post(`/items/${item.id}/transition`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          to: 'awaiting_approval',
          reason: 'Ready for review',
        })

      expect(res.status).toBe(200)
      expect(res.body.item).toBeDefined()
      expect(res.body.item.id).toBe(item.id)
      expect(res.body.item.status).toBe('awaiting_approval')
      expect(res.body.item.version).toBe(2)
    })

    it('returns 422 INVALID_TRANSITION on illegal transition', async () => {
      const team = await seedTeam()
      const user = await seedUser()
      await seedMembership(user.id, team.id, 'lead')
      const item = await seedItem(team.id, {
        status: 'open',
        createdBy: user.id,
      })
      const token = await signAccessToken(user.id)

      const res = await request(app)
        .post(`/items/${item.id}/transition`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          to: 'closed', // open -> closed is illegal
        })

      expect(res.status).toBe(422)
      expect(res.body.error?.code).toBe('INVALID_TRANSITION')
    })
  })

  describe('POST /items/:id/comments', () => {
    it('requires authentication (401)', async () => {
      const team = await seedTeam()
      const item = await seedItem(team.id)
      const res = await request(app).post(`/items/${item.id}/comments`).send({ body: 'Hello' })
      expect(res.status).toBe(401)
      expect(res.body.error?.code).toBe('UNAUTHENTICATED')
    })

    it('adds comment to item (returns 201 { comment })', async () => {
      const team = await seedTeam()
      const user = await seedUser()
      await seedMembership(user.id, team.id, 'member')
      const item = await seedItem(team.id, {
        createdBy: user.id,
      })
      const token = await signAccessToken(user.id)

      const res = await request(app)
        .post(`/items/${item.id}/comments`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          body: 'This is an important comment on the task.',
        })

      expect(res.status).toBe(201)
      expect(res.body.comment).toBeDefined()
      expect(res.body.comment.workItemId).toBe(item.id)
      expect(res.body.comment.authorId).toBe(user.id)
      expect(res.body.comment.body).toBe('This is an important comment on the task.')
    })

    it('returns 422 VALIDATION_ERROR when comment body is empty', async () => {
      const team = await seedTeam()
      const user = await seedUser()
      await seedMembership(user.id, team.id, 'member')
      const item = await seedItem(team.id, {
        createdBy: user.id,
      })
      const token = await signAccessToken(user.id)

      const res = await request(app)
        .post(`/items/${item.id}/comments`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          body: '',
        })

      expect(res.status).toBe(422)
      expect(res.body.error?.code).toBe('VALIDATION_ERROR')
    })
  })
})
