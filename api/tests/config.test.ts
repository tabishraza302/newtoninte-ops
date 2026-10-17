import { describe, it, expect } from 'vitest'
import { loadConfig } from '../src/config'

const base = { DATABASE_URL: 'mysql://x', JWT_SECRET: 's' }

describe('loadConfig', () => {
  it('applies documented defaults', () => {
    const c = loadConfig(base)
    expect(c.accessTtlSec).toBe(900)
    expect(c.refreshGraceSec).toBe(10)
    expect(c.workerBatchSize).toBe(10)
    expect(c.idempotencyTtlSec).toBe(86400)
    expect(c.inviteTtlDays).toBe(7)
    expect(c.mailDriver).toBe('mailpit')
  })
  it('rejects an unknown MAIL_DRIVER', () => {
    expect(() => loadConfig({ ...base, MAIL_DRIVER: 'smtp' })).toThrow()
  })
  it('requires JWT_SECRET', () => {
    expect(() => loadConfig({ DATABASE_URL: 'mysql://x' })).toThrow()
  })
  it('rejects an invalid numeric setting', () => {
    expect(() => loadConfig({ ...base, PORT: 'abc' })).toThrow()
  })
  it('rejects an invalid boolean setting', () => {
    expect(() => loadConfig({ ...base, COOKIE_SECURE: 'maybe' })).toThrow()
  })
})
