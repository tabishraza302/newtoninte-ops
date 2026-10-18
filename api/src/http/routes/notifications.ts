import { Router, type Request, type Response } from 'express'
import { z } from 'zod'
import { currentActor, requireAuth } from '../middleware/auth'
import { paginationSchema, parse } from '../validate'
import {
  getNotificationsSummary,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '../../services/notifications'
import { handleNotificationStream } from '../../services/notificationStream'

export const notificationsRouter: Router = Router()

const notificationIdParamSchema = z.object({
  id: z.coerce
    .number()
    .int()
    .positive()
    .refine((n) => Number.isSafeInteger(n), {
      message: 'Must be a safe integer',
    }),
})

// GET /notifications/summary
notificationsRouter.get('/notifications/summary', requireAuth(), async (req: Request, res: Response, next) => {
  try {
    const actor = currentActor(req)
    const summary = await getNotificationsSummary(actor)
    res.status(200).json(summary)
  } catch (err) {
    next(err)
  }
})

// GET /notifications/stream
notificationsRouter.get('/notifications/stream', requireAuth(), async (req: Request, res: Response, next) => {
  try {
    const actor = currentActor(req)
    const header = req.headers.authorization ?? ''
    const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : ''
    await handleNotificationStream(actor, token, req, res)
  } catch (err) {
    next(err)
  }
})

// GET /notifications?cursor=...&limit=...
notificationsRouter.get('/notifications', requireAuth(), async (req: Request, res: Response, next) => {
  try {
    const actor = currentActor(req)
    const query = parse(paginationSchema, req.query)
    const result = await listNotifications(actor, {
      limit: query.limit,
      ...(query.cursor !== undefined ? { cursor: query.cursor } : {}),
    })
    res.status(200).json(result)
  } catch (err) {
    next(err)
  }
})

// POST /notifications/read-all
notificationsRouter.post('/notifications/read-all', requireAuth(), async (req: Request, res: Response, next) => {
  try {
    const actor = currentActor(req)
    await markAllNotificationsRead(actor)
    res.status(204).end()
  } catch (err) {
    next(err)
  }
})

// POST /notifications/:id/read
notificationsRouter.post('/notifications/:id/read', requireAuth(), async (req: Request, res: Response, next) => {
  try {
    const actor = currentActor(req)
    const { id } = parse(notificationIdParamSchema, req.params)
    await markNotificationRead(actor, id)
    res.status(204).end()
  } catch (err) {
    next(err)
  }
})
