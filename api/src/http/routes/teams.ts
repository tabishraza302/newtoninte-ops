import { Router, type Request, type Response } from 'express'
import { z } from 'zod'
import { ROLES, type Role } from '../../domain/types'
import { currentActor, requireAuth } from '../middleware/auth'
import { paginationSchema, parse } from '../validate'
import { createTeam, getTeam, listTeams } from '../../services/teams'
import {
  addMember,
  listMembers,
  removeMember,
  setMemberRole,
} from '../../services/memberships'
import { createInvitation, listInvitations } from '../../services/invitations'

export const teamsRouter: Router = Router()

const createTeamSchema = z.object({
  name: z.string().min(1).max(255),
  slug: z.string().min(1).max(255),
})

const teamIdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
})

const teamMemberParamSchema = z.object({
  id: z.coerce.number().int().positive(),
  userId: z.coerce.number().int().positive(),
})

const addMemberSchema = z.object({
  userId: z.coerce.number().int().positive(),
  role: z.enum(ROLES),
})

const setMemberRoleSchema = z.object({
  role: z.enum(ROLES),
})

const createInvitationSchema = z.object({
  email: z.string().email(),
  role: z.enum(ROLES),
  maxUses: z.number().int().positive().optional(),
})

teamsRouter.get('/teams', requireAuth(), async (req: Request, res: Response, next) => {
  try {
    const actor = currentActor(req)
    const allQuery = req.query.all
    const all = allQuery === '1' || allQuery === 'true'
    const teams = await listTeams(actor, { all })
    res.status(200).json({ teams })
  } catch (err) {
    next(err)
  }
})

teamsRouter.post('/teams', requireAuth(), async (req: Request, res: Response, next) => {
  try {
    const actor = currentActor(req)
    const body = parse(createTeamSchema, req.body)
    const team = await createTeam(actor, body)
    res.status(201).json({ team })
  } catch (err) {
    next(err)
  }
})

teamsRouter.get('/teams/:id', requireAuth(), async (req: Request, res: Response, next) => {
  try {
    const actor = currentActor(req)
    const { id } = parse(teamIdParamSchema, req.params)
    const team = await getTeam(actor, id)
    res.status(200).json({ team })
  } catch (err) {
    next(err)
  }
})

teamsRouter.get('/teams/:id/members', requireAuth(), async (req: Request, res: Response, next) => {
  try {
    const actor = currentActor(req)
    const { id } = parse(teamIdParamSchema, req.params)
    const { cursor, limit } = parse(paginationSchema, req.query)
    const result = await listMembers(actor, id, cursor, limit)
    res.status(200).json(result)
  } catch (err) {
    next(err)
  }
})

teamsRouter.post('/teams/:id/members', requireAuth(), async (req: Request, res: Response, next) => {
  try {
    const actor = currentActor(req)
    const { id } = parse(teamIdParamSchema, req.params)
    const { userId, role } = parse(addMemberSchema, req.body)
    await addMember(actor, id, userId, role)
    res.status(201).json({ status: 'created' })
  } catch (err) {
    next(err)
  }
})

teamsRouter.patch('/teams/:id/members/:userId', requireAuth(), async (req: Request, res: Response, next) => {
  try {
    const actor = currentActor(req)
    const { id, userId } = parse(teamMemberParamSchema, req.params)
    const { role } = parse(setMemberRoleSchema, req.body)
    await setMemberRole(actor, id, userId, role)
    res.status(200).json({ status: 'ok' })
  } catch (err) {
    next(err)
  }
})

teamsRouter.delete('/teams/:id/members/:userId', requireAuth(), async (req: Request, res: Response, next) => {
  try {
    const actor = currentActor(req)
    const { id, userId } = parse(teamMemberParamSchema, req.params)
    await removeMember(actor, id, userId)
    res.status(204).end()
  } catch (err) {
    next(err)
  }
})

teamsRouter.post('/teams/:id/invitations', requireAuth(), async (req: Request, res: Response, next) => {
  try {
    const actor = currentActor(req)
    const { id } = parse(teamIdParamSchema, req.params)
    const body = parse(createInvitationSchema, req.body)
    const invitation = await createInvitation(actor, id, body)
    res.status(201).json({ invitation })
  } catch (err) {
    next(err)
  }
})

teamsRouter.get('/teams/:id/invitations', requireAuth(), async (req: Request, res: Response, next) => {
  try {
    const actor = currentActor(req)
    const { id } = parse(teamIdParamSchema, req.params)
    const { cursor, limit } = parse(paginationSchema, req.query)
    const result = await listInvitations(actor, id, cursor, limit)
    res.status(200).json(result)
  } catch (err) {
    next(err)
  }
})
