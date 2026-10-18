import os from 'node:os'
import { and, asc, eq, inArray, lte, sql } from 'drizzle-orm'
import { config } from '../config'
import { outboxJobs } from '../db/schema'
import { withTransaction } from '../db/tx'
import type { OutboxJobType } from '../domain/types'
export interface OutboxWorker {
  stop(): Promise<void>
}

export type JobHandler = (payload: unknown) => Promise<void>
const WORKER_ID = `${os.hostname()}:${process.pid}`

/**
 * Computes exponential backoff in seconds per spec §8.6 / plan task 2.5:
 * `min(2^attempts * 5s, 5min)` (where 5min = 300 seconds).
 */
export function computeBackoffSec(attempts: number): number {
  const exponent = Math.max(0, attempts)
  return Math.min(Math.pow(2, exponent) * 5, 300)
}

/**
 * Polls and processes one batch of due outbox jobs:
 * 1. Claims up to `batchSize` jobs with `status = 'pending' AND available_at <= NOW(3)`
 *    using `FOR UPDATE SKIP LOCKED`.
 * 2. Marks them `status = 'processing'`, `locked_at = NOW(3)`, `locked_by = hostname:pid`.
 * 3. Executes the corresponding handler for each job outside the lock:
 *    - On success: marks `status = 'done'`, sets `payload = NULL`, clears `locked_by`.
 *    - On failure: increments `attempts`. If `attempts >= max_attempts`, marks `status = 'failed'`.
 *      Otherwise returns to `status = 'pending'` with `available_at = NOW() + backoff(attempts)`.
 *      Records `last_error` and clears `locked_by`.
 *
 * Returns the count of jobs claimed and processed in this batch.
 */
export async function runOnce(opts?: {
  batchSize?: number
  handlers?: Record<OutboxJobType, JobHandler>
}): Promise<number> {
  const batchSize = opts?.batchSize ?? config.workerBatchSize ?? 10
  const handlers = opts?.handlers

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
      const newAttempts = job.attempts + 1
      const isFailed = newAttempts >= job.maxAttempts
      const backoffSec = computeBackoffSec(newAttempts)
      const errorMessage = error instanceof Error ? error.message : String(error)

      await withTransaction(async (tx) => {
        if (isFailed) {
          await tx
            .update(outboxJobs)
            .set({
              status: 'failed',
              attempts: newAttempts,
              lastError: errorMessage,
              lockedBy: null,
            })
            .where(eq(outboxJobs.id, job.id))
        } else {
          await tx
            .update(outboxJobs)
            .set({
              status: 'pending',
              attempts: newAttempts,
              availableAt: sql`DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL ${backoffSec} SECOND)`,
              lastError: errorMessage,
              lockedBy: null,
            })
            .where(eq(outboxJobs.id, job.id))
        }
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
