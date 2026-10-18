import { Router, type Request, type Response } from 'express'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../../db/client'
import { users } from '../../db/schema'
import type { Actor } from '../../domain/types'
import { setRefreshCookie } from '../cookies'
import { currentActor, requireAuth } from '../middleware/auth'
import { parse } from '../validate'
import { redeem, revokeInvitation } from '../../services/invitations'
import { verifyAccessToken } from '../../services/tokens'

export const invitationsRouter: Router = Router()

const invitationIdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
})

const redeemSchema = z.object({
  code: z.string().min(1),
  email: z.string().email().optional(),
  password: z.string().min(8).optional(),
  displayName: z.string().min(1).max(255).optional(),
})

async function resolveOptionalActor(req: Request): Promise<Actor | null> {
  const header = req.headers.authorization
  if (!header || !header.startsWith('Bearer ')) {
    return null
  }

  const token = header.slice('Bearer '.length).trim()
  if (!token) {
    return null
  }

  let sub: number
  try {
    const verified = await verifyAccessToken(token)
    sub = verified.sub
  } catch {
    return null
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
      return null
    }

    return {
      id: user.id,
      isAdmin: Boolean(user.isAdmin),
    }
  } catch {
    return null
  }
}

invitationsRouter.delete('/invitations/:id', requireAuth(), async (req: Request, res: Response, next) => {
  try {
    const actor = currentActor(req)
    const { id } = parse(invitationIdParamSchema, req.params)
    await revokeInvitation(actor, id)
    res.status(204).end()
  } catch (err) {
    next(err)
  }
})

invitationsRouter.post('/invitations/redeem', async (req: Request, res: Response, next) => {
  try {
    const actor = await resolveOptionalActor(req)
    const body = parse(redeemSchema, req.body)
    const result = await redeem(actor, body)

    setRefreshCookie(res, result.refreshToken)

    res.status(200).json({
      accessToken: result.accessToken,
      user: result.user,
      teamId: result.teamId,
      role: result.role,
    })
  } catch (err) {
    next(err)
  }
})
