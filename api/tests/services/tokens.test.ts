import { describe, it, expect } from 'vitest'
import { SignJWT } from 'jose'
import { signAccessToken, verifyAccessToken } from '../../src/services/tokens'
import { ApiError } from '../../src/http/errors'
import { config } from '../../src/config'

// A second, unrelated key so we can forge tokens the service must reject.
const WRONG_SECRET = new TextEncoder().encode('not-the-test-secret')
// The real key, used to forge well-signed tokens that are still invalid.
const REAL_SECRET = new TextEncoder().encode(config.jwtSecret)

/** Mints an HS256 token with an arbitrary key, claim set and lifetime. */
async function forge(
  secret: Uint8Array,
  claims: Record<string, unknown>,
  expiresInSec: number,
): Promise<string> {
  const nowSec = Math.floor(Date.now() / 1000)
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt(nowSec)
    .setExpirationTime(nowSec + expiresInSec)
    .sign(secret)
}

/** Splits a JWT into its decoded protected header and payload. */
function decode(token: string): {
  header: Record<string, unknown>
  payload: Record<string, unknown>
} {
  const [headerB64, payloadB64] = token.split('.')
  return {
    header: JSON.parse(Buffer.from(headerB64!, 'base64url').toString()),
    payload: JSON.parse(Buffer.from(payloadB64!, 'base64url').toString()),
  }
}

describe('access tokens', () => {
  it('round-trips a user id through sign and verify', async () => {
    const token = await signAccessToken(42)
    expect(await verifyAccessToken(token)).toEqual({ sub: 42 })
  })

  it('signs HS256 tokens whose payload is exactly sub/iat/exp', async () => {
    const { header, payload } = decode(await signAccessToken(42))
    expect(header).toEqual({ alg: 'HS256' })
    expect(Object.keys(payload).sort()).toEqual(['exp', 'iat', 'sub'])
  })

  it('rejects a token signed with a different secret', async () => {
    const token = await forge(WRONG_SECRET, { sub: '42' }, 900)
    await expect(verifyAccessToken(token)).rejects.toThrow(ApiError)
  })

  it('rejects a token signed with the right secret but a non-HS256 algorithm', async () => {
    for (const alg of ['HS384', 'HS512']) {
      const nowSec = Math.floor(Date.now() / 1000)
      const token = await new SignJWT({})
        .setProtectedHeader({ alg })
        .setSubject('42')
        .setIssuedAt(nowSec)
        .setExpirationTime(nowSec + 900)
        .sign(REAL_SECRET)
      await expect(verifyAccessToken(token)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' })
    }
  })

  it('rejects a token past its expiry', async () => {
    const token = await forge(REAL_SECRET, { sub: '42' }, -60)
    await expect(verifyAccessToken(token)).rejects.toThrow(ApiError)
  })

  it('rejects a validly signed token that omits exp', async () => {
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('42')
      .setIssuedAt()
      .sign(REAL_SECRET)
    await expect(verifyAccessToken(token)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' })
  })

  it('surfaces every rejection as ApiError UNAUTHENTICATED, never a raw jose error', async () => {
    const forged = await forge(WRONG_SECRET, { sub: '42' }, 900)
    for (const token of [forged, await forge(REAL_SECRET, { sub: '42' }, -60), 'not-a-jwt']) {
      await expect(verifyAccessToken(token)).rejects.toMatchObject({
        name: 'ApiError',
        code: 'UNAUTHENTICATED',
      })
    }
  })

  it('rejects a sub that is not a canonical positive integer', async () => {
    for (const sub of ['abc', '-1', '0', '1.5', '0042', '+42', '42 ']) {
      const token = await forge(REAL_SECRET, { sub }, 900)
      await expect(verifyAccessToken(token)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' })
    }
    const missing = await forge(REAL_SECRET, {}, 900)
    await expect(verifyAccessToken(missing)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' })
  })

  it('refuses to mint a token for a user id its own verifier would reject', async () => {
    for (const userId of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
      await expect(signAccessToken(userId)).rejects.toMatchObject({
        name: 'ApiError',
        code: 'INTERNAL_ERROR',
      })
    }
  })

  it('takes the lifetime from config, not a hard-coded literal', async () => {
    // The test env pins ACCESS_TOKEN_TTL_SEC=1234, so a hard-coded 900 fails.
    expect(config.accessTtlSec).toBe(1234)
    const { payload } = decode(await signAccessToken(7))
    expect((payload.exp as number) - (payload.iat as number)).toBe(config.accessTtlSec)
  })
})
