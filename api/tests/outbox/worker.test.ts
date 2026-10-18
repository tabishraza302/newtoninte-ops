import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import { resetDb } from '../helpers/db'
import { closeDb, pool } from '../../src/db/client'
import { withTransaction } from '../../src/db/tx'
import { enqueue } from '../../src/services/outbox'
import { runOnce, startWorker, computeBackoffSec, type JobHandler } from '../../src/outbox/worker'
import type { OutboxJobType } from '../../src/domain/types'

interface JobRow {
  id: number
  type: string
  payload: unknown
  status: string
  attempts: number
  max_attempts: number
  available_at: Date
  locked_by: string | null
  locked_at: Date | null
  last_error: string | null
}

async function fetchJob(dedupeKey: string): Promise<JobRow> {
  const [rows] = await pool.query(
    'SELECT id, type, payload, status, attempts, max_attempts, available_at, locked_by, locked_at, last_error FROM outbox_jobs WHERE dedupe_key = ?',
    [dedupeKey],
  )
  const row = (rows as JobRow[])[0]
  if (!row) throw new Error(`Job not found for dedupeKey: ${dedupeKey}`)
  let payload = row.payload
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload) as unknown
    } catch {
      // keep raw string
    }
  }
  return { ...row, payload }
}

function extractKey(payload: unknown): string | undefined {
  if (payload && typeof payload === 'object' && 'key' in payload) {
    const val = (payload as Record<string, unknown>).key
    return typeof val === 'string' ? val : undefined
  }
  return undefined
}

describe('computeBackoffSec', () => {
  it('computes exponential backoff min(2^attempts * 5s, 5min)', () => {
    expect(computeBackoffSec(1)).toBe(10)
    expect(computeBackoffSec(2)).toBe(20)
    expect(computeBackoffSec(3)).toBe(40)
    expect(computeBackoffSec(4)).toBe(80)
    expect(computeBackoffSec(5)).toBe(160)
    expect(computeBackoffSec(6)).toBe(300) // capped at 300s (5min)
    expect(computeBackoffSec(10)).toBe(300)
  })
})

