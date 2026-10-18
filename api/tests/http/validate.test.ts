import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { parse, paginationSchema } from '../../src/http/validate'
import { ApiError } from '../../src/http/errors'

describe('validate', () => {
  it('returns parsed data', () => {
    expect(parse(z.object({ a: z.number() }), { a: 1 })).toEqual({ a: 1 })
  })
  it('throws VALIDATION_ERROR with details', () => {
    try { parse(z.object({ a: z.number() }), { a: 'x' }); expect.unreachable() }
    catch (e) { expect(e).toBeInstanceOf(ApiError); expect((e as ApiError).code).toBe('VALIDATION_ERROR'); expect((e as ApiError).details).toBeTruthy() }
  })
  it('caps limit at 100 and defaults to 20', () => {
    expect(paginationSchema.parse({}).limit).toBe(20)
    expect(() => paginationSchema.parse({ limit: 1000 })).toThrow()
    expect(() => paginationSchema.parse({ limit: 0 })).toThrow()
  })
})
