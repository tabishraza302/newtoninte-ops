import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { migrate } from 'drizzle-orm/mysql2/migrator'
const url = process.env.TEST_DATABASE_URL
describe.skipIf(!url)('migrations', () => {
  it('creates every table', async () => {
    const { db, pool, closeDb } = await import('../../src/db/client')
    await migrate(db, { migrationsFolder: 'drizzle' })
    const [rows] = await pool.query(
      "SELECT table_name t FROM information_schema.tables WHERE table_schema = DATABASE()")
    const names = (rows as Array<{ t: string }>).map(r => r.t)
    for (const t of ['admin_audit_events','users','teams','memberships','membership_events','invitations',
      'refresh_tokens','password_reset_tokens','work_items','activity_events','comments',
      'notifications','outbox_jobs','idempotency_keys'])
      expect(names).toContain(t)
    await closeDb()
  })
})
