import { pool } from '../../src/db/client'

export * from './factory'

// The 12 application tables created by the schema (see src/db/schema.ts).
// Order is irrelevant because FOREIGN_KEY_CHECKS is disabled below.
// Drizzle's `__drizzle_migrations` journal is deliberately excluded: migrations
// are applied once by `globalSetup`, so the journal must survive `resetDb`.
// `TRUNCATE` resets `AUTO_INCREMENT`, so no separate counter reset is needed.
const TABLES = [
  'users',
  'teams',
  'memberships',
  'membership_events',
  'invitations',
  'refresh_tokens',
  'password_reset_tokens',
  'work_items',
  'activity_events',
  'comments',
  'outbox_jobs',
  'idempotency_keys',
] as const

/**
 * Empties every application table for a clean test, keeping the schema in place.
 *
 * `FOREIGN_KEY_CHECKS` is session-scoped, so the guard, the truncates, and the
 * reset all run on ONE connection — `pool.query` may otherwise route each
 * statement to a different pooled connection (see `src/db/reset.ts`).
 */
export async function resetDb(): Promise<void> {
  const conn = await pool.getConnection()
  try {
    await conn.query('SET FOREIGN_KEY_CHECKS = 0')
    for (const table of TABLES) {
      await conn.query(`TRUNCATE TABLE \`${table}\``)
    }
    await conn.query('SET FOREIGN_KEY_CHECKS = 1')
  } finally {
    conn.release()
  }
}
