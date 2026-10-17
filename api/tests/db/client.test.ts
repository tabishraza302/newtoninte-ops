import { describe, it, expect, afterAll } from 'vitest'
const url = process.env.TEST_DATABASE_URL
describe.skipIf(!url)('db client', () => {
  it('runs SELECT 1', async () => {
    const { pool, closeDb } = await import('../../src/db/client')
    const [rows] = await pool.query('SELECT 1 AS one')
    expect((rows as any[])[0].one).toBe(1)
    await closeDb()
  })
})
