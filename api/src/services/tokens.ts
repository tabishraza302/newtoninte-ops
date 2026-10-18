// Access tokens: the short-lived bearer credential the API issues on login and
// checks on every authenticated request.
//
// Tokens are self-contained HS256 JWTs signed with the app's shared secret, so
// verification needs no database round trip. They carry only the user id in the
// standard `sub` claim — never roles or other attributes, which would go stale
// between issuance and expiry. Every failure mode (bad signature, expiry,
// malformed input, unusable subject) collapses to the same `UNAUTHENTICATED`
// error so callers cannot distinguish "wrong secret" from "expired" and no raw
// library error ever escapes the service.

import { SignJWT, jwtVerify } from 'jose'
import { config } from '../config'
import { ApiError } from '../http/errors'

/** The signing key, derived once from the configured secret. */
const key = new TextEncoder().encode(config.jwtSecret)

/**
 * Signs a short-lived access token for `userId`.
 *
 * The lifetime is `config.accessTtlSec` (default 900s); `iat`/`exp` are set by
 * jose from the current clock.
 */
export async function signAccessToken(userId: number): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(String(userId))
    .setIssuedAt()
    .setExpirationTime(`${config.accessTtlSec}s`)
    .sign(key)
}

/**
 * Verifies `token` and returns its subject as a positive integer.
 *
 * Throws `ApiError('UNAUTHENTICATED')` for anything the caller could not
 * legitimately present: a bad signature, an expired or malformed token, or a
 * `sub` that is missing, non-numeric, zero or negative.
 */
export async function verifyAccessToken(token: string): Promise<{ sub: number }> {
  let sub: unknown
  try {
    const { payload } = await jwtVerify(token, key)
    sub = payload.sub
  } catch {
    throw new ApiError('UNAUTHENTICATED')
  }

  const userId = typeof sub === 'string' && /^\d+$/.test(sub) ? Number(sub) : NaN
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    throw new ApiError('UNAUTHENTICATED')
  }
  return { sub: userId }
}
