import { migrate } from 'drizzle-orm/mysql2/migrator'
import { db, closeDb } from './client'

// Resolve the checked-in migration folder relative to this module so the
// script works regardless of the process working directory.
const migrationsFolder = new URL('../../drizzle', import.meta.url).pathname

/** Applies every pending migration in `api/drizzle` to the configured database. */
export async function runMigrations(): Promise<void> {
  await migrate(db, { migrationsFolder })
}

if (import.meta.main) {
  try {
    await runMigrations()
    console.log('migrations applied')
  } finally {
    await closeDb()
  }
}
