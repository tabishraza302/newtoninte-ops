import type { RequestHandler } from 'express'

/**
 * Structured JSON logging middleware (spec §12.2).
 * Emits a single JSON object per request on finish, including:
 * - timestamp, level, method, path, status, durationMs
 * - per-request correlation id (from requestId middleware)
 * - actorId on write operations (POST, PUT, PATCH, DELETE) when authenticated
 *
 */
export function requestLogger(): RequestHandler {
  return (req, res, next) => {
    const startTime = Date.now()
    res.on('finish', () => {
      const durationMs = Date.now() - startTime
      const requestId = res.locals.requestId
      const isWrite = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)
      const actorId = req.actor?.id

      const entry: Record<string, unknown> = {
        level: res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
        time: new Date().toISOString(),
        requestId: typeof requestId === 'string' ? requestId : undefined,
        method: req.method,
        path: req.path,
        status: res.statusCode,
        durationMs,
      }

      if (isWrite && actorId !== undefined) {
        entry.actorId = actorId
      }

      console.log(JSON.stringify(entry))
    })

    next()
  }
}
