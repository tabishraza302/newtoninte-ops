// The `/admin` HTTP surface (spec §9, §12.2): the ops screen's four calls into
// the Task 5.1 service in `services/jobs.ts`.
//
// The routes own authentication (`requireAuth`), request *shape* (Zod schemas via `parse`,
// so a typo is a 422 and never a 500), status codes, and route-level administrative gates
// (such as `PATCH /admin/teams/:id/members/:userId` enforcing platform admin status over
// shared role operations that also admit team leads on team routes).
// `GET /admin/jobs` mirrors `/items`' list shape: a keyset cursor (never
// `OFFSET`) and a `nextCursor` the caller feeds back verbatim.

import { Router, type Request, type Response } from 'express'
import { z } from 'zod'
import { outboxJobs } from '../../db/schema'
import { ADMIN_AUDIT_ACTIONS, OUTBOX_TYPES, ROLES } from '../../domain/types'
import { can } from '../../policy'
import { ApiError } from '../errors'
import { currentActor, requireAuth } from '../middleware/auth'
import { parse, paginationSchema } from '../validate'
import {
  jobsSummary,
  listJobs,
  retryJob,
  setUserStatus,
  type ListJobsQuery,
} from '../../services/jobs'
import { createUser, listUsers, type CreateUserInput, type ListUsersQuery } from '../../services/users'
import { adminListTeamMembers, adminRemoveTeamMember, listAdminTeams, type ListAdminTeamsQuery } from '../../services/teams'
import { setMemberRole } from '../../services/memberships'
import { listAdminAudit, type ListAdminAuditQuery } from '../../services/adminAudit'
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

const teamIdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
})

const teamMemberParamSchema = z.object({
  id: z.coerce.number().int().positive(),
  userId: z.coerce.number().int().positive(),
})

const setUserStatusBodySchema = z.object({
  status: z.enum(['active', 'disabled']),
})
const listUsersQuerySchema = paginationSchema.extend({
  q: z.string().trim().optional(),
})

const listAdminTeamsQuerySchema = paginationSchema.extend({
  q: z.string().trim().optional(),
})

const setTeamMemberRoleBodySchema = z.object({
  role: z.enum(ROLES),
})

const listAuditLogQuerySchema = paginationSchema.extend({
  action: z.enum(ADMIN_AUDIT_ACTIONS).optional(),
  q: z.string().trim().optional(),
})

const createUserBodySchema = z
  .object({
    email: z.string().trim().email(),
    displayName: z.string().trim().min(1).max(120),
    password: z
      .string()
      .min(8)
      .refine((pw) => Buffer.byteLength(pw, 'utf8') <= 72, {
        message: 'Password must not exceed 72 bytes',
      }),
    teamId: z.coerce.number().int().positive().optional(),
    role: z.enum(ROLES).optional(),
  })
  .refine(
    (data) =>
      (data.teamId === undefined && data.role === undefined) ||
      (data.teamId !== undefined && data.role !== undefined),
    {
      message: 'teamId and role must be provided together',
      path: ['teamId'],
    },
  )

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

// GET /admin/users
adminRouter.get('/admin/users', requireAuth(), async (req: Request, res: Response, next) => {
  try {
    const actor = currentActor(req)
    const query = parse(listUsersQuerySchema, req.query)
    const listQuery: ListUsersQuery = {
      limit: query.limit,
      ...(query.q !== undefined ? { q: query.q } : {}),
      ...(query.cursor !== undefined ? { cursor: query.cursor } : {}),
    }
    const result = await listUsers(actor, listQuery)
    res.status(200).json(result)
  } catch (err) {
    next(err)
  }
})

// POST /admin/users
adminRouter.post('/admin/users', requireAuth(), async (req: Request, res: Response, next) => {
  try {
    const actor = currentActor(req)
    const body = parse(createUserBodySchema, req.body)
    const createInput: CreateUserInput = {
      email: body.email,
      displayName: body.displayName,
      password: body.password,
      ...(body.teamId !== undefined ? { teamId: body.teamId } : {}),
      ...(body.role !== undefined ? { role: body.role } : {}),
    }
    const user = await createUser(actor, createInput)
    res.status(201).json({ user })
  } catch (err) {
    next(err)
  }
})

// GET /admin/teams
adminRouter.get('/admin/teams', requireAuth(), async (req: Request, res: Response, next) => {
  try {
    const actor = currentActor(req)
    const query = parse(listAdminTeamsQuerySchema, req.query)
    const listQuery: ListAdminTeamsQuery = {
      limit: query.limit,
      ...(query.q !== undefined ? { q: query.q } : {}),
      ...(query.cursor !== undefined ? { cursor: query.cursor } : {}),
    }
    const result = await listAdminTeams(actor, listQuery)
    res.status(200).json(result)
  } catch (err) {
    next(err)
  }
})

// GET /admin/teams/:id/members
adminRouter.get('/admin/teams/:id/members', requireAuth(), async (req: Request, res: Response, next) => {
  try {
    const actor = currentActor(req)
    const { id } = parse(teamIdParamSchema, req.params)
    const query = parse(paginationSchema, req.query)
    const result = await adminListTeamMembers(actor, id, query)
    res.status(200).json(result)
  } catch (err) {
    next(err)
  }
})

// DELETE /admin/teams/:id/members/:userId
adminRouter.delete('/admin/teams/:id/members/:userId', requireAuth(), async (req: Request, res: Response, next) => {
  try {
    const actor = currentActor(req)
    const { id, userId } = parse(teamMemberParamSchema, req.params)
    await adminRemoveTeamMember(actor, id, userId)
    res.status(204).end()
  } catch (err) {
    next(err)
  }
})

// PATCH /admin/teams/:id/members/:userId
adminRouter.patch('/admin/teams/:id/members/:userId', requireAuth(), async (req: Request, res: Response, next) => {
  try {
    const actor = currentActor(req)
    if (!(await can(actor, 'user:manage'))) {
      throw ApiError.of('FORBIDDEN')
    }
    const { id, userId } = parse(teamMemberParamSchema, req.params)
    const { role } = parse(setTeamMemberRoleBodySchema, req.body)
    await setMemberRole(actor, id, userId, role)
    res.status(200).json({ status: 'ok' })
  } catch (err) {
    next(err)
  }
})

// GET /admin/audit-log
adminRouter.get('/admin/audit-log', requireAuth(), async (req: Request, res: Response, next) => {
  try {
    const actor = currentActor(req)
    const query = parse(listAuditLogQuerySchema, req.query)
    const listQuery: ListAdminAuditQuery = {
      limit: query.limit,
      ...(query.action !== undefined ? { action: query.action } : {}),
      ...(query.q !== undefined ? { q: query.q } : {}),
      ...(query.cursor !== undefined ? { cursor: query.cursor } : {}),
    }
    const result = await listAdminAudit(actor, listQuery)
    res.status(200).json(result)
  } catch (err) {
    next(err)
  }
})
