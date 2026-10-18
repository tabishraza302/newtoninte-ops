import type { Request, Response } from 'express'
import { config } from '../config'

export const REFRESH_COOKIE_NAME = 'refresh_token'

export function setRefreshCookie(res: Response, token: string): void {
  res.cookie(REFRESH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: 'lax',
    path: '/auth',
    maxAge: config.refreshTtlSec * 1000,
  })
}

export function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE_NAME, {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: 'lax',
    path: '/auth',
  })
}

export function readRefreshCookie(req: Request): string | undefined {
  const reqWithCookies = req as Request & { cookies?: Record<string, string | undefined> }
  const fromReqCookies = reqWithCookies.cookies?.[REFRESH_COOKIE_NAME]
  if (typeof fromReqCookies === 'string' && fromReqCookies.length > 0) {
    return fromReqCookies
  }

  const cookieHeader = req.headers.cookie
  if (!cookieHeader) {
    return undefined
  }

  const parts = cookieHeader.split(';')
  for (const rawPart of parts) {
    const part = rawPart.trim()
    if (!part) continue
    const eqIdx = part.indexOf('=')
    if (eqIdx === -1) continue
    const name = part.slice(0, eqIdx).trim()
    if (name === REFRESH_COOKIE_NAME) {
      const val = part.slice(eqIdx + 1).trim()
      try {
        return decodeURIComponent(val)
      } catch {
        return val
      }
    }
  }

  return undefined
}
