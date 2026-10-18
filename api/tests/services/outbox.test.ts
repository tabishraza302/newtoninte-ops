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

async function outboxCount(): Promise<number> {
  const [rows] = await pool.query('SELECT COUNT(*) AS c FROM outbox_jobs')
  return (rows as { c: number }[])[0]!.c
}

describe('outbox.enqueue', () => {
  beforeEach(resetDb)
  afterAll(closeDb)

  it('collapses a repeated dedupeKey inside one transaction to a single row', async () => {
    await withTransaction(async (tx) => {
      await enqueue(tx, { type: 'email.invite', payload: { inviteId: 1 }, dedupeKey: KEY_DUPLICATE })
      // A repeat inside the same transaction must be a no-op, not an error and
      // not an update.
      await enqueue(tx, { type: 'email.invite', payload: { inviteId: 1 }, dedupeKey: KEY_DUPLICATE })
    })
    expect(await outboxCount()).toBe(1)
  })

  it('keeps rows with different dedupeKeys distinct', async () => {
    await withTransaction(async (tx) => {
      await enqueue(tx, { type: 'email.invite', payload: { inviteId: 2 }, dedupeKey: KEY_DISTINCT_A })
      await enqueue(tx, { type: 'email.reset', payload: { userId: 3 }, dedupeKey: KEY_DISTINCT_B })
    })
    expect(await outboxCount()).toBe(2)
  })

  it('inserts a pending row whose available_at tracks the database clock', async () => {
    await withTransaction(async (tx) => {
      await enqueue(tx, { type: 'email.assigned', payload: { workItemId: 7 }, dedupeKey: KEY_CLOCK })
    })

    // Compare against the database's own NOW(3), never Node's clock: the point
    // is that available_at is computed server-side rather than hard-coded.
    const [clockRows] = await pool.query('SELECT NOW(3) AS now')
    const dbNow = (clockRows as { now: Date }[])[0]!.now

    const [jobRows] = await pool.query(
      'SELECT status, available_at FROM outbox_jobs WHERE dedupe_key = ?',
      [KEY_CLOCK],
    )
    const job = (jobRows as { status: string; available_at: Date }[])[0]!
    expect(job.status).toBe('pending')
    expect(Math.abs(job.available_at.getTime() - dbNow.getTime())).toBeLessThan(3000)
  })

  it('round-trips an arbitrary JSON payload', async () => {
    const payload = { inviteId: 42, nested: { tags: ['a', 'b'], ok: true } }
    await withTransaction(async (tx) => {
      await enqueue(tx, { type: 'email.invite', payload, dedupeKey: KEY_PAYLOAD })
    })

    const [rows] = await pool.query('SELECT payload FROM outbox_jobs WHERE dedupe_key = ?', [
      KEY_PAYLOAD,
    ])
    const raw = (rows as { payload: unknown }[])[0]!.payload
    // The driver may hand back either the raw JSON text or an already-parsed
    // value depending on the server; normalise before comparing.
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    expect(parsed).toEqual(payload)
  })
})
