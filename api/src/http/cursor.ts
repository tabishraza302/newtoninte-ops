// Keyset ("cursor") pagination primitives.
//
// The API pages with keyset cursors only — never `OFFSET *` — because offset
// paging silently skips or duplicates rows when the underlying set changes
// between pages (the stability the plan requires of `/items` and the timeline).
//
// A cursor is an opaque, base64url-encoded JSON payload:
//
//     { "values": { ...keyset tuple... }, "scope": "<fingerprint>" }
//
// `values` is the last row of the previous page, echoed back into the next
// query as `WHERE (tuple) < (values)`. `scope` is an opaque fingerprint of the
// *filter set* the cursor was issued for (e.g. `team=3;view=overdue`). Paging a
// narrowed list with a cursor minted for a different list would silently return
// a wrong page, so a scope mismatch is rejected loudly (422) rather than
// restarting from the beginning.

import { ApiError } from './errors'

/** The keyset tuple carried by a cursor: the last row of the previous page. */
export type CursorValues = Record<string, string | number | null>

/** Pages default to 20 rows; the plan caps every list at 100. */
export const DEFAULT_LIMIT = 20
export const MAX_LIMIT = 100

/**
 * An invalid cursor or limit is *user input* that failed validation, so it is a
 * 422 `VALIDATION_ERROR` — never a 500 and never a silent fallback.
 */
function invalid(details: unknown, message: string): ApiError {
  return ApiError.of('VALIDATION_ERROR', message, details)
}

/** The JSON shape that actually travels inside a cursor. */
type CursorPayload = { values: CursorValues; scope: string }

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isCursorValue(value: unknown): value is string | number | null {
  if (value === null) return true
  if (typeof value === 'string') return true
  return typeof value === 'number' && Number.isFinite(value)
}

/**
 * Validates a decoded payload. Anything that is not a non-empty map of
 * `string | number | null` (plus an optional scope string) is malformed: an
 * empty tuple would produce a keyset predicate with no bounds and an unbounded
 * page, so it is rejected too.
 */
function parsePayload(decoded: unknown): CursorPayload {
  if (!isPlainObject(decoded)) throw invalid(decoded, 'Malformed cursor')

  const scope = decoded.scope
  if (scope !== undefined && typeof scope !== 'string') {
    throw invalid(scope, 'Malformed cursor')
  }

  const values = decoded.values
  if (!isPlainObject(values)) throw invalid(values, 'Malformed cursor')
  const entries = Object.entries(values)
  if (entries.length === 0) throw invalid(values, 'Malformed cursor: empty keyset tuple')
  for (const [key, value] of entries) {
    if (!isCursorValue(value)) throw invalid({ [key]: value }, 'Malformed cursor: bad keyset value')
  }

  return { values: values as CursorValues, scope: scope ?? '' }
}

/**
 * Mints an opaque cursor for the last row of a page.
 *
 * `scope` is the caller's filter fingerprint; pass the same value to
 * `decodeCursor` on the next request so a cursor cannot be replayed against a
 * different filter set.
 */
export function encodeCursor(values: Record<string, string | number | null>, scope?: string): string {
  const payload: CursorPayload = { values, scope: scope ?? '' }
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
}

/**
 * Decodes a cursor, or returns `null` when none was supplied (`undefined`/`''`).
 *
 * Throws `VALIDATION_ERROR` (422) when the cursor is malformed *or* when its
 * embedded scope differs from `scope` — the fingerprint of the query it is
 * being replayed against (defaulting to the empty scope). This is the loud
 * failure Review Focus #5 requires: a cursor from another list must never be
 * silently honoured.
 */
export function decodeCursor(
  cursor: string | undefined,
  scope?: string,
): Record<string, string | number | null> | null {
  if (cursor === undefined || cursor === '') return null

  let json: string
  try {
    json = Buffer.from(cursor, 'base64url').toString('utf8')
  } catch {
    throw invalid(cursor, 'Malformed cursor')
  }

  let decoded: unknown
  try {
    decoded = JSON.parse(json)
  } catch {
    throw invalid(cursor, 'Malformed cursor')
  }

  const payload = parsePayload(decoded)
  if (payload.scope !== (scope ?? '')) {
    // Deliberately no `details`: echoing either fingerprint would hand a caller
    // the very value they would need to forge a cursor for another list.
    throw invalid(undefined, 'Cursor was issued for a different query')
  }

  return payload.values
}

/**
 * Builds one page from the `limit + 1` rows the caller fetched (fetching one
 * extra row is how we learn whether another page exists without a second
 * count query).
 *
 * If more than `limit` rows arrived, the extra row is dropped and `nextCursor`
 * is minted from the last *kept* row; otherwise `nextCursor` is `null`.
 */
export function buildPage<T>(
  rows: T[],
  limit: number = DEFAULT_LIMIT,
  mapCursor: (row: T) => Record<string, string | number | null>,
  scope?: string,
): { page: T[]; nextCursor: string | null } {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw invalid({ limit }, `limit must be an integer between 1 and ${MAX_LIMIT}`)
  }

  if (rows.length <= limit) return { page: rows, nextCursor: null }

  const page = rows.slice(0, limit)
  // `page` has exactly `limit` (>= 1) entries here, so its last element exists.
  const last = page[limit - 1] as T
  return { page, nextCursor: encodeCursor(mapCursor(last), scope) }
}
