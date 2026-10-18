import os from 'node:os'
import { and, asc, eq, inArray, lt, lte, sql } from 'drizzle-orm'
import { config } from '../config'
import { outboxJobs } from '../db/schema'
import { withTransaction, type Tx } from '../db/tx'
import type { OutboxJobType } from '../domain/types'
export interface OutboxWorker {
  stop(): Promise<void>
}

export type JobHandler = (payload: unknown) => Promise<void>
const WORKER_ID = `${os.hostname()}:${process.pid}`

/**
 * The `last_error` recorded when a lease expires. Only ever written to a row
 * whose `last_error` is NULL: an error a handler actually reported is more
 * informative than "the worker died", and erasing it would destroy the very
 * evidence the ops screen exists to show (the same reason `retryJob` keeps it).
 */
function leaseExpiredMessage(leaseSec: number): string {
  return `Worker lease expired (no result within ${leaseSec}s); job re-queued for retry`
}

/**
 * Computes exponential backoff in seconds per spec §8.6 / plan task 2.5:
 * `min(2^attempts * 5s, 5min)` (where 5min = 300 seconds).
 */
export function computeBackoffSec(attempts: number): number {
  const exponent = Math.max(0, attempts)
  return Math.min(Math.pow(2, exponent) * 5, 300)
}

/**
 * The one failure transition, shared by a handler that threw and a lease that
 * expired: `attempts + 1`; at `max_attempts` the row is `failed` (visible,
 * never silently dropped — spec §8.6), otherwise `pending` with
 * `available_at = NOW(3) + backoff(newAttempts)`. Either way the lease is
 * released (`locked_at`/`locked_by` NULL), because the row is no longer owned
 * by any worker.
 *
 * The caller supplies the message, so each cause keeps its own wording.
 */
async function failJob(
  tx: Tx,
  job: { id: number; attempts: number; maxAttempts: number },
  message: string,
): Promise<void> {
  const newAttempts = job.attempts + 1
  const released = {
    attempts: newAttempts,
    lastError: message,
    lockedAt: null,
    lockedBy: null,
  }

  if (newAttempts >= job.maxAttempts) {
    await tx
      .update(outboxJobs)
      .set({ ...released, status: 'failed' })
      .where(eq(outboxJobs.id, job.id))
  } else {
    await tx
      .update(outboxJobs)
      .set({
        ...released,
        status: 'pending',
        availableAt: sql`DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL ${computeBackoffSec(newAttempts)} SECOND)`,
      })
      .where(eq(outboxJobs.id, job.id))
  }
}

/**
 * Polls and processes one batch of due outbox jobs:
 * 0. Reclaims up to `batchSize` leases that have expired (see below), in their
 *    own transaction, before any pending work is touched.
 * 1. Claims up to `batchSize` jobs with `status = 'pending' AND available_at <= NOW(3)`
 *    using `FOR UPDATE SKIP LOCKED`.
 * 2. Marks them `status = 'processing'`, `locked_at = NOW(3)`, `locked_by = hostname:pid`.
 * 3. Executes the corresponding handler for each job outside the lock:
 *    - On success: marks `status = 'done'`, sets `payload = NULL`, clears `locked_by`.
 *    - On failure: increments `attempts`. If `attempts >= max_attempts`, marks `status = 'failed'`.
 *      Otherwise returns to `status = 'pending'` with `available_at = NOW() + backoff(attempts)`.
 *      Records `last_error` and clears `locked_by`.
 *
 * Returns the count of jobs **claimed for processing** in this pass. Reclaimed
 * (step 0) and re-queued rows are not claims, so they do not count: a pass that
 * only sweeps dead leases returns 0, exactly as if there had been no work.
 *
 * The lease exists because a claim must not be permanent. If the process dies
 * between claiming a row and writing `done`/`pending`, that row would sit in
 * `processing` forever — its `attempts` untouched, invisible to the admin
 * surface (`retryJob` only takes `failed`), and the side effect it stands for
 * silently lost, which is exactly what spec §12.1 forbids ("a crashed
 * container loses nothing"). So a row whose `locked_at` is older than
 * `workerLeaseSec` is driven through the ordinary failure path and becomes
 * deliverable again.
 *
 * The cost is the §17 double-send window: a handler that legitimately outlives
 * the lease is re-delivered while its first execution may still be running.
 * Delivery is at-least-once; the job's `dedupe_key` is what mitigates the
 * duplicate, and `workerLeaseSec` is therefore a policy dial — long enough to
 * cover a normal handler, short enough that a crash is not a permanent stall.
 */
