import { describe, it, expect } from 'vitest'
import { encodeCursor, decodeCursor, buildPage, MAX_LIMIT, DEFAULT_LIMIT } from '../../src/http/cursor'
import { ApiError } from '../../src/http/errors'

/** Asserts `fn` raises a 422 VALIDATION_ERROR, the only failure mode cursor misuse may have. */
function expectValidationError(fn: () => unknown): void {
  let caught: unknown
  try {
    fn()
  } catch (err) {
    caught = err
  }
  expect(caught).toBeInstanceOf(ApiError)
  expect((caught as ApiError).code).toBe('VALIDATION_ERROR')
  expect((caught as ApiError).status).toBe(422)
}

describe('cursor', () => {
  it('round-trips', () => {
    const c = encodeCursor({ id: 42, priority: 'high' })
    expect(decodeCursor(c)).toEqual({ id: 42, priority: 'high' })
  })
  it('rejects a malformed cursor', () => {
    expect(() => decodeCursor('not-base64!!')).toThrow(ApiError)
  })
  it('returns a next cursor only when a full page plus one arrived', () => {
    const rows = [1, 2, 3]
    const p = buildPage(rows, 2, r => ({ id: r }))
    expect(p.page).toEqual([1, 2]); expect(p.nextCursor).not.toBeNull()
    const q = buildPage([1, 2], 2, r => ({ id: r }))
    expect(q.page).toEqual([1, 2]); expect(q.nextCursor).toBeNull()
  })
})

// Review Focus #5 — cursor misuse must fail loudly (422), never silently return a
// wrong or unbounded page: malformed cursors, foreign-scope cursors, bad limits.
describe('cursor hardening', () => {
  it('has no cursor for an absent one', () => {
    expect(decodeCursor(undefined)).toBeNull()
    expect(decodeCursor('')).toBeNull()
  })

  it('rejects every malformed cursor shape with VALIDATION_ERROR', () => {
    // Not base64url / not JSON / valid base64url of the wrong JSON shape.
    expectValidationError(() => decodeCursor('not-base64!!'))
    expectValidationError(() => decodeCursor('%%%%'))
    expectValidationError(() => decodeCursor(encode('hello')))
    expectValidationError(() => decodeCursor(encode('42')))
    expectValidationError(() => decodeCursor(encode('null')))
    expectValidationError(() => decodeCursor(encode('[1,2,3]')))
    expectValidationError(() => decodeCursor(encode('{}')))
    // `values` must be a non-empty map of string | number | null.
    expectValidationError(() => decodeCursor(encode(JSON.stringify({ values: {} }))))
    expectValidationError(() => decodeCursor(encode(JSON.stringify({ values: [] }))))
    expectValidationError(() => decodeCursor(encode(JSON.stringify({ values: { id: true } }))))
    expectValidationError(() => decodeCursor(encode(JSON.stringify({ values: { id: { nested: 1 } } }))))
    expectValidationError(() => decodeCursor(encode(JSON.stringify({ scope: 'x' }))))
  })

  it('rejects non-base64url characters appended to an otherwise valid cursor', () => {
    const cursor = encodeCursor({ id: 7 }, 'items')
    for (const suffix of ['!!!', '\n', ' ', '=']) {
      expectValidationError(() => decodeCursor(cursor + suffix, 'items'))
    }
  })

  it('rejects a cursor replayed under a different scope', () => {
    const cursor = encodeCursor({ id: 7, priority: 'high' }, 'team=3;view=overdue')
    // Same scope: accepted.
    expect(decodeCursor(cursor, 'team=3;view=overdue')).toEqual({ id: 7, priority: 'high' })
    // Different scope: loud 422, never a silent restart from row one.
    expectValidationError(() => decodeCursor(cursor, 'team=4;view=overdue'))
    expectValidationError(() => decodeCursor(cursor, 'team=3;view=all'))
    expectValidationError(() => decodeCursor(cursor, ''))
    // A scoped cursor replayed against an unscoped query is also a mismatch.
    expectValidationError(() => decodeCursor(cursor, undefined))
  })

  it('binds the nextCursor it issues to the current scope', () => {
    const p = buildPage([1, 2, 3], 2, r => ({ id: r }), 'team=3;view=overdue')
    expect(p.page).toEqual([1, 2])
    expect(p.nextCursor).not.toBeNull()
    expect(decodeCursor(p.nextCursor ?? undefined, 'team=3;view=overdue')).toEqual({ id: 2 })
    expectValidationError(() => decodeCursor(p.nextCursor ?? undefined, 'team=99'))
  })

  it('rejects a limit outside 1..100 with VALIDATION_ERROR', () => {
    expectValidationError(() => buildPage([], 0, r => ({ id: r })))
    expectValidationError(() => buildPage([], -1, r => ({ id: r })))
    expectValidationError(() => buildPage([], MAX_LIMIT + 1, r => ({ id: r })))
    expectValidationError(() => buildPage([], 1000, r => ({ id: r })))
    expectValidationError(() => buildPage([], 2.5, r => ({ id: r })))
    expectValidationError(() => buildPage([], Number.NaN, r => ({ id: r })))
    // The boundaries themselves are legal.
    expect(buildPage([], 1, r => ({ id: r })).nextCursor).toBeNull()
    expect(buildPage([], MAX_LIMIT, r => ({ id: r })).nextCursor).toBeNull()
  })

  it('defaults the page size to 20 when the caller omits a limit', () => {
    expect(DEFAULT_LIMIT).toBe(20)
    const rows = Array.from({ length: 21 }, (_, i) => i + 1)
    const p = buildPage(rows, undefined, r => ({ id: r }))
    expect(p.page).toHaveLength(DEFAULT_LIMIT)
    expect(p.nextCursor).not.toBeNull()
  })

  it('drops any rows beyond limit + 1 and keys the cursor off the last kept row', () => {
    const p = buildPage([1, 2, 3, 4, 5], 2, r => ({ id: r }))
    expect(p.page).toEqual([1, 2])
    expect(decodeCursor(p.nextCursor ?? undefined)).toEqual({ id: 2 })
  })

  it('returns no nextCursor for an empty page', () => {
    const p = buildPage([], 20, r => ({ id: r }))
    expect(p.page).toEqual([])
    expect(p.nextCursor).toBeNull()
  })
})

/** Base64url-encodes raw text, bypassing `encodeCursor`, to forge malformed cursors. */
function encode(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64url')
}
