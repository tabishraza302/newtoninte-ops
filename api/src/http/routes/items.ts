import { Router, type Request, type Response } from 'express'
import { z } from 'zod'
import { ITEM_TYPES, PRIORITIES, STATUSES, type ItemType, type Priority, type Status } from '../../domain/types'
import { ApiError } from '../errors'
import { currentActor, requireAuth } from '../middleware/auth'
import { parse } from '../validate'
import {
  addComment,
  assignItem,
  claimItem,
  createItem,
  getItem,
  listActivity,
  listItems,
  patchItem,
  transitionItem,
  type CreateItemInput,
  type ListItemsQuery,
  type PatchItemInput,
  type ViewName,
} from '../../services/items'
import { withIdempotency } from '../../services/idempotency'

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

const createItemBodySchema = z.object({
  teamId: z.coerce.number().int().positive(),
  title: z.string().min(1).max(200),
  description: z.string().nullable().optional(),
  type: z.enum(ITEM_TYPES),
  priority: z.enum(PRIORITIES),
  dueAt: z.union([z.string(), z.date()]).nullable().optional(),
  assigneeId: z.coerce.number().int().positive().nullable().optional(),
})

const patchItemBodySchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().nullable().optional(),
  type: z.enum(ITEM_TYPES).optional(),
  dueAt: z.union([z.string(), z.date()]).nullable().optional(),
  due_at: z.union([z.string(), z.date()]).nullable().optional(),
  priority: z.enum(PRIORITIES).optional(),
})

const assignItemBodySchema = z.object({
  assigneeId: z.coerce.number().int().positive(),
  expectedVersion: z.coerce.number().int().optional(),
  version: z.coerce.number().int().optional(),
})

const transitionItemBodySchema = z.object({
  to: z.enum(STATUSES),
  reason: z.string().optional(),
})

