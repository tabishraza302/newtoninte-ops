import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { pool } from '../../src/db/client'
import { ApiError } from '../../src/http/errors'
import { requestHash, withIdempotency } from '../../src/services/idempotency'
import { resetDb, seedUser } from '../helpers/db'

describe('idempotency service', () => {
  beforeEach(resetDb)
  afterAll(async () => {
    // Keep pool open or clean up if needed
  })

  describe('requestHash', () => {
    it('is key-order-insensitive for objects but distinguishes different values', () => {
      const hash1 = requestHash({ a: 1, b: 2, c: { x: 'foo', y: [1, 2] } })
      const hash2 = requestHash({ b: 2, c: { y: [1, 2], x: 'foo' }, a: 1 })
      const hashDiff = requestHash({ a: 1, b: 3, c: { x: 'foo', y: [1, 2] } })

      expect(hash1).toBe(hash2)
      expect(hash1).not.toBe(hashDiff)
    })
  })

  describe('withIdempotency', () => {
    it('first call inserts + runs fn, second identical call returns cached result without running fn', async () => {
      const user = await seedUser()
      let callCount = 0

      const fn = async () => {
        callCount++
        return {
          status: 201,
          body: { id: 123, name: 'Task Alpha' },
          resourceId: 123,
        }
      }

      const res1 = await withIdempotency(
        user.id,
        'key-abc',
        'POST /items',
        { name: 'Task Alpha' },
        fn,
      )

      expect(callCount).toBe(1)
      expect(res1.status).toBe(201)
      expect(res1.body).toEqual({ id: 123, name: 'Task Alpha' })
      expect(res1.replayed).toBe(false)

      const [rows] = await pool.query(
        'SELECT id, user_id, `key`, endpoint, request_hash, response_status, response_body, resource_id, expires_at FROM idempotency_keys WHERE user_id = ?',
        [user.id],
      )
      const keyRows = rows as Array<{ id: number; key: string; response_status: number }>
      expect(keyRows).toHaveLength(1)
      expect(keyRows[0]?.key).toBe('key-abc')
      expect(keyRows[0]?.response_status).toBe(201)

      const res2 = await withIdempotency(
        user.id,
        'key-abc',
        'POST /items',
        { name: 'Task Alpha' },
        fn,
      )

      expect(callCount).toBe(1)
      expect(res2.status).toBe(201)
      expect(res2.body).toEqual({ id: 123, name: 'Task Alpha' })
      expect(res2.replayed).toBe(true)
    })

    it('same key with different body throws IDEMPOTENCY_KEY_MISMATCH (422)', async () => {
      const user = await seedUser()

      await withIdempotency(
        user.id,
        'key-mismatch',
        'POST /items',
        { title: 'Original' },
        async () => ({
          status: 200,
          body: { ok: true },
        }),
      )

      await expect(
        withIdempotency(
          user.id,
          'key-mismatch',
          'POST /items',
          { title: 'Different' },
          async () => ({
            status: 200,
            body: { ok: true },
          }),
        ),
      ).rejects.toThrow(ApiError)

      try {
        await withIdempotency(
          user.id,
          'key-mismatch',
          'POST /items',
          { title: 'Different' },
          async () => ({
            status: 200,
            body: { ok: true },
          }),
        )
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError)
        const apiErr = err as ApiError
        expect(apiErr.code).toBe('IDEMPOTENCY_KEY_MISMATCH')
        expect(apiErr.status).toBe(422)
      }
    })

    it('expired key row lets fresh call proceed and replaces the record', async () => {
      const user = await seedUser()
      let callCount = 0

      // First call with a key
      await withIdempotency(
        user.id,
        'key-expired',
        'POST /items',
        { val: 1 },
        async () => {
          callCount++
          return { status: 201, body: { v: 1 } }
        },
      )
      expect(callCount).toBe(1)

      // Manually backdate expires_at in DB
      await pool.query(
        "UPDATE idempotency_keys SET expires_at = '2000-01-01 00:00:00' WHERE user_id = ? AND `key` = ?",
        [user.id, 'key-expired'],
      )

      // Second call with same key but updated body
      const res = await withIdempotency(
        user.id,
        'key-expired',
        'POST /items',
        { val: 2 },
        async () => {
          callCount++
          return { status: 200, body: { v: 2 } }
        },
      )

      expect(callCount).toBe(2)
      expect(res.status).toBe(200)
      expect(res.body).toEqual({ v: 2 })
      expect(res.replayed).toBe(false)

      const [rows] = await pool.query(
        'SELECT id, request_hash, response_status, expires_at FROM idempotency_keys WHERE user_id = ? AND `key` = ?',
        [user.id, 'key-expired'],
      )
      const keyRows = rows as Array<{ id: number; response_status: number; expires_at: Date }>
      expect(keyRows).toHaveLength(1)
      expect(keyRows[0]?.response_status).toBe(200)
      expect(keyRows[0]?.expires_at.getTime()).toBeGreaterThan(Date.now())
    })
  })
})
