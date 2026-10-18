import { expect } from 'vitest'

/**
 * The keys a user object may carry in an API response: the `users` row minus
 * `password_hash`. Asserting the whole key set (rather than only that the hash
 * is absent) also fails if a newly added column starts escaping a `select()`
 * that returns a whole row.
 */
const PUBLIC_USER_KEYS = [
  'createdAt',
  'displayName',
  'email',
  'id',
  'isAdmin',
  'status',
  'updatedAt',
]

export function expectPublicUser(user: unknown): void {
  expect(Object.keys(user as object).sort()).toEqual(PUBLIC_USER_KEYS)
}
