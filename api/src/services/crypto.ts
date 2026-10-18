// Cryptographic primitives shared by the auth, invitation and reset flows.
//
// Passwords are hashed with bcrypt through Bun's built-in `Bun.password` — no
// third-party dependency and no second hashing route. Tokens and ids draw from
// the platform CSPRNG; `sha256` exists so opaque tokens are stored as digests,
// never as the value that grants access.

/** How many random bytes a session/invite/reset token carries by default. */
const DEFAULT_TOKEN_BYTES = 32

/** Hashes a plaintext password with bcrypt (`$2b$`, cost 10). */
export function hashPassword(pw: string): Promise<string> {
  return Bun.password.hash(pw, { algorithm: 'bcrypt' })
}

/**
 * Checks `pw` against a stored bcrypt hash.
 *
 * A malformed or empty stored hash — a corrupt row — returns `false` instead of
 * throwing, so it can never turn a login attempt into a 500.
 */
export async function verifyPassword(pw: string, hash: string): Promise<boolean> {
  if (hash === '') return false
  try {
    return await Bun.password.verify(pw, hash)
  } catch {
    return false
  }
}

/** A fresh base64url token carrying `bytes` bytes of entropy (default 32). */
export function randomToken(bytes: number = DEFAULT_TOKEN_BYTES): string {
  const buf = new Uint8Array(bytes)
  crypto.getRandomValues(buf)
  return Buffer.from(buf).toString('base64url')
}

/** The lowercase-hex SHA-256 digest of `input`. */
export function sha256(input: string): string {
  return new Bun.CryptoHasher('sha256').update(input).digest('hex')
}

/** A random RFC 4122 v4 UUID. */
export function uuid(): string {
  return crypto.randomUUID()
}
