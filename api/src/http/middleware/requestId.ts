import { randomUUID } from 'node:crypto'
import type { RequestHandler } from 'express'

/**
 * Response (and echo) header carrying the per-request correlation id. Clients
 * may send their own; we echo it back so a single value spans the whole trace.
 */
export const REQUEST_ID_HEADER = 'X-Request-Id'
const VALID_REQUEST_ID = /^[a-zA-Z0-9_-]{1,128}$/

/**
 * Assigns every request a correlation id and echoes it on the response.
 *
 * An inbound `X-Request-Id` is honoured if valid and <= 128 characters so a caller
 * (or an upstream proxy) can pin the trace; otherwise a fresh UUID is generated.
 * The value is exposed on `res.locals.requestId` so later middleware (the error handler)
 * can include it in logs without re-reading the header.
 */
export function requestId(): RequestHandler {
  return (req, res, next) => {
    const incoming = req.header(REQUEST_ID_HEADER)?.trim()
    const id = incoming && VALID_REQUEST_ID.test(incoming) ? incoming : randomUUID()
    res.locals.requestId = id
    res.setHeader(REQUEST_ID_HEADER, id)
    next()
  }
}
