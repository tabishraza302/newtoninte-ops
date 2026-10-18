// The transactional outbox (design): a state change that must trigger a side
// effect (an email) is recorded as a job row in the same transaction that makes
// the change. A worker — a later task — will drain outbox_jobs after the
// commit. That is what buys the guarantee: a side effect can never fire for a
// transaction that rolled back, and the side effect for a committed change
// cannot be lost.

import { sql } from 'drizzle-orm'
import { outboxJobs } from '../db/schema'
import type { Tx } from '../db/tx'
import type { OutboxJobType } from '../domain/types'

/**
 * Records an outbox job on `tx`. Callers pass the transaction that carries the
 * business change, so the job and the change commit or roll back together.
 *
 * `dedupe_key` is globally unique: a repeat enqueue is a genuine no-op
 * (`ON DUPLICATE KEY UPDATE id = id`), not an error and not an overwrite, so
 * the original job — including its payload and its claim state — is preserved.
 *
 * The column values are supplied explicitly rather than left to defaults:
 * `available_at` is computed by the database (`CURRENT_TIMESTAMP(3)`, never a
 * JS clock, so it agrees with the worker's own time comparisons), and `status`
 * is pinned to `pending`, the worker's "unclaimed" state.
 */
export async function enqueue(
  tx: Tx,
  job: { type: OutboxJobType; payload: unknown; dedupeKey: string },
): Promise<void> {
  await tx
    .insert(outboxJobs)
    .values({
      type: job.type,
      payload: job.payload,
      status: 'pending',
      availableAt: sql`CURRENT_TIMESTAMP(3)`,
      dedupeKey: job.dedupeKey,
    })
    .onDuplicateKeyUpdate({ set: { id: sql`id` } })
}
