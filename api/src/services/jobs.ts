// The admin/ops surface over the outbox queue (spec §12.2) plus account
// enable/disable (spec §7.1, §11.2).
//
// Failed jobs are first-class rows, not log lines: everything here reads and
// writes `outbox_jobs` so the ops screen can show *why* a background side
// effect did not happen and offer a retry. All four operations are admin-only
// (`isAdmin`, spec §7.1) — a job payload can carry a single-use token and an
// account-level disable is not scoped to any team, so neither is reachable by
// a membership role.

import { and, count, desc, eq, lt, sql, type SQL } from 'drizzle-orm'
import { db } from '../db/client'
import { outboxJobs, users, type OutboxJobRow } from '../db/schema'
import { withTransaction } from '../db/tx'
import { OUTBOX_TYPES, type Actor, type OutboxJobType } from '../domain/types'
import { buildPage, decodeCursor, DEFAULT_LIMIT, MAX_LIMIT } from '../http/cursor'
import { ApiError } from '../http/errors'
import { can } from '../policy'
import { revokeAllForUser } from './sessions'

/** The four states a queue row can be in (mirrors the schema enum). */
export type JobStatus = 'pending' | 'processing' | 'done' | 'failed'

const JOB_STATUSES: readonly JobStatus[] = ['pending', 'processing', 'done', 'failed']

/**
 * A queue row as the ops screen may see it: `OutboxJobRow` **without
 * `payload`**.
 *
 * `payload` routinely holds a single-use invite or password-reset token, and
 * the ops screen needs only the queue's *shape* (status, attempts,
 * `last_error`, timestamps) to decide whether to retry. Selecting the columns
 * explicitly is what keeps the token out of the response — the row still
 * carries one in the database (see `api/tests/services/jobs.test.ts`, which
 * asserts the store keeps a payload while the view never exposes it).
 */
export type JobView = Omit<OutboxJobRow, 'payload'>

export interface ListJobsQuery {
  status?: JobStatus | undefined
  type?: OutboxJobType | undefined
  cursor?: string | undefined
  limit?: number | undefined
}

/**
 * The explicit column list for `JobView` — every `outbox_jobs` column except
 * `payload`. `db.select({ ...outboxJobs })` would spread the payload back in,
 * so the omission has to be stated column by column.
 */
const jobColumns = {
  id: outboxJobs.id,
  type: outboxJobs.type,
  status: outboxJobs.status,
  attempts: outboxJobs.attempts,
  maxAttempts: outboxJobs.maxAttempts,
  availableAt: outboxJobs.availableAt,
  lockedAt: outboxJobs.lockedAt,
  lockedBy: outboxJobs.lockedBy,
  lastError: outboxJobs.lastError,
  dedupeKey: outboxJobs.dedupeKey,
  createdAt: outboxJobs.createdAt,
  updatedAt: outboxJobs.updatedAt,
}

// `isJobStatus`/`isOutboxJobType` are type guards, so they change the type of
// the value they accept — an inline `includes` check would not narrow.
function isJobStatus(value: unknown): value is JobStatus {
  return JOB_STATUSES.includes(value as JobStatus)
}

function isOutboxJobType(value: unknown): value is OutboxJobType {
  return OUTBOX_TYPES.includes(value as OutboxJobType)
}

/** `throw ApiError.of('FORBIDDEN')` unless the actor may manage background jobs. */
async function authorizeJobManage(actor: Actor): Promise<void> {
  const allowed = await can(actor, 'job:manage')
  if (!allowed) {
    throw ApiError.of('FORBIDDEN')
  }
}

/**
 * Lists queue rows for the ops screen, newest id first, keyset-paginated on
 * `id` (never `OFFSET`).
 *
 * `status` and `type` are validated against the known sets *before* any query
 * runs, so a typo is a 422 rather than an empty page that reads like "no
 * failed jobs". The cursor is bound to the filter set via `jobsScope`.
 */
export async function listJobs(
  actor: Actor,
  query: ListJobsQuery = {},
): Promise<{ jobs: JobView[]; nextCursor: string | null }> {
  await authorizeJobManage(actor)

  if (query.status !== undefined && !isJobStatus(query.status)) {
    throw ApiError.of('VALIDATION_ERROR', `Unknown job status: ${String(query.status)}`, {
      status: query.status,
    })
  }
  if (query.type !== undefined && !isOutboxJobType(query.type)) {
    throw ApiError.of('VALIDATION_ERROR', `Unknown job type: ${String(query.type)}`, {
      type: query.type,
    })
  }

  const limit = query.limit ?? DEFAULT_LIMIT
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw ApiError.of('VALIDATION_ERROR', `limit must be an integer between 1 and ${MAX_LIMIT}`, {
      limit,
    })
  }

  // The cursor scope fingerprint: the filter set a cursor was minted for.
  // `decodeCursor` rejects a cursor replayed against a different filter set
  // (422) rather than silently returning a wrong page.
  const scope = `jobs:status=${query.status ?? ''};type=${query.type ?? ''}`
  const conditions: SQL[] = []

  if (query.status !== undefined) {
    conditions.push(eq(outboxJobs.status, query.status))
  }
  if (query.type !== undefined) {
    conditions.push(eq(outboxJobs.type, query.type))
  }

  if (query.cursor !== undefined && query.cursor !== '') {
    const cursorValues = decodeCursor(query.cursor, scope)
    if (cursorValues) {
      const cursorId = typeof cursorValues.id === 'number' ? cursorValues.id : NaN
      if (Number.isNaN(cursorId)) {
        throw ApiError.of('VALIDATION_ERROR', 'Malformed cursor values')
      }
      conditions.push(lt(outboxJobs.id, cursorId))
    }
  }

  const rows: JobView[] = await db
    .select(jobColumns)
    .from(outboxJobs)
    .where(and(...conditions))
    .orderBy(desc(outboxJobs.id))
    .limit(limit + 1)

  const pageResult = buildPage(
    rows,
    limit,
    (row) => ({ id: row.id }),
    scope,
  )

  return {
    jobs: pageResult.page,
    nextCursor: pageResult.nextCursor,
  }
}

