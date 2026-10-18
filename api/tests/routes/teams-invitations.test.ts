import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import request from 'supertest'
import { createApp } from '../../src/app'
import { closeDb, pool } from '../../src/db/client'
import { resetDb, seedMembership, seedTeam, seedUser } from '../helpers/db'
import { expectPublicUser } from '../helpers/publicUser'
import { createInvitation } from '../../src/services/invitations'
import { signAccessToken } from '../../src/services/tokens'
import type { Actor } from '../../src/domain/types'

async function fetchOutboxInviteCode(inviteId: number): Promise<string> {
  const [rows] = await pool.query(
    'SELECT payload FROM outbox_jobs WHERE dedupe_key = ?',
    [`invite:${inviteId}`],
  )
  const raw = (rows as { payload: unknown }[])[0]?.payload
  const payload = typeof raw === 'string' ? JSON.parse(raw) : (raw as { code: string })
  return payload.code
}

describe('Teams and Invitations routes (Task 2.17)', () => {
  const app = createApp()

  beforeEach(resetDb)
  afterAll(closeDb)

  it('POST /invitations/redeem unauthenticated -> 200 + refresh cookie, repeat with same code -> 409 ALREADY_MEMBER', async () => {
    const team = await seedTeam({ name: 'Phoenix Team', slug: 'phoenix' })
    const lead = await seedUser({ email: 'lead@example.test' })
    await seedMembership(lead.id, team.id, 'lead')
    const leadActor: Actor = { id: lead.id, isAdmin: false }

    const inv = await createInvitation(leadActor, team.id, {
      email: 'newbie@example.test',
      role: 'member',
      maxUses: 5,
    })
    const code = await fetchOutboxInviteCode(inv.id)

    // First redeem unauthenticated -> creates user, sets refresh cookie
    const res1 = await request(app)
      .post('/invitations/redeem')
      .send({
        code,
        email: 'newbie@example.test',
        password: 'password-1234',
        displayName: 'Newbie User',
      })

    expect(res1.status).toBe(200)
    expect(res1.body.teamId).toBe(team.id)
    expect(res1.body.role).toBe('member')
    expect(res1.body.user.email).toBe('newbie@example.test')
    expectPublicUser(res1.body.user)
    expect(res1.body.accessToken).toBeTypeOf('string')

    // Verify refresh cookie set
    const cookies = res1.headers['set-cookie']
    expect(cookies).toBeDefined()
    const refreshCookie = Array.isArray(cookies) ? cookies.find((c) => c.startsWith('refresh_token=')) : cookies
    expect(refreshCookie).toBeDefined()
    expect(refreshCookie).toContain('HttpOnly')

    // Second redeem with same code by same authenticated user (now already a member) -> 409 ALREADY_MEMBER
    const accessToken = res1.body.accessToken as string
    const res2 = await request(app)
      .post('/invitations/redeem')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ code })

    expect(res2.status).toBe(409)
    expect(res2.body.error.code).toBe('ALREADY_MEMBER')
  })

  it('POST /teams/:id/invitations: viewer gets 403 FORBIDDEN, lead gets 201 created', async () => {
    const team = await seedTeam({ name: 'Alpha Team', slug: 'alpha' })

    const viewer = await seedUser({ email: 'viewer@alpha.test' })
    await seedMembership(viewer.id, team.id, 'viewer')
    const viewerToken = await signAccessToken(viewer.id)

    const lead = await seedUser({ email: 'lead@alpha.test' })
    await seedMembership(lead.id, team.id, 'lead')
    const leadToken = await signAccessToken(lead.id)

    // Viewer calling POST /teams/:id/invitations -> 403 FORBIDDEN
    const resViewer = await request(app)
      .post(`/teams/${team.id}/invitations`)
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({
        email: 'invitee1@alpha.test',
        role: 'member',
      })

    expect(resViewer.status).toBe(403)
    expect(resViewer.body.error.code).toBe('FORBIDDEN')

    // Lead calling POST /teams/:id/invitations -> 201 created
    const resLead = await request(app)
      .post(`/teams/${team.id}/invitations`)
      .set('Authorization', `Bearer ${leadToken}`)
      .send({
        email: 'invitee2@alpha.test',
        role: 'member',
        maxUses: 2,
      })

    expect(resLead.status).toBe(201)
    expect(resLead.body.invitation).toBeDefined()
    expect(resLead.body.invitation.email).toBe('invitee2@alpha.test')
    expect(resLead.body.invitation.role).toBe('member')
    expect(resLead.body.invitation.teamId).toBe(team.id)
    expect(resLead.body.invitation.codeHash).toBeUndefined()
  })

  it('GET /teams/:id/members is paginated with nextCursor', async () => {
    const team = await seedTeam({ name: 'Beta Team', slug: 'beta' })
    const lead = await seedUser({ email: 'lead@beta.test' })
    await seedMembership(lead.id, team.id, 'lead')
    const leadToken = await signAccessToken(lead.id)

    // Seed 4 members
    for (let i = 1; i <= 4; i++) {
      const u = await seedUser({ email: `member${i}@beta.test` })
      await seedMembership(u.id, team.id, 'member')
    }

    // Page 1: limit=2
    const page1 = await request(app)
      .get(`/teams/${team.id}/members?limit=2`)
      .set('Authorization', `Bearer ${leadToken}`)

    expect(page1.status).toBe(200)
    expect(page1.body.members).toHaveLength(2)
    expect(page1.body.nextCursor).toBeTypeOf('string')

    // Page 2: with cursor
    const page2 = await request(app)
      .get(`/teams/${team.id}/members?limit=2&cursor=${encodeURIComponent(page1.body.nextCursor as string)}`)
      .set('Authorization', `Bearer ${leadToken}`)

    expect(page2.status).toBe(200)
    expect(page2.body.members).toHaveLength(2)
    expect(page2.body.nextCursor).toBeTypeOf('string')

    // Page 3: final page
    const page3 = await request(app)
      .get(`/teams/${team.id}/members?limit=2&cursor=${encodeURIComponent(page2.body.nextCursor as string)}`)
      .set('Authorization', `Bearer ${leadToken}`)

    expect(page3.status).toBe(200)
    expect(page3.body.members).toHaveLength(1)
    expect(page3.body.nextCursor).toBeNull()
  })

  it('POST /teams/:id/members: admin direct-add returns 201 created', async () => {
    const team = await seedTeam({ name: 'Gamma Team', slug: 'gamma' })
    const admin = await seedUser({ email: 'admin@system.test', isAdmin: true })
    const adminToken = await signAccessToken(admin.id)

    const targetUser = await seedUser({ email: 'target@system.test' })

    const res = await request(app)
      .post(`/teams/${team.id}/members`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        userId: targetUser.id,
        role: 'member',
      })

    expect(res.status).toBe(201)
    expect(res.body).toEqual({ status: 'created' })

    // Verify membership exists
    const [rows] = await pool.query(
      'SELECT role FROM memberships WHERE team_id = ? AND user_id = ?',
      [team.id, targetUser.id],
    )
    expect((rows as { role: string }[])[0]?.role).toBe('member')
  })

  it('Lead sets member role and removes member', async () => {
    const team = await seedTeam({ name: 'Delta Team', slug: 'delta' })

    const lead1 = await seedUser({ email: 'lead1@delta.test' })
    await seedMembership(lead1.id, team.id, 'lead')
    const lead1Token = await signAccessToken(lead1.id)

    const member = await seedUser({ email: 'user@delta.test' })
    await seedMembership(member.id, team.id, 'member')

    // Update member role to lead
    const patchRes = await request(app)
      .patch(`/teams/${team.id}/members/${member.id}`)
      .set('Authorization', `Bearer ${lead1Token}`)
      .send({ role: 'lead' })

    expect(patchRes.status).toBe(200)
    expect(patchRes.body).toEqual({ status: 'ok' })

    const [updatedRows] = await pool.query(
      'SELECT role FROM memberships WHERE team_id = ? AND user_id = ?',
      [team.id, member.id],
    )
    expect((updatedRows as { role: string }[])[0]?.role).toBe('lead')

    // Remove the newly promoted lead (still lead1 remains, so no LAST_LEAD violation)
    const delRes = await request(app)
      .delete(`/teams/${team.id}/members/${member.id}`)
      .set('Authorization', `Bearer ${lead1Token}`)

    expect(delRes.status).toBe(204)

    const [afterDelRows] = await pool.query(
      'SELECT role FROM memberships WHERE team_id = ? AND user_id = ?',
      [team.id, member.id],
    )
    expect((afterDelRows as { role: string }[]).length).toBe(0)
  })

  it('GET /teams and GET /teams/:id and DELETE /invitations/:id', async () => {
    const team1 = await seedTeam({ name: 'Team One', slug: 'team-one' })
    const team2 = await seedTeam({ name: 'Team Two', slug: 'team-two' })

    const lead = await seedUser({ email: 'lead@teamone.test' })
    await seedMembership(lead.id, team1.id, 'lead')
    const leadToken = await signAccessToken(lead.id)

    // GET /teams scoped to memberships
    const listRes = await request(app)
      .get('/teams')
      .set('Authorization', `Bearer ${leadToken}`)

    expect(listRes.status).toBe(200)
    expect(listRes.body.teams).toHaveLength(1)
    expect(listRes.body.teams[0].id).toBe(team1.id)

    // GET /teams/:id
    const getRes = await request(app)
      .get(`/teams/${team1.id}`)
      .set('Authorization', `Bearer ${leadToken}`)

    expect(getRes.status).toBe(200)
    expect(getRes.body.team.id).toBe(team1.id)

    // Out-of-team get -> 404
    const notFoundRes = await request(app)
      .get(`/teams/${team2.id}`)
      .set('Authorization', `Bearer ${leadToken}`)

    expect(notFoundRes.status).toBe(404)

    // POST /teams/:id/invitations then GET /teams/:id/invitations then DELETE /invitations/:id
    const createInvRes = await request(app)
      .post(`/teams/${team1.id}/invitations`)
      .set('Authorization', `Bearer ${leadToken}`)
      .send({ email: 'revoke-me@teamone.test', role: 'viewer' })

    expect(createInvRes.status).toBe(201)
    const invId = createInvRes.body.invitation.id as number

    const listInvRes = await request(app)
      .get(`/teams/${team1.id}/invitations`)
      .set('Authorization', `Bearer ${leadToken}`)

    expect(listInvRes.status).toBe(200)
    expect(listInvRes.body.invitations).toHaveLength(1)

    const delInvRes = await request(app)
      .delete(`/invitations/${invId}`)
      .set('Authorization', `Bearer ${leadToken}`)

    expect(delInvRes.status).toBe(204)

    // Revoked invitations are excluded from active list
    const listInvAfterRes = await request(app)
      .get(`/teams/${team1.id}/invitations`)
      .set('Authorization', `Bearer ${leadToken}`)

    expect(listInvAfterRes.status).toBe(200)
    expect(listInvAfterRes.body.invitations[0].revokedAt).toBeTruthy()
  })
})
