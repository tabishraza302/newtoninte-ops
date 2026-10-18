import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { resetDb } from './helpers/db'
import { runSeed } from '../src/seed'
import { closeDb, db, pool } from '../src/db/client'

describe('seed', () => {
  beforeEach(resetDb); afterAll(closeDb)
  it('creates the demo teams, role users, and >=5000 items', async () => {
    const counts = await runSeed(db)
    expect(counts.teams).toBe(2); expect(counts.users).toBeGreaterThanOrEqual(4); expect(counts.items).toBeGreaterThanOrEqual(5000)
    const [rows] = await pool.query("SELECT COUNT(*) c FROM work_items WHERE status='open' AND priority IN ('high','urgent')")
    expect((rows as any[])[0].c).toBeGreaterThan(0)
  })
  it('is idempotent', async () => { await runSeed(db); expect((await runSeed(db)).items).toBeGreaterThanOrEqual(5000) })
})
