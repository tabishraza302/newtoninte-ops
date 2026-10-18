import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../../src/app'
import { closeDb, pool } from '../../src/db/client'
import { hashPassword } from '../../src/services/crypto'
import { handlers } from '../../src/outbox/handlers'
import { runOnce } from '../../src/outbox/worker'
import { resetDb, seedMembership, seedTeam, seedUser } from '../helpers/db'

const MAILPIT_API = 'http://localhost:8025/api/v1/messages'

interface MailpitAddress {
  Name: string
  Address: string
}

interface MailpitMessageSummary {
  ID: string
  Subject: string
  To: MailpitAddress[]
}

interface MailpitMessageDetail {
  Text: string
  HTML: string
}

interface MailpitList {
  messages: MailpitMessageSummary[]
}

describe('end-to-end auth flow (Task 2.19)', () => {
  const app = createApp()

  beforeEach(async () => {
    await resetDb()
  })
  afterAll(closeDb)

  it('continuous flow through HTTP surface: lead invites, worker sends mail, user redeems via Mailpit code, logs in, checks /me, logs out, refresh fails', async () => {
    // 1. Seed a team + a lead member with unique identifiers
    const runId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const team = await seedTeam({ name: `Apollo Team ${runId}`, slug: `apollo-${runId}` })
    const leadPassword = 'LeadPassword123!'
    const leadPasswordHash = await hashPassword(leadPassword)
    const leadEmail = `lead_${runId}@apollo.test`
    const lead = await seedUser({
      email: leadEmail,
      passwordHash: leadPasswordHash,
      displayName: `Apollo Lead ${runId}`,
    })
    await seedMembership(lead.id, team.id, 'lead')

    // 2. Lead logs in via POST /auth/login to obtain access token
    const loginRes = await request(app)
      .post('/auth/login')
      .send({ email: leadEmail, password: leadPassword })

    expect(loginRes.status).toBe(200)
    expect(loginRes.body.user.id).toBe(lead.id)
    const leadAccessToken: string = loginRes.body.accessToken
    expect(typeof leadAccessToken).toBe('string')
    expect(leadAccessToken.length).toBeGreaterThan(0)

    // 3. Lead invites user via POST /teams/:id/invitations
    const invitedEmail = `newhire_${runId}@apollo.test`
    const inviteRes = await request(app)
      .post(`/teams/${team.id}/invitations`)
      .set('Authorization', `Bearer ${leadAccessToken}`)
      .send({
        email: invitedEmail,
        role: 'member',
        maxUses: 1,
      })

    expect(inviteRes.status).toBe(201)
    expect(inviteRes.body.invitation).toBeDefined()
    expect(inviteRes.body.invitation.email).toBe(invitedEmail)
    expect(inviteRes.body.invitation.role).toBe('member')

    // 4. Worker runOnce({ handlers }) processes the outbox job, sending mail to Mailpit
    const processed = await runOnce({ handlers })
    expect(processed).toBe(1)

    // 5. Extract redeem code from Mailpit (http://localhost:8025/api/v1/messages)
    const mailpitMessage = await vi.waitFor(
      async () => {
        const res = await fetch(MAILPIT_API)
        expect(res.status).toBe(200)
        const list = (await res.json()) as MailpitList
        const msg = list.messages.find((m) =>
          m.To.some((recipient) => recipient.Address === invitedEmail) && m.Subject.includes(team.name),
        )
        expect(msg).toBeDefined()
        return msg!
      },
      { timeout: 5000, interval: 100 },
    )

    const detailRes = await fetch(`http://localhost:8025/api/v1/message/${mailpitMessage.ID}`)
    expect(detailRes.status).toBe(200)
    const detail = (await detailRes.json()) as MailpitMessageDetail
    const bodyText = detail.Text || detail.HTML
    expect(bodyText).toBeDefined()

    // Match code pattern from URL query param: /redeem?code=...
    const codeMatch = bodyText.match(/[?&]code=([^&\s"'>]+)/)
    expect(codeMatch).not.toBeNull()
    const redeemCode = codeMatch![1]
    expect(redeemCode).toBeDefined()

    // 6. Redeem invite via POST /invitations/redeem (unauthenticated)
    const newHirePassword = 'NewHirePassword123!'
    const redeemRes = await request(app)
      .post('/invitations/redeem')
      .send({
        code: redeemCode,
        email: invitedEmail,
        password: newHirePassword,
        displayName: 'New Hire User',
      })

    expect(redeemRes.status).toBe(200)
    expect(redeemRes.body.teamId).toBe(team.id)
    expect(redeemRes.body.role).toBe('member')
    expect(redeemRes.body.user.email).toBe(invitedEmail)

    // 7. New user logs in via POST /auth/login
    const newHireLoginRes = await request(app)
      .post('/auth/login')
      .send({
        email: invitedEmail,
        password: newHirePassword,
      })

    expect(newHireLoginRes.status).toBe(200)
    const newHireAccessToken: string = newHireLoginRes.body.accessToken
    expect(typeof newHireAccessToken).toBe('string')
    expect(newHireAccessToken.length).toBeGreaterThan(0)

    const loginCookieHeader = newHireLoginRes.headers['set-cookie']
    expect(loginCookieHeader).toBeDefined()
    const loginCookies = Array.isArray(loginCookieHeader) ? loginCookieHeader : [String(loginCookieHeader)]
    const newHireRefreshCookie = loginCookies.find((c) => c.startsWith('refresh_token='))
    expect(newHireRefreshCookie).toBeDefined()

    // 8. GET /auth/me verifies new user has membership in the team
    const meRes = await request(app)
      .get('/auth/me')
      .set('Authorization', `Bearer ${newHireAccessToken}`)

    expect(meRes.status).toBe(200)
    expect(meRes.body.user.email).toBe(invitedEmail)
    expect(meRes.body.memberships).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          teamId: team.id,
          role: 'member',
        }),
      ]),
    )

    // 9. POST /auth/logout logs out and clears cookie
    const logoutRes = await request(app)
      .post('/auth/logout')
      .set('Cookie', loginCookies)

    expect(logoutRes.status).toBe(204)
    const logoutCookieHeader = logoutRes.headers['set-cookie']
    expect(logoutCookieHeader).toBeDefined()
    const logoutCookies = Array.isArray(logoutCookieHeader) ? logoutCookieHeader : [String(logoutCookieHeader)]
    const clearedRefreshCookie = logoutCookies.find((c) => c.startsWith('refresh_token='))
    expect(clearedRefreshCookie).toBeDefined()
    // Cleared cookie has Max-Age=0 or Expires in past
    expect(clearedRefreshCookie).toMatch(/Max-Age=0|expires=Thu, 01 Jan 1970/i)

    // 10. POST /auth/refresh with cleared/revoked token fails with 401 UNAUTHENTICATED
    // (a) Trying refresh with the original (now revoked by logout) refresh cookie
    const refreshRevokedRes = await request(app)
      .post('/auth/refresh')
      .set('Cookie', loginCookies)

    expect(refreshRevokedRes.status).toBe(401)
    expect(refreshRevokedRes.body.error.code).toBe('UNAUTHENTICATED')

    // (b) Trying refresh with the cleared cookie (or no cookie)
    const refreshClearedRes = await request(app)
      .post('/auth/refresh')
      .set('Cookie', logoutCookies)

    expect(refreshClearedRes.status).toBe(401)
    expect(refreshClearedRes.body.error.code).toBe('UNAUTHENTICATED')
  })
})
