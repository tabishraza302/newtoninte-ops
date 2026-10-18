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

/** The canonical form of a subject we are willing to sign: a positive integer. */
function isPositiveSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0
}

/**
 * Signs a short-lived access token for `userId`.
 *
 * The lifetime is `config.accessTtlSec` (default 900s). `iat` is read once and
 * `exp` is derived from it, so the two never straddle a second boundary. A
 * `userId` our own verifier would reject is a programming error, not caller
 * input, hence `INTERNAL_ERROR` rather than `UNAUTHENTICATED`.
 */
export async function signAccessToken(userId: number): Promise<string> {
  if (!isPositiveSafeInteger(userId)) {
    throw new ApiError('INTERNAL_ERROR')
  }
  const iat = Math.floor(Date.now() / 1000)
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(String(userId))
    .setIssuedAt(iat)
    .setExpirationTime(iat + config.accessTtlSec)
    .sign(key)
}

/**
 * Verifies `token` and returns its subject as a positive integer.
 *
 * Throws `ApiError('UNAUTHENTICATED')` for anything the caller could not
 * legitimately present: a bad signature, an unexpected algorithm, an expired,
 * malformed or `exp`-less token, or a `sub` that is missing, non-canonical,
 * zero or negative.
 */
export async function verifyAccessToken(token: string): Promise<{ sub: number }> {
  let sub: unknown
  try {
    const { payload } = await jwtVerify(token, key, {
      algorithms: ['HS256'],
      requiredClaims: ['exp'],
    })
    sub = payload.sub
  } catch {
    throw new ApiError('UNAUTHENTICATED')
  }

  const userId = typeof sub === 'string' && /^[1-9][0-9]*$/.test(sub) ? Number(sub) : NaN
  if (!isPositiveSafeInteger(userId)) {
    throw new ApiError('UNAUTHENTICATED')
  }
  return { sub: userId }
}
