import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import request from 'supertest'
import express, { type Request, type Response } from 'express'
import { resetDb, seedUser } from '../helpers/db'
import { closeDb } from '../../src/db/client'
import { signAccessToken } from '../../src/services/tokens'
import { errorHandler } from '../../src/http/middleware/errorHandler'
import { requireAuth, currentActor } from '../../src/http/middleware/auth'
import { rateLimit } from '../../src/http/middleware/rateLimit'
import {
  setRefreshCookie,
  clearRefreshCookie,
  readRefreshCookie,
  REFRESH_COOKIE_NAME,
} from '../../src/http/cookies'

describe('auth & http middleware', () => {
  beforeEach(async () => {
    await resetDb()
  })

  afterAll(async () => {
    await closeDb()
  })

  describe('requireAuth and currentActor', () => {
    function buildAuthApp() {
      const app = express()
      app.get('/protected', requireAuth(), (req: Request, res: Response) => {
        const actor = currentActor(req)
        res.status(200).json({ actor })
      })
      app.use(errorHandler())
      return app
    }

    it('rejects missing or invalid Authorization header with 401 UNAUTHENTICATED', async () => {
      const app = buildAuthApp()

      const resMissing = await request(app).get('/protected')
      expect(resMissing.status).toBe(401)
      expect(resMissing.body.error.code).toBe('UNAUTHENTICATED')

      const resMalformed = await request(app)
        .get('/protected')
        .set('Authorization', 'Basic 12345')
      expect(resMalformed.status).toBe(401)
      expect(resMalformed.body.error.code).toBe('UNAUTHENTICATED')

      const resEmptyBearer = await request(app)
        .get('/protected')
        .set('Authorization', 'Bearer ')
      expect(resEmptyBearer.status).toBe(401)
      expect(resEmptyBearer.body.error.code).toBe('UNAUTHENTICATED')

      const resInvalidToken = await request(app)
        .get('/protected')
        .set('Authorization', 'Bearer invalid.jwt.token')
      expect(resInvalidToken.status).toBe(401)
      expect(resInvalidToken.body.error.code).toBe('UNAUTHENTICATED')
    })

    it('accepts valid access token and attaches actor to request', async () => {
      const app = buildAuthApp()
      const user = await seedUser({ isAdmin: true, status: 'active' })
      const token = await signAccessToken(user.id)

      const res = await request(app)
        .get('/protected')
        .set('Authorization', `Bearer ${token}`)

      expect(res.status).toBe(200)
      expect(res.body.actor).toEqual({
        id: user.id,
        isAdmin: true,
      })
    })

    it('rejects token for disabled user with 401 UNAUTHENTICATED', async () => {
      const app = buildAuthApp()
      const user = await seedUser({ status: 'disabled' })
      const token = await signAccessToken(user.id)

      const res = await request(app)
        .get('/protected')
        .set('Authorization', `Bearer ${token}`)

      expect(res.status).toBe(401)
      expect(res.body.error.code).toBe('UNAUTHENTICATED')
    })

    it('rejects token for non-existent user with 401 UNAUTHENTICATED', async () => {
      const app = buildAuthApp()
      const token = await signAccessToken(999999)

      const res = await request(app)
        .get('/protected')
        .set('Authorization', `Bearer ${token}`)

      expect(res.status).toBe(401)
      expect(res.body.error.code).toBe('UNAUTHENTICATED')
    })

    it('throws UNAUTHENTICATED when currentActor is called without actor', () => {
      const dummyReq = {} as Request
      expect(() => currentActor(dummyReq)).toThrow()
    })
  })

  describe('setRefreshCookie and clearRefreshCookie', () => {
    it('sets and clears refresh cookie with proper attributes', async () => {
      const app = express()
      app.post('/set-cookie', (_req: Request, res: Response) => {
        setRefreshCookie(res, 'sample-refresh-token')
        res.status(204).end()
      })
      app.post('/clear-cookie', (_req: Request, res: Response) => {
        clearRefreshCookie(res)
        res.status(204).end()
      })

      const setRes = await request(app).post('/set-cookie')
      expect(setRes.status).toBe(204)
      const setCookies = setRes.headers['set-cookie']
      expect(setCookies).toBeDefined()
      const cookieHeader = Array.isArray(setCookies) ? setCookies[0] : setCookies
      expect(cookieHeader).toContain(`${REFRESH_COOKIE_NAME}=sample-refresh-token`)
      expect(cookieHeader).toMatch(/HttpOnly/i)
      expect(cookieHeader).toMatch(/SameSite=Lax/i)
      expect(cookieHeader).toMatch(/Path=\/auth/i)
      expect(cookieHeader).toMatch(/Max-Age=/i)

      const clearRes = await request(app).post('/clear-cookie')
      expect(clearRes.status).toBe(204)
      const clearCookies = clearRes.headers['set-cookie']
      expect(clearCookies).toBeDefined()
      const clearHeader = Array.isArray(clearCookies) ? clearCookies[0] : clearCookies
      expect(clearHeader).toContain(`${REFRESH_COOKIE_NAME}=;`)
      expect(clearHeader).toMatch(/HttpOnly/i)
      expect(clearHeader).toMatch(/SameSite=Lax/i)
      expect(clearHeader).toMatch(/Path=\/auth/i)
    })

    it('reads refresh cookie from cookie header or parsed cookies', () => {
      const reqFromHeader = {
        headers: {
          cookie: `other=123; ${REFRESH_COOKIE_NAME}=secret-token; test=abc`,
        },
      } as unknown as Request

      expect(readRefreshCookie(reqFromHeader)).toBe('secret-token')

      const reqFromParsed = {
        headers: {},
        cookies: {
          [REFRESH_COOKIE_NAME]: 'parsed-token',
        },
      } as unknown as Request

      expect(readRefreshCookie(reqFromParsed)).toBe('parsed-token')

      const reqEmpty = { headers: {} } as unknown as Request
      expect(readRefreshCookie(reqEmpty)).toBeUndefined()
    })
  })

  describe('rateLimit', () => {
    it('allows up to max requests and returns 429 RATE_LIMITED on the (max+1)th request', async () => {
      const app = express()
      const limiter = rateLimit({ key: 'test-limit', windowMs: 60000, max: 3 })
      app.get('/limited', limiter, (_req: Request, res: Response) => {
        res.status(200).json({ ok: true })
      })
      app.use(errorHandler())

      const res1 = await request(app).get('/limited')
      expect(res1.status).toBe(200)

      const res2 = await request(app).get('/limited')
      expect(res2.status).toBe(200)

      const res3 = await request(app).get('/limited')
      expect(res3.status).toBe(200)

      const res4 = await request(app).get('/limited')
      expect(res4.status).toBe(429)
      expect(res4.body.error.code).toBe('RATE_LIMITED')
    })
  })
})
