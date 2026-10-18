import { drizzle, type MySql2Database } from 'drizzle-orm/mysql2'
import mysql from 'mysql2/promise'
import { config } from '../config'
import * as schema from './schema'

export const pool: mysql.Pool = mysql.createPool({
  uri: config.databaseUrl,
  connectionLimit: 10,
  timezone: 'Z',
  dateStrings: false,
})

// `timezone: 'Z'` only tells mysql2 how to *parse* the `datetime` values it
// reads (as UTC); it does not change the server session's zone. On a server
// whose session zone is SYSTEM/IST, a DB-computed value such as the
// `CURRENT_TIMESTAMP(3)` default on `created_at`/`available_at` is therefore
// local wall-clock, and parsing it as UTC lands every DB-written timestamp
// hours in the future. Pinning each pooled connection's session zone to UTC
// makes the server's clock and mysql2's parsing agree. The callback fires once
// per connection at creation, and mysql2 queues the SET ahead of that
// connection's first user query, so no query can observe the unset zone. The
// promise is dropped with `void` on purpose: a connection that cannot set its
// zone will fail loudly on the real query anyway, and discarding it avoids an
// unhandled rejection from this fire-and-forget handler.
pool.on('connection', (conn) => {
  void conn.query("SET time_zone = '+00:00'")
})

export const db: MySql2Database<typeof schema> = drizzle(pool, { schema, mode: 'default' })

/** Closes the pool — used by tests to let the process exit cleanly. */
export async function closeDb(): Promise<void> {
  await pool.end()
}
