import { describe, it, expect } from 'vitest'
import { SignJWT } from 'jose'
import { signAccessToken, verifyAccessToken } from '../../src/services/tokens'
import { ApiError } from '../../src/http/errors'
import { config } from '../../src/config'

// A second, unrelated key so we can forge tokens the service must reject.
const WRONG_SECRET = new TextEncoder().encode('not-the-test-secret')

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

describe('access tokens', () => {
  it('round-trips a user id through sign and verify', async () => {
    const token = await signAccessToken(42)
    expect(await verifyAccessToken(token)).toEqual({ sub: 42 })
  })

  it('rejects a token signed with a different secret', async () => {
    const token = await forge(WRONG_SECRET, { sub: '42' }, 900)
    await expect(verifyAccessToken(token)).rejects.toThrow(ApiError)
  })

  it('rejects a token past its expiry', async () => {
    const token = await forge(new TextEncoder().encode(config.jwtSecret), { sub: '42' }, -60)
    await expect(verifyAccessToken(token)).rejects.toThrow(ApiError)
  })

  it('surfaces every rejection as ApiError UNAUTHENTICATED, never a raw jose error', async () => {
    const forged = await forge(WRONG_SECRET, { sub: '42' }, 900)
    for (const token of [forged, await forge(new TextEncoder().encode(config.jwtSecret), { sub: '42' }, -60), 'not-a-jwt']) {
      await expect(verifyAccessToken(token)).rejects.toMatchObject({
        name: 'ApiError',
        code: 'UNAUTHENTICATED',
      })
    }
  })

  it('rejects a sub that is not a positive integer', async () => {
    const secret = new TextEncoder().encode(config.jwtSecret)
    for (const sub of ['abc', '-1', '0', '1.5']) {
      const token = await forge(secret, { sub }, 900)
      await expect(verifyAccessToken(token)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' })
    }
    const missing = await forge(secret, {}, 900)
    await expect(verifyAccessToken(missing)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' })
  })

  it('takes the lifetime from config, not a hard-coded literal', async () => {
    const token = await signAccessToken(7)
    const [, payloadB64] = token.split('.')
    const payload = JSON.parse(Buffer.from(payloadB64!, 'base64url').toString()) as {
      iat: number
      exp: number
    }
    expect(payload.exp - payload.iat).toBe(config.accessTtlSec)
  })
})
