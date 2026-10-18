import { describe, it, expect } from 'vitest'
import { loadConfig } from '../src/config'

const base = { DATABASE_URL: 'mysql://x', JWT_SECRET: 's' }

describe('loadConfig', () => {
  it('applies documented defaults', () => {
    const c = loadConfig(base)
    expect(c.accessTtlSec).toBe(900)
    expect(c.refreshGraceSec).toBe(10)
    expect(c.workerBatchSize).toBe(10)
    expect(c.workerLeaseSec).toBe(300)
    expect(c.idempotencyTtlSec).toBe(86400)
    expect(c.inviteTtlDays).toBe(7)
    expect(c.mailDriver).toBe('mailpit')
    expect(c.adminUserCreationEnabled).toBe(true)
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
  it('reads the worker knobs from the environment', () => {
    const c = loadConfig({
      ...base,
      WORKER_INTERVAL_MS: '1000',
      WORKER_BATCH_SIZE: '25',
      WORKER_LEASE_SEC: '45',
    })
    expect(c.workerIntervalMs).toBe(1000)
    expect(c.workerBatchSize).toBe(25)
    expect(c.workerLeaseSec).toBe(45)
  })
  it('rejects an invalid boolean setting', () => {
    expect(() => loadConfig({ ...base, COOKIE_SECURE: 'maybe' })).toThrow()
  })
  it('reads ADMIN_USER_CREATION_ENABLED from the environment', () => {
    const c = loadConfig({ ...base, ADMIN_USER_CREATION_ENABLED: 'false' })
    expect(c.adminUserCreationEnabled).toBe(false)
  })
  it('strips trailing slashes from APP_BASE_URL', () => {
    const c = loadConfig({ ...base, APP_BASE_URL: 'http://localhost:8080///' })
    expect(c.appBaseUrl).toBe('http://localhost:8080')
  })
  it('rejects an invalid or non-http APP_BASE_URL', () => {
    expect(() => loadConfig({ ...base, APP_BASE_URL: 'javascript:alert(1)' })).toThrow(/APP_BASE_URL/)
    expect(() => loadConfig({ ...base, APP_BASE_URL: 'not-a-url' })).toThrow(/APP_BASE_URL/)
  })
  it('reads TRUST_PROXY from environment or applies default', () => {
    const def = loadConfig(base)
    expect(def.trustProxy).toBe('loopback, linklocal, uniquelocal')
    const custom = loadConfig({ ...base, TRUST_PROXY: '10.0.0.0/8' })
    expect(custom.trustProxy).toBe('10.0.0.0/8')
  })
})
