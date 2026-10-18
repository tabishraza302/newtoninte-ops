import { Router, type Request, type Response } from 'express'
import { z } from 'zod'
import { ITEM_TYPES, PRIORITIES, STATUSES, type ItemType, type Priority, type Status } from '../../domain/types'
import { ApiError } from '../errors'
import { currentActor, requireAuth } from '../middleware/auth'
import { parse } from '../validate'
import {
  getItem,
  listActivity,
  listItems,
  type ListItemsQuery,
  type ViewName,
} from '../../services/items'

export const itemsRouter: Router = Router()

const VIEW_NAMES = [
  'assigned_to_me',
  'unassigned_urgent',
  'awaiting_my_approval',
  'overdue',
] as const

const listItemsQuerySchema = z.object({
  team: z.coerce.number().int().positive().optional(),
  status: z.enum(STATUSES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  assignee: z.coerce.number().int().positive().optional(),
  type: z.enum(ITEM_TYPES).optional(),
  q: z.string().optional(),
  view: z.enum(VIEW_NAMES).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().optional(),
})

const itemIdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
})

const activityQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().optional(),
})

// GET /items
itemsRouter.get('/items', requireAuth(), async (req: Request, res: Response, next) => {
  try {
    const actor = currentActor(req)
    const query = parse(listItemsQuerySchema, req.query)

    if (query.limit !== undefined && (query.limit < 1 || query.limit > 100)) {
      throw ApiError.of('VALIDATION_ERROR', 'limit must be between 1 and 100', { limit: query.limit })
    }

    const effectiveLimit = query.limit ?? 20

    const listQuery: ListItemsQuery = {
      limit: effectiveLimit,
      ...(query.team !== undefined ? { team: query.team } : {}),
      ...(query.status !== undefined ? { status: query.status as Status } : {}),
      ...(query.priority !== undefined ? { priority: query.priority as Priority } : {}),
      ...(query.assignee !== undefined ? { assignee: query.assignee } : {}),
      ...(query.type !== undefined ? { type: query.type as ItemType } : {}),
      ...(query.q !== undefined ? { q: query.q } : {}),
      ...(query.view !== undefined ? { view: query.view as ViewName } : {}),
      ...(query.cursor !== undefined ? { cursor: query.cursor } : {}),
    }

    const { items, nextCursor } = await listItems(actor, listQuery)
    res.status(200).json({ items, nextCursor })
  } catch (err) {
    next(err)
  }
})

// GET /items/:id
itemsRouter.get('/items/:id', requireAuth(), async (req: Request, res: Response, next) => {
  try {
    const actor = currentActor(req)
    const { id } = parse(itemIdParamSchema, req.params)
    const item = await getItem(actor, id)
    res.status(200).json({ item })
  } catch (err) {
    next(err)
  }
})

// GET /items/:id/activity
itemsRouter.get('/items/:id/activity', requireAuth(), async (req: Request, res: Response, next) => {
  try {
    const actor = currentActor(req)
    const { id } = parse(itemIdParamSchema, req.params)
    const query = parse(activityQuerySchema, req.query)

    if (query.limit !== undefined && (query.limit < 1 || query.limit > 100)) {
      throw ApiError.of('VALIDATION_ERROR', 'limit must be between 1 and 100', { limit: query.limit })
    }

    const { events, nextCursor } = await listActivity(actor, id, query.cursor, query.limit)
    res.status(200).json({ events, nextCursor })
  } catch (err) {
    next(err)
  }
})
