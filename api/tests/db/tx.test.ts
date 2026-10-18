import { describe, it, expect, vi, afterAll } from 'vitest'
import { withTransaction } from '../../src/db/tx'
import { closeDb } from '../../src/db/client'

function deadlock() { const e: any = new Error('Deadlock'); e.errno = 1213; return e }

describe('withTransaction', () => {
  it('retries a deadlock then succeeds', async () => {
    const fn = vi.fn<(tx: any) => Promise<string>>()
      .mockRejectedValueOnce(deadlock()).mockResolvedValueOnce('ok')
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
