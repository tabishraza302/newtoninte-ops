import { describe, it, expect, vi, afterAll } from 'vitest'
import { withTransaction, isRetryable } from '../../src/db/tx'
import { closeDb } from '../../src/db/client'

function deadlock() { const e: any = new Error('Deadlock'); e.errno = 1213; return e }

describe('isRetryable', () => {
  it('detects a raw driver error, with errno on the error itself', () => {
    expect(isRetryable({ errno: 1213 })).toBe(true)
    expect(isRetryable({ errno: 1205 })).toBe(true)
  })
  it('detects a driver error wrapped by drizzle, with errno on .cause', () => {
    // What `db.transaction` actually throws: the wrapper has no errno and the
    // driver fields live on `.cause`.
    expect(isRetryable({ errno: undefined, cause: { errno: 1213 } })).toBe(true)
    expect(isRetryable(Object.assign(new Error('wrapped'), { cause: { errno: 1205 } }))).toBe(true)
  })
  it('rejects non-retryable errors', () => {
    expect(isRetryable(new Error('boom'))).toBe(false)
    expect(isRetryable({ errno: 1406 })).toBe(false)
    expect(isRetryable({ errno: undefined, cause: { errno: 1406 } })).toBe(false)
    expect(isRetryable(undefined)).toBe(false)
  })
})

describe('withTransaction', () => {
  it('retries a deadlock then succeeds', async () => {
    const fn = vi.fn<(tx: any) => Promise<string>>()
      .mockRejectedValueOnce(deadlock()).mockResolvedValueOnce('ok')
    expect(await withTransaction(fn, { retries: 3 })).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(2)
  })
  it('retries a deadlock that arrives wrapped, with the driver fields on .cause', async () => {
    const wrapped = Object.assign(new Error('wrapped deadlock'), { cause: { errno: 1213 } })
    const fn = vi.fn<(tx: any) => Promise<string>>()
      .mockRejectedValueOnce(wrapped).mockResolvedValueOnce('ok')
    expect(await withTransaction(fn, { retries: 3 })).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(2)
  })
  it('does not retry a non-deadlock error', async () => {
    const fn = vi.fn<(tx: any) => Promise<string>>().mockRejectedValue(new Error('boom'))
    await expect(withTransaction(fn, { retries: 3 })).rejects.toThrow('boom')
    expect(fn).toHaveBeenCalledTimes(1)
  })
  it('gives up after the retry budget', async () => {
    const fn = vi.fn<(tx: any) => Promise<string>>().mockRejectedValue(deadlock())
    await expect(withTransaction(fn, { retries: 2 })).rejects.toMatchObject({ errno: 1213 })
    expect(fn).toHaveBeenCalledTimes(3)
  })
})

afterAll(async () => {
  await closeDb()
})
