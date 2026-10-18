import { db } from './client'

/** Transaction handle passed to `withTransaction` callbacks (Drizzle MySQL transaction). */
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

const RETRYABLE_ERRNOS = new Set([1213, 1205]) // deadlock, lock wait timeout

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Runs `fn` inside a transaction, retrying on MySQL deadlock (1213) and
 * lock wait timeout (1205) with small jittered backoff. Any other error
 * rethrows immediately.
 */
export async function withTransaction<T>(
  fn: (tx: Tx) => Promise<T>,
  opts?: { retries?: number }
): Promise<T> {
  const retries = opts?.retries ?? 3
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await db.transaction(fn)
    } catch (err: any) {
      if (RETRYABLE_ERRNOS.has(err?.errno) && attempt < retries) {
        await sleep(2 ** attempt * 5 + Math.floor(Math.random() * 20))
        continue
      }
      throw err
    }
  }
  throw new Error('unreachable')
}
