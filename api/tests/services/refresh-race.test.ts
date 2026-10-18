import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { resetDb, seedUser } from '../helpers/db'
import { closeDb, pool } from '../../src/db/client'
import { issueFamily, rotate } from '../../src/services/sessions'
import { ApiError } from '../../src/http/errors'
import { sha256 } from '../../src/services/crypto'

interface TokenRow {
  id: number
  user_id: number
  family_id: string
  token_hash: string
  revoked_at: Date | null
  replaced_by: number | null
  expires_at: Date
}

async function fetchTokens(familyId: string): Promise<TokenRow[]> {
  const [rows] = await pool.query(
    'SELECT id, user_id, family_id, token_hash, revoked_at, replaced_by, expires_at FROM refresh_tokens WHERE family_id = ? ORDER BY id ASC',
    [familyId],
  )
  return rows as TokenRow[]
}

async function errorCode(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn()
    return 'NO_THROW'
  } catch (e: unknown) {
    if (e instanceof ApiError) {
      return e.code
    }
    throw e
  }
}

describe('sessions service refresh race & theft tests (Task 2.20)', () => {
  beforeEach(resetDb)
  afterAll(closeDb)

  it('(a) reuse of a revoked token beyond grace window throws UNAUTHENTICATED and revokes the whole family', async () => {
    const user = await seedUser()
    const { refreshToken: t1, familyId } = await issueFamily(user.id)

    // First rotation succeeds -> t1 revoked with replaced_by pointing to t2
    const { refreshToken: t2 } = await rotate(t1)
    expect(t2).not.toBe(t1)

    // Manually push t1's revoked_at into the past, beyond config.refreshGraceSec (default 30s)
    await pool.query(
      'UPDATE refresh_tokens SET revoked_at = DATE_SUB(NOW(), INTERVAL 60 SECOND) WHERE family_id = ? AND replaced_by IS NOT NULL',
      [familyId],
    )

    // Verify t2 is currently active before theft attempt
    const beforeTheftTokens = await fetchTokens(familyId)
    const t2RowBefore = beforeTheftTokens.find((r) => r.revoked_at === null)
    expect(t2RowBefore).toBeDefined()

    // Attacker or stale client presents old token t1 beyond grace window
    const code = await errorCode(() => rotate(t1))
    expect(code).toBe('UNAUTHENTICATED')

    // Entire family must now be revoked (no active tokens)
    const afterTheftTokens = await fetchTokens(familyId)
    expect(afterTheftTokens.length).toBeGreaterThanOrEqual(2)
    const anyActive = afterTheftTokens.some((r) => r.revoked_at === null)
    expect(anyActive).toBe(false)

    // Even the previously valid t2 can no longer rotate because the whole family is revoked
    const t2Code = await errorCode(() => rotate(t2))
    expect(t2Code).toBe('UNAUTHENTICATED')
  })

  it('(b) §13 "Refresh race": fire two concurrent rotate() calls with the same valid token -> no false theft: both/at least one succeeds, family is NOT revoked, and afterwards exactly one token is active in the family', async () => {
    const user = await seedUser()
    const { refreshToken: t1, familyId } = await issueFamily(user.id)

    // Fire two concurrent rotate calls with the exact same initial valid token
    const results = await Promise.allSettled([
      rotate(t1, { userAgent: 'Client-1' }),
      rotate(t1, { userAgent: 'Client-2' }),
    ])

    // At least one must succeed; within grace window both may succeed (benign race)
    const fulfilled = results.filter(
      (r): r is PromiseFulfilledResult<{ userId: number; refreshToken: string; familyId: string }> =>
        r.status === 'fulfilled',
    )
    expect(fulfilled.length).toBeGreaterThanOrEqual(1)

    // Family is NOT revoked: verify there is at least one active token
    const familyTokens = await fetchTokens(familyId)
    const activeTokens = familyTokens.filter((r) => r.revoked_at === null)

    // Exactly one token is active in the family
    expect(activeTokens).toHaveLength(1)

    // The active token can successfully be used to rotate again
    const activeTokenHash = activeTokens[0]!.token_hash
    const matchingSession = fulfilled.find(
      (f) => sha256(f.value.refreshToken) === activeTokenHash,
    )
    expect(matchingSession).toBeDefined()

    // Test that rotating with the active token works cleanly
    const activeResult = await rotate(matchingSession!.value.refreshToken)
    expect(activeResult.userId).toBe(user.id)
    expect(activeResult.familyId).toBe(familyId)

    const updatedTokens = await fetchTokens(familyId)
    const stillOneActive = updatedTokens.filter((r) => r.revoked_at === null)
    expect(stillOneActive).toHaveLength(1)
  })

  it('(c) a token from family A cannot refresh family B', async () => {
    const userA = await seedUser({ email: 'userA@example.test' })
    const userB = await seedUser({ email: 'userB@example.test' })

    const sessionA = await issueFamily(userA.id)
    const sessionB = await issueFamily(userB.id)

    expect(sessionA.familyId).not.toBe(sessionB.familyId)

    // Rotating sessionA yields a session belonging to userA and familyA, never familyB
    const rotatedA = await rotate(sessionA.refreshToken)
    expect(rotatedA.userId).toBe(userA.id)
    expect(rotatedA.familyId).toBe(sessionA.familyId)
    expect(rotatedA.familyId).not.toBe(sessionB.familyId)

    // Tokens in familyB remain untouched
    const tokensB = await fetchTokens(sessionB.familyId)
    expect(tokensB).toHaveLength(1)
    expect(tokensB[0]?.revoked_at).toBeNull()
    expect(tokensB[0]?.user_id).toBe(userB.id)

    // SessionB rotates in its own family independently
    const rotatedB = await rotate(sessionB.refreshToken)
    expect(rotatedB.userId).toBe(userB.id)
    expect(rotatedB.familyId).toBe(sessionB.familyId)
  })
})
