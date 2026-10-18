import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import request from 'supertest'
import { createApp } from '../../src/app'
import { closeDb, db } from '../../src/db/client'
import { memberships } from '../../src/db/schema'
import { createItem } from '../../src/services/items'
import { signAccessToken } from '../../src/services/tokens'
import { resetDb, seedMembership, seedTeam, seedUser } from '../helpers/db'
import type { Actor } from '../../src/domain/types'

describe('Notifications routes', () => {
  const app = createApp()

  beforeEach(resetDb)
  afterAll(closeDb)

  describe('Authentication guards (401)', () => {
    it('GET /notifications requires auth', async () => {
      const res = await request(app).get('/notifications')
      expect(res.status).toBe(401)
      expect(res.body.error?.code).toBe('UNAUTHENTICATED')
    })

    it('GET /notifications/summary requires auth', async () => {
      const res = await request(app).get('/notifications/summary')
      expect(res.status).toBe(401)
      expect(res.body.error?.code).toBe('UNAUTHENTICATED')
    })

    it('POST /notifications/read-all requires auth', async () => {
      const res = await request(app).post('/notifications/read-all')
      expect(res.status).toBe(401)
      expect(res.body.error?.code).toBe('UNAUTHENTICATED')
    })

    it('POST /notifications/1/read requires auth', async () => {
      const res = await request(app).post('/notifications/1/read')
      expect(res.status).toBe(401)
      expect(res.body.error?.code).toBe('UNAUTHENTICATED')
    })
  })

  describe('GET /notifications/summary', () => {
    it('returns 200 with unread count for user', async () => {
      const lead = await seedUser()
      const member = await seedUser()
      const team = await seedTeam()
      await seedMembership(lead.id, team.id, 'lead')
      await seedMembership(member.id, team.id, 'member')

      const memberToken = await signAccessToken(member.id)

      // Initial count is 0
      const res1 = await request(app)
        .get('/notifications/summary')
        .set('Authorization', `Bearer ${memberToken}`)

      expect(res1.status).toBe(200)
      expect(res1.body).toEqual({ unreadCount: 0 })

      // Create item assigned to member
      const leadActor: Actor = { id: lead.id, isAdmin: false }
      await createItem(leadActor, {
        teamId: team.id,
        title: 'New assignment',
        type: 'task',
        priority: 'high',
        assigneeId: member.id,
      })

      const res2 = await request(app)
        .get('/notifications/summary')
        .set('Authorization', `Bearer ${memberToken}`)

      expect(res2.status).toBe(200)
      expect(res2.body).toEqual({ unreadCount: 1 })
    })
  })

  describe('GET /notifications', () => {
    it('returns paginated notifications for the authenticated user', async () => {
      const lead = await seedUser()
      const member = await seedUser()
      const team = await seedTeam()
      await seedMembership(lead.id, team.id, 'lead')
      await seedMembership(member.id, team.id, 'member')

      const leadActor: Actor = { id: lead.id, isAdmin: false }
      const memberToken = await signAccessToken(member.id)

      await createItem(leadActor, {
        teamId: team.id,
        title: 'Item 1',
        type: 'task',
        priority: 'medium',
        assigneeId: member.id,
      })
      await createItem(leadActor, {
        teamId: team.id,
        title: 'Item 2',
        type: 'task',
        priority: 'high',
        assigneeId: member.id,
      })

      // Fetch with limit 1
      const res1 = await request(app)
        .get('/notifications?limit=1')
        .set('Authorization', `Bearer ${memberToken}`)

      expect(res1.status).toBe(200)
      expect(res1.body.notifications).toHaveLength(1)
      expect(res1.body.notifications[0].itemTitle).toBe('Item 2')
      expect(res1.body.nextCursor).toBeDefined()
      expect(res1.body.nextCursor).not.toBeNull()

      // Fetch next page
      const res2 = await request(app)
        .get(`/notifications?limit=1&cursor=${encodeURIComponent(res1.body.nextCursor)}`)
        .set('Authorization', `Bearer ${memberToken}`)

      expect(res2.status).toBe(200)
      expect(res2.body.notifications).toHaveLength(1)
      expect(res2.body.notifications[0].itemTitle).toBe('Item 1')
      expect(res2.body.nextCursor).toBeNull()
    })

    it('rejects invalid limit (422)', async () => {
      const user = await seedUser()
      const token = await signAccessToken(user.id)

      const res1 = await request(app)
        .get('/notifications?limit=0')
        .set('Authorization', `Bearer ${token}`)
      expect(res1.status).toBe(422)

      const res2 = await request(app)
        .get('/notifications?limit=101')
        .set('Authorization', `Bearer ${token}`)
      expect(res2.status).toBe(422)

      const res3 = await request(app)
        .get('/notifications?limit=invalid')
        .set('Authorization', `Bearer ${token}`)
      expect(res3.status).toBe(422)
    })
  })

  describe('POST /notifications/:id/read', () => {
    it('marks notification read (204) and is idempotent on repeat', async () => {
      const lead = await seedUser()
      const member = await seedUser()
      const team = await seedTeam()
      await seedMembership(lead.id, team.id, 'lead')
      await seedMembership(member.id, team.id, 'member')

      const leadActor: Actor = { id: lead.id, isAdmin: false }
      const memberToken = await signAccessToken(member.id)

      await createItem(leadActor, {
        teamId: team.id,
        title: 'Item to read',
        type: 'task',
        priority: 'low',
        assigneeId: member.id,
      })

      const listRes = await request(app)
        .get('/notifications')
        .set('Authorization', `Bearer ${memberToken}`)

      const notifId = listRes.body.notifications[0].id

      // First mark-read
      const readRes1 = await request(app)
        .post(`/notifications/${notifId}/read`)
        .set('Authorization', `Bearer ${memberToken}`)

      expect(readRes1.status).toBe(204)

      // Summary is now 0
      const summaryRes = await request(app)
        .get('/notifications/summary')
        .set('Authorization', `Bearer ${memberToken}`)
      expect(summaryRes.body.unreadCount).toBe(0)

      // Second mark-read (idempotent)
      const readRes2 = await request(app)
        .post(`/notifications/${notifId}/read`)
        .set('Authorization', `Bearer ${memberToken}`)
      expect(readRes2.status).toBe(204)
    })

    it('returns 422 for invalid id', async () => {
      const user = await seedUser()
      const token = await signAccessToken(user.id)

      const res1 = await request(app)
        .post('/notifications/abc/read')
        .set('Authorization', `Bearer ${token}`)
      expect(res1.status).toBe(422)

      const res2 = await request(app)
        .post('/notifications/-1/read')
        .set('Authorization', `Bearer ${token}`)
      expect(res2.status).toBe(422)

      const res3 = await request(app)
        .post('/notifications/0/read')
        .set('Authorization', `Bearer ${token}`)
      expect(res3.status).toBe(422)
    })

    it('returns 404 for missing notification or another user notification', async () => {
      const user1 = await seedUser()
      const user2 = await seedUser()
      const team = await seedTeam()
      await seedMembership(user1.id, team.id, 'lead')
      await seedMembership(user2.id, team.id, 'member')

      const token1 = await signAccessToken(user1.id)
      const token2 = await signAccessToken(user2.id)

      await createItem({ id: user1.id, isAdmin: false }, {
        teamId: team.id,
        title: 'Task for user2',
        type: 'task',
        priority: 'high',
        assigneeId: user2.id,
      })

      const listRes = await request(app)
        .get('/notifications')
        .set('Authorization', `Bearer ${token2}`)
      const notifId = listRes.body.notifications[0].id

      // User 1 tries to mark User 2's notification as read
      const resOther = await request(app)
        .post(`/notifications/${notifId}/read`)
        .set('Authorization', `Bearer ${token1}`)
      expect(resOther.status).toBe(404)

      // Non-existent id
      const resMissing = await request(app)
        .post('/notifications/999999/read')
        .set('Authorization', `Bearer ${token2}`)
      expect(resMissing.status).toBe(404)
    })

    it('returns 404 when team membership is revoked', async () => {
      const lead = await seedUser()
      const member = await seedUser()
      const team = await seedTeam()
      await seedMembership(lead.id, team.id, 'lead')
      await seedMembership(member.id, team.id, 'member')

      const memberToken = await signAccessToken(member.id)

      await createItem({ id: lead.id, isAdmin: false }, {
        teamId: team.id,
        title: 'Task for member',
        type: 'task',
        priority: 'high',
        assigneeId: member.id,
      })

      const listRes = await request(app)
        .get('/notifications')
        .set('Authorization', `Bearer ${memberToken}`)
      const notifId = listRes.body.notifications[0].id

      // Revoke membership
      await db
        .delete(memberships)
        .where(and(eq(memberships.userId, member.id), eq(memberships.teamId, team.id)))

      const res = await request(app)
        .post(`/notifications/${notifId}/read`)
        .set('Authorization', `Bearer ${memberToken}`)
      expect(res.status).toBe(404)
    })
  })

  describe('POST /notifications/read-all', () => {
    it('marks all visible unread notifications read (204)', async () => {
      const lead = await seedUser()
      const member = await seedUser()
      const team = await seedTeam()
      await seedMembership(lead.id, team.id, 'lead')
      await seedMembership(member.id, team.id, 'member')

      const memberToken = await signAccessToken(member.id)
      const leadActor: Actor = { id: lead.id, isAdmin: false }

      await createItem(leadActor, {
        teamId: team.id,
        title: 'Task 1',
        type: 'task',
        priority: 'medium',
        assigneeId: member.id,
      })
      await createItem(leadActor, {
        teamId: team.id,
        title: 'Task 2',
        type: 'task',
        priority: 'high',
        assigneeId: member.id,
      })

      const summaryBefore = await request(app)
        .get('/notifications/summary')
        .set('Authorization', `Bearer ${memberToken}`)
      expect(summaryBefore.body.unreadCount).toBe(2)

      const readAllRes = await request(app)
        .post('/notifications/read-all')
        .set('Authorization', `Bearer ${memberToken}`)
      expect(readAllRes.status).toBe(204)

      const summaryAfter = await request(app)
        .get('/notifications/summary')
        .set('Authorization', `Bearer ${memberToken}`)
      expect(summaryAfter.body.unreadCount).toBe(0)
    })
  })
})
