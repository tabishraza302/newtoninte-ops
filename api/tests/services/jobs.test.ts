// Task 5.1 — the admin/ops surface over the outbox queue (§12.2) plus account
// enable/disable (§7.1).
//
// Assertions read the *queue* through raw SQL (`status`, `attempts`,
// `available_at <= NOW(3)`) rather than through the app's own row mapping:
// comparing an app-side `Date` with a DB-side `NOW(3)` would compare two
// different clocks, and the millisecond both sides format could make a broken
// value look correct.

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { closeDb, db } from '../../src/db/client'
import { outboxJobs } from '../../src/db/schema'
import type { Actor, OutboxJobType } from '../../src/domain/types'
import { ApiError } from '../../src/http/errors'
import { runOnce, type JobHandler } from '../../src/outbox/worker'
import { login, me } from '../../src/services/auth'
import { hashPassword } from '../../src/services/crypto'
import { jobsSummary, listJobs, retryJob, setUserStatus } from '../../src/services/jobs'
import { rotate } from '../../src/services/sessions'
import { resetDb, seedUser } from '../helpers/db'

type JobStatus = 'pending' | 'processing' | 'done' | 'failed'

const PASSWORD = 'Passw0rd!'

async function adminActor(): Promise<Actor> {
  const user = await seedUser({ isAdmin: true })
  return { id: user.id, isAdmin: true }
}

async function memberActor(): Promise<Actor> {
  const user = await seedUser()
  return { id: user.id, isAdmin: false }
}