describe('outbox worker', () => {
  beforeEach(resetDb)
  afterAll(closeDb)

  it('(a) processes a pending job successfully: marks done and nulls payload', async () => {
    const dedupeKey = 'test-worker-success'
    await withTransaction(async (tx) => {
      await enqueue(tx, {
        type: 'email.invite',
        payload: { to: 'invitee@example.test', code: 'secret-token' },
        dedupeKey,
      })
    })

    const handler = vi.fn<JobHandler>().mockResolvedValue(undefined)
    const handlers: Record<OutboxJobType, JobHandler> = {
      'email.invite': handler,
      'email.reset': vi.fn(),
      'email.assigned': vi.fn(),
    }

    const processed = await runOnce({ handlers })
    expect(processed).toBe(1)
    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledWith({ to: 'invitee@example.test', code: 'secret-token' })

    const row = await fetchJob(dedupeKey)
    expect(row.status).toBe('done')
    expect(row.payload).toBeNull()
    expect(row.locked_by).toBeNull()
    expect(row.locked_at).toBeNull()
  })

  it('(b) handles handler error: attempts incremented, status pending, last_error set, available_at in future', async () => {
    const dedupeKey = 'test-worker-fail-once'
    await withTransaction(async (tx) => {
      await enqueue(tx, {
        type: 'email.reset',
        payload: { to: 'user@example.test', code: 'reset-123' },
        dedupeKey,
      })
    })

    const handler = vi.fn<JobHandler>().mockRejectedValue(new Error('SMTP connection refused'))
    const handlers: Record<OutboxJobType, JobHandler> = {
      'email.invite': vi.fn(),
      'email.reset': handler,
      'email.assigned': vi.fn(),
    }

    const processed = await runOnce({ handlers })
    expect(processed).toBe(1)
    expect(handler).toHaveBeenCalledTimes(1)

    const row = await fetchJob(dedupeKey)
    expect(row.status).toBe('pending')
    expect(row.attempts).toBe(1)
    expect(row.last_error).toContain('SMTP connection refused')
    expect(row.locked_by).toBeNull()
    // available_at was moved forward by 10 seconds (attempt 1)
    expect(row.available_at.getTime()).toBeGreaterThan(Date.now())
  })

  it('(c) permanently fails a job when attempts reach max_attempts', async () => {
    const dedupeKey = 'test-worker-max-attempts'
    await withTransaction(async (tx) => {
      await enqueue(tx, {
        type: 'email.assigned',
        payload: { itemId: 42 },
        dedupeKey,
      })
    })

    // Set max_attempts to 2 directly on the row
    await pool.query('UPDATE outbox_jobs SET max_attempts = 2 WHERE dedupe_key = ?', [dedupeKey])

    const handler = vi.fn<JobHandler>().mockRejectedValue(new Error('Fatal delivery error'))
    const handlers: Record<OutboxJobType, JobHandler> = {
      'email.invite': vi.fn(),
      'email.reset': vi.fn(),
      'email.assigned': handler,
    }

    // First attempt: fails, attempts becomes 1
    const run1 = await runOnce({ handlers })
    expect(run1).toBe(1)
    let row = await fetchJob(dedupeKey)
    expect(row.status).toBe('pending')
    expect(row.attempts).toBe(1)

    // Reset available_at to NOW() so it is immediately eligible for the second run
    await pool.query('UPDATE outbox_jobs SET available_at = CURRENT_TIMESTAMP(3) WHERE dedupe_key = ?', [dedupeKey])

    // Second attempt: fails, attempts becomes 2 -> reached max_attempts 2 -> status becomes 'failed'
    const run2 = await runOnce({ handlers })
    expect(run2).toBe(1)
    row = await fetchJob(dedupeKey)
    expect(row.status).toBe('failed')
    expect(row.attempts).toBe(2)
    expect(row.last_error).toContain('Fatal delivery error')

    // Third run: pending job query does not pick up 'failed' jobs
    await pool.query('UPDATE outbox_jobs SET available_at = CURRENT_TIMESTAMP(3) WHERE dedupe_key = ?', [dedupeKey])
    const run3 = await runOnce({ handlers })
    expect(run3).toBe(0)
  })

  it('(d) two workers concurrently claim disjoint rows with SKIP LOCKED', async () => {
    // Insert 4 jobs
    const keys = ['test-skip-1', 'test-skip-2', 'test-skip-3', 'test-skip-4']
    await withTransaction(async (tx) => {
      for (const k of keys) {
        await enqueue(tx, {
          type: 'email.invite',
          payload: { key: k },
          dedupeKey: k,
        })
      }
    })

    const processedKeys: string[] = []
    const { promise: firstBatchInFlight, resolve: notifyFirstBatchInFlight } = Promise.withResolvers<void>()
    const { promise: allowFirstBatchFinish, resolve: releaseFirstBatch } = Promise.withResolvers<void>()

    let handlerCalls = 0
    const handler: JobHandler = async (payload: unknown) => {
      const key = extractKey(payload)
      if (key) {
        processedKeys.push(key)
      }
      handlerCalls++
      // The first worker holds its handler until the second worker has initiated its claim
      if (handlerCalls === 1) {
        notifyFirstBatchInFlight()
        await allowFirstBatchFinish
      }
    }

    const handlers: Record<OutboxJobType, JobHandler> = {
      'email.invite': handler,
      'email.reset': vi.fn(),
      'email.assigned': vi.fn(),
    }

    // Worker 1 runs with batchSize 2 and claims the first 2 rows
    const worker1Promise = runOnce({ batchSize: 2, handlers })

    // Wait until Worker 1 has claimed rows and started executing
    await firstBatchInFlight

    // Worker 2 runs concurrently with batchSize 2 — SKIP LOCKED skips Worker 1's rows
    const worker2Promise = runOnce({ batchSize: 2, handlers })

    // Now release Worker 1 to finish
    releaseFirstBatch()

    const [w1, w2] = await Promise.all([worker1Promise, worker2Promise])

    expect(w1 + w2).toBe(4)
    expect(processedKeys).toHaveLength(4)
    // Every key processed exactly once
    expect(new Set(processedKeys).size).toBe(4)

    // Verify all 4 jobs are done and payloads nulled
    for (const k of keys) {
      const row = await fetchJob(k)
      expect(row.status).toBe('done')
      expect(row.payload).toBeNull()
    }
  })

  it('(e) startWorker processes jobs and stop() halts further execution', async () => {
    const dedupeKey = 'test-worker-start-stop'
    await withTransaction(async (tx) => {
      await enqueue(tx, {
        type: 'email.invite',
        payload: { to: 'start@example.test' },
        dedupeKey,
      })
    })

    const { promise: jobHandled, resolve: notifyJobHandled } = Promise.withResolvers<void>()
    const handler = vi.fn<JobHandler>().mockImplementation(async () => {
      notifyJobHandled()
    })

    const handlers: Record<OutboxJobType, JobHandler> = {
      'email.invite': handler,
      'email.reset': vi.fn(),
      'email.assigned': vi.fn(),
    }

    const worker = startWorker({ intervalMs: 20, batchSize: 5, handlers })
    // Await handler execution signal
    await jobHandled

    // Await graceful stop which flushes in-flight update
    await worker.stop()

    const row = await fetchJob(dedupeKey)
    expect(row.status).toBe('done')
    expect(row.payload).toBeNull()
  })
  it('(f) reclaims a processing row whose locked_at is NULL', async () => {
    const dedupeKey = 'test-worker-null-locked-at'
    await withTransaction(async (tx) => {
      await enqueue(tx, {
        type: 'email.invite',
        payload: { to: 'stranded@example.test' },
        dedupeKey,
      })
    })

    // Manually strand row in 'processing' with locked_at = NULL
    await pool.query(
      "UPDATE outbox_jobs SET status = 'processing', locked_at = NULL, locked_by = 'crashed:999' WHERE dedupe_key = ?",
      [dedupeKey],
    )

    const processed = await runOnce({ handlers: { 'email.invite': vi.fn(), 'email.reset': vi.fn(), 'email.assigned': vi.fn() } })
    // runOnce returns claimed count, sweep pass reclaims stranded row to pending
    const row = await fetchJob(dedupeKey)
    expect(row.status).toBe('pending')
    expect(row.locked_by).toBeNull()
    expect(row.locked_at).toBeNull()
    expect(row.last_error).toMatch(/lease/i)
  })
})
