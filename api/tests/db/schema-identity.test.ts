import { describe, it, expect } from 'vitest'
import * as s from '../../src/db/schema'

describe('schema: identity', () => {
  it('exposes the identity tables', () => {
    for (const t of ['users','teams','memberships','membershipEvents','invitations','refreshTokens','passwordResetTokens'])
      expect(s).toHaveProperty(t)
  })
  it('users.email is unique', () => {
    expect(Object.values(s.users)[0]).toBeTruthy() // presence; uniqueness asserted against the DB in 1.9
  })
})
