import type { ErrorRequestHandler } from 'express'
import { toEnvelope } from '../errors'

/**
 * Terminal error middleware. Renders any thrown value through `toEnvelope`,
 * which keeps an `ApiError`'s code/status/details and collapses everything else
 * to a generic `INTERNAL_ERROR` 500 — raw messages, query parameters and stacks are never
 * sent to the client (only bounded error class and driver code/errno are logged server-side).
 *
 * Must be registered last, and with all four arguments so Express recognises it
 * as an error handler rather than a normal middleware.
 */
export function errorHandler(): ErrorRequestHandler {
  return (err, req, res, next) => {
    // The response has already started (e.g. a stream failed mid-flight):
    // we cannot write a status/body without throwing ERR_HTTP_HEADERS_SENT and
    // masking `err`, so let Express close the connection via the default handler.
    if (res.headersSent) return next(err)

    const { status, body } = toEnvelope(err)
    // Unexpected failures are bugs: surface a bounded structured error entry server-side.
    // Drizzle and database drivers embed raw SQL statements and query parameter arrays
    // (which contain password hashes, invitation tokens, or secrets) directly inside
    // err.message and err.params. We never log free-form error messages, SQL strings,
    // request bodies, or query parameters.
    if (status >= 500) {
      const requestId = res.locals.requestId
      const errorClass = err instanceof Error ? (err.constructor?.name || err.name) : 'UnknownError'

      let driverCode: string | undefined
      let driverErrno: number | undefined
      if (err && typeof err === 'object') {
        const rawCode = 'code' in err ? err.code : undefined
        const rawErrno = 'errno' in err ? err.errno : undefined
        if (typeof rawCode === 'string' && /^[A-Z0-9_]{1,32}$/.test(rawCode)) {
          driverCode = rawCode
        }
        if (typeof rawErrno === 'number' && Number.isInteger(rawErrno)) {
          driverErrno = rawErrno
        }
      }

      const logEntry: Record<string, unknown> = {
        level: 'error',
        time: new Date().toISOString(),
        requestId: typeof requestId === 'string' ? requestId : 'unknown',
        method: req.method,
        path: req.path,
        errorClass,
      }
      if (driverCode !== undefined) {
        logEntry.driverCode = driverCode
      }
      if (driverErrno !== undefined) {
        logEntry.driverErrno = driverErrno
      }
      console.error(JSON.stringify(logEntry))
    }
    res.status(status).json(body)
  }
}
