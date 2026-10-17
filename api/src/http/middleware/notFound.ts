import type { RequestHandler } from 'express'
import { ApiError } from '../errors'

/**
 * Catch-all for unmatched routes. Registered after every real route and before
 * `errorHandler()`, it hands a `NOT_FOUND` `ApiError` to the error middleware so
 * 404s use the exact same envelope as every other failure.
 */
export function notFound(): RequestHandler {
  return (_req, _res, next) => {
    next(ApiError.of('NOT_FOUND'))
  }
}
