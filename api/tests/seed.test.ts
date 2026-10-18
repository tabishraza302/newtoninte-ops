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
  it('does not duplicate demo accounts, teams or items on rerun', async () => {
    const before = await runSeed(db)
    expect(await runSeed(db)).toEqual(before)
  })

  it('records a replayable baseline for each demo item without duplicating it on rerun', async () => {
    await runSeed(db)
    const [missing] = await pool.query(
      'SELECT w.id FROM work_items w LEFT JOIN activity_events a ON a.work_item_id=w.id WHERE a.id IS NULL',
    )
    expect(missing).toEqual([])
    const [mismatches] = await pool.query(`
      SELECT w.id FROM work_items w
      JOIN activity_events a ON a.work_item_id=w.id AND a.type='created'
      WHERE JSON_UNQUOTE(JSON_EXTRACT(a.metadata, '$.status')) <> w.status
         OR JSON_UNQUOTE(JSON_EXTRACT(a.metadata, '$.title')) <> w.title
         OR JSON_UNQUOTE(JSON_EXTRACT(a.metadata, '$.priority')) <> w.priority
         OR NOT (CAST(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(a.metadata, '$.assigneeId')), 'null') AS UNSIGNED) <=> w.assignee_id)
    `)
    expect(mismatches).toEqual([])
    const [before] = await pool.query('SELECT COUNT(*) AS count FROM activity_events')
    await runSeed(db)
    const [after] = await pool.query('SELECT COUNT(*) AS count FROM activity_events')
    expect(after).toEqual(before)
  })
})
