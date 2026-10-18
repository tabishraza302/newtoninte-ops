// Task 5.3 — the outbox's reliability promises, end to end (§13 "Outbox",
// §8.6, §12.1 "a crashed container loses nothing", §17).
//
// `tests/outbox/worker.test.ts` pins one mechanism at a time (claim, failure
// transition, SKIP LOCKED, poller loop). This file pins the promises those
// mechanisms exist to keep, and keeps them honest across the worker *and* the
// admin surface:
//   (a) a throwing handler is retried after its backoff, then succeeds;
//   (b) the same `dedupe_key` enqueued twice runs the handler once;
//   (c) a job that exhausts `max_attempts` is visible as `failed` over HTTP and
//       can be re-queued by the admin retry route;
//   (d) a worker that dies mid-claim does not strand its row: an expired lease
//       (ruling R44) is reclaimed through the same failure path, and the row is
//       either retried or failed — never left `processing` forever.
//
// Every assertion about queue state reads the row back through MySQL (raw
// columns, `available_at <= NOW(3)` evaluated by SQL) rather than through a
// returned object or the API's own mapping: the row is the queue's truth, and
// comparing an app-side `Date` to a DB-side `NOW(3)` would compare two clocks.

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import { sql } from 'drizzle-orm'
import type { Express } from 'express'
import { createApp } from '../../src/app'
import { closeDb, db, pool } from '../../src/db/client'
import { outboxJobs } from '../../src/db/schema'
import { withTransaction } from '../../src/db/tx'
import { enqueue } from '../../src/services/outbox'
import { assignItem } from '../../src/services/items'
import { runOnce, type JobHandler } from '../../src/outbox/worker'
import { signAccessToken } from '../../src/services/tokens'
import { resetDb, seedItem, seedMembership, seedTeam, seedUser } from '../helpers/db'
import type { Actor, OutboxJobType } from '../../src/domain/types'

/**
 * The lease-expiry reason a reclaimed row must carry. Matched loosely on the
 * word "lease": the message is operator-facing prose, not a contract.
 */
const LEASE_MESSAGE = /lease/i

interface JobRow {
  id: number
  payload: unknown
  status: string
  attempts: number
  max_attempts: number
  locked_at: Date | null
  locked_by: string | null
  last_error: string | null
  /** `available_at <= NOW(3)`, decided by SQL. */
  due_now: number
}

/** Reads the queue row as MySQL sees it. */
async function readJob(id: number): Promise<JobRow> {
  const [rows] = await pool.query(
    `SELECT id, payload, status, attempts, max_attempts, locked_at, locked_by, last_error,
            (available_at <= NOW(3)) AS due_now
       FROM outbox_jobs
      WHERE id = ?`,
    [id],
  )
  const row = (rows as JobRow[])[0]
  if (!row) throw new Error(`readJob: no outbox_jobs row ${id}`)
  let payload = row.payload
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload) as unknown
    } catch {
      // keep the raw string
    }
  }
  return { ...row, payload, due_now: Number(row.due_now) }
}

/** Enqueues through the service (the production path) and returns the row id. */
async function enqueueJob(type: OutboxJobType, payload: unknown, dedupeKey: string): Promise<number> {
  await withTransaction(async (tx) => {
    await enqueue(tx, { type, payload, dedupeKey })
  })
  const [rows] = await pool.query('SELECT id FROM outbox_jobs WHERE dedupe_key = ?', [dedupeKey])
  const row = (rows as Array<{ id: number }>)[0]
  if (!row) throw new Error(`enqueueJob: no outbox_jobs row for ${dedupeKey}`)
  return row.id
}

/**
 * Inserts a row that a worker already claimed and then abandoned: `processing`
 * with a lease `leaseSecAgo` seconds old, which is what a killed container
 * leaves behind.
 */
async function seedLeasedJob(o: {
  dedupeKey: string
  /** Seconds before SQL `NOW(3)` for both `locked_at` and `available_at`. */
  leaseSecAgo: number
  attempts?: number
  maxAttempts?: number
  lastError?: string | null
}): Promise<number> {
  const [inserted] = await db
    .insert(outboxJobs)
    .values({
      type: 'email.assigned',
      payload: { to: 'assignee@example.test', itemId: 1 },
      status: 'processing',
      attempts: o.attempts ?? 0,
      maxAttempts: o.maxAttempts ?? 5,
      availableAt: sql`DATE_SUB(NOW(3), INTERVAL ${o.leaseSecAgo} SECOND)`,
      lockedAt: sql`DATE_SUB(NOW(3), INTERVAL ${o.leaseSecAgo} SECOND)`,
      lockedBy: 'dead-worker:1',
      lastError: o.lastError ?? null,
      dedupeKey: o.dedupeKey,
    })
    .$returningId()
  const id = inserted?.id
  if (id === undefined) throw new Error('seedLeasedJob: insert returned no id')
  return id
}

