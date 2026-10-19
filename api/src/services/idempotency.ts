import { and, eq, sql } from 'drizzle-orm'
import { config } from '../config'
import { idempotencyKeys } from '../db/schema'
import { withTransaction, type Tx } from '../db/tx'
import { ApiError } from '../http/errors'
import { sha256 } from './crypto'

/**
 * Deterministically canonicalizes JSON (keys sorted recursively) and returns SHA-256 hex hash.
 */
export function requestHash(body: unknown): string {
  return sha256(canonicalizeJson(body))
}

function canonicalizeJson(val: unknown): string {
  if (val === null || typeof val !== 'object') {
    return JSON.stringify(val) ?? 'null'
  }

  if (Array.isArray(val)) {
    const items = val.map((item) => canonicalizeJson(item))
    return `[${items.join(',')}]`
  }

  const obj = val as Record<string, unknown>
  const sortedKeys = Object.keys(obj).sort()
  const entries: string[] = []
  for (const k of sortedKeys) {
    const v = obj[k]
    if (v !== undefined) {
      entries.push(`${JSON.stringify(k)}:${canonicalizeJson(v)}`)
    }
  }
  return `{${entries.join(',')}}`
}

export interface IdempotencyResult<T> {
  status: number
  body: T
  replayed: boolean
}

export interface IdempotencyHandlerResult<T> {
  status: number
  body: T
  resourceId?: number
}
function isDupEntry(err: unknown): boolean {
  const errno = (err as { errno?: unknown } | null | undefined)?.errno
  const cause = (err as { cause?: unknown } | null | undefined)?.cause
  const causeErrno = (cause as { errno?: unknown } | null | undefined)?.errno
  const code = (err as { code?: unknown } | null | undefined)?.code
  const causeCode = (cause as { code?: unknown } | null | undefined)?.code
  return (
    errno === 1062 ||
    causeErrno === 1062 ||
    code === 'ER_DUP_ENTRY' ||
    causeCode === 'ER_DUP_ENTRY'
  )
}

/**
 * Executes `fn` with idempotency guarantees within a transaction.
 */
export async function withIdempotency<T>(
  actorId: number,
  key: string,
  endpoint: string,
  body: unknown,
  fn: (tx: Tx) => Promise<IdempotencyHandlerResult<T>>,
  authorize?: (tx: Tx) => Promise<void>,
): Promise<IdempotencyResult<T>> {
  if (!key || typeof key !== 'string' || key.trim().length === 0 || key.length > 255) {
    throw ApiError.of('VALIDATION_ERROR', 'Idempotency key must be between 1 and 255 characters')
  }

  const currentHash = requestHash(body)
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await withTransaction(async (tx) => {
        const [existing] = await tx
          .select()
          .from(idempotencyKeys)
          .where(and(eq(idempotencyKeys.userId, actorId), eq(idempotencyKeys.key, key)))
          .for('update')

        if (existing) {
          const now = new Date()
          const isExpired = existing.expiresAt.getTime() <= now.getTime()

          if (!isExpired) {
            if (existing.endpoint !== endpoint || existing.requestHash !== currentHash) {
              throw ApiError.of('IDEMPOTENCY_KEY_MISMATCH')
            }
            if (authorize) {
              await authorize(tx)
            }
            return {
              status: existing.responseStatus,
              body: existing.responseBody as T,
              replayed: true,
            }
          }

          await tx
            .delete(idempotencyKeys)
            .where(eq(idempotencyKeys.id, existing.id))
        }
        if (authorize) {
          await authorize(tx)
        }

        const res = await fn(tx)

        const ttlSec = config.idempotencyTtlSec
        const expiresAt = new Date(Date.now() + ttlSec * 1000)

        await tx.insert(idempotencyKeys).values({
          userId: actorId,
          key,
          endpoint,
          requestHash: currentHash,
          responseStatus: res.status,
          responseBody: res.body,
          resourceId: res.resourceId ?? null,
          expiresAt,
        })

        const [insertedRow] = await tx
          .select({ responseBody: idempotencyKeys.responseBody })
          .from(idempotencyKeys)
          .where(and(eq(idempotencyKeys.userId, actorId), eq(idempotencyKeys.key, key)))
          .limit(1)

        return {
          status: res.status,
          body: (insertedRow?.responseBody as T) ?? res.body,
          replayed: false,
        }
      })
    } catch (err: unknown) {
      if (isDupEntry(err) && attempt < 4) {
        const { promise, resolve } = Promise.withResolvers<void>()
        setTimeout(resolve, 10 * (attempt + 1) + Math.random() * 20)
        await promise
        continue
      }
      throw err
    }
  }
  throw new Error('unreachable')
}
