/**
 * Vitest global setup — runs once in vitest's main process, before any worker.
 *
 * `src/config.ts` reads `process.env` at import time, and vitest's `test.env`
 * only reaches the workers, so the test database URL has to be installed here
 * before `src/db/migrate` (and therefore `src/db/client`) is imported.
 */
export default async function setup(): Promise<void> {
  const testDatabaseUrl = process.env.TEST_DATABASE_URL
  if (testDatabaseUrl === undefined || testDatabaseUrl.trim() === '') {
    throw new Error('TEST_DATABASE_URL must be set to run the api test suite')
  }
  process.env.DATABASE_URL = testDatabaseUrl
  // `src/config.ts` validates on import, and this process is out of reach of
  // vitest's `test.env`, so the settings it requires need a default here too.
  // Keep in sync with the `env` block in vitest.config.ts.
  process.env.JWT_SECRET ??= 'test-secret'

  const { runMigrations } = await import('../src/db/migrate')
  await runMigrations()

  // Close the pool this process opened so vitest can exit cleanly.
  const { closeDb } = await import('../src/db/client')
  await closeDb()
}