const addCommentBodySchema = z.object({
  body: z.string().min(1).max(10000),
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

// POST /items
itemsRouter.post('/items', requireAuth(), async (req: Request, res: Response, next) => {
  try {
    const actor = currentActor(req)
    const body = parse(createItemBodySchema, req.body)
    const createInput: CreateItemInput = {
      teamId: body.teamId,
      title: body.title,
      type: body.type,
      priority: body.priority,
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.dueAt !== undefined ? { dueAt: body.dueAt } : {}),
      ...(body.assigneeId !== undefined ? { assigneeId: body.assigneeId } : {}),
    }

    const idempotencyKeyHeader = req.headers['idempotency-key']
    const idempotencyKey = typeof idempotencyKeyHeader === 'string'
      ? idempotencyKeyHeader.trim()
      : Array.isArray(idempotencyKeyHeader) && typeof idempotencyKeyHeader[0] === 'string'
        ? idempotencyKeyHeader[0].trim()
        : undefined

    if (idempotencyKey && idempotencyKey.length > 0) {
      const result = await withIdempotency(
        actor.id,
        idempotencyKey,
        '/items',
        req.body,
        async (tx) => {
          const item = await createItem(actor, createInput, tx)
          return {
            status: 201,
            body: { item },
            resourceId: item.id,
          }
        },
      )
      res.status(result.status).json(result.body)
    } else {
      const item = await createItem(actor, createInput)
      res.status(201).json({ item })
    }
  } catch (err) {
    next(err)
  }
})

// PATCH /items/:id
itemsRouter.patch('/items/:id', requireAuth(), async (req: Request, res: Response, next) => {
  try {
    const actor = currentActor(req)
    const { id } = parse(itemIdParamSchema, req.params)

    if (req.body && typeof req.body === 'object') {
      if (
        'status' in req.body ||
        'assigneeId' in req.body ||
        'assignee' in req.body ||
        'assignee_id' in req.body
      ) {
        throw ApiError.of('VALIDATION_ERROR', 'status and assignee cannot be updated via PATCH')
      }
    }

    const ifMatchHeader = Array.isArray(req.headers['if-match'])
      ? req.headers['if-match'][0]
      : req.headers['if-match']
    const ifMatchVersion = ifMatchHeader?.replace(/^W\//, '').replace(/["']/g, '').trim()
    const rawVersion =
      req.body && typeof req.body === 'object' && 'version' in req.body && req.body.version !== undefined && req.body.version !== null
        ? req.body.version
        : ifMatchVersion && ifMatchVersion.length > 0
          ? ifMatchVersion
          : undefined

    if (rawVersion === undefined || rawVersion === null || rawVersion === '' || Number.isNaN(Number(rawVersion))) {
      throw ApiError.of('VALIDATION_ERROR', 'version is required and must be numeric')
    }
    const version = Number(rawVersion)

    const fields = parse(patchItemBodySchema, req.body)
    const patchInput: PatchItemInput = {
      version,
      ...(fields.title !== undefined ? { title: fields.title } : {}),
      ...(fields.description !== undefined ? { description: fields.description } : {}),
      ...(fields.type !== undefined ? { type: fields.type } : {}),
      ...(fields.dueAt !== undefined ? { dueAt: fields.dueAt } : {}),
      ...(fields.due_at !== undefined ? { due_at: fields.due_at } : {}),
      ...(fields.priority !== undefined ? { priority: fields.priority } : {}),
    }
    const item = await patchItem(actor, id, patchInput)
    res.status(200).json({ item })
  } catch (err) {
    next(err)
  }
})

// POST /items/:id/claim
itemsRouter.post('/items/:id/claim', requireAuth(), async (req: Request, res: Response, next) => {
  try {
    const actor = currentActor(req)
    const { id } = parse(itemIdParamSchema, req.params)
    const item = await claimItem(actor, id)
    res.status(200).json({ item })
  } catch (err) {
    next(err)
  }
})

// POST /items/:id/assign
itemsRouter.post('/items/:id/assign', requireAuth(), async (req: Request, res: Response, next) => {
  try {
    const actor = currentActor(req)
    const { id } = parse(itemIdParamSchema, req.params)

    const ifMatchHeader = Array.isArray(req.headers['if-match'])
      ? req.headers['if-match'][0]
      : req.headers['if-match']
    const ifMatchVersion = ifMatchHeader?.replace(/^W\//, '').replace(/["']/g, '').trim()
    const rawVersion =
      req.body && typeof req.body === 'object' && ('expectedVersion' in req.body || 'version' in req.body)
        ? (req.body.expectedVersion ?? req.body.version)
        : ifMatchVersion && ifMatchVersion.length > 0
          ? ifMatchVersion
          : undefined

    if (rawVersion === undefined || rawVersion === null || rawVersion === '' || Number.isNaN(Number(rawVersion))) {
      throw ApiError.of('VALIDATION_ERROR', 'expectedVersion is required and must be numeric')
    }
    const expectedVersion = Number(rawVersion)

    const { assigneeId } = parse(assignItemBodySchema, req.body)
    const item = await assignItem(actor, id, assigneeId, expectedVersion)
    res.status(200).json({ item })
  } catch (err) {
    next(err)
  }
})

// POST /items/:id/transition
itemsRouter.post('/items/:id/transition', requireAuth(), async (req: Request, res: Response, next) => {
  try {
    const actor = currentActor(req)
    const { id } = parse(itemIdParamSchema, req.params)
    const { to, reason } = parse(transitionItemBodySchema, req.body)
    const item = reason !== undefined
      ? await transitionItem(actor, id, to, reason)
      : await transitionItem(actor, id, to)
    res.status(200).json({ item })
  } catch (err) {
    next(err)
  }
})

// POST /items/:id/comments
itemsRouter.post('/items/:id/comments', requireAuth(), async (req: Request, res: Response, next) => {
  try {
    const actor = currentActor(req)
    const { id } = parse(itemIdParamSchema, req.params)
    const { body } = parse(addCommentBodySchema, req.body)
    const comment = await addComment(actor, id, body)
    res.status(201).json({ comment })
  } catch (err) {
    next(err)
  }
})
