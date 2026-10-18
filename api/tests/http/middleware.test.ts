import { describe, it, expect } from 'vitest'
import request from 'supertest'
import express from 'express'
import { ApiError } from '../../src/http/errors'
import { requestId } from '../../src/http/middleware/requestId'
import { errorHandler } from '../../src/http/middleware/errorHandler'
import { notFound } from '../../src/http/middleware/notFound'

function appWith(route?: express.RequestHandler) {
  const app = express()
  app.use(requestId())
  app.use(express.json({ limit: '1mb' }))
  if (route) app.get('/boom', route)
  app.post('/json-test', (_req, res) => {
    res.status(200).json({ ok: true })
  })
  app.use(notFound())
  app.use(errorHandler())
  return app
}

describe('middleware', () => {
  it('sets X-Request-Id', async () => {
    const res = await request(appWith()).get('/nope')
    expect(res.headers['x-request-id']).toMatch(/.+/)
  })
  it('renders the NOT_FOUND envelope', async () => {
    const res = await request(appWith()).get('/nope')
    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
  })
  it('renders an ApiError envelope', async () => {
    const res = await request(appWith(() => { throw ApiError.of('FORBIDDEN', 'no') })).get('/boom')
    expect(res.status).toBe(403)
    expect(res.body.error).toEqual({ code: 'FORBIDDEN', message: 'no' })
  })
  it('turns an unknown error into a generic 500 without leaking', async () => {
    const res = await request(appWith(() => { throw new Error('do-not-leak') })).get('/boom')
    expect(res.status).toBe(500)
    expect(res.body.error.code).toBe('INTERNAL_ERROR')
    expect(JSON.stringify(res.body)).not.toContain('do-not-leak')
  })
  it('echoes a valid inbound X-Request-Id', async () => {
    const res = await request(appWith())
      .get('/nope')
      .set('X-Request-Id', 'client-trace-123')
    expect(res.headers['x-request-id']).toBe('client-trace-123')
  })
  it('replaces an invalid or overlong X-Request-Id with a generated ID', async () => {
    const longId = 'a'.repeat(200)
    const res = await request(appWith())
      .get('/nope')
      .set('X-Request-Id', longId)
    expect(res.headers['x-request-id']).toMatch(/^[A-Za-z0-9_-]{1,128}$/)
    expect(res.headers['x-request-id']).not.toBe(longId)

    const invalidId = 'bad request id with spaces'
    const res2 = await request(appWith())
      .get('/nope')
      .set('X-Request-Id', invalidId)
    expect(res2.headers['x-request-id']).toMatch(/^[A-Za-z0-9_-]{1,128}$/)
    expect(res2.headers['x-request-id']).not.toBe(invalidId)
  })
  it('renders a 422 VALIDATION_ERROR envelope for malformed JSON request body', async () => {
    const res = await request(appWith())
      .post('/json-test')
      .set('Content-Type', 'application/json')
      .send('{"invalid-json":')
    expect(res.status).toBe(422)
    expect(res.body.error).toEqual({
      code: 'VALIDATION_ERROR',
      message: 'Malformed JSON payload',
    })
  })
})
