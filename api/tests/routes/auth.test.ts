import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../../src/app'
import { closeDb, db } from '../../src/db/client'
import { outboxJobs } from '../../src/db/schema'
import { hashPassword } from '../../src/services/crypto'
import { signAccessToken } from '../../src/services/tokens'
import { resetDb, seedMembership, seedTeam, seedUser } from '../helpers/db'

describe('auth routes', () => {
  beforeEach(resetDb)
  afterAll(closeDb)

  const password = 'CorrectPassword123!'

  describe('POST /auth/login', () => {
    it('returns 200, accessToken, user, and Set-Cookie with Path=/auth; HttpOnly', async () => {
      const passwordHash = await hashPassword(password)
      const user = await seedUser({ email: 'login-test@example.com', passwordHash })

      const res = await request(createApp())
        .post('/auth/login')
        .send({ email: 'login-test@example.com', password })

      expect(res.status).toBe(200)
      expect(res.body.user.id).toBe(user.id)
      expect(res.body.user.email).toBe('login-test@example.com')
      expect(typeof res.body.accessToken).toBe('string')
      expect(res.body.accessToken.length).toBeGreaterThan(0)

      const cookies = res.headers['set-cookie']
      expect(cookies).toBeDefined()
      const cookieArray = Array.isArray(cookies) ? cookies : [cookies]
      const refreshCookie = cookieArray.find((c: string) => c.startsWith('refresh_token='))
      expect(refreshCookie).toBeDefined()
      expect(refreshCookie).toContain('Path=/auth')
      expect(refreshCookie?.toLowerCase()).toContain('httponly')
    })
  })

  describe('POST /auth/refresh', () => {
    it('with cookie returns 200, accessToken, user, and new cookie', async () => {
      const passwordHash = await hashPassword(password)
      await seedUser({ email: 'refresh-test@example.com', passwordHash })

      const app = createApp()

      const loginRes = await request(app)
        .post('/auth/login')
        .send({ email: 'refresh-test@example.com', password })

      expect(loginRes.status).toBe(200)
      const loginCookies = loginRes.headers['set-cookie']
      expect(loginCookies).toBeDefined()
      const cookieHeader = Array.isArray(loginCookies) ? loginCookies : [String(loginCookies)]

      const refreshRes = await request(app)
        .post('/auth/refresh')
        .set('Cookie', cookieHeader)

      expect(refreshRes.status).toBe(200)
      expect(typeof refreshRes.body.accessToken).toBe('string')
      expect(refreshRes.body.user.email).toBe('refresh-test@example.com')

      const nextCookies = refreshRes.headers['set-cookie']
      expect(nextCookies).toBeDefined()
      const cookieArray = Array.isArray(nextCookies) ? nextCookies : [nextCookies]
      const nextRefreshCookie = cookieArray.find((c: string) => c.startsWith('refresh_token='))
      expect(nextRefreshCookie).toBeDefined()
      expect(nextRefreshCookie).toContain('Path=/auth')
    })
  })

  describe('POST /auth/logout', () => {
    it('clears cookie and returns 204 (idempotent on repeat)', async () => {
      const passwordHash = await hashPassword(password)
      await seedUser({ email: 'logout-test@example.com', passwordHash })

      const app = createApp()

      const loginRes = await request(app)
        .post('/auth/login')
        .send({ email: 'logout-test@example.com', password })

      const loginCookies = loginRes.headers['set-cookie']
      const cookieHeader = Array.isArray(loginCookies) ? loginCookies : [String(loginCookies)]

      const logoutRes1 = await request(app)
        .post('/auth/logout')
        .set('Cookie', cookieHeader)

      expect(logoutRes1.status).toBe(204)
      const cookies1 = logoutRes1.headers['set-cookie']
      expect(cookies1).toBeDefined()
      const cookieArray = Array.isArray(cookies1) ? cookies1 : [cookies1]
      const clearedCookie = cookieArray.find((c: string) => c.startsWith('refresh_token='))
      expect(clearedCookie).toBeDefined()
      // Clearing cookie sets max-age=0 or expires in past
      expect(clearedCookie).toMatch(/Expires=|Max-Age=0/i)

      const logoutRes2 = await request(app)
        .post('/auth/logout')
        .set('Cookie', cookieHeader)

      expect(logoutRes2.status).toBe(204)
    })
  })

  describe('POST /auth/password/forgot', () => {
    it('returns 202 for known and unknown email', async () => {
      const passwordHash = await hashPassword(password)
      await seedUser({ email: 'known@example.com', passwordHash })

      const app = createApp()

      const resKnown = await request(app)
        .post('/auth/password/forgot')
        .send({ email: 'known@example.com' })

      expect(resKnown.status).toBe(202)
      expect(resKnown.body).toEqual({ status: 'accepted' })

      const resUnknown = await request(app)
        .post('/auth/password/forgot')
        .send({ email: 'unknown@example.com' })

      expect(resUnknown.status).toBe(202)
      expect(resUnknown.body).toEqual({ status: 'accepted' })
    })
  })

  describe('POST /auth/password/reset', () => {
    it('resets password successfully and returns 200', async () => {
      const passwordHash = await hashPassword(password)
      const user = await seedUser({ email: 'reset-route@example.com', passwordHash })

      const app = createApp()

      await request(app)
        .post('/auth/password/forgot')
        .send({ email: 'reset-route@example.com' })

      const jobs = await db.select().from(outboxJobs)
      const resetJob = jobs.find((j) => j.type === 'email.reset')
      expect(resetJob).toBeDefined()
      const rawPayload = resetJob!.payload
      const payload = typeof rawPayload === 'string'
        ? (JSON.parse(rawPayload) as { to: string; code: string })
        : (rawPayload as { to: string; code: string })
      const token = payload.code

      const newPassword = 'NewSecretPassword456!'
      const resetRes = await request(app)
        .post('/auth/password/reset')
        .send({ token, password: newPassword })

      expect(resetRes.status).toBe(200)
      expect(resetRes.body).toEqual({ status: 'ok' })

      // Verify login with new password works
      const loginRes = await request(app)
        .post('/auth/login')
        .send({ email: 'reset-route@example.com', password: newPassword })

      expect(loginRes.status).toBe(200)
      expect(loginRes.body.user.id).toBe(user.id)
    })
  })

  describe('GET /auth/me', () => {
    it('without auth header returns 401 UNAUTHENTICATED', async () => {
      const res = await request(createApp()).get('/auth/me')

      expect(res.status).toBe(401)
      expect(res.body.error).toEqual(
        expect.objectContaining({
          code: 'UNAUTHENTICATED',
        }),
      )
    })

    it('with valid Bearer token returns 200 with user and memberships', async () => {
      const user = await seedUser({ email: 'me-route@example.com' })
      const team = await seedTeam({ name: 'Acme Corp', slug: 'acme' })
      await seedMembership(user.id, team.id, 'lead')

      const token = await signAccessToken(user.id)

      const res = await request(createApp())
        .get('/auth/me')
        .set('Authorization', `Bearer ${token}`)

      expect(res.status).toBe(200)
      expect(res.body.user.id).toBe(user.id)
      expect(res.body.user.email).toBe('me-route@example.com')
      expect(res.body.memberships).toEqual([
        { teamId: team.id, role: 'lead' },
      ])
    })
  })

  describe('rate limiter', () => {
    it('triggers 429 after exceeding max requests', async () => {
      const app = createApp()
      const remoteIp = '198.51.100.42'

      for (let i = 0; i < 10; i++) {
        const res = await request(app)
          .post('/auth/password/forgot')
          .set('X-Forwarded-For', remoteIp)
          .send({ email: 'test@example.com' })
        expect(res.status).toBe(202)
      }

      const throttled = await request(app)
        .post('/auth/password/forgot')
        .set('X-Forwarded-For', remoteIp)
        .send({ email: 'test@example.com' })

      expect(throttled.status).toBe(429)
      expect(throttled.body.error).toEqual(
        expect.objectContaining({
          code: 'RATE_LIMITED',
        }),
      )
    })
  })
})
