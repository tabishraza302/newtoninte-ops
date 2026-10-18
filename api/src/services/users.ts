import { users, type UserRow } from '../db/schema'

/**
 * The explicit column list for a user as the API returns it: every `users`
 * column except `password_hash`. `db.select()` would spread the hash into the
 * response, so the omission has to be stated column by column - the same rule
 * `jobColumns` follows for outbox payloads in `services/jobs.ts`.
 */
export const publicUserColumns = {
  id: users.id,
  email: users.email,
  displayName: users.displayName,
  isAdmin: users.isAdmin,
  status: users.status,
  createdAt: users.createdAt,
  updatedAt: users.updatedAt,
} as const

export type PublicUser = Omit<UserRow, 'passwordHash'>

/** Drops `password_hash` from a whole row - for the paths that must read it (password checks). */
export function toPublicUser(row: UserRow): PublicUser {
  const { passwordHash, ...user } = row
  return user
}