/**
 * Queue health for the ops dashboard (spec §12.2): a zero-filled count per
 * status, plus `oldestPendingAgeSec` — how *overdue* the most overdue
 * `pending` job is:
 *
 *     TIMESTAMPDIFF(SECOND, MIN(available_at), NOW(3))  over status='pending'
 *
 * Two deliberate properties of that definition:
 *
 * - A job whose backoff scheduled it in the future (or the worker has not yet
 *   reached) contributes **0**, never a negative age: the number answers "how
 *   long has work been *waiting past its due moment*", so it is clamped with
 *   `Math.max(0, …)` rather than reporting scheduling slack as health.
 * - The report is an **alert signal, not a readiness check** (§12.2): `/ready`
 *   reflects DB reachability only, so a permanent failure cannot drain healthy
 *   containers behind a load balancer. A sustained non-zero age is what an
 *   operator alerts on.
 *
 * `null` means there is no pending row at all (nothing is backed up) — which
 * is a different, and better, state than "0 seconds overdue".
 */
export async function jobsSummary(
  actor: Actor,
): Promise<{ byStatus: Record<JobStatus, number>; oldestPendingAgeSec: number | null }> {
  await authorizeJobManage(actor)

  const counts = await db
    .select({ status: outboxJobs.status, total: count() })
    .from(outboxJobs)
    .groupBy(outboxJobs.status)

  const byStatus: Record<JobStatus, number> = {
    pending: 0,
    processing: 0,
    done: 0,
    failed: 0,
  }
  for (const row of counts) {
    byStatus[row.status] = Number(row.total)
  }

  const [oldest] = await db
    .select({
      ageSec: sql<number | string | null>`TIMESTAMPDIFF(SECOND, MIN(${outboxJobs.availableAt}), NOW(3))`,
    })
    .from(outboxJobs)
    .where(eq(outboxJobs.status, 'pending'))

  const value = oldest?.ageSec
  const oldestPendingAgeSec = value === null || value === undefined ? null : Math.max(0, Number(value))

  return { byStatus, oldestPendingAgeSec }
}

/**
 * Re-queues a `failed` job for the next worker pass: `status='pending'`,
 * `available_at=NOW(3)`, `attempts=0`, lease released. Safe because handlers
 * are idempotent (spec §8.6).
 *
 * `last_error` is deliberately **kept** (ruling R5): erasing the reason the
 * job failed would destroy the very evidence the ops screen exists to show,
 * and a retry that fails again overwrites it anyway.
 *
 * The write is a single guarded `UPDATE` (`WHERE id = ? AND status='failed'`),
 * so it can never resurrect a job the worker is currently processing or
 * overwrite a finished one — including when a retry races a worker pass. A
 * zero-row update is classified by re-reading the row: absent → `NOT_FOUND`,
 * otherwise `VALIDATION_ERROR` naming the current status. The refused row is
 * left untouched.
 */
export async function retryJob(actor: Actor, id: number): Promise<void> {
  await authorizeJobManage(actor)

  const [result] = await db
    .update(outboxJobs)
    .set({
      status: 'pending',
      availableAt: sql`NOW(3)`,
      attempts: 0,
      lockedAt: null,
      lockedBy: null,
    })
    .where(and(eq(outboxJobs.id, id), eq(outboxJobs.status, 'failed')))

  if (result.affectedRows === 0) {
    const [row] = await db
      .select({ status: outboxJobs.status })
      .from(outboxJobs)
      .where(eq(outboxJobs.id, id))
      .limit(1)

    if (!row) {
      throw ApiError.of('NOT_FOUND')
    }
    throw ApiError.of('VALIDATION_ERROR', `Only a failed job can be retried (job ${id} is ${row.status})`, {
      id,
      status: row.status,
    })
  }
}

/**
 * Enables or disables a user account (spec §7.1 `PATCH /admin/users/:id`).
 *
 * Admin-only on `actor.isAdmin` — this is an account-level action, not
 * work-item access, so no membership role grants it.
 *
 * Disabling also revokes every live refresh token in the same transaction:
 * login and `me` already refuse a disabled account, but an already-minted
 * refresh family would otherwise keep rotating for its full 30-day TTL. Doing
 * both writes in one transaction means there is no committed state in which
 * the account is disabled *and* a usable refresh token exists — the same
 * either-both-or-neither property the outbox buys for side effects.
 */
export async function setUserStatus(
  actor: Actor,
  userId: number,
  status: 'active' | 'disabled',
): Promise<void> {
  if (!actor.isAdmin) {
    throw ApiError.of('FORBIDDEN')
  }

  await withTransaction(async (tx) => {
    const [user] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)

    if (!user) {
      throw ApiError.of('NOT_FOUND')
    }

    await tx.update(users).set({ status }).where(eq(users.id, userId))

    if (status === 'disabled') {
      await revokeAllForUser(userId, tx)
    }
  })
}