/** Inserts a queue row directly, so each test controls lease/attempt state. */
async function seedJob(o: {
  dedupeKey: string
  status?: JobStatus
  type?: OutboxJobType
  attempts?: number
  maxAttempts?: number
  lastError?: string | null
  /** Seconds before SQL `NOW(3)` — negative schedules the job in the future. */
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
      // Server-side clock, written the same way `enqueue` writes it.
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
  lockedBy: string | null
  dueNow: boolean
}> {
  const [row] = await db
    .select({
      status: outboxJobs.status,
      attempts: outboxJobs.attempts,
      lastError: outboxJobs.lastError,
      lockedBy: outboxJobs.lockedBy,
      due: sql<number | string>`(${outboxJobs.availableAt} <= NOW(3))`,
    })
    .from(outboxJobs)
    .where(eq(outboxJobs.id, id))
    .limit(1)
  if (row === undefined) throw new Error(`readJob: no row ${id}`)
  return {
    status: row.status,
    attempts: row.attempts,
    lastError: row.lastError,
    lockedBy: row.lockedBy,
    dueNow: Number(row.due) === 1,
  }
}

function handlersWith(handler: JobHandler): Record<OutboxJobType, JobHandler> {
  const noop = vi.fn<JobHandler>().mockResolvedValue(undefined)
  return { 'email.invite': handler, 'email.reset': noop, 'email.assigned': noop }
}

async function caught(promise: Promise<unknown>): Promise<ApiError> {
  let error: unknown
  try {
    await promise
  } catch (e) {
    error = e
  }
  expect(error).toBeInstanceOf(ApiError)
  return error as ApiError
}

describe('jobs service (Task 5.1)', () => {
  beforeEach(resetDb)
  afterAll(closeDb)

  describe('listJobs', () => {
    it('filters by status and type, newest id first', async () => {
      const admin = await adminActor()
      const failedId = await seedJob({
        dedupeKey: 'failed-1',
        status: 'failed',
        attempts: 5,
        maxAttempts: 5,
        lastError: 'boom',
      })
      const pendingInviteId = await seedJob({ dedupeKey: 'pending-1' })
      const pendingResetId = await seedJob({ dedupeKey: 'pending-reset', type: 'email.reset' })

      const all = await listJobs(admin)
      expect(all.jobs.map((j) => j.id)).toEqual([pendingResetId, pendingInviteId, failedId])
      expect(all.nextCursor).toBeNull()

      const failed = await listJobs(admin, { status: 'failed' })
      expect(failed.jobs.map((j) => j.id)).toEqual([failedId])
      expect(failed.jobs[0]?.lastError).toBe('boom')
      expect(failed.jobs[0]?.attempts).toBe(5)

      const resets = await listJobs(admin, { type: 'email.reset' })
      expect(resets.jobs.map((j) => j.id)).toEqual([pendingResetId])

      const pendingInvites = await listJobs(admin, { status: 'pending', type: 'email.invite' })
      expect(pendingInvites.jobs.map((j) => j.id)).toEqual([pendingInviteId])
    })

    it('never hands out a job payload (it can carry a single-use token)', async () => {
      const admin = await adminActor()
      const id = await seedJob({ dedupeKey: 'secret' })

      const { jobs } = await listJobs(admin)
      expect(jobs).toHaveLength(1)
      const [job] = jobs
      if (job === undefined) throw new Error('listJobs returned no job')
      expect('payload' in job).toBe(false)

      // The row itself does carry one — so the assertion above proves the ops
      // view strips it rather than the payload being empty.
      const [stored] = await db
        .select({ payload: outboxJobs.payload })
        .from(outboxJobs)
        .where(eq(outboxJobs.id, id))
        .limit(1)
      expect(stored?.payload).not.toBeNull()
    })

    it('rejects a status/type outside the known sets', async () => {
      const admin = await adminActor()

      expect((await caught(listJobs(admin, { status: 'wat' as JobStatus }))).code).toBe(
        'VALIDATION_ERROR',
      )
      expect((await caught(listJobs(admin, { type: 'email.nope' as OutboxJobType }))).code).toBe(
        'VALIDATION_ERROR',
      )
    })

    it('pages newest-first with a scope-bound cursor and rejects a foreign cursor', async () => {
      const admin = await adminActor()
      const first = await seedJob({ dedupeKey: 'p-1' })
      const second = await seedJob({ dedupeKey: 'p-2' })
      const third = await seedJob({ dedupeKey: 'p-3' })

      const page1 = await listJobs(admin, { limit: 2 })
      expect(page1.jobs.map((j) => j.id)).toEqual([third, second])
      expect(page1.nextCursor).not.toBeNull()

      const page2 = await listJobs(admin, { limit: 2, cursor: page1.nextCursor ?? undefined })
      expect(page2.jobs.map((j) => j.id)).toEqual([first])
      expect(page2.nextCursor).toBeNull()

      // A cursor minted under no filter must not page a filtered list: it would
      // silently return a wrong page (422, not a restart from the top).
      const foreign = await caught(
        listJobs(admin, { status: 'pending', cursor: page1.nextCursor ?? undefined }),
      )
      expect(foreign.code).toBe('VALIDATION_ERROR')
      expect((await caught(listJobs(admin, { cursor: 'not-a-cursor' }))).code).toBe(
        'VALIDATION_ERROR',
      )
    })

    it('rejects a limit outside 1..100', async () => {
      const admin = await adminActor()

      expect((await caught(listJobs(admin, { limit: 0 }))).code).toBe('VALIDATION_ERROR')
      expect((await caught(listJobs(admin, { limit: 101 }))).code).toBe('VALIDATION_ERROR')
    })
  })

  describe('jobsSummary', () => {
    it('counts every status and reports how far the oldest pending job is overdue', async () => {
      const admin = await adminActor()
      await seedJob({ dedupeKey: 's-pending-old', dueSecAgo: 30 })
      await seedJob({ dedupeKey: 's-pending-new', dueSecAgo: 5 })
      // A backed-off job is due in the future: it is not backlog, and the age
      // must not go negative because of it.
      await seedJob({ dedupeKey: 's-pending-future', dueSecAgo: -300 })
      await seedJob({ dedupeKey: 's-processing', status: 'processing' })
      await seedJob({ dedupeKey: 's-done', status: 'done' })
      await seedJob({ dedupeKey: 's-failed', status: 'failed', attempts: 5, maxAttempts: 5 })

      const summary = await jobsSummary(admin)

      expect(summary.byStatus).toEqual({ pending: 3, processing: 1, done: 1, failed: 1 })
      expect(summary.oldestPendingAgeSec).toBeGreaterThanOrEqual(29)
      expect(summary.oldestPendingAgeSec).toBeLessThan(60)
    })

    it('reports a null age when nothing is pending', async () => {
      const admin = await adminActor()
      await seedJob({ dedupeKey: 'n-done', status: 'done' })

      const summary = await jobsSummary(admin)

      expect(summary.byStatus).toEqual({ pending: 0, processing: 0, done: 1, failed: 0 })
      expect(summary.oldestPendingAgeSec).toBeNull()
    })
  })

  describe('retryJob', () => {
    it('re-queues a failed job and a later worker pass completes it', async () => {
      const admin = await adminActor()
      const id = await seedJob({
        dedupeKey: 'retry-me',
        status: 'failed',
        attempts: 5,
        maxAttempts: 5,
        lastError: 'smtp exploded',
        dueSecAgo: 120,
      })

      await retryJob(admin, id)

      const requeued = await readJob(id)
      expect(requeued.status).toBe('pending')
      expect(requeued.attempts).toBe(0)
      expect(requeued.dueNow).toBe(true)
      expect(requeued.lastError).toBe('smtp exploded')
      expect(requeued.lockedBy).toBeNull()

      const handler = vi.fn<JobHandler>().mockResolvedValue(undefined)
      expect(await runOnce({ handlers: handlersWith(handler) })).toBe(1)
      expect(handler).toHaveBeenCalledTimes(1)

      const done = await readJob(id)
      expect(done.status).toBe('done')
      expect(done.attempts).toBe(0)
    })

    it('refuses an unknown job and a job that is not failed', async () => {
      const admin = await adminActor()
      const doneId = await seedJob({ dedupeKey: 'already-done', status: 'done' })
      const processingId = await seedJob({ dedupeKey: 'in-flight', status: 'processing' })

      expect((await caught(retryJob(admin, 987654))).code).toBe('NOT_FOUND')
      expect((await caught(retryJob(admin, doneId))).code).toBe('VALIDATION_ERROR')
      expect((await caught(retryJob(admin, processingId))).code).toBe('VALIDATION_ERROR')

      // Neither refusal may have touched the row.
      expect((await readJob(doneId)).status).toBe('done')
      expect((await readJob(processingId)).status).toBe('processing')
    })
  })

  describe('setUserStatus', () => {
    it('disabling blocks login, kills the live refresh family, and re-enabling restores login', async () => {
      const admin = await adminActor()
      const passwordHash = await hashPassword(PASSWORD)
      const user = await seedUser({ email: 'target@test.local', passwordHash })

      const session = await login('target@test.local', PASSWORD)

      await setUserStatus(admin, user.id, 'disabled')

      // A live refresh token must not outlive the disable (30-day TTL otherwise).
      expect((await caught(rotate(session.refreshToken))).code).toBe('UNAUTHENTICATED')
      expect((await caught(login('target@test.local', PASSWORD))).code).toBe('FORBIDDEN')
      expect((await caught(me({ id: user.id, isAdmin: false }))).code).toBe('UNAUTHENTICATED')

      await setUserStatus(admin, user.id, 'active')
      const again = await login('target@test.local', PASSWORD)
      expect(again.accessToken).toEqual(expect.any(String))
    })

    it('rejects an unknown user and a non-admin actor', async () => {
      const admin = await adminActor()
      const member = await memberActor()

      expect((await caught(setUserStatus(admin, 987654, 'disabled'))).code).toBe('NOT_FOUND')
      expect((await caught(setUserStatus(member, admin.id, 'disabled'))).code).toBe('FORBIDDEN')
    })
  })

  it('refuses a non-admin actor on every ops operation', async () => {
    const member = await memberActor()
    const id = await seedJob({ dedupeKey: 'locked-out', status: 'failed', lastError: 'x' })

    expect((await caught(listJobs(member))).code).toBe('FORBIDDEN')
    expect((await caught(jobsSummary(member))).code).toBe('FORBIDDEN')
    expect((await caught(retryJob(member, id))).code).toBe('FORBIDDEN')

    expect((await readJob(id)).status).toBe('failed')
  })
})
