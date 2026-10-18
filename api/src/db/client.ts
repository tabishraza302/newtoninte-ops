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

export const db: MySql2Database<typeof schema> = drizzle(pool, { schema, mode: 'default' })

/** Closes the pool — used by tests to let the process exit cleanly. */
export async function closeDb(): Promise<void> {
  await pool.end()
}
