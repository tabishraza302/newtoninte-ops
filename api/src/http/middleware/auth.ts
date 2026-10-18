import type { Request, RequestHandler } from 'express'
import { eq } from 'drizzle-orm'
import { db } from '../../db/client'
import { users } from '../../db/schema'
import type { Actor } from '../../domain/types'
import { verifyAccessToken } from '../../services/tokens'
import { ApiError } from '../errors'

declare global {
  namespace Express {
    interface Request {
      actor?: Actor
    }
  }
}

export function currentActor(req: Request): Actor {
  if (!req.actor) {
    throw ApiError.of('UNAUTHENTICATED')
  }
  return req.actor
}

export function requireAuth(): RequestHandler {
  return async (req, _res, next) => {
    const header = req.headers.authorization
    if (!header || !header.startsWith('Bearer ')) {
      next(ApiError.of('UNAUTHENTICATED'))
      return
    }

    const token = header.slice('Bearer '.length).trim()
    if (!token) {
      next(ApiError.of('UNAUTHENTICATED'))
      return
    }

    let sub: number
    try {
      const verified = await verifyAccessToken(token)
      sub = verified.sub
    } catch {
      next(ApiError.of('UNAUTHENTICATED'))
      return
    }

    try {
      const [user] = await db
        .select({
          id: users.id,
          isAdmin: users.isAdmin,
          status: users.status,
        })
        .from(users)
        .where(eq(users.id, sub))
        .limit(1)

      if (!user || user.status === 'disabled') {
        next(ApiError.of('UNAUTHENTICATED'))
        return
      }

      req.actor = {
        id: user.id,
        isAdmin: Boolean(user.isAdmin),
      }
      next()
    } catch (err) {
      next(err)
    }
  }
}
