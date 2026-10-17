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
  await pool.query('SET FOREIGN_KEY_CHECKS = 0')
  try {
    for (const table of TABLES) {
      await pool.query(`DROP TABLE IF EXISTS \`${table}\``)
    }
  } finally {
    await pool.query('SET FOREIGN_KEY_CHECKS = 1')
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
