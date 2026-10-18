import { describe, it, expect } from 'vitest'
import request from 'supertest'
import fs from 'node:fs'
import path from 'node:path'
import { createApp } from '../../src/app'

describe('health routes', () => {
  it('GET /health returns 200 with { status: "ok" }', async () => {
    const res = await request(createApp()).get('/health')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ status: 'ok' })
  })

  it('GET /ready returns 200 with { status: "ready" } when DB is up', async () => {
    const res = await request(createApp()).get('/ready')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ status: 'ready' })
  })

  it('asserts health.ts contains NO mention of outbox_jobs', () => {
    const filePath = path.resolve(__dirname, '../../src/http/routes/health.ts')
    const source = fs.readFileSync(filePath, 'utf-8')
    expect(source.includes('outbox_jobs')).toBe(false)
  })
})
