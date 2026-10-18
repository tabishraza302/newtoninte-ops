import { db } from './client'

/** Transaction handle passed to `withTransaction` callbacks (Drizzle MySQL transaction). */
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

const RETRYABLE_ERRNOS = new Set([1213, 1205]) // deadlock, lock wait timeout

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Reads `err.errno` when it is present and numeric. */
function errorNumber(err: unknown): number | undefined {
  const errno = (err as { errno?: unknown } | null | undefined)?.errno
  return typeof errno === 'number' ? errno : undefined
}

/** Reads `err.cause` from an object-shaped error. */
function causeOf(err: unknown): unknown {
  return typeof err === 'object' && err !== null ? (err as { cause?: unknown }).cause : undefined
}

/**
 * True when `err` is a MySQL deadlock (1213) or lock-wait timeout (1205).
 *
 * Drizzle wraps errors raised inside a transaction: the raw mysql2 driver
 * fields (`errno`, `code`) end up on `err.cause`, while the wrapper thrown out
 * of `db.transaction` has `errno === undefined`. (The same error raised through
 * `pool.query` outside a transaction is not wrapped.) Checking both the error
 * and its cause is therefore required for the retry below to be reachable at
 * all.
 */
export function isRetryable(err: unknown): boolean {
  return [errorNumber(err), errorNumber(causeOf(err))].some(
    (errno) => errno !== undefined && RETRYABLE_ERRNOS.has(errno),
  )
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
    } catch (err: unknown) {
      if (isRetryable(err) && attempt < retries) {
        await sleep(2 ** attempt * 5 + Math.floor(Math.random() * 20))
        continue
      }
      throw err
    }
  }
  throw new Error('unreachable')
}
