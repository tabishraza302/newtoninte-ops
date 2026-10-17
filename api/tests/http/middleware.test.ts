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
  if (route) app.get('/boom', route)
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
})
