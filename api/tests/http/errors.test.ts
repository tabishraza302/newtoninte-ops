import { describe, it, expect } from 'vitest'
import { ApiError, ERROR_STATUS, toEnvelope } from '../../src/http/errors'

describe('errors', () => {
  it('maps every code to its documented status', () => {
    expect(ERROR_STATUS.VERSION_CONFLICT).toBe(409)
    expect(ERROR_STATUS.STALE_STATE).toBe(409)
    expect(ERROR_STATUS.ALREADY_CLAIMED).toBe(409)
    expect(ERROR_STATUS.INVALID_TRANSITION).toBe(422)
    expect(ERROR_STATUS.IDEMPOTENCY_KEY_MISMATCH).toBe(422)
    expect(ERROR_STATUS.LAST_LEAD).toBe(422)
    expect(ERROR_STATUS.ALREADY_MEMBER).toBe(409)
    expect(ERROR_STATUS.INVITE_EXHAUSTED).toBe(409)
    expect(ERROR_STATUS.INVITE_EXPIRED).toBe(409)
    expect(ERROR_STATUS.INVITE_REVOKED).toBe(409)
    expect(ERROR_STATUS.RATE_LIMITED).toBe(429)
    expect(ERROR_STATUS.FORBIDDEN).toBe(403)
    expect(ERROR_STATUS.NOT_FOUND).toBe(404)
    expect(ERROR_STATUS.UNAUTHENTICATED).toBe(401)
    expect(ERROR_STATUS.VALIDATION_ERROR).toBe(422)
    expect(ERROR_STATUS.INTERNAL_ERROR).toBe(500)
    expect(ERROR_STATUS.USER_CREATION_DISABLED).toBe(403)
    expect(ERROR_STATUS.EMAIL_TAKEN).toBe(409)
  })
  it('renders the envelope', () => {
    expect(toEnvelope(ApiError.of('LAST_LEAD', 'one lead must remain')))
      .toEqual({ status: 422, body: { error: { code: 'LAST_LEAD', message: 'one lead must remain' } } })
  })
  it('turns an unknown error into INTERNAL_ERROR without leaking', () => {
    expect(toEnvelope(new Error('secret stack'))).toMatchObject({ status: 500, body: { error: { code: 'INTERNAL_ERROR' } } })
  })
  it('maps malformed JSON syntax error to 422 VALIDATION_ERROR', () => {
    const syntaxErr = new SyntaxError('Unexpected token in JSON at position 0')
    Object.assign(syntaxErr, { status: 400, type: 'entity.parse.failed' })
    expect(toEnvelope(syntaxErr)).toEqual({
      status: 422,
      body: { error: { code: 'VALIDATION_ERROR', message: 'Malformed JSON payload' } },
    })
  })
  it('maps entity.too.large to 413 VALIDATION_ERROR', () => {
    const payloadTooLarge = { status: 413, type: 'entity.too.large' }
    expect(toEnvelope(payloadTooLarge)).toEqual({
      status: 413,
      body: { error: { code: 'VALIDATION_ERROR', message: 'Payload too large' } },
    })
  })
})
