// The `/admin` HTTP surface (spec §9, §12.2): the ops screen's four calls into
// the Task 5.1 service in `services/jobs.ts`.
//
// The routes own exactly three things — authentication (`requireAuth`),
// request *shape* (Zod schemas via `parse`, so a typo is a 422 and never a 500),
// and status codes. Authorization is deliberately absent here: every operation
// in the service re-checks `job:manage`/`isAdmin` against the actor, so a route
// that forgot a check could not widen the surface, and there is exactly one
// place where the admin rule lives.
//
// `GET /admin/jobs` mirrors `/items`' list shape: a keyset cursor (never
// `OFFSET`) and a `nextCursor` the caller feeds back verbatim.

import { Router, type Request, type Response } from 'express'
import { z } from 'zod'
import { outboxJobs } from '../../db/schema'
import { OUTBOX_TYPES } from '../../domain/types'
import { currentActor, requireAuth } from '../middleware/auth'
import { parse, paginationSchema } from '../validate'
import {
  jobsSummary,
  listJobs,
  retryJob,
  setUserStatus,
  type ListJobsQuery,
} from '../../services/jobs'

export const adminRouter: Router = Router()

// The filter values are enums, not free strings: an unknown status would
// otherwise read to the operator as "no failed jobs". `outbox_jobs.status` is
// where that value set is declared (the Drizzle column *is* the schema), and
// the service validates the same sets again — the route check exists so the
// failure is a 422 that names the offending field like every other 422.
const JOB_STATUSES = outboxJobs.status.enumValues

const listJobsQuerySchema = paginationSchema.extend({
  status: z.enum(JOB_STATUSES).optional(),
  type: z.enum(OUTBOX_TYPES).optional(),
})

const jobIdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
})

const userIdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
})

const setUserStatusBodySchema = z.object({
  status: z.enum(['active', 'disabled']),
})

// GET /admin/jobs
adminRouter.get('/admin/jobs', requireAuth(), async (req: Request, res: Response, next) => {
  try {
    const actor = currentActor(req)
    const query = parse(listJobsQuerySchema, req.query)

    const listQuery: ListJobsQuery = {
      limit: query.limit,
      ...(query.status !== undefined ? { status: query.status } : {}),
      ...(query.type !== undefined ? { type: query.type } : {}),
      ...(query.cursor !== undefined ? { cursor: query.cursor } : {}),
    }

    const { jobs, nextCursor } = await listJobs(actor, listQuery)
    res.status(200).json({ jobs, nextCursor })
  } catch (err) {
    next(err)
  }
})

// GET /admin/jobs/summary
adminRouter.get('/admin/jobs/summary', requireAuth(), async (req: Request, res: Response, next) => {
  try {
    const actor = currentActor(req)
    const summary = await jobsSummary(actor)
    res.status(200).json(summary)
  } catch (err) {
    next(err)
  }
})

// POST /admin/jobs/:id/retry
adminRouter.post('/admin/jobs/:id/retry', requireAuth(), async (req: Request, res: Response, next) => {
  try {
    const actor = currentActor(req)
    const { id } = parse(jobIdParamSchema, req.params)
    await retryJob(actor, id)
    res.status(204).end()
  } catch (err) {
    next(err)
  }
})

// PATCH /admin/users/:id
adminRouter.patch('/admin/users/:id', requireAuth(), async (req: Request, res: Response, next) => {
  try {
    const actor = currentActor(req)
    const { id } = parse(userIdParamSchema, req.params)
    const { status } = parse(setUserStatusBodySchema, req.body)
    await setUserStatus(actor, id, status)
    res.status(204).end()
  } catch (err) {
    next(err)
  }
})
