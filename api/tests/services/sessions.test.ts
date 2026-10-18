import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { resetDb, seedUser } from '../helpers/db'
import { closeDb, pool } from '../../src/db/client'
import {
  issueFamily,
  rotate,
  revokeFamily,
  revokeAllForUser,
} from '../../src/services/sessions'
import { sha256 } from '../../src/services/crypto'
import { ApiError } from '../../src/http/errors'

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

describe('sessions service (Task 2.11)', () => {
  beforeEach(resetDb)
  afterAll(closeDb)

  it('issue -> rotate: old token revoked with replaced_by set, new token works', async () => {
    const user = await seedUser()
    const { refreshToken: t1, familyId } = await issueFamily(user.id, {
      userAgent: 'TestBrowser',
      ip: '127.0.0.1',
    })

    const rowsInitial = await fetchTokens(familyId)
    expect(rowsInitial).toHaveLength(1)
    expect(rowsInitial[0]?.revoked_at).toBeNull()

    const { refreshToken: t2, familyId: f2, userId } = await rotate(t1)
    expect(userId).toBe(user.id)
    expect(f2).toBe(familyId)
    expect(t2).not.toBe(t1)

    const rowsAfterRotate = await fetchTokens(familyId)
    expect(rowsAfterRotate).toHaveLength(2)

    // First token revoked and points to second
    const oldRow = rowsAfterRotate[0]!
    const newRow = rowsAfterRotate[1]!
    expect(oldRow.revoked_at).toBeInstanceOf(Date)
    expect(oldRow.replaced_by).toBe(newRow.id)

    // Second token is active
    expect(newRow.revoked_at).toBeNull()
    expect(newRow.token_hash).toBe(sha256(t2))

    // Rotate again with t2 succeeds
    const { refreshToken: t3 } = await rotate(t2)
    expect(t3).not.toBe(t2)
  })

  it('theft detection: presenting revoked token after grace window revokes entire family', async () => {
    const user = await seedUser()
    const { refreshToken: t1, familyId } = await issueFamily(user.id)
    const { refreshToken: t2 } = await rotate(t1)

    // Backdate the revocation of t1 to 30 seconds ago (grace window is 10s by default)
    await pool.query(
      'UPDATE refresh_tokens SET revoked_at = DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 30 SECOND) WHERE token_hash = ?',
      [sha256(t1)],
    )

    // Presenting t1 again after grace window -> UNAUTHENTICATED
    expect(await errorCode(() => rotate(t1))).toBe('UNAUTHENTICATED')

    // Every token in the family must now be revoked
    const rows = await fetchTokens(familyId)
    for (const r of rows) {
      expect(r.revoked_at).toBeInstanceOf(Date)
    }

    // Now even t2 (which was active) is revoked and fails
    expect(await errorCode(() => rotate(t2))).toBe('UNAUTHENTICATED')
  })

  it('benign race: presenting revoked token within grace window issues successor', async () => {
    const user = await seedUser()
    const { refreshToken: t1, familyId } = await issueFamily(user.id)
    const { refreshToken: t2 } = await rotate(t1)

    // t1 was revoked just now (within 10s grace window)
    // Presenting t1 again simulates two concurrent tabs refreshing with t1
    const rotatedFromRace = await rotate(t1)
    expect(rotatedFromRace.userId).toBe(user.id)
    expect(rotatedFromRace.familyId).toBe(familyId)

    // Exactly ONE active token remains in the family
    const rows = await fetchTokens(familyId)
    const active = rows.filter((r) => r.revoked_at === null)
    expect(active).toHaveLength(1)
    expect(active[0]?.token_hash).toBe(sha256(rotatedFromRace.refreshToken))
  })

  it('unknown or expired token throws UNAUTHENTICATED', async () => {
    const user = await seedUser()
    const { refreshToken: t1 } = await issueFamily(user.id)

    // Unknown token
    expect(await errorCode(() => rotate('totally-bogus-token'))).toBe('UNAUTHENTICATED')

    // Expired token
    await pool.query(
      'UPDATE refresh_tokens SET expires_at = DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 1 DAY) WHERE token_hash = ?',
      [sha256(t1)],
    )
    expect(await errorCode(() => rotate(t1))).toBe('UNAUTHENTICATED')
  })

  it('revokeFamily and revokeAllForUser revoke active tokens', async () => {
    const user = await seedUser()
    const { refreshToken: t1, familyId: f1 } = await issueFamily(user.id)
    const { refreshToken: t2, familyId: f2 } = await issueFamily(user.id)

    await revokeFamily(f1)
    expect(await errorCode(() => rotate(t1))).toBe('UNAUTHENTICATED')
    // f2 still works
    expect(await errorCode(() => rotate(t2))).toBe('NO_THROW')

    // Revoke all for user
    await revokeAllForUser(user.id)
    const [rows] = await pool.query(
      'SELECT COUNT(*) AS activeCount FROM refresh_tokens WHERE user_id = ? AND revoked_at IS NULL',
      [user.id],
    )
    expect((rows as { activeCount: number }[])[0]?.activeCount).toBe(0)
  })
})
