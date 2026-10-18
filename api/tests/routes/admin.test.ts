// Task 5.2 — the `/admin` HTTP surface over the Task 5.1 service (§9, §12.2).
//
// These tests pin the *wire* contract the ops screen consumes: camelCase field
// names, a job row that never carries its `payload`, keyset pagination, and the
// 401/403/404/422 classification of every failure. Authorization itself lives
// in the service (`api/src/services/jobs.ts`), so a 403 here proves the route
// hand-off rather than a second permission check.
//
// Row state the assertions depend on is read back through the database (raw
// columns, `available_at <= NOW(3)` evaluated by SQL) rather than through the
// API's own mapping: the queue's truth is the row, and comparing an app-side
// `Date` with a DB-side `NOW(3)` would compare two different clocks.

import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { eq, sql } from 'drizzle-orm'
import type { Express } from 'express'
import { createApp } from '../../src/app'
import { closeDb, db } from '../../src/db/client'
import { outboxJobs, users } from '../../src/db/schema'
import type { OutboxJobType } from '../../src/domain/types'
import { signAccessToken } from '../../src/services/tokens'
import { resetDb, seedUser } from '../helpers/db'

type JobStatus = 'pending' | 'processing' | 'done' | 'failed'

/** Bearer header for a freshly seeded admin (`isAdmin` is read live per request). */
async function adminAuth(): Promise<string> {
  const admin = await seedUser({ isAdmin: true })
  return `Bearer ${await signAccessToken(admin.id)}`
}

/** Bearer header for a freshly seeded non-admin. */
async function memberAuth(): Promise<string> {
  const member = await seedUser()
  return `Bearer ${await signAccessToken(member.id)}`
}

/** Inserts a queue row directly, so each test controls status/attempts/lease state. */
async function seedJob(o: {
  dedupeKey: string
  status?: JobStatus
  type?: OutboxJobType
  attempts?: number
  maxAttempts?: number
  lastError?: string | null
  /** Seconds before SQL `NOW(3)` — a negative value schedules the job in the future. */
  dueSecAgo?: number
}): Promise<number> {
  const [inserted] = await db
    .insert(outboxJobs)
    .values({
      type: o.type ?? 'email.invite',
      payload: { to: 'someone@example.test' },
      status: o.status ?? 'pending',
      attempts: o.attempts ?? 0,
      maxAttempts: o.maxAttempts ?? 5,
      availableAt: sql`DATE_SUB(NOW(3), INTERVAL ${o.dueSecAgo ?? 0} SECOND)`,
      lastError: o.lastError ?? null,
      dedupeKey: o.dedupeKey,
    })
    .$returningId()
  const id = inserted?.id
  if (id === undefined) throw new Error('seedJob: insert returned no id')
  return id
}

/** Reads the queue row as the database sees it. */
async function readJob(id: number): Promise<{
  status: string
  attempts: number
  lastError: string | null
  dueNow: boolean
}> {
  const [row] = await db
    .select({
      status: outboxJobs.status,
      attempts: outboxJobs.attempts,
      lastError: outboxJobs.lastError,
      dueNow: sql<number | string>`(${outboxJobs.availableAt} <= NOW(3))`,
    })
    .from(outboxJobs)
    .where(eq(outboxJobs.id, id))
    .limit(1)

  if (row === undefined) throw new Error(`readJob: no outbox_jobs row ${id}`)
  return {
    status: row.status,
    attempts: row.attempts,
    lastError: row.lastError,
    dueNow: Number(row.dueNow) === 1,
  }
}

/** Reads a user's stored account status. */
async function readUserStatus(id: number): Promise<string> {
  const [row] = await db.select({ status: users.status }).from(users).where(eq(users.id, id)).limit(1)
  if (row === undefined) throw new Error(`readUserStatus: no users row ${id}`)
  return row.status
}

/** One entry per route, so the auth tests cover the whole surface, not a sample. */
interface RouteSpec {
  name: string
  method: 'get' | 'post' | 'patch'
  path: string
  body?: Record<string, unknown>
}

const ROUTES: readonly RouteSpec[] = [
  { name: 'GET /admin/jobs', method: 'get', path: '/admin/jobs' },
  { name: 'GET /admin/jobs/summary', method: 'get', path: '/admin/jobs/summary' },
  { name: 'POST /admin/jobs/:id/retry', method: 'post', path: '/admin/jobs/1/retry' },
  {
    name: 'PATCH /admin/users/:id',
    method: 'patch',
    path: '/admin/users/1',
    body: { status: 'disabled' },
  },
  { name: 'GET /admin/users', method: 'get', path: '/admin/users' },
  {
    name: 'POST /admin/users',
    method: 'post',
    path: '/admin/users',
    body: { email: 'admin-route-test@example.com', displayName: 'Route Test', password: 'password123' },
  },
]

