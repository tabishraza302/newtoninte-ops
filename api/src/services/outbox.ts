// The transactional outbox: state changes that must trigger a side effect
// (an email) are recorded as a job row in the same transaction that makes the
// change. A separate worker drains `outbox_jobs` after the commit, so the
// side effect can never fire for a transaction that rolled back and a lost
// side effect cannot outlive a committed change.

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
 * the original job — including its payload and schedule — is preserved.
 *
 * `available_at` and `status` are left to the database: `CURRENT_TIMESTAMP(3)`
 * is the source of truth for "due now" (fat-fingering a JS clock here would
 * drift from the worker's time comparisons), and the `pending` default is the
 * worker's "unclaimed" state.
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
