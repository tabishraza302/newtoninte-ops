// Request validation, built on Zod.
//
// Handlers must never see raw `unknown` request input: every route runs its
// params, query and body through `parse` first and then works with typed data.
// We use `safeParse` rather than `schema.parse` so the failure path stays
// in-band and *every* schema failure maps onto the API's single 422
// `VALIDATION_ERROR`, instead of leaking a ZodError as a 500.

import { z } from 'zod'
import { ApiError } from './errors'

/**
 * Validates `value` against `schema`, returning the parsed result (coerced,
 * defaulted and stripped of unknown keys) on success.
 *
 * On failure it throws `VALIDATION_ERROR` with the underlying Zod issues as
 * `details`, so clients — and our tests — can see exactly which fields failed
 * without parsing a prose message.
 */
export function parse<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value)
  if (!result.success) {
    throw ApiError.of('VALIDATION_ERROR', 'invalid request', { issues: result.error.issues })
  }
  return result.data
}

/**
 * The `limit`/`cursor` query pair every list endpoint accepts.
 *
 * `limit` is coerced because query-string values always arrive as `string`s;
 * it is bounded to 1..100 (the plan's page cap) and defaults to 20 so a caller
 * that omits it still gets the standard page size. `cursor` stays an opaque
 * string here — `decodeCursor` owns validating what it contains.
 */
export const paginationSchema: z.ZodObject<{
  limit: z.ZodDefault<z.ZodNumber>
  cursor: z.ZodOptional<z.ZodString>
}> = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
})
