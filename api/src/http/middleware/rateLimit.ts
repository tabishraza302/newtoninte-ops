import type { RequestHandler } from 'express'
import { ApiError } from '../errors'

interface RateLimitBucket {
  count: number
  resetAt: number
}

export function rateLimit(opts: { key: string; windowMs: number; max: number }): RequestHandler {
  const buckets = new Map<string, RateLimitBucket>()

  return (req, _res, next) => {
    const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown'
    const identifier = `${ip}:${opts.key}`
    const now = Date.now()

    const current = buckets.get(identifier)
    if (!current || now >= current.resetAt) {
      buckets.set(identifier, { count: 1, resetAt: now + opts.windowMs })
      next()
      return
    }

    if (current.count >= opts.max) {
      next(ApiError.of('RATE_LIMITED'))
      return
    }

    current.count += 1
    next()
  }
}
