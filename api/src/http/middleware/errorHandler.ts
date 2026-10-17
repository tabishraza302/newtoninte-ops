import type { ErrorRequestHandler } from 'express'
import { toEnvelope } from '../errors'

/**
 * Terminal error middleware. Renders any thrown value through `toEnvelope`,
 * which keeps an `ApiError`'s code/status/details and collapses everything else
 * to a generic `INTERNAL_ERROR` 500 — the raw message and stack are never sent
 * to the client (they are logged to stderr instead).
 *
 * Must be registered last, and with all four arguments so Express recognises it
 * as an error handler rather than a normal middleware.
 */
export function errorHandler(): ErrorRequestHandler {
  return (err, _req, res, _next) => {
    const { status, body } = toEnvelope(err)
    // Unexpected failures are bugs: surface a trace server-side, but keep the
    // client-facing body generic.
    if (status >= 500) {
      const requestId = res.locals.requestId
      console.error(
        `[error] requestId=${typeof requestId === 'string' ? requestId : 'unknown'}`,
        err,
      )
    }
    res.status(status).json(body)
  }
}
