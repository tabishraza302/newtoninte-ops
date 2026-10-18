import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { eq } from 'drizzle-orm'
import { createApp } from '../../src/app'
import { closeDb, db } from '../../src/db/client'
import {
  activityEvents,
  adminAuditEvents,
  comments,
  membershipEvents,
  memberships,
  users,
} from '../../src/db/schema'
import { withTransaction } from '../../src/db/tx'
import { recordAdminAudit } from '../../src/services/adminAudit'
import { signAccessToken } from '../../src/services/tokens'
import { resetDb, seedItem, seedMembership, seedTeam, seedUser } from '../helpers/db'

describe('Admin operations remediation HTTP routes (admin-remediation.test.ts)', () => {
  const app = createApp()

  beforeEach(async () => {
    await resetDb()
  })

  afterAll(async () => {
    await closeDb()
  })

  async function adminAuth(
    overrides: Partial<typeof users.$inferInsert> = {},
  ): Promise<{ authHeader: string; user: typeof users.$inferSelect }> {
    const admin = await seedUser({ isAdmin: true, ...overrides })
    const token = await signAccessToken(admin.id)
    return { authHeader: `Bearer ${token}`, user: admin }
  }

  async function memberAuth(
    overrides: Partial<typeof users.$inferInsert> = {},
  ): Promise<{ authHeader: string; user: typeof users.$inferSelect }> {
    const member = await seedUser({ isAdmin: false, ...overrides })
    const token = await signAccessToken(member.id)
    return { authHeader: `Bearer ${token}`, user: member }
  }

  describe('1. GET /admin/teams', () => {
    describe('1.1 Authorization: admin / nonadmin / anon', () => {
      it('rejects unauthenticated callers with 401 UNAUTHENTICATED', async () => {
        const res = await request(app).get('/admin/teams')
        expect(res.status).toBe(401)
        expect(res.body.error.code).toBe('UNAUTHENTICATED')
      })

      it('rejects non-admin regular members with 403 FORBIDDEN', async () => {
        const { authHeader } = await memberAuth()
        const res = await request(app).get('/admin/teams').set('Authorization', authHeader)
        expect(res.status).toBe(403)
        expect(res.body.error.code).toBe('FORBIDDEN')
      })

      it('rejects non-admin team leads with 403 FORBIDDEN', async () => {
        const { authHeader, user } = await memberAuth()
        const team = await seedTeam()
        await seedMembership(user.id, team.id, 'lead')

        const res = await request(app).get('/admin/teams').set('Authorization', authHeader)
        expect(res.status).toBe(403)
        expect(res.body.error.code).toBe('FORBIDDEN')
      })

      it('allows platform administrators with 200 OK and expected envelope', async () => {
        const { authHeader } = await adminAuth()
        const res = await request(app).get('/admin/teams').set('Authorization', authHeader)
        expect(res.status).toBe(200)
        expect(res.body).toHaveProperty('teams')
        expect(res.body).toHaveProperty('nextCursor')
        expect(Array.isArray(res.body.teams)).toBe(true)
      })
    })

    describe('1.2 Name and slug literal wildcard search', () => {
      it('escapes %, _, and \\ so they match literally rather than as SQL LIKE wildcards', async () => {
        const { authHeader } = await adminAuth()

        const tPercent = await seedTeam({ name: 'Alpha%Team', slug: 'alpha-pct' })
        const tUnderscore = await seedTeam({ name: 'Beta_Team', slug: 'beta-und' })
        const tBackslash = await seedTeam({ name: 'Gamma\\Team', slug: 'gamma-bs' })
        const tNormal = await seedTeam({ name: 'Delta Team', slug: 'delta-slug' })
        const tSlugMatch = await seedTeam({ name: 'Epsilon Team', slug: 'eps%wild_slug' })

        // Searching '%' literally should match tPercent (in name) and tSlugMatch (in slug), but NOT tUnderscore, tBackslash, tNormal
        const percentRes = await request(app)
          .get('/admin/teams?q=%25')
          .set('Authorization', authHeader)
        expect(percentRes.status).toBe(200)
        const percentIds = percentRes.body.teams.map((t: { id: number }) => t.id)
        expect(percentIds).toContain(tPercent.id)
        expect(percentIds).toContain(tSlugMatch.id)
        expect(percentIds).not.toContain(tUnderscore.id)
        expect(percentIds).not.toContain(tBackslash.id)
        expect(percentIds).not.toContain(tNormal.id)

        // Searching '_' literally should match tUnderscore (in name) and tSlugMatch (in slug), but NOT tNormal
        const underscoreRes = await request(app)
          .get('/admin/teams?q=_')
          .set('Authorization', authHeader)
        expect(underscoreRes.status).toBe(200)
        const underscoreIds = underscoreRes.body.teams.map((t: { id: number }) => t.id)
        expect(underscoreIds).toContain(tUnderscore.id)
        expect(underscoreIds).toContain(tSlugMatch.id)
        expect(underscoreIds).not.toContain(tNormal.id)

        // Searching '\' literally should match tBackslash
        const backslashRes = await request(app)
          .get('/admin/teams?q=%5C')
          .set('Authorization', authHeader)
        expect(backslashRes.status).toBe(200)
        const backslashIds = backslashRes.body.teams.map((t: { id: number }) => t.id)
        expect(backslashIds).toEqual([tBackslash.id])

        // Searching slug directly
        const slugRes = await request(app)
          .get('/admin/teams?q=delta-slug')
          .set('Authorization', authHeader)
        expect(slugRes.status).toBe(200)
        expect(slugRes.body.teams).toHaveLength(1)
        expect(slugRes.body.teams[0].id).toBe(tNormal.id)
      })
    })

    describe('1.3 Bounded page ordering and keyset continuation', () => {
      it('orders teams strictly by id ASC, limits page sizes, and traverses with nextCursor', async () => {
        const { authHeader } = await adminAuth()
        const t1 = await seedTeam({ name: 'Team One' })
        const t2 = await seedTeam({ name: 'Team Two' })
        const t3 = await seedTeam({ name: 'Team Three' })
        const t4 = await seedTeam({ name: 'Team Four' })
        const t5 = await seedTeam({ name: 'Team Five' })

        // Page 1
        const p1 = await request(app)
          .get('/admin/teams?limit=2')
          .set('Authorization', authHeader)
        expect(p1.status).toBe(200)
        expect(p1.body.teams.map((t: { id: number }) => t.id)).toEqual([t1.id, t2.id])
        expect(p1.body.nextCursor).toBeTruthy()

        // Page 2
        const p2 = await request(app)
          .get(`/admin/teams?limit=2&cursor=${encodeURIComponent(p1.body.nextCursor)}`)
          .set('Authorization', authHeader)
        expect(p2.status).toBe(200)
        expect(p2.body.teams.map((t: { id: number }) => t.id)).toEqual([t3.id, t4.id])
        expect(p2.body.nextCursor).toBeTruthy()

        // Page 3 (final)
        const p3 = await request(app)
          .get(`/admin/teams?limit=2&cursor=${encodeURIComponent(p2.body.nextCursor)}`)
          .set('Authorization', authHeader)
        expect(p3.status).toBe(200)
        expect(p3.body.teams.map((t: { id: number }) => t.id)).toEqual([t5.id])
        expect(p3.body.nextCursor).toBeNull()
      })
    })

    describe('1.4 Filter-scoped cursor rejection', () => {
      it('rejects a cursor generated under one query scope when presented with a different query', async () => {
        const { authHeader } = await adminAuth()
        await seedTeam({ name: 'Alpha 1', slug: 'alpha-1' })
        await seedTeam({ name: 'Alpha 2', slug: 'alpha-2' })
        await seedTeam({ name: 'Beta 1', slug: 'beta-1' })

        // Cursor generated for q=Alpha
        const alphaPage = await request(app)
          .get('/admin/teams?q=Alpha&limit=1')
          .set('Authorization', authHeader)
        expect(alphaPage.status).toBe(200)
        const alphaCursor = alphaPage.body.nextCursor
        expect(alphaCursor).toBeTruthy()

        // Replaying with q=Beta must fail with 422 VALIDATION_ERROR
        const mismatchRes = await request(app)
          .get(`/admin/teams?q=Beta&cursor=${encodeURIComponent(alphaCursor)}`)
          .set('Authorization', authHeader)
        expect(mismatchRes.status).toBe(422)
        expect(mismatchRes.body.error.code).toBe('VALIDATION_ERROR')

        // Replaying with q omitted when minted with q=Alpha must also fail
        const omittedRes = await request(app)
          .get(`/admin/teams?cursor=${encodeURIComponent(alphaCursor)}`)
          .set('Authorization', authHeader)
        expect(omittedRes.status).toBe(422)
        expect(omittedRes.body.error.code).toBe('VALIDATION_ERROR')
      })
    })

    describe('1.5 Invalid limits', () => {
      it('rejects limits <= 0, > 100, or non-numeric with 422 VALIDATION_ERROR', async () => {
        const { authHeader } = await adminAuth()

        for (const limit of ['0', '-1', '101', 'invalid', '1.5']) {
          const res = await request(app)
            .get(`/admin/teams?limit=${limit}`)
            .set('Authorization', authHeader)
          expect(res.status).toBe(422)
          expect(res.body.error.code).toBe('VALIDATION_ERROR')
        }
      })
    })
  })

  describe('2. PATCH /admin/teams/:id/members/:userId', () => {
    describe('2.1 Admin success and journal metadata', () => {
      it('allows platform admin to change role and atomically writes membership_role_changed journal entry', async () => {
        const { authHeader, user: admin } = await adminAuth({ displayName: 'Audited Admin', email: 'audited-admin@test.local' })
        const team = await seedTeam({ name: 'Remediation Team', slug: 'remed-team' })
        const targetUser = await seedUser({ displayName: 'Target Member', email: 'target-member@test.local' })
        await seedMembership(targetUser.id, team.id, 'viewer')

        const res = await request(app)
          .patch(`/admin/teams/${team.id}/members/${targetUser.id}`)
          .set('Authorization', authHeader)
          .send({ role: 'member' })

        expect(res.status).toBe(200)
        expect(res.body).toEqual({ status: 'ok' })

        // DB state verification
        const [updatedMembership] = await db
          .select()
          .from(memberships)
          .where(eq(memberships.userId, targetUser.id))
        expect(updatedMembership).toBeDefined()
        expect(updatedMembership!.role).toBe('member')

        // Admin audit journal verification
        const auditRows = await db.select().from(adminAuditEvents)
        expect(auditRows).toHaveLength(1)
        expect(auditRows[0]).toBeDefined()
        expect(auditRows[0]!).toMatchObject({
          actorId: admin.id,
          action: 'membership_role_changed',
          targetType: 'membership',
          targetId: updatedMembership!.id,
          metadata: {
            teamId: team.id,
            teamName: 'Remediation Team',
            userId: targetUser.id,
            email: 'target-member@test.local',
            displayName: 'Target Member',
            fromRole: 'viewer',
            toRole: 'member',
          },
        })
      })
    })

    describe('2.2 Non-admin lead denied on admin route but existing /teams lead route works', () => {
      it('denies non-admin lead with 403 on /admin/teams route while allowing PATCH /teams/:id/members/:userId without admin audit', async () => {
        const team = await seedTeam({ name: 'Lead Test Team' })
        const { authHeader: leadAuth, user: leadUser } = await memberAuth({ displayName: 'Team Lead' })
        const { user: memberUser } = await memberAuth({ displayName: 'Team Member' })

        await seedMembership(leadUser.id, team.id, 'lead')
        await seedMembership(memberUser.id, team.id, 'viewer')

        // 1. Non-admin lead on /admin/teams/:id/members/:userId -> 403 FORBIDDEN
        const adminRouteRes = await request(app)
          .patch(`/admin/teams/${team.id}/members/${memberUser.id}`)
          .set('Authorization', leadAuth)
          .send({ role: 'member' })

        expect(adminRouteRes.status).toBe(403)
        expect(adminRouteRes.body.error.code).toBe('FORBIDDEN')

        // Assert no role change occurred yet
        const [unchanged] = await db
          .select()
          .from(memberships)
          .where(eq(memberships.userId, memberUser.id))
        expect(unchanged).toBeDefined()
        expect(unchanged!.role).toBe('viewer')
        expect(await db.select().from(adminAuditEvents)).toHaveLength(0)

        // 2. The same non-admin lead calling the existing team endpoint PATCH /teams/:id/members/:userId -> 200 OK
        const teamRouteRes = await request(app)
          .patch(`/teams/${team.id}/members/${memberUser.id}`)
          .set('Authorization', leadAuth)
          .send({ role: 'member' })

        expect(teamRouteRes.status).toBe(200)
        expect(teamRouteRes.body).toEqual({ status: 'ok' })

        // Membership was updated
        const [updated] = await db
          .select()
          .from(memberships)
          .where(eq(memberships.userId, memberUser.id))
        expect(updated).toBeDefined()
        expect(updated!.role).toBe('member')

        // Admin audit journal must remain empty (non-admin operations do not write to admin audit journal)
        const auditRows = await db.select().from(adminAuditEvents)
        expect(auditRows).toHaveLength(0)

        // Local team membership_events journal records the change
        const localEvents = await db
          .select()
          .from(membershipEvents)
          .where(eq(membershipEvents.teamId, team.id))
        expect(localEvents).toHaveLength(1)
        expect(localEvents[0]).toBeDefined()
        expect(localEvents[0]!).toMatchObject({
          action: 'role_changed',
          actorId: leadUser.id,
          subjectUserId: memberUser.id,
          fromRole: 'viewer',
          toRole: 'member',
        })
      })
    })
    describe('2.3 Last lead rejection and no-op no history', () => {
      it('rejects demoting the last lead with 422 LAST_LEAD and creates no audit row', async () => {
        const { authHeader } = await adminAuth()
        const team = await seedTeam({ name: 'Solo Lead Team' })
        const soleLead = await seedUser({ displayName: 'Solo Lead' })
        await seedMembership(soleLead.id, team.id, 'lead')

        const res = await request(app)
          .patch(`/admin/teams/${team.id}/members/${soleLead.id}`)
          .set('Authorization', authHeader)
          .send({ role: 'member' })

        expect(res.status).toBe(422)
        expect(res.body.error.code).toBe('LAST_LEAD')

        // DB state unchanged
        const [membership] = await db
          .select()
          .from(memberships)
          .where(eq(memberships.userId, soleLead.id))
        expect(membership).toBeDefined()
        expect(membership!.role).toBe('lead')
        // No audit row recorded
        expect(await db.select().from(adminAuditEvents)).toHaveLength(0)
      })

      it('returns 200 on same-role no-op without writing to audit journal', async () => {
        const { authHeader } = await adminAuth()
        const team = await seedTeam()
        const member = await seedUser()
        await seedMembership(member.id, team.id, 'viewer')

        const res = await request(app)
          .patch(`/admin/teams/${team.id}/members/${member.id}`)
          .set('Authorization', authHeader)
          .send({ role: 'viewer' })

        expect(res.status).toBe(200)
        expect(res.body).toEqual({ status: 'ok' })

        // DB role unchanged and no audit event written
        const [membership] = await db
          .select()
          .from(memberships)
          .where(eq(memberships.userId, member.id))
        expect(membership).toBeDefined()
        expect(membership!.role).toBe('viewer')
        expect(await db.select().from(adminAuditEvents)).toHaveLength(0)
      })
    })
  })

  describe('3. GET /admin/audit-log', () => {
    describe('3.1 Authorization: admin / nonadmin / anon', () => {
      it('rejects unauthenticated callers with 401 UNAUTHENTICATED', async () => {
        const res = await request(app).get('/admin/audit-log')
        expect(res.status).toBe(401)
        expect(res.body.error.code).toBe('UNAUTHENTICATED')
      })

      it('rejects non-admin members with 403 FORBIDDEN', async () => {
        const { authHeader } = await memberAuth()
        const res = await request(app).get('/admin/audit-log').set('Authorization', authHeader)
        expect(res.status).toBe(403)
        expect(res.body.error.code).toBe('FORBIDDEN')
      })

      it('rejects non-admin team leads with 403 FORBIDDEN', async () => {
        const { authHeader, user } = await memberAuth()
        const team = await seedTeam()
        await seedMembership(user.id, team.id, 'lead')

        const res = await request(app).get('/admin/audit-log').set('Authorization', authHeader)
        expect(res.status).toBe(403)
        expect(res.body.error.code).toBe('FORBIDDEN')
      })

      it('allows platform administrators with 200 OK and expected envelope', async () => {
        const { authHeader } = await adminAuth()
        const res = await request(app).get('/admin/audit-log').set('Authorization', authHeader)
        expect(res.status).toBe(200)
        expect(res.body).toEqual({ events: [], nextCursor: null })
      })
    })

    describe('3.2 Enum validation and invalid limits', () => {
      it('rejects invalid action query param with 422 VALIDATION_ERROR', async () => {
        const { authHeader } = await adminAuth()
        const res = await request(app)
          .get('/admin/audit-log?action=unknown_action_type')
          .set('Authorization', authHeader)

        expect(res.status).toBe(422)
        expect(res.body.error.code).toBe('VALIDATION_ERROR')
      })

      it('accepts valid ADMIN_AUDIT_ACTIONS enum values', async () => {
        const { authHeader } = await adminAuth()
        const validActions = [
          'user_created',
          'user_status_changed',
          'team_created',
          'membership_added',
          'membership_role_changed',
          'membership_removed',
          'job_retried',
        ]

        for (const action of validActions) {
          const res = await request(app)
            .get(`/admin/audit-log?action=${action}`)
            .set('Authorization', authHeader)
          expect(res.status).toBe(200)
          expect(Array.isArray(res.body.events)).toBe(true)
        }
      })

      it('rejects invalid limit values with 422 VALIDATION_ERROR', async () => {
        const { authHeader } = await adminAuth()
        for (const limit of ['0', '-2', '101', 'notanumber']) {
          const res = await request(app)
            .get(`/admin/audit-log?limit=${limit}`)
            .set('Authorization', authHeader)
          expect(res.status).toBe(422)
          expect(res.body.error.code).toBe('VALIDATION_ERROR')
        }
      })
    })

    describe('3.3 Action filter and actor/target search', () => {
      it('filters by action and performs literal escaped search across actor email/displayName and metadata', async () => {
        const { authHeader: aliceAuth, user: adminAlice } = await adminAuth({
          displayName: 'Alice Admin',
          email: 'alice@audit-test.local',
        })
        const { user: adminBob } = await adminAuth({
          displayName: 'Bob Admin',
          email: 'bob@audit-test.local',
        })

        const team = await seedTeam({ name: 'Alpha%Special Team', slug: 'alpha-special' })
        const userCharlie = await seedUser({ displayName: 'Charlie_Target', email: 'charlie@audit-test.local' })

        // Seed 3 distinct audit events
        await withTransaction(async (tx) => {
          await recordAdminAudit(tx, {
            actorId: adminAlice.id,
            action: 'team_created',
            targetType: 'team',
            targetId: team.id,
            metadata: { name: 'Alpha%Special Team', slug: 'alpha-special' },
          })
          await recordAdminAudit(tx, {
            actorId: adminBob.id,
            action: 'user_created',
            targetType: 'user',
            targetId: userCharlie.id,
            metadata: { email: 'charlie@audit-test.local', displayName: 'Charlie_Target' },
          })
          await recordAdminAudit(tx, {
            actorId: adminAlice.id,
            action: 'membership_role_changed',
            targetType: 'membership',
            targetId: 999,
            metadata: {
              teamId: team.id,
              teamName: 'Alpha%Special Team',
              userId: userCharlie.id,
              email: 'charlie@audit-test.local',
              displayName: 'Charlie_Target',
              fromRole: 'viewer',
              toRole: 'lead',
            },
          })
        })

        // 1. Action filter
        const teamCreatedRes = await request(app)
          .get('/admin/audit-log?action=team_created')
          .set('Authorization', aliceAuth)
        expect(teamCreatedRes.status).toBe(200)
        expect(teamCreatedRes.body.events).toHaveLength(1)
        expect(teamCreatedRes.body.events[0].action).toBe('team_created')

        const userCreatedRes = await request(app)
          .get('/admin/audit-log?action=user_created')
          .set('Authorization', aliceAuth)
        expect(userCreatedRes.status).toBe(200)
        expect(userCreatedRes.body.events).toHaveLength(1)
        expect(userCreatedRes.body.events[0].action).toBe('user_created')

        // 2. Actor search via q (matches actor email or displayName)
        const bobSearch = await request(app)
          .get('/admin/audit-log?q=Bob%20Admin')
          .set('Authorization', aliceAuth)
        expect(bobSearch.status).toBe(200)
        expect(bobSearch.body.events).toHaveLength(1)
        expect(bobSearch.body.events[0].actor.email).toBe('bob@audit-test.local')

        const aliceSearch = await request(app)
          .get('/admin/audit-log?q=alice@audit-test.local')
          .set('Authorization', aliceAuth)
        expect(aliceSearch.status).toBe(200)
        expect(aliceSearch.body.events).toHaveLength(2)

        // 3. Literal search in metadata: searching '%' should match 'Alpha%Special Team' events (team_created & membership_role_changed), NOT user_created
        const percentSearch = await request(app)
          .get('/admin/audit-log?q=%25')
          .set('Authorization', aliceAuth)
        expect(percentSearch.status).toBe(200)
        expect(percentSearch.body.events).toHaveLength(2)
        const percentActions = percentSearch.body.events.map((e: { action: string }) => e.action)
        expect(percentActions).toContain('team_created')
        expect(percentActions).toContain('membership_role_changed')
        expect(percentActions).not.toContain('user_created')

        // 4. Literal search in metadata: searching '_' should match 'Charlie_Target' in metadata, NOT team_created
        const underscoreSearch = await request(app)
          .get('/admin/audit-log?q=_')
          .set('Authorization', aliceAuth)
        expect(underscoreSearch.status).toBe(200)
        expect(underscoreSearch.body.events).toHaveLength(2)
        const underscoreActions = underscoreSearch.body.events.map((e: { action: string }) => e.action)
        expect(underscoreActions).toContain('user_created')
        expect(underscoreActions).toContain('membership_role_changed')
        expect(underscoreActions).not.toContain('team_created')
      })
    })

    describe('3.4 Keyset paging and filter binding', () => {
      it('orders events newest-first (id DESC) and rejects mismatched cursor filter scope', async () => {
        const { authHeader, user: admin } = await adminAuth()

        // Seed 3 events in order
        let ev1Id = 0
        let ev2Id = 0
        let ev3Id = 0
        await withTransaction(async (tx) => {
          await recordAdminAudit(tx, {
            actorId: admin.id,
            action: 'team_created',
            targetType: 'team',
            targetId: 101,
            metadata: { name: 'Team Scope 1', slug: 'team-scope-1' },
          })
        })
        await withTransaction(async (tx) => {
          await recordAdminAudit(tx, {
            actorId: admin.id,
            action: 'team_created',
            targetType: 'team',
            targetId: 102,
            metadata: { name: 'Team Scope 2', slug: 'team-scope-2' },
          })
        })
        await withTransaction(async (tx) => {
          await recordAdminAudit(tx, {
            actorId: admin.id,
            action: 'team_created',
            targetType: 'team',
            targetId: 103,
            metadata: { name: 'Team Scope 3', slug: 'team-scope-3' },
          })
        })

        const allRows = await db.select().from(adminAuditEvents)
        expect(allRows).toHaveLength(3)
        expect(allRows[0]).toBeDefined()
        expect(allRows[1]).toBeDefined()
        expect(allRows[2]).toBeDefined()
        ev1Id = allRows[0]!.id
        ev2Id = allRows[1]!.id
        ev3Id = allRows[2]!.id
        // Page 1: limit=2 -> should return ev3 and ev2 (newest first, id DESC)
        const p1 = await request(app)
          .get('/admin/audit-log?limit=2')
          .set('Authorization', authHeader)
        expect(p1.status).toBe(200)
        expect(p1.body.events.map((e: { id: number }) => e.id)).toEqual([ev3Id, ev2Id])
        expect(p1.body.nextCursor).toBeTruthy()

        // Page 2: with cursor -> should return ev1 and nextCursor null
        const p2 = await request(app)
          .get(`/admin/audit-log?limit=2&cursor=${encodeURIComponent(p1.body.nextCursor)}`)
          .set('Authorization', authHeader)
        expect(p2.status).toBe(200)
        expect(p2.body.events.map((e: { id: number }) => e.id)).toEqual([ev1Id])
        expect(p2.body.nextCursor).toBeNull()

        // Filter binding: cursor minted with action=team_created rejected when replayed with action=job_retried
        const actionCursorRes = await request(app)
          .get('/admin/audit-log?action=team_created&limit=1')
          .set('Authorization', authHeader)
        expect(actionCursorRes.status).toBe(200)
        const actionCursor = actionCursorRes.body.nextCursor
        expect(actionCursor).toBeTruthy()

        const actionMismatchRes = await request(app)
          .get(`/admin/audit-log?action=job_retried&cursor=${encodeURIComponent(actionCursor)}`)
          .set('Authorization', authHeader)
        expect(actionMismatchRes.status).toBe(422)
        expect(actionMismatchRes.body.error.code).toBe('VALIDATION_ERROR')

        // Filter binding: cursor minted with q=Scope rejected when replayed with q=Other
        const qCursorRes = await request(app)
          .get('/admin/audit-log?q=Scope&limit=1')
          .set('Authorization', authHeader)
        expect(qCursorRes.status).toBe(200)
        const qCursor = qCursorRes.body.nextCursor
        expect(qCursor).toBeTruthy()

        const qMismatchRes = await request(app)
          .get(`/admin/audit-log?q=Other&cursor=${encodeURIComponent(qCursor)}`)
          .set('Authorization', authHeader)
        expect(qMismatchRes.status).toBe(422)
        expect(qMismatchRes.body.error.code).toBe('VALIDATION_ERROR')
      })
    })

    describe('3.5 No work-item stream inclusion', () => {
      it('completely isolates administrative audit log from activity_events, comments, and local membership events', async () => {
        const { authHeader, user: admin } = await adminAuth()
        const team = await seedTeam({ name: 'Work Item Team' })
        const item = await seedItem(team.id, { title: 'Test Work Item' })

        // Populate activity_events (item history)
        await db.insert(activityEvents).values([
          {
            workItemId: item.id,
            actorId: admin.id,
            type: 'status_changed',
            fromValue: 'todo',
            toValue: 'done',
            metadata: { note: 'Work item stream activity' },
          },
          {
            workItemId: item.id,
            actorId: admin.id,
            type: 'priority_changed',
            fromValue: 'medium',
            toValue: 'urgent',
            metadata: { reason: 'Escalation' },
          },
        ])

        // Populate comments
        await db.insert(comments).values({
          workItemId: item.id,
          authorId: admin.id,
          body: 'Discussion comment on work item',
        })

        // Populate local membership_events
        await db.insert(membershipEvents).values({
          teamId: team.id,
          actorId: admin.id,
          subjectUserId: admin.id,
          action: 'role_changed',
          fromRole: 'member',
          toRole: 'lead',
        })

        // Verify that GET /admin/audit-log returns NO rows despite activityEvents, comments, and membershipEvents existing
        const initialRes = await request(app)
          .get('/admin/audit-log')
          .set('Authorization', authHeader)

        expect(initialRes.status).toBe(200)
        expect(initialRes.body).toEqual({ events: [], nextCursor: null })

        // Now perform an administrative mutation (PATCH /admin/teams/:id/members/:userId)
        const targetUser = await seedUser()
        await seedMembership(targetUser.id, team.id, 'viewer')

        const patchRes = await request(app)
          .patch(`/admin/teams/${team.id}/members/${targetUser.id}`)
          .set('Authorization', authHeader)
          .send({ role: 'member' })
        expect(patchRes.status).toBe(200)

        // The audit endpoint must return ONLY the admin audit event, with zero work-item activity rows
        const auditRes = await request(app)
          .get('/admin/audit-log')
          .set('Authorization', authHeader)

        expect(auditRes.status).toBe(200)
        expect(auditRes.body.events).toHaveLength(1)
        expect(auditRes.body.events[0]).toMatchObject({
          action: 'membership_role_changed',
          targetType: 'membership',
          metadata: {
            teamId: team.id,
            fromRole: 'viewer',
            toRole: 'member',
          },
        })
      })
    })
  })
})
