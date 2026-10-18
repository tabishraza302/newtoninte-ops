import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { closeDb, pool } from '../../src/db/client'
import { ApiError } from '../../src/http/errors'
import { login, logout, me } from '../../src/services/auth'
import { hashPassword, sha256 } from '../../src/services/crypto'
import { verifyAccessToken } from '../../src/services/tokens'
import { resetDb, seedMembership, seedTeam, seedUser } from '../helpers/db'

interface TokenRow {
  id: number
  family_id: string
  token_hash: string
  revoked_at: Date | null
}

async function fetchTokens(familyId: string): Promise<TokenRow[]> {
  const [rows] = await pool.query(
    'SELECT id, family_id, token_hash, revoked_at FROM refresh_tokens WHERE family_id = ?',
    [familyId],
  )
  return rows as TokenRow[]
}

describe('auth service', () => {
  beforeEach(resetDb)
  afterAll(closeDb)

  describe('login', () => {
    it('returns user, accessToken, refreshToken with valid credentials', async () => {
      const password = 'SuperSecretPassword123!'
      const passwordHash = await hashPassword(password)
      const seeded = await seedUser({
        email: 'user@example.com',
        passwordHash,
      })

      const res = await login('user@example.com', password, {
        userAgent: 'TestAgent',
        ip: '127.0.0.1',
      })

      expect(res.user.id).toBe(seeded.id)
      expect(res.user.email).toBe('user@example.com')

      const verified = await verifyAccessToken(res.accessToken)
      expect(verified.sub).toBe(seeded.id)

      expect(typeof res.refreshToken).toBe('string')
      expect(res.refreshToken.length).toBeGreaterThan(0)

      const hash = sha256(res.refreshToken)
      const [rows] = await pool.query(
        'SELECT token_hash, user_agent, ip FROM refresh_tokens WHERE token_hash = ?',
        [hash],
      )
      const tokenRows = rows as Array<{ token_hash: string; user_agent: string; ip: string }>
      expect(tokenRows).toHaveLength(1)
      expect(tokenRows[0]?.user_agent).toBe('TestAgent')
      expect(tokenRows[0]?.ip).toBe('127.0.0.1')
    })

    it('throws UNAUTHENTICATED with wrong password', async () => {
      const passwordHash = await hashPassword('CorrectPassword')
      await seedUser({
        email: 'user@example.com',
        passwordHash,
      })

      let err: unknown
      try {
        await login('user@example.com', 'WrongPassword')
      } catch (e) {
        err = e
      }

      expect(err).toBeInstanceOf(ApiError)
      expect((err as ApiError).code).toBe('UNAUTHENTICATED')
    })

    it('throws UNAUTHENTICATED with unknown email (exact same error code)', async () => {
      let err: unknown
      try {
        await login('unknown@example.com', 'AnyPassword')
      } catch (e) {
        err = e
      }

      expect(err).toBeInstanceOf(ApiError)
      expect((err as ApiError).code).toBe('UNAUTHENTICATED')
    })

    it('throws FORBIDDEN for disabled account', async () => {
      const password = 'CorrectPassword'
      const passwordHash = await hashPassword(password)
      await seedUser({
        email: 'disabled@example.com',
        passwordHash,
        status: 'disabled',
      })

      let err: unknown
      try {
        await login('disabled@example.com', password)
      } catch (e) {
        err = e
      }

      expect(err).toBeInstanceOf(ApiError)
      expect((err as ApiError).code).toBe('FORBIDDEN')
    })

    it('treats email as case-insensitive and trims whitespace', async () => {
      const password = 'SuperSecretPassword123!'
      const passwordHash = await hashPassword(password)
      const seeded = await seedUser({
        email: 'mixedcase@example.com',
        passwordHash,
      })

      const res = await login('  MixedCase@Example.COM  ', password)
      expect(res.user.id).toBe(seeded.id)
    })
  })

  describe('logout', () => {
    it('revokes the session family when presented with a valid token', async () => {
      const password = 'SuperSecretPassword123!'
      const passwordHash = await hashPassword(password)
      await seedUser({
        email: 'user@example.com',
        passwordHash,
      })

      const { refreshToken } = await login('user@example.com', password)
      const hash = sha256(refreshToken)

      const [rows] = await pool.query(
        'SELECT family_id FROM refresh_tokens WHERE token_hash = ?',
        [hash],
      )
      const familyId = (rows as Array<{ family_id: string }>)[0]?.family_id
      expect(familyId).toBeDefined()

      await logout(refreshToken)

      const tokens = await fetchTokens(familyId!)
      expect(tokens).toHaveLength(1)
      expect(tokens[0]?.revoked_at).not.toBeNull()
    })

    it('is idempotent and does not throw for undefined or unknown token', async () => {
      await expect(logout(undefined)).resolves.toBeUndefined()
      await expect(logout('non-existent-token')).resolves.toBeUndefined()
    })
  })

  describe('me', () => {
    it('returns user and memberships for an active user', async () => {
      const user = await seedUser({ status: 'active' })
      const team1 = await seedTeam()
      const team2 = await seedTeam()

      await seedMembership(user.id, team1.id, 'lead')
      await seedMembership(user.id, team2.id, 'member')

      const result = await me({ id: user.id, isAdmin: false })

      expect(result.user.id).toBe(user.id)
      expect(result.memberships).toEqual(
        expect.arrayContaining([
          { teamId: team1.id, role: 'lead' },
          { teamId: team2.id, role: 'member' },
        ]),
      )
      expect(result.memberships).toHaveLength(2)
    })

    it('throws UNAUTHENTICATED for unknown user', async () => {
      let err: unknown
      try {
        await me({ id: 999999, isAdmin: false })
      } catch (e) {
        err = e
      }

      expect(err).toBeInstanceOf(ApiError)
      expect((err as ApiError).code).toBe('UNAUTHENTICATED')
    })

    it('throws UNAUTHENTICATED for disabled user', async () => {
      const user = await seedUser({ status: 'disabled' })

      let err: unknown
      try {
        await me({ id: user.id, isAdmin: false })
      } catch (e) {
        err = e
      }

      expect(err).toBeInstanceOf(ApiError)
      expect((err as ApiError).code).toBe('UNAUTHENTICATED')
    })
  })
})
