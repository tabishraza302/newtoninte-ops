import { Router, type Request, type Response } from 'express'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { db } from '../../db/client'
import { users } from '../../db/schema'
import { ApiError } from '../errors'
import { parse } from '../validate'
import { setRefreshCookie, readRefreshCookie, clearRefreshCookie } from '../cookies'
import { rateLimit } from '../middleware/rateLimit'
import { requireAuth, currentActor } from '../middleware/auth'
import { login, logout, me } from '../../services/auth'
import { rotate } from '../../services/sessions'
import { signAccessToken } from '../../services/tokens'
import { forgotPassword, resetPassword } from '../../services/passwordReset'
import { publicUserColumns } from '../../services/users'

export const authRouter: Router = Router()

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

const forgotSchema = z.object({
  email: z.string().email(),
})

const resetSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8),
})

function sessionCtx(req: Request): { userAgent?: string; ip?: string } {
  const ctx: { userAgent?: string; ip?: string } = {}
  const ua = req.headers['user-agent']
  if (typeof ua === 'string') ctx.userAgent = ua
  if (typeof req.ip === 'string') ctx.ip = req.ip
  return ctx
}

authRouter.post(
  '/auth/login',
  rateLimit({ key: 'auth:login', windowMs: 60000, max: 10 }),
  async (req: Request, res: Response) => {
    const { email, password } = parse(loginSchema, req.body)
    const result = await login(email, password, sessionCtx(req))
    setRefreshCookie(res, result.refreshToken)
    res.status(200).json({
      accessToken: result.accessToken,
      user: result.user,
    })
  },
)

authRouter.post('/auth/refresh', async (req: Request, res: Response) => {
  const token = readRefreshCookie(req)
  if (!token) {
    throw ApiError.of('UNAUTHENTICATED')
  }

  const rotated = await rotate(token, sessionCtx(req))

  const accessToken = await signAccessToken(rotated.userId)

  const [user] = await db
    .select(publicUserColumns)
    .from(users)
    .where(eq(users.id, rotated.userId))
    .limit(1)

  if (!user || user.status === 'disabled') {
    throw ApiError.of('UNAUTHENTICATED')
  }

  setRefreshCookie(res, rotated.refreshToken)
  res.status(200).json({
    accessToken,
    user,
  })
})

authRouter.post('/auth/logout', async (req: Request, res: Response) => {
  const token = readRefreshCookie(req)
  await logout(token)
  clearRefreshCookie(res)
  res.status(204).end()
})

authRouter.post(
  '/auth/password/forgot',
  rateLimit({ key: 'auth:forgot', windowMs: 60000, max: 10 }),
  async (req: Request, res: Response) => {
    const { email } = parse(forgotSchema, req.body)
    await forgotPassword(email)
    res.status(202).json({ status: 'accepted' })
  },
)

authRouter.post(
  '/auth/password/reset',
  rateLimit({ key: 'auth:reset', windowMs: 60000, max: 10 }),
  async (req: Request, res: Response) => {
    const { token, password } = parse(resetSchema, req.body)
    await resetPassword(token, password)
    res.status(200).json({ status: 'ok' })
  },
)

authRouter.get('/auth/me', requireAuth(), async (req: Request, res: Response) => {
  const actor = currentActor(req)
  const result = await me(actor)
  res.status(200).json(result)
})
