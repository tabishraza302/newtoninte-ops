import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { resetDb } from '../helpers/db'
import { closeDb, pool } from '../../src/db/client'
import { withTransaction } from '../../src/db/tx'
import { enqueue } from '../../src/services/outbox'

/** `dedupe_key` is globally unique, so every case uses its own key (and `resetDb` clears between). */
const KEY_DUPLICATE = 'test-outbox-duplicate'
const KEY_DISTINCT_A = 'test-outbox-distinct-a'
const KEY_DISTINCT_B = 'test-outbox-distinct-b'
const KEY_CLOCK = 'test-outbox-clock'
const KEY_PAYLOAD = 'test-outbox-payload'

/** The row shape these assertions care about, with the JSON payload normalised. */
interface OutboxRow {
  type: string
  payload: unknown
  status: string
  attempts: number
  locked_by: string | null
  available_at: Date
}

async function outboxCount(): Promise<number> {
  const [rows] = await pool.query('SELECT COUNT(*) AS c FROM outbox_jobs')
  return (rows as { c: number }[])[0]!.c
}

async function readRow(dedupeKey: string): Promise<OutboxRow> {
  const [rows] = await pool.query(
    'SELECT type, payload, status, attempts, locked_by, available_at FROM outbox_jobs WHERE dedupe_key = ?',
    [dedupeKey],
  )
  const row = (rows as (Omit<OutboxRow, 'payload'> & { payload: unknown })[])[0]!
  // The driver may hand back either the raw JSON text or an already-parsed
  // value depending on the server; normalise before comparing.
  const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload
  return { ...row, payload }
}

describe('outbox.enqueue', () => {
  beforeEach(resetDb)
  afterAll(closeDb)

  it('makes a repeat dedupeKey a genuine no-op, preserving payload, type and claim state', async () => {
    const payloadA = { inviteId: 1, marker: 'A' }
    const payloadB = { inviteId: 999, marker: 'B' }

    await withTransaction(async (tx) => {
      await enqueue(tx, { type: 'email.invite', payload: payloadA, dedupeKey: KEY_DUPLICATE })
    })

    // Emulate an in-flight job claimed by a worker, so the second enqueue has
    // mutable state it could wrongly clobber.
    await pool.query(
      "UPDATE outbox_jobs SET status='processing', attempts=3, locked_by='probe' WHERE dedupe_key = ?",
      [KEY_DUPLICATE],
    )
    const before = await readRow(KEY_DUPLICATE)

    // Same key, deliberately different payload and type: a last-write-wins
    // merge (e.g. `set: { payload: values(payload) }`) would overwrite the row
    // and still leave COUNT === 1.
    await withTransaction(async (tx) => {
      await enqueue(tx, { type: 'email.reset', payload: payloadB, dedupeKey: KEY_DUPLICATE })
    })

    expect(await outboxCount()).toBe(1)
    const after = await readRow(KEY_DUPLICATE)
    expect(after.payload).toEqual(payloadA)
    expect(after.type).toBe('email.invite')
    expect(after.available_at.getTime()).toBe(before.available_at.getTime())
    // A no-op must not resurrect or reset a claimed job.
    expect(after.status).toBe('processing')
    expect(after.attempts).toBe(3)
    expect(after.locked_by).toBe('probe')
  })

  it('keeps rows with different dedupeKeys distinct', async () => {
    await withTransaction(async (tx) => {
      await enqueue(tx, { type: 'email.invite', payload: { inviteId: 2 }, dedupeKey: KEY_DISTINCT_A })
      await enqueue(tx, { type: 'email.reset', payload: { userId: 3 }, dedupeKey: KEY_DISTINCT_B })
    })
    expect(await outboxCount()).toBe(2)
  })

  it('inserts a pending row whose available_at matches the app clock', async () => {
    await withTransaction(async (tx) => {
      await enqueue(tx, { type: 'email.assigned', payload: { workItemId: 7 }, dedupeKey: KEY_CLOCK })
    })

    // Compare the JS-read value against Node's own clock, not against the
    // server's NOW(3) parsed by the same driver: a shared timezone error would
    // shift both and pass. A one-hour-or-worse zone mistake (e.g. the session
    // pinned to SYSTEM/IST while mysql2 parses as UTC) exceeds this 60s window
    // and fails loudly, while ordinary clock drift is tolerated.
    const readAt = Date.now()
    const job = await readRow(KEY_CLOCK)
    expect(job.status).toBe('pending')
    expect(Math.abs(job.available_at.getTime() - readAt)).toBeLessThan(60_000)
  })

  it('round-trips an arbitrary JSON payload', async () => {
    const payload = { inviteId: 42, nested: { tags: ['a', 'b'], ok: true } }
    await withTransaction(async (tx) => {
      await enqueue(tx, { type: 'email.invite', payload, dedupeKey: KEY_PAYLOAD })
    })

    const row = await readRow(KEY_PAYLOAD)
    expect(row.payload).toEqual(payload)
  })
})