describe('Admin routes (Task 5.2)', () => {
  const app: Express = createApp()

  beforeEach(resetDb)
  afterAll(closeDb)

  /** Issues one of the `ROUTES` requests, optionally authenticated. */
  function call(route: RouteSpec, token?: string) {
    const agent = request(app)
    let req =
      route.method === 'get'
        ? agent.get(route.path)
        : route.method === 'post'
          ? agent.post(route.path)
          : agent.patch(route.path)

    if (token !== undefined) req = req.set('Authorization', token)
    if (route.body !== undefined) req = req.send(route.body)
    return req
  }

  it('rejects an unauthenticated caller on every route (401 UNAUTHENTICATED)', async () => {
    for (const route of ROUTES) {
      const res = await call(route)
      expect(res.status, route.name).toBe(401)
      expect(res.body.error.code, route.name).toBe('UNAUTHENTICATED')
    }
  })

  it('rejects a non-admin on every route (403 FORBIDDEN)', async () => {
    const token = await memberAuth()
    for (const route of ROUTES) {
      const res = await call(route, token)
      expect(res.status, route.name).toBe(403)
      expect(res.body.error.code, route.name).toBe('FORBIDDEN')
    }
  })

  describe('GET /admin/jobs', () => {
    it('lists a failed job without ever exposing its payload', async () => {
      const token = await adminAuth()
      const failedId = await seedJob({
        dedupeKey: 'invite:1',
        status: 'failed',
        attempts: 3,
        maxAttempts: 5,
        lastError: 'smtp: connection refused',
      })
      const pendingId = await seedJob({ dedupeKey: 'invite:2' })

      const res = await request(app)
        .get('/admin/jobs?status=failed')
        .set('Authorization', token)

      expect(res.status).toBe(200)
      expect(res.body.nextCursor).toBeNull()
      expect(res.body.jobs).toHaveLength(1)

      const job = res.body.jobs[0]
      expect(job.id).toBe(failedId)
      expect(job.status).toBe('failed')
      expect(job.type).toBe('email.invite')
      expect(job.attempts).toBe(3)
      expect(job.maxAttempts).toBe(5)
      expect(job.lastError).toBe('smtp: connection refused')
      expect(job.createdAt).toBeTypeOf('string')

      // The row *does* hold a payload (the queue needs one) — it is the view
      // that must not carry it.
      expect('payload' in job).toBe(false)
      const [stored] = await db
        .select({ payload: outboxJobs.payload })
        .from(outboxJobs)
        .where(eq(outboxJobs.id, failedId))
        .limit(1)
      expect(stored?.payload).toEqual({ to: 'someone@example.test' })

      // …and the status filter really filters.
      expect(res.body.jobs.map((j: { id: number }) => j.id)).not.toContain(pendingId)
    })

    it('filters by type', async () => {
      const token = await adminAuth()
      const inviteId = await seedJob({ dedupeKey: 'invite:1', type: 'email.invite' })
      const resetId = await seedJob({ dedupeKey: 'reset:1', type: 'email.reset' })

      const res = await request(app)
        .get('/admin/jobs?type=email.reset')
        .set('Authorization', token)

      expect(res.status).toBe(200)
      expect(res.body.jobs.map((j: { id: number }) => j.id)).toEqual([resetId])
      expect(res.body.jobs.map((j: { id: number }) => j.id)).not.toContain(inviteId)
    })

    it('paginates with limit/cursor: one row per page, no duplicates, no gaps', async () => {
      const token = await adminAuth()
      const first = await seedJob({ dedupeKey: 'invite:1' })
      const second = await seedJob({ dedupeKey: 'invite:2' })

      const page1 = await request(app)
        .get('/admin/jobs?limit=1')
        .set('Authorization', token)

      expect(page1.status).toBe(200)
      expect(page1.body.jobs).toHaveLength(1)
      expect(page1.body.nextCursor).toBeTypeOf('string')
      expect(page1.body.nextCursor).not.toBeNull()

      const page2 = await request(app)
        .get(`/admin/jobs?limit=1&cursor=${encodeURIComponent(page1.body.nextCursor as string)}`)
        .set('Authorization', token)

      expect(page2.status).toBe(200)
      expect(page2.body.jobs).toHaveLength(1)
      expect(page2.body.nextCursor).toBeNull()

      const seen = [page1.body.jobs[0].id, page2.body.jobs[0].id] as number[]
      expect([...seen].sort((a, b) => a - b)).toEqual([first, second].sort((a, b) => a - b))
    })

    it('rejects a cursor replayed against a different filter set (422)', async () => {
      const token = await adminAuth()
      await seedJob({ dedupeKey: 'invite:1' })
      await seedJob({ dedupeKey: 'invite:2' })

      const page1 = await request(app)
        .get('/admin/jobs?status=pending&limit=1')
        .set('Authorization', token)
      expect(page1.status).toBe(200)
      expect(page1.body.nextCursor).toBeTypeOf('string')

      const replay = await request(app)
        .get(`/admin/jobs?limit=1&cursor=${encodeURIComponent(page1.body.nextCursor as string)}`)
        .set('Authorization', token)

      expect(replay.status).toBe(422)
      expect(replay.body.error.code).toBe('VALIDATION_ERROR')
    })

    it('rejects an unknown status or type filter with 422 VALIDATION_ERROR', async () => {
      const token = await adminAuth()

      const byStatus = await request(app)
        .get('/admin/jobs?status=exploded')
        .set('Authorization', token)
      expect(byStatus.status).toBe(422)
      expect(byStatus.body.error.code).toBe('VALIDATION_ERROR')

      const byType = await request(app)
        .get('/admin/jobs?type=email.pigeon')
        .set('Authorization', token)
      expect(byType.status).toBe(422)
      expect(byType.body.error.code).toBe('VALIDATION_ERROR')
    })
  })

  describe('GET /admin/jobs/summary', () => {
    it('returns a zero-filled count for each of the four statuses', async () => {
      const token = await adminAuth()

      const res = await request(app)
        .get('/admin/jobs/summary')
        .set('Authorization', token)

      expect(res.status).toBe(200)
      expect(res.body.byStatus).toEqual({ pending: 0, processing: 0, done: 0, failed: 0 })
      expect(res.body.oldestPendingAgeSec).toBeNull()
    })

    it('counts each status and reports the age of the oldest pending job', async () => {
      const token = await adminAuth()
      await seedJob({ dedupeKey: 'pending:old', status: 'pending', dueSecAgo: 120 })
      await seedJob({ dedupeKey: 'pending:new', status: 'pending', dueSecAgo: 30 })
      await seedJob({ dedupeKey: 'processing:1', status: 'processing' })
      await seedJob({ dedupeKey: 'done:1', status: 'done' })
      await seedJob({ dedupeKey: 'failed:1', status: 'failed', lastError: 'boom' })

      const res = await request(app)
        .get('/admin/jobs/summary')
        .set('Authorization', token)

      expect(res.status).toBe(200)
      expect(res.body.byStatus).toEqual({ pending: 2, processing: 1, done: 1, failed: 1 })
      expect(res.body.oldestPendingAgeSec).toBeGreaterThanOrEqual(120)
    })

    it('reports 0 — never a negative age — for a pending job scheduled in the future', async () => {
      const token = await adminAuth()
      await seedJob({ dedupeKey: 'pending:future', status: 'pending', dueSecAgo: -3600 })

      const res = await request(app)
        .get('/admin/jobs/summary')
        .set('Authorization', token)

      expect(res.status).toBe(200)
      expect(res.body.byStatus.pending).toBe(1)
      expect(res.body.oldestPendingAgeSec).toBe(0)
    })
  })

  describe('POST /admin/jobs/:id/retry', () => {
    it('re-queues a failed job as pending, with attempts reset and due now', async () => {
      const token = await adminAuth()
      // Scheduled a full hour in the future: a retry must pull `available_at`
      // back to now, not leave the row waiting behind its old backoff.
      const id = await seedJob({
        dedupeKey: 'invite:1',
        status: 'failed',
        attempts: 4,
        maxAttempts: 5,
        lastError: 'smtp: connection refused',
        dueSecAgo: -3600,
      })

      const res = await request(app)
        .post(`/admin/jobs/${id}/retry`)
        .set('Authorization', token)

      expect(res.status).toBe(204)
      expect(res.text).toBe('')

      const row = await readJob(id)
      expect(row.status).toBe('pending')
      expect(row.attempts).toBe(0)
      expect(row.dueNow).toBe(true)
      // Ruling R5: the failure reason is evidence, not garbage.
      expect(row.lastError).toBe('smtp: connection refused')
    })

    it('retries a failed job exactly once per call (second call is no longer failed)', async () => {
      const token = await adminAuth()
      const id = await seedJob({ dedupeKey: 'invite:1', status: 'failed', attempts: 5, lastError: 'boom' })

      const first = await request(app)
        .post(`/admin/jobs/${id}/retry`)
        .set('Authorization', token)
      expect(first.status).toBe(204)

      const second = await request(app)
        .post(`/admin/jobs/${id}/retry`)
        .set('Authorization', token)
      expect(second.status).toBe(422)
      expect(second.body.error.code).toBe('VALIDATION_ERROR')
    })

    it('refuses a job that is not failed (422 VALIDATION_ERROR) and leaves it untouched', async () => {
      const token = await adminAuth()
      const id = await seedJob({ dedupeKey: 'invite:1', status: 'done', attempts: 1 })

      const res = await request(app)
        .post(`/admin/jobs/${id}/retry`)
        .set('Authorization', token)

      expect(res.status).toBe(422)
      expect(res.body.error.code).toBe('VALIDATION_ERROR')

      const row = await readJob(id)
      expect(row.status).toBe('done')
      expect(row.attempts).toBe(1)
    })

    it('returns 404 NOT_FOUND for an unknown id', async () => {
      const token = await adminAuth()

      const res = await request(app)
        .post('/admin/jobs/999999/retry')
        .set('Authorization', token)

      expect(res.status).toBe(404)
      expect(res.body.error.code).toBe('NOT_FOUND')
    })

    it('returns 422 — not 500 — for a non-numeric id', async () => {
      const token = await adminAuth()

      const res = await request(app)
        .post('/admin/jobs/not-a-number/retry')
        .set('Authorization', token)

      expect(res.status).toBe(422)
      expect(res.body.error.code).toBe('VALIDATION_ERROR')
    })
  })

  describe('PATCH /admin/users/:id', () => {
    it('disables a user and the stored status really changes', async () => {
      const token = await adminAuth()
      const target = await seedUser({ email: 'target@example.test' })
      expect(await readUserStatus(target.id)).toBe('active')

      const res = await request(app)
        .patch(`/admin/users/${target.id}`)
        .set('Authorization', token)
        .send({ status: 'disabled' })

      expect(res.status).toBe(204)
      expect(res.text).toBe('')
      expect(await readUserStatus(target.id)).toBe('disabled')
    })

    it('re-enables a disabled user', async () => {
      const token = await adminAuth()
      const target = await seedUser({ email: 'target@example.test', status: 'disabled' })

      const res = await request(app)
        .patch(`/admin/users/${target.id}`)
        .set('Authorization', token)
        .send({ status: 'active' })

      expect(res.status).toBe(204)
      expect(await readUserStatus(target.id)).toBe('active')
    })

    it('rejects an unknown status value with 422 VALIDATION_ERROR and leaves the row alone', async () => {
      const token = await adminAuth()
      const target = await seedUser({ email: 'target@example.test' })

      const res = await request(app)
        .patch(`/admin/users/${target.id}`)
        .set('Authorization', token)
        .send({ status: 'suspended' })

      expect(res.status).toBe(422)
      expect(res.body.error.code).toBe('VALIDATION_ERROR')
      expect(await readUserStatus(target.id)).toBe('active')
    })

    it('rejects a missing status with 422 VALIDATION_ERROR', async () => {
      const token = await adminAuth()
      const target = await seedUser({ email: 'target@example.test' })

      const res = await request(app)
        .patch(`/admin/users/${target.id}`)
        .set('Authorization', token)
        .send({})

      expect(res.status).toBe(422)
      expect(res.body.error.code).toBe('VALIDATION_ERROR')
    })

    it('returns 422 — not 500 — for a non-numeric id', async () => {
      const token = await adminAuth()

      const res = await request(app)
        .patch('/admin/users/not-a-number')
        .set('Authorization', token)
        .send({ status: 'disabled' })

      expect(res.status).toBe(422)
      expect(res.body.error.code).toBe('VALIDATION_ERROR')
    })

    it('returns 404 NOT_FOUND for an unknown user id', async () => {
      const token = await adminAuth()

      const res = await request(app)
        .patch('/admin/users/999999')
        .set('Authorization', token)
        .send({ status: 'disabled' })

      expect(res.status).toBe(404)
      expect(res.body.error.code).toBe('NOT_FOUND')
    })
  })
})