export async function runOnce(opts?: {
  batchSize?: number
  handlers?: Record<OutboxJobType, JobHandler>
}): Promise<number> {
  const batchSize = opts?.batchSize ?? config.workerBatchSize ?? 10
  const leaseSec = config.workerLeaseSec ?? 300
  const handlers = opts?.handlers

  // 0. Reclaim expired leases in their own transaction, so the sweep cannot
  //    hold locks (or be rolled back) with the claim that follows it.
  await withTransaction(async (tx) => {
    const stranded = await tx
      .select()
      .from(outboxJobs)
      .where(
        and(
          eq(outboxJobs.status, 'processing'),
          lt(
            outboxJobs.lockedAt,
            sql`DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL ${leaseSec} SECOND)`,
          ),
        ),
      )
      .orderBy(asc(outboxJobs.id))
      .limit(batchSize)
      .for('update', { skipLocked: true })

    for (const job of stranded) {
      // `last_error` is only filled in when the row has none: a handler that
      // reported why it failed is more informative than a lease expiry.
      const message = job.lastError ?? leaseExpiredMessage(leaseSec)
      await failJob(tx, job, message)
    }
  })

  // 1. Atomically claim batch of pending jobs
  const claimed = await withTransaction(async (tx) => {
    const jobs = await tx
      .select()
      .from(outboxJobs)
      .where(
        and(
          eq(outboxJobs.status, 'pending'),
          lte(outboxJobs.availableAt, sql`CURRENT_TIMESTAMP(3)`),
        ),
      )
      .orderBy(asc(outboxJobs.id))
      .limit(batchSize)
      .for('update', { skipLocked: true })

    if (jobs.length === 0) {
      return []
    }

    const ids = jobs.map((j) => j.id)
    await tx
      .update(outboxJobs)
      .set({
        status: 'processing',
        lockedAt: sql`CURRENT_TIMESTAMP(3)`,
        lockedBy: WORKER_ID,
      })
      .where(inArray(outboxJobs.id, ids))

    return jobs
  })

  if (claimed.length === 0) {
    return 0
  }

  // 2. Process each claimed job
  for (const job of claimed) {
    let error: unknown = null
    try {
      const handler = handlers?.[job.type]
      if (!handler) {
        throw new Error(`No handler registered for job type: ${job.type}`)
      }
      let payload = job.payload
      if (typeof payload === 'string') {
        try {
          payload = JSON.parse(payload) as unknown
        } catch {
          // keep original payload if not JSON
        }
      }
      await handler(payload)
    } catch (err: unknown) {
      error = err
    }

    if (error === null) {
      // Success: null out payload and mark done
      await withTransaction(async (tx) => {
        await tx
          .update(outboxJobs)
          .set({
            status: 'done',
            payload: null,
            lockedBy: null,
          })
          .where(eq(outboxJobs.id, job.id))
      })
    } else {
      // Failure: retry or fail at max_attempts
      const errorMessage = error instanceof Error ? error.message : String(error)

      await withTransaction(async (tx) => {
        await failJob(tx, job, errorMessage)
      })
    }
  }

  return claimed.length
}

/**
 * Starts the worker poller loop running every `intervalMs`.
 * Returns an object with `stop()` for graceful shutdown.
 */
export function startWorker(opts?: {
  intervalMs?: number
  batchSize?: number
  handlers?: Record<OutboxJobType, JobHandler>
}): OutboxWorker {
  const intervalMs = opts?.intervalMs ?? config.workerIntervalMs ?? 3000
  let stopped = false
  let timer: NodeJS.Timeout | null = null
  let currentRun: Promise<number> | null = null

  async function tick(): Promise<void> {
    if (stopped) return
    try {
      currentRun = runOnce(opts)
      await currentRun
    } catch {
      // Absorb top-level error to keep worker poller alive
    } finally {
      currentRun = null
      if (!stopped) {
        timer = setTimeout(() => {
          void tick()
        }, intervalMs)
      }
    }
  }

  timer = setTimeout(() => {
    void tick()
  }, 0)
  return {
    async stop(): Promise<void> {
      stopped = true
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
      if (currentRun !== null) {
        await currentRun.catch(() => undefined)
      }
    },
  }
}
