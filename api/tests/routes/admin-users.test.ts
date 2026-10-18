import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { eq } from 'drizzle-orm'
import { createApp } from '../../src/app'
import { closeDb, db } from '../../src/db/client'
import { membershipEvents, memberships, users } from '../../src/db/schema'
import { config } from '../../src/config'
import { signAccessToken } from '../../src/services/tokens'
import { createUser, type PublicUser } from '../../src/services/users'
import { resetDb, seedTeam, seedUser } from '../helpers/db'
import { expectPublicUser } from '../helpers/publicUser'
import type { Actor } from '../../src/domain/types'
import { ApiError } from '../../src/http/errors'

async function adminAuth(): Promise<string> {
  const admin = await seedUser({ isAdmin: true })
  const token = await signAccessToken(admin.id)
  return `Bearer ${token}`
}

async function memberAuth(): Promise<string> {
  const member = await seedUser({ isAdmin: false })
  const token = await signAccessToken(member.id)
  return `Bearer ${token}`
}

describe('Admin user management routes (GET /admin/users, POST /admin/users)', () => {
  const app = createApp()

  beforeEach(async () => {
    config.adminUserCreationEnabled = true
    await resetDb()
  })

  afterAll(async () => {
    config.adminUserCreationEnabled = true
    await closeDb()
  })

  describe('1. Admin-only authorization', () => {
    it('rejects unauthenticated callers with 401 UNAUTHENTICATED', async () => {
      const getRes = await request(app).get('/admin/users')
      expect(getRes.status).toBe(401)
      expect(getRes.body.error.code).toBe('UNAUTHENTICATED')

      const postRes = await request(app).post('/admin/users').send({
        email: 'nobody@example.com',
        displayName: 'Nobody',
        password: 'password123',
      })
      expect(postRes.status).toBe(401)
      expect(postRes.body.error.code).toBe('UNAUTHENTICATED')
    })

    it('rejects non-admin callers with 403 FORBIDDEN', async () => {
      const token = await memberAuth()

      const getRes = await request(app).get('/admin/users').set('Authorization', token)
      expect(getRes.status).toBe(403)
      expect(getRes.body.error.code).toBe('FORBIDDEN')

      const postRes = await request(app)
        .post('/admin/users')
        .set('Authorization', token)
        .send({
          email: 'forbidden@example.com',
          displayName: 'Forbidden User',
          password: 'password123',
        })
      expect(postRes.status).toBe(403)
      expect(postRes.body.error.code).toBe('FORBIDDEN')
    })
  })

  describe('2. Config-off handling (ADMIN_USER_CREATION_ENABLED=false)', () => {
    it('returns userCreationEnabled: false on GET and 403 USER_CREATION_DISABLED on POST', async () => {
      const token = await adminAuth()
      config.adminUserCreationEnabled = false

      const getRes = await request(app).get('/admin/users').set('Authorization', token)
      expect(getRes.status).toBe(200)
      expect(getRes.body.userCreationEnabled).toBe(false)

      const postRes = await request(app)
        .post('/admin/users')
        .set('Authorization', token)
        .send({
          email: 'disabled@example.com',
          displayName: 'Disabled Creation User',
          password: 'password123',
        })
      expect(postRes.status).toBe(403)
      expect(postRes.body.error.code).toBe('USER_CREATION_DISABLED')
    })
  })

  describe('3. Duplicate email detection and normalization', () => {
    it('rejects exact duplicate email with 409 EMAIL_TAKEN', async () => {
      const token = await adminAuth()

      const first = await request(app)
        .post('/admin/users')
        .set('Authorization', token)
        .send({
          email: 'dup@example.com',
          displayName: 'First User',
          password: 'password123',
        })
      expect(first.status).toBe(201)

      const duplicate = await request(app)
        .post('/admin/users')
        .set('Authorization', token)
        .send({
          email: 'dup@example.com',
          displayName: 'Duplicate User',
          password: 'password123',
        })
      expect(duplicate.status).toBe(409)
      expect(duplicate.body.error.code).toBe('EMAIL_TAKEN')
    })

    it('normalizes email (case & trim) and rejects duplicates with 409 EMAIL_TAKEN', async () => {
      const token = await adminAuth()

      const first = await request(app)
        .post('/admin/users')
        .set('Authorization', token)
        .send({
          email: 'case@example.com',
          displayName: 'Case User',
          password: 'password123',
        })
      expect(first.status).toBe(201)

      // Uppercase + leading/trailing whitespace
      const duplicate = await request(app)
        .post('/admin/users')
        .set('Authorization', token)
        .send({
          email: '  CASE@EXAMPLE.COM  ',
          displayName: 'Second User',
          password: 'password123',
        })
      expect(duplicate.status).toBe(409)
      expect(duplicate.body.error.code).toBe('EMAIL_TAKEN')
    })

    it('translates database duplicate key race error into 409 EMAIL_TAKEN', async () => {
      const admin = await seedUser({ isAdmin: true })
      const actor: Actor = { id: admin.id, isAdmin: true }

      const results = await Promise.allSettled([
        createUser(actor, {
          email: 'race@example.com',
          displayName: 'Race User 1',
          password: 'password123',
        }),
        createUser(actor, {
          email: 'race@example.com',
          displayName: 'Race User 2',
          password: 'password123',
        }),
      ])

      const fulfilled = results.filter(
        (r): r is PromiseFulfilledResult<PublicUser> => r.status === 'fulfilled',
      )
      const rejected = results.filter(
        (r): r is PromiseRejectedResult => r.status === 'rejected',
      )

      expect(fulfilled).toHaveLength(1)
      expect(rejected).toHaveLength(1)
      const rejection = rejected[0]
      if (!rejection) throw new Error('Expected rejection')
      expect((rejection.reason as ApiError).code).toBe('EMAIL_TAKEN')
      expect((rejection.reason as ApiError).status).toBe(409)
    })
  })

  describe('4. Projection guarantees (PublicUser, no password hash)', () => {
    it('POST returns PublicUser with no password hash, status active, isAdmin false', async () => {
      const token = await adminAuth()

      const res = await request(app)
        .post('/admin/users')
        .set('Authorization', token)
        .send({
          email: 'project@example.com',
          displayName: '  Projected User  ',
          password: 'password123',
        })

      expect(res.status).toBe(201)
      const user = res.body.user
      expectPublicUser(user)
      expect(user.displayName).toBe('Projected User') // trimmed
      expect(user.email).toBe('project@example.com')
      expect(user.isAdmin).toBe(false)
      expect(user.status).toBe('active')
      expect('passwordHash' in user).toBe(false)
      expect('password_hash' in user).toBe(false)
    })

    it('GET /admin/users returns PublicUser array with no password hashes and userCreationEnabled: true', async () => {
      const token = await adminAuth()
      const u1 = await seedUser({ displayName: 'User One' })

      const res = await request(app).get('/admin/users').set('Authorization', token)
      expect(res.status).toBe(200)
      expect(res.body.userCreationEnabled).toBe(true)
      expect(Array.isArray(res.body.users)).toBe(true)
      const returnedIds = res.body.users.map((u: { id: number }) => u.id)
      expect(returnedIds).toContain(u1.id)

      for (const u of res.body.users) {
        expectPublicUser(u)
        expect('passwordHash' in u).toBe(false)
        expect('password_hash' in u).toBe(false)
      }
    })
  })

  describe('5. Keyset cursor pagination and literal search', () => {
    it('paginates descending by id using scoped keyset cursor', async () => {
      const token = await adminAuth()
      const u1 = await seedUser({ email: 'page1@example.com', displayName: 'P1' })
      const u2 = await seedUser({ email: 'page2@example.com', displayName: 'P2' })
      const u3 = await seedUser({ email: 'page3@example.com', displayName: 'P3' })

      const page1 = await request(app)
        .get('/admin/users?q=page&limit=2')
        .set('Authorization', token)

      expect(page1.status).toBe(200)
      expect(page1.body.users.map((u: { id: number }) => u.id)).toEqual([u3.id, u2.id])
      expect(page1.body.nextCursor).toBeTypeOf('string')

      const page2 = await request(app)
        .get(`/admin/users?q=page&limit=2&cursor=${encodeURIComponent(page1.body.nextCursor as string)}`)
        .set('Authorization', token)

      expect(page2.status).toBe(200)
      expect(page2.body.users.map((u: { id: number }) => u.id)).toEqual([u1.id])
      expect(page2.body.nextCursor).toBeNull()
    })

    it('rejects cursor replayed against a different search query with 422 VALIDATION_ERROR', async () => {
      const token = await adminAuth()
      const a1 = await seedUser({ email: 'alice1@example.com', displayName: 'Alice 1' })
      const a2 = await seedUser({ email: 'alice2@example.com', displayName: 'Alice 2' })
      await seedUser({ email: 'bob@example.com', displayName: 'Bob' })

      const page1 = await request(app)
        .get('/admin/users?q=ali&limit=1')
        .set('Authorization', token)

      expect(page1.status).toBe(200)
      expect(page1.body.users.map((u: { id: number }) => u.id)).toEqual([a2.id])
      const cursor = page1.body.nextCursor
      expect(cursor).toBeTypeOf('string')

      const replayed = await request(app)
        .get(`/admin/users?q=bob&limit=1&cursor=${encodeURIComponent(cursor as string)}`)
        .set('Authorization', token)

      expect(replayed.status).toBe(422)
      expect(replayed.body.error.code).toBe('VALIDATION_ERROR')
    })

    it('performs literal search over email and displayName escaping SQL % and _ wildcards', async () => {
      const token = await adminAuth()
      const pctUser = await seedUser({ email: 'pct@example.com', displayName: '100% User' })
      const underUser = await seedUser({ email: 'under@example.com', displayName: 'a_b User' })
      const normalUser = await seedUser({ email: 'norm@example.com', displayName: 'axb User' })

      // Literal % search
      const pctRes = await request(app)
        .get('/admin/users?q=%')
        .set('Authorization', token)
      expect(pctRes.status).toBe(200)
      expect(pctRes.body.users.map((u: { id: number }) => u.id)).toEqual([pctUser.id])

      // Literal _ search (should match a_b, not axb or pct)
      const underRes = await request(app)
        .get('/admin/users?q=a_b')
        .set('Authorization', token)
      expect(underRes.status).toBe(200)
      expect(underRes.body.users.map((u: { id: number }) => u.id)).toEqual([underUser.id])
    })
  })

  describe('6. Optional paired teamId/role and membership atomicity', () => {
    it('creates user with paired teamId and role, inserting membership and joined audit event', async () => {
      const token = await adminAuth()
      const team = await seedTeam({ name: 'Alpha Team', slug: 'alpha-team' })

      const res = await request(app)
        .post('/admin/users')
        .set('Authorization', token)
        .send({
          email: 'teammember@example.com',
          displayName: 'Team Member',
          password: 'password123',
          teamId: team.id,
          role: 'member',
        })

      expect(res.status).toBe(201)
      const newUserId = res.body.user.id

      // Verify membership created
      const [membership] = await db
        .select()
        .from(memberships)
        .where(eq(memberships.userId, newUserId))
        .limit(1)

      expect(membership).toBeDefined()
      expect(membership?.teamId).toBe(team.id)
      expect(membership?.role).toBe('member')

      // Verify membership event joined created
      const [event] = await db
        .select()
        .from(membershipEvents)
        .where(eq(membershipEvents.subjectUserId, newUserId))
        .limit(1)

      expect(event).toBeDefined()
      expect(event?.teamId).toBe(team.id)
      expect(event?.action).toBe('joined')
      expect(event?.toRole).toBe('member')
      expect(event?.fromRole).toBeNull()
    })

    it('rejects teamId without role with 422 VALIDATION_ERROR', async () => {
      const token = await adminAuth()
      const team = await seedTeam()

      const res = await request(app)
        .post('/admin/users')
        .set('Authorization', token)
        .send({
          email: 'unpaired1@example.com',
          displayName: 'Unpaired 1',
          password: 'password123',
          teamId: team.id,
        })

      expect(res.status).toBe(422)
      expect(res.body.error.code).toBe('VALIDATION_ERROR')
    })

    it('rejects role without teamId with 422 VALIDATION_ERROR', async () => {
      const token = await adminAuth()

      const res = await request(app)
        .post('/admin/users')
        .set('Authorization', token)
        .send({
          email: 'unpaired2@example.com',
          displayName: 'Unpaired 2',
          password: 'password123',
          role: 'lead',
        })

      expect(res.status).toBe(422)
      expect(res.body.error.code).toBe('VALIDATION_ERROR')
    })

    it('rolls back atomically (no user created) when teamId does not exist', async () => {
      const token = await adminAuth()
      const nonExistentTeamId = 999999

      const res = await request(app)
        .post('/admin/users')
        .set('Authorization', token)
        .send({
          email: 'ghostteam@example.com',
          displayName: 'Ghost Team User',
          password: 'password123',
          teamId: nonExistentTeamId,
          role: 'viewer',
        })

      expect(res.status).toBe(404)
      expect(res.body.error.code).toBe('NOT_FOUND')

      // Verify no user was created
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.email, 'ghostteam@example.com'))
        .limit(1)

      expect(user).toBeUndefined()
    })
  })

  describe('7. Input validation edge cases', () => {
    it('rejects password shorter than 8 characters', async () => {
      const token = await adminAuth()
      const res = await request(app)
        .post('/admin/users')
        .set('Authorization', token)
        .send({
          email: 'shortpw@example.com',
          displayName: 'Short PW',
          password: 'short',
        })
      expect(res.status).toBe(422)
      expect(res.body.error.code).toBe('VALIDATION_ERROR')
    })

    it('rejects password longer than 72 UTF-8 bytes', async () => {
      const token = await adminAuth()
      // 73 ASCII bytes
      const longPw = 'a'.repeat(73)
      const res = await request(app)
        .post('/admin/users')
        .set('Authorization', token)
        .send({
          email: 'longpw@example.com',
          displayName: 'Long PW',
          password: longPw,
        })
      expect(res.status).toBe(422)
      expect(res.body.error.code).toBe('VALIDATION_ERROR')
    })

    it('rejects empty or whitespace-only displayName', async () => {
      const token = await adminAuth()
      const res = await request(app)
        .post('/admin/users')
        .set('Authorization', token)
        .send({
          email: 'noname@example.com',
          displayName: '   ',
          password: 'password123',
        })
      expect(res.status).toBe(422)
      expect(res.body.error.code).toBe('VALIDATION_ERROR')
    })

    it('rejects displayName longer than 120 characters', async () => {
      const token = await adminAuth()
      const res = await request(app)
        .post('/admin/users')
        .set('Authorization', token)
        .send({
          email: 'toolong@example.com',
          displayName: 'x'.repeat(121),
          password: 'password123',
        })
      expect(res.status).toBe(422)
      expect(res.body.error.code).toBe('VALIDATION_ERROR')
    })
  })
})
