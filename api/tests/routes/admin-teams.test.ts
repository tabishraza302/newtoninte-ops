import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { eq, isNull } from 'drizzle-orm'
import { createApp } from '../../src/app'
import { closeDb, db } from '../../src/db/client'
import { membershipEvents, memberships, refreshTokens, users } from '../../src/db/schema'
import { signAccessToken } from '../../src/services/tokens'
import { setUserStatus } from '../../src/services/users'
import { resetDb, seedMembership, seedTeam, seedUser } from '../helpers/db'

describe('Admin team roster and session revocation routes', () => {
  const app = createApp()

  beforeEach(async () => {
    await resetDb()
  })

  afterAll(async () => {
    await closeDb()
  })

  async function adminAuth(): Promise<{ authHeader: string; user: typeof users.$inferSelect }> {
    const admin = await seedUser({ isAdmin: true })
    const token = await signAccessToken(admin.id)
    return { authHeader: `Bearer ${token}`, user: admin }
  }

  async function memberAuth(): Promise<{ authHeader: string; user: typeof users.$inferSelect }> {
    const member = await seedUser({ isAdmin: false })
    const token = await signAccessToken(member.id)
    return { authHeader: `Bearer ${token}`, user: member }
  }

  describe('1. Session Revocation on Account Disable', () => {
    it('disabling a user revokes active refresh tokens', async () => {
      const { authHeader, user: admin } = await adminAuth()
      const targetUser = await seedUser({ isAdmin: false })

      // Seed an active refresh token and an already revoked refresh token for target user
      const [activeToken] = await db
        .insert(refreshTokens)
        .values({
          userId: targetUser.id,
          tokenHash: 'hash-active-token-1',
          familyId: 'family-1',
          expiresAt: new Date(Date.now() + 1000 * 60 * 60),
          revokedAt: null,
        })
        .$returningId()

      const pastRevokedAt = new Date(Date.now() - 1000 * 60)
      const [revokedToken] = await db
        .insert(refreshTokens)
        .values({
          userId: targetUser.id,
          tokenHash: 'hash-revoked-token-2',
          familyId: 'family-2',
          expiresAt: new Date(Date.now() + 1000 * 60 * 60),
          revokedAt: pastRevokedAt,
        })
        .$returningId()

      // Calling setUserStatus directly or via PATCH /admin/users/:id
      const res = await request(app)
        .patch(`/admin/users/${targetUser.id}`)
        .set('Authorization', authHeader)
        .send({ status: 'disabled' })

      expect(res.status).toBe(204)

      // Verify the target user is disabled
      const [userInDb] = await db.select().from(users).where(eq(users.id, targetUser.id)).limit(1)
      expect(userInDb?.status).toBe('disabled')

      // Verify active token was revoked
      const [updatedActive] = await db
        .select()
        .from(refreshTokens)
        .where(eq(refreshTokens.id, activeToken!.id))
        .limit(1)
      expect(updatedActive?.revokedAt).not.toBeNull()

      // Verify previously revoked token was not overwritten with a new timestamp
      const [updatedRevoked] = await db
        .select()
        .from(refreshTokens)
        .where(eq(refreshTokens.id, revokedToken!.id))
        .limit(1)
      expect(updatedRevoked?.revokedAt?.getTime()).toBe(pastRevokedAt.getTime())
    })
  })

  describe('2. Admin Team Roster Inspection (GET /admin/teams/:id/members)', () => {
    it('admin can list team members on GET /admin/teams/:id/members', async () => {
      const { authHeader } = await adminAuth()
      const team = await seedTeam({ name: 'Alpha Team' })
      const leadUser = await seedUser({ displayName: 'Alice Lead', email: 'alice@alpha.test' })
      const memberUser = await seedUser({ displayName: 'Bob Member', email: 'bob@alpha.test' })

      await seedMembership(leadUser.id, team.id, 'lead')
      await seedMembership(memberUser.id, team.id, 'member')

      const res = await request(app)
        .get(`/admin/teams/${team.id}/members`)
        .set('Authorization', authHeader)

      expect(res.status).toBe(200)
      expect(res.body).toHaveProperty('members')
      expect(Array.isArray(res.body.members)).toBe(true)
      expect(res.body.members).toHaveLength(2)

      const first = res.body.members[0]
      expect(first).toMatchObject({
        teamId: team.id,
        userId: leadUser.id,
        role: 'lead',
        user: {
          id: leadUser.id,
          email: 'alice@alpha.test',
          displayName: 'Alice Lead',
        },
      })
      expect(first).toHaveProperty('createdAt')

      const second = res.body.members[1]
      expect(second).toMatchObject({
        teamId: team.id,
        userId: memberUser.id,
        role: 'member',
        user: {
          id: memberUser.id,
          email: 'bob@alpha.test',
          displayName: 'Bob Member',
        },
      })
    })

    it('non-admin gets 403 on GET /admin/teams/:id/members', async () => {
      const { authHeader } = await memberAuth()
      const team = await seedTeam()

      const res = await request(app)
        .get(`/admin/teams/${team.id}/members`)
        .set('Authorization', authHeader)

      expect(res.status).toBe(403)
      expect(res.body.error.code).toBe('FORBIDDEN')
    })

    it('404 for nonexistent team on GET /admin/teams/:id/members', async () => {
      const { authHeader } = await adminAuth()

      const res = await request(app)
        .get('/admin/teams/999999/members')
        .set('Authorization', authHeader)

      expect(res.status).toBe(404)
      expect(res.body.error.code).toBe('NOT_FOUND')
    })
  })

  describe('3. Admin Team Member Removal (DELETE /admin/teams/:id/members/:userId)', () => {
    it('admin can remove a non-lead member on DELETE /admin/teams/:id/members/:userId', async () => {
      const { authHeader, user: adminUser } = await adminAuth()
      const team = await seedTeam()
      const lead = await seedUser()
      const member = await seedUser()

      await seedMembership(lead.id, team.id, 'lead')
      await seedMembership(member.id, team.id, 'member')

      const res = await request(app)
        .delete(`/admin/teams/${team.id}/members/${member.id}`)
        .set('Authorization', authHeader)

      expect(res.status).toBe(204)

      // Ensure membership is gone
      const remaining = await db
        .select()
        .from(memberships)
        .where(eq(memberships.teamId, team.id))

      expect(remaining).toHaveLength(1)
      expect(remaining[0]?.userId).toBe(lead.id)

      // Ensure membershipEvents audit row is recorded
      const events = await db
        .select()
        .from(membershipEvents)
        .where(eq(membershipEvents.teamId, team.id))

      expect(events).toHaveLength(1)
      expect(events[0]).toMatchObject({
        teamId: team.id,
        actorId: adminUser.id,
        subjectUserId: member.id,
        action: 'removed',
        fromRole: 'member',
        toRole: null,
      })
    })

    it('removing the only lead returns 422 LAST_LEAD', async () => {
      const { authHeader } = await adminAuth()
      const team = await seedTeam()
      const lead = await seedUser()
      const member = await seedUser()

      await seedMembership(lead.id, team.id, 'lead')
      await seedMembership(member.id, team.id, 'member')

      const res = await request(app)
        .delete(`/admin/teams/${team.id}/members/${lead.id}`)
        .set('Authorization', authHeader)

      expect(res.status).toBe(422)
      expect(res.body.error.code).toBe('LAST_LEAD')

      // Ensure membership is intact
      const leads = await db
        .select()
        .from(memberships)
        .where(eq(memberships.teamId, team.id))
      expect(leads).toHaveLength(2)
    })

    it('admin can remove a lead if another lead exists', async () => {
      const { authHeader } = await adminAuth()
      const team = await seedTeam()
      const lead1 = await seedUser()
      const lead2 = await seedUser()

      await seedMembership(lead1.id, team.id, 'lead')
      await seedMembership(lead2.id, team.id, 'lead')

      const res = await request(app)
        .delete(`/admin/teams/${team.id}/members/${lead1.id}`)
        .set('Authorization', authHeader)

      expect(res.status).toBe(204)

      const remaining = await db
        .select()
        .from(memberships)
        .where(eq(memberships.teamId, team.id))
      expect(remaining).toHaveLength(1)
      expect(remaining[0]?.userId).toBe(lead2.id)
    })

    it('removing a non-member returns 404', async () => {
      const { authHeader } = await adminAuth()
      const team = await seedTeam()
      const nonMember = await seedUser()

      const res = await request(app)
        .delete(`/admin/teams/${team.id}/members/${nonMember.id}`)
        .set('Authorization', authHeader)

      expect(res.status).toBe(404)
      expect(res.body.error.code).toBe('NOT_FOUND')
    })

    it('non-admin gets 403 on DELETE /admin/teams/:id/members/:userId', async () => {
      const { authHeader } = await memberAuth()
      const team = await seedTeam()
      const member = await seedUser()
      await seedMembership(member.id, team.id, 'member')

      const res = await request(app)
        .delete(`/admin/teams/${team.id}/members/${member.id}`)
        .set('Authorization', authHeader)

      expect(res.status).toBe(403)
      expect(res.body.error.code).toBe('FORBIDDEN')
    })
  })
})
