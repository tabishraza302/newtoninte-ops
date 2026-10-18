import { describe, it, expect } from 'vitest'
import { hashPassword, verifyPassword, randomToken, sha256 } from '../../src/services/crypto'
import { ApiError } from '../../src/http/errors'
describe('crypto', () => {
  it('hashes a password to something other than the plaintext', async () => {
    const hash = await hashPassword('Passw0rd!')
    expect(hash).not.toBe('Passw0rd!')
    // Pins the product decision (bcrypt) so it cannot silently regress.
    expect(hash).toMatch(/^\$2b\$/)
  })

  it('verifies the correct password and rejects a wrong one', async () => {
    const hash = await hashPassword('Passw0rd!')
    expect(await verifyPassword('Passw0rd!', hash)).toBe(true)
    expect(await verifyPassword('wrong-password', hash)).toBe(false)
  })

  it('returns false rather than throwing on a malformed stored hash', async () => {
    // A corrupt row must never 500 the login flow.
    expect(await verifyPassword('Passw0rd!', '')).toBe(false)
    expect(await verifyPassword('Passw0rd!', 'not-a-hash')).toBe(false)
    expect(await verifyPassword('Passw0rd!', '$2b$10$truncated')).toBe(false)
  })

  it('mints a url-safe token carrying 32 bytes of entropy', () => {
    const token = randomToken()
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(Buffer.from(token, 'base64url')).toHaveLength(32)
  })

  it('hashes to the known sha256 digest', () => {
    expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })
  it('enforces 72-byte password boundary for bcrypt', async () => {
    const valid72 = 'a'.repeat(72)
    const invalid73 = 'a'.repeat(73)

    const hash72 = await hashPassword(valid72)
    expect(await verifyPassword(valid72, hash72)).toBe(true)

    await expect(hashPassword(invalid73)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    })

    expect(await verifyPassword(invalid73, hash72)).toBe(false)
  })
})
