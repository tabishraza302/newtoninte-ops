import { afterAll, describe, expect, it } from 'vitest'
import { closeDb, pool } from '../../src/db/client'
import { resetDatabase } from '../../src/db/reset'
import { resetDb } from '../helpers/db'

// Fail before any destructive statement executes, then inspect the real session
// returned to the pool. A subsequent borrower must still have FK enforcement.
describe('failed database resets', () => {
  afterAll(closeDb)

  it.each([
    ['test reset', resetDb],
    ['development reset', resetDatabase],
  ] as const)('%s restores foreign-key enforcement after a statement fails', async (_name, reset) => {
    const connection = await pool.getConnection()
    const query = connection.query.bind(connection)
    const getConnection = pool.getConnection.bind(pool)
    connection.query = ((...args: Parameters<typeof query>) => {
      if (/^(TRUNCATE|DROP)/.test(String(args[0]))) {
        return Promise.reject(new Error('forced reset failure'))
      }
      return query(...args)
    }) as typeof connection.query
    pool.getConnection = async () => connection
    try {
      await expect(reset()).rejects.toThrow('forced reset failure')
      // No second pool acquisition: query the exact session reset just released.
      const [rows] = await query('SELECT @@FOREIGN_KEY_CHECKS AS enabled')
      expect(rows).toEqual([{ enabled: 1 }])
    } finally {
      connection.query = query
      pool.getConnection = getConnection
      await query('SET FOREIGN_KEY_CHECKS = 1')
    }
  })
})