/** Brings a not-yet-due row forward, so a test does not sleep through real backoff. */
async function makeDue(id: number): Promise<void> {
  await pool.query('UPDATE outbox_jobs SET available_at = NOW(3) WHERE id = ?', [id])
}

describe('outbox reliability (Task 5.3)', () => {
  const app: Express = createApp()

  beforeEach(resetDb)
  afterAll(closeDb)

  /** Bearer header for a freshly seeded admin (`isAdmin` is read live per request). */
  async function adminAuth(): Promise<string> {
    const admin = await seedUser({ isAdmin: true })
    return `Bearer ${await signAccessToken(admin.id)}`
  }

  it('(a) retries a throwing handler after its backoff, then succeeds', async () => {
    const dedupeKey = 'reliability-retry-then-succeed'
    const id = await enqueueJob('email.reset', { to: 'user@example.test', code: 'reset-1' }, dedupeKey)

    let throwing = true
    const handler = vi.fn<JobHandler>(async () => {
      if (throwing) throw new Error('attempt 1: SMTP connection refused')
    })
    const handlers: Record<OutboxJobType, JobHandler> = {
      'email.invite': vi.fn<JobHandler>(),
      'email.reset': handler,
      'email.assigned': vi.fn<JobHandler>(),
    }

    const firstPass = await runOnce({ handlers })
    expect(firstPass).toBe(1)
    expect(handler).toHaveBeenCalledTimes(1)

    let row = await readJob(id)
    expect(row.status).toBe('pending')
    expect(row.attempts).toBe(1)
    expect(row.last_error).toContain('attempt 1: SMTP connection refused')
    expect(row.locked_by).toBeNull()
    // The backoff moved `available_at` into the future, so the row is not due yet.
    expect(row.due_now).toBe(0)

    // An immediate pass must NOT re-deliver it: the retry waits for `available_at`.
    const immediatePass = await runOnce({ handlers })
    expect(immediatePass).toBe(0)
    expect(handler).toHaveBeenCalledTimes(1)

    // Once `available_at` arrives the handler runs again and succeeds.
    await makeDue(id)
    throwing = false
    const thirdPass = await runOnce({ handlers })
    expect(thirdPass).toBe(1)
    expect(handler).toHaveBeenCalledTimes(2)

    row = await readJob(id)
    expect(row.status).toBe('done')
    expect(row.attempts).toBe(1)
    expect(row.payload).toBeNull()
    expect(row.locked_by).toBeNull()
  })

  it('(b) a repeat enqueue of the same dedupe_key runs the handler once', async () => {
    const lead = await seedUser()
    const member1 = await seedUser()
    const member2 = await seedUser()
    const team = await seedTeam({ name: 'Reliability Ops' })
    await seedMembership(lead.id, team.id, 'lead')
    await seedMembership(member1.id, team.id, 'member')
    await seedMembership(member2.id, team.id, 'member')

    const item = await seedItem(team.id, { createdBy: lead.id, version: 1 })

    // Two real assignment events (member1, then member2) — both enqueue under
    // the item-scoped `assigned:item:<id>` key.
    const actor: Actor = { id: lead.id, isAdmin: false }
    await assignItem(actor, item.id, member1.id, 1)
    await assignItem(actor, item.id, member2.id, 2)

    const [rows] = await pool.query(
      'SELECT id, status, payload FROM outbox_jobs WHERE dedupe_key = ?',
      [`assigned:item:${item.id}`],
    )
    expect(rows as unknown[]).toHaveLength(1)

    const handler = vi.fn<JobHandler>()
    const handlers: Record<OutboxJobType, JobHandler> = {
      'email.invite': vi.fn<JobHandler>(),
      'email.reset': vi.fn<JobHandler>(),
      'email.assigned': handler,
    }

    const processed = await runOnce({ handlers })
    expect(processed).toBe(1)
    expect(handler).toHaveBeenCalledTimes(1)
    // The surviving job is the first enqueue, not an overwrite by the second.
    expect(handler).toHaveBeenCalledWith({
      to: member1.email,
      itemTitle: item.title,
      teamName: team.name,
      itemId: item.id,
    })
  })

  it('(b2) enqueueing the same dedupe_key twice in one transaction writes one row', async () => {
    const dedupeKey = 'reliability-dedupe-one-transaction'
    await withTransaction(async (tx) => {
      await enqueue(tx, { type: 'email.invite', payload: { to: 'first@example.test' }, dedupeKey })
      await enqueue(tx, { type: 'email.invite', payload: { to: 'second@example.test' }, dedupeKey })
    })

    const [rows] = await pool.query('SELECT id, payload, status FROM outbox_jobs WHERE dedupe_key = ?', [
      dedupeKey,
    ])
    const all = rows as Array<{ id: number; payload: unknown; status: string }>
    expect(all).toHaveLength(1)
    expect(all[0]?.status).toBe('pending')

    const handler = vi.fn<JobHandler>()
    const handlers: Record<OutboxJobType, JobHandler> = {
      'email.invite': handler,
      'email.reset': vi.fn<JobHandler>(),
      'email.assigned': vi.fn<JobHandler>(),
    }

    expect(await runOnce({ handlers })).toBe(1)
    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledWith({ to: 'first@example.test' })
  })

  it('(c) an exhausted job is visible as failed over HTTP and retry re-queues it to done', async () => {
    const token = await adminAuth()
    const dedupeKey = 'reliability-failed-visibility'
    const id = await enqueueJob('email.assigned', { to: 'ops@example.test', itemId: 7 }, dedupeKey)
    await pool.query('UPDATE outbox_jobs SET max_attempts = 2 WHERE id = ?', [id])

    const alwaysThrows = vi.fn<JobHandler>(async () => {
      throw new Error('delivery exploded')
    })
    const handlers: Record<OutboxJobType, JobHandler> = {
      'email.invite': vi.fn<JobHandler>(),
      'email.reset': vi.fn<JobHandler>(),
      'email.assigned': alwaysThrows,
    }

    expect(await runOnce({ handlers })).toBe(1)
    await makeDue(id)
    expect(await runOnce({ handlers })).toBe(1)

    let row = await readJob(id)
    expect(row.status).toBe('failed')
    expect(row.attempts).toBe(2)
    expect(row.last_error).toContain('delivery exploded')
    expect(row.locked_by).toBeNull()

    // The ops screen's query: `GET /admin/jobs?status=failed`.
    const listRes = await request(app).get('/admin/jobs?status=failed').set('Authorization', token)
    expect(listRes.status).toBe(200)
    const listed = listRes.body.jobs as Array<Record<string, unknown>>
    const listedRow = listed.find((job) => job.id === id)
    expect(listedRow).toBeDefined()
    expect(listedRow?.status).toBe('failed')
    expect(listedRow?.attempts).toBe(2)
    expect(String(listedRow?.lastError)).toContain('delivery exploded')
    expect(listedRow).not.toHaveProperty('payload')

    // The ops screen's retry: `POST /admin/jobs/:id/retry` (204, no body).
    const retryRes = await request(app).post(`/admin/jobs/${id}/retry`).set('Authorization', token)
    expect(retryRes.status).toBe(204)

    row = await readJob(id)
    expect(row.status).toBe('pending')
    expect(row.attempts).toBe(0)
    expect(row.locked_at).toBeNull()
    expect(row.locked_by).toBeNull()

    const afterRetry = await request(app).get('/admin/jobs?status=failed').set('Authorization', token)
    expect((afterRetry.body.jobs as Array<{ id: number }>).map((job) => job.id)).not.toContain(id)

    // `retryJob` schedules for NOW(3), so the very next pass delivers it.
    const succeeding = vi.fn<JobHandler>()
    const fixed: Record<OutboxJobType, JobHandler> = {
      'email.invite': vi.fn<JobHandler>(),
      'email.reset': vi.fn<JobHandler>(),
      'email.assigned': succeeding,
    }
    expect(await runOnce({ handlers: fixed })).toBe(1)
    expect(succeeding).toHaveBeenCalledTimes(1)

    row = await readJob(id)
    expect(row.status).toBe('done')
    expect(row.payload).toBeNull()
  })

  it('(d) reclaims an expired lease through the failure path and leaves a fresh lease alone', async () => {
    const token = await adminAuth()
    // A lease is 300s (WORKER_LEASE_SEC). An hour-old lease is unambiguously
    // expired; a lease stamped NOW(3) is unambiguously live, so the test does
    // not restate the configured length.
    const expiredId = await seedLeasedJob({ dedupeKey: 'reliability-lease-expired', leaseSecAgo: 3600 })
    const freshId = await seedLeasedJob({ dedupeKey: 'reliability-lease-fresh', leaseSecAgo: 0 })

    const handler = vi.fn<JobHandler>()
    const handlers: Record<OutboxJobType, JobHandler> = {
      'email.invite': vi.fn<JobHandler>(),
      'email.reset': vi.fn<JobHandler>(),
      'email.assigned': handler,
    }

    const before = await request(app).get('/admin/jobs/summary').set('Authorization', token)
    expect(before.status).toBe(200)
    expect(before.body.byStatus).toMatchObject({ pending: 0, processing: 2, done: 0, failed: 0 })
    expect(before.body.oldestPendingAgeSec).toBeNull()

    // Reclaiming is not claiming: the pass return value stays "jobs claimed for
    // processing", and no handler runs for a row that was never claimed.
    const firstPass = await runOnce({ handlers })
    expect(firstPass).toBe(0)
    expect(handler).not.toHaveBeenCalled()

    const expired = await readJob(expiredId)
    expect(expired.status).toBe('pending')
    expect(expired.attempts).toBe(1)
    expect(expired.locked_at).toBeNull()
    expect(expired.locked_by).toBeNull()
    expect(expired.last_error).toMatch(LEASE_MESSAGE)
    // Re-queued with backoff, not immediately due.
    expect(expired.due_now).toBe(0)

    const fresh = await readJob(freshId)
    expect(fresh.status).toBe('processing')
    expect(fresh.attempts).toBe(0)
    expect(fresh.locked_by).toBe('dead-worker:1')

    const afterReclaim = await request(app).get('/admin/jobs/summary').set('Authorization', token)
    expect(afterReclaim.body.byStatus).toMatchObject({ pending: 1, processing: 1, done: 0, failed: 0 })

    // A later pass — after the backoff — delivers the reclaimed job normally.
    await makeDue(expiredId)
    const secondPass = await runOnce({ handlers })
    expect(secondPass).toBe(1)
    expect(handler).toHaveBeenCalledTimes(1)

    const delivered = await readJob(expiredId)
    expect(delivered.status).toBe('done')
    expect(delivered.attempts).toBe(1)
    expect(delivered.payload).toBeNull()

    const afterDone = await request(app).get('/admin/jobs/summary').set('Authorization', token)
    expect(afterDone.body.byStatus).toMatchObject({ pending: 0, processing: 1, done: 1, failed: 0 })
  })

  it('(d2) reclaiming at max_attempts fails the job, and never erases a recorded last_error', async () => {
    const exhaustedId = await seedLeasedJob({
      dedupeKey: 'reliability-lease-exhausted',
      leaseSecAgo: 3600,
      attempts: 1,
      maxAttempts: 2,
    })
    const informedId = await seedLeasedJob({
      dedupeKey: 'reliability-lease-keeps-last-error',
      leaseSecAgo: 3600,
      attempts: 0,
      lastError: 'handler said: SMTP connection refused',
    })

    const handler = vi.fn<JobHandler>()
    const handlers: Record<OutboxJobType, JobHandler> = {
      'email.invite': vi.fn<JobHandler>(),
      'email.reset': vi.fn<JobHandler>(),
      'email.assigned': handler,
    }

    expect(await runOnce({ handlers })).toBe(0)
    expect(handler).not.toHaveBeenCalled()

    const exhausted = await readJob(exhaustedId)
    expect(exhausted.status).toBe('failed')
    expect(exhausted.attempts).toBe(2)
    expect(exhausted.max_attempts).toBe(2)
    expect(exhausted.last_error).toMatch(LEASE_MESSAGE)
    expect(exhausted.locked_at).toBeNull()
    expect(exhausted.locked_by).toBeNull()

    const informed = await readJob(informedId)
    expect(informed.status).toBe('pending')
    expect(informed.attempts).toBe(1)
    // The earlier handler error is more informative than a lease expiry.
    expect(informed.last_error).toBe('handler said: SMTP connection refused')
  })

  it('(d3) reclaims at most batchSize expired leases per pass, oldest id first', async () => {
    const ids = [
      await seedLeasedJob({ dedupeKey: 'reliability-lease-batch-1', leaseSecAgo: 3600 }),
      await seedLeasedJob({ dedupeKey: 'reliability-lease-batch-2', leaseSecAgo: 3600 }),
      await seedLeasedJob({ dedupeKey: 'reliability-lease-batch-3', leaseSecAgo: 3600 }),
    ]

    const handlers: Record<OutboxJobType, JobHandler> = {
      'email.invite': vi.fn<JobHandler>(),
      'email.reset': vi.fn<JobHandler>(),
      'email.assigned': vi.fn<JobHandler>(),
    }

    expect(await runOnce({ batchSize: 2, handlers })).toBe(0)

    expect((await readJob(ids[0]!)).status).toBe('pending')
    expect((await readJob(ids[1]!)).status).toBe('pending')
    // The third is past the batch limit, so the next pass sweeps it.
    const third = await readJob(ids[2]!)
    expect(third.status).toBe('processing')
    expect(third.attempts).toBe(0)
    expect(third.locked_by).toBe('dead-worker:1')

    expect(await runOnce({ batchSize: 2, handlers })).toBe(0)
    expect((await readJob(ids[2]!)).status).toBe('pending')
  })
})
