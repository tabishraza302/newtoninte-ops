import { pool, closeDb } from './client'
import { runMigrations } from './migrate'

// Every table created by the schema, plus Drizzle's own migration journal.
// Dropped child-first is unnecessary because FOREIGN_KEY_CHECKS is disabled.
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
  '__drizzle_migrations',
]

/**
 * Drops every application table (and Drizzle's migration journal) from the
 * configured database, then re-applies every migration from scratch. This is
 * a destructive dev-only helper — point `DATABASE_URL` at the dev database.
 */
export async function resetDatabase(): Promise<void> {
  // `FOREIGN_KEY_CHECKS` is session-scoped, so the guard, the drops, and the
  // reset must all run on ONE connection — `pool.query` may otherwise route
  // each statement to a different pooled connection.
  const conn = await pool.getConnection()
  try {
    await conn.query('SET FOREIGN_KEY_CHECKS = 0')
    for (const table of TABLES) {
      await conn.query(`DROP TABLE IF EXISTS \`${table}\``)
    }
  } finally {
    try {
      await conn.query('SET FOREIGN_KEY_CHECKS = 1')
      conn.release()
    } catch (error) {
      conn.destroy()
      throw error
    }
  }
  await runMigrations()
}

if (import.meta.main) {
  try {
    await resetDatabase()
    console.log('database reset')
  } finally {
    await closeDb()
  }
}
