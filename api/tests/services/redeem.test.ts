import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { resetDb, seedUser, seedTeam, seedMembership } from '../helpers/db'
import { closeDb, pool } from '../../src/db/client'
import { createInvitation, redeem } from '../../src/services/invitations'
import { removeMember } from '../../src/services/memberships'
import { hashPassword } from '../../src/services/crypto'
import { ApiError } from '../../src/http/errors'
import type { Actor } from '../../src/domain/types'

async function errorCode(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn()
    return 'NO_THROW'
  } catch (e: unknown) {
    if (e instanceof ApiError) {
      return e.code
    }
    throw e
  }
}

async function fetchOutboxInviteCode(inviteId: number): Promise<string> {
  const [rows] = await pool.query(
    'SELECT payload FROM outbox_jobs WHERE dedupe_key = ?',
    [`invite:${inviteId}`],
  )
  const raw = (rows as { payload: unknown }[])[0]?.payload
  const payload = typeof raw === 'string' ? JSON.parse(raw) : (raw as { code: string })
  return payload.code
}

describe('invitations service: redeem (Task 2.10)', () => {
  beforeEach(resetDb)
  afterAll(closeDb)

  it('(a) unauthenticated happy path: creates user, membership, joined event, uses===1, returns tokens', async () => {
    const team = await seedTeam({ name: 'Phoenix Team' })
    const lead = await seedUser({ email: 'lead@example.test' })
    await seedMembership(lead.id, team.id, 'lead')
    const leadActor: Actor = { id: lead.id, isAdmin: false }

    const inv = await createInvitation(leadActor, team.id, {
      email: 'newbie@example.test',
      role: 'member',
    })
    const code = await fetchOutboxInviteCode(inv.id)

    const result = await redeem(null, {
      code,
      email: 'newbie@example.test',
      password: 'new-password-123',
      displayName: 'Newbie User',
    })

    expect(result.user.email).toBe('newbie@example.test')
    expect(result.user.displayName).toBe('Newbie User')
    expect(result.teamId).toBe(team.id)
    expect(result.role).toBe('member')
    expect(result.accessToken).toBeTruthy()
    expect(result.refreshToken).toBeTruthy()

    // uses === 1
    const [invRows] = await pool.query('SELECT uses FROM invitations WHERE id = ?', [inv.id])
    expect((invRows as { uses: number }[])[0]?.uses).toBe(1)

    // Joined event written
    const [eventRows] = await pool.query(
      'SELECT action, subject_user_id, to_role FROM membership_events WHERE team_id = ? AND subject_user_id = ?',
      [team.id, result.user.id],
    )
    const events = eventRows as Array<{ action: string; to_role: string | null }>
    expect(events[0]?.action).toBe('joined')
    expect(events[0]?.to_role).toBe('member')
  })

  it('(b) wrong email throws FORBIDDEN', async () => {
    const team = await seedTeam()
    const lead = await seedUser({ email: 'lead@example.test' })
    await seedMembership(lead.id, team.id, 'lead')
    const leadActor: Actor = { id: lead.id, isAdmin: false }

    const inv = await createInvitation(leadActor, team.id, {
      email: 'target@example.test',
      role: 'viewer',
    })
    const code = await fetchOutboxInviteCode(inv.id)

    expect(
      await errorCode(() =>
        redeem(null, {
          code,
          email: 'wrong@example.test',
          password: 'password123',
        }),
      ),
    ).toBe('FORBIDDEN')
  })

  it('(c) authenticated join by the invited user: membership added to existing user', async () => {
    const team = await seedTeam()
    const lead = await seedUser({ email: 'lead@example.test' })
    await seedMembership(lead.id, team.id, 'lead')
    const leadActor: Actor = { id: lead.id, isAdmin: false }

    const existingUser = await seedUser({ email: 'existing@example.test' })
    const existingActor: Actor = { id: existingUser.id, isAdmin: false }

    const inv = await createInvitation(leadActor, team.id, {
      email: 'existing@example.test',
      role: 'member',
    })
    const code = await fetchOutboxInviteCode(inv.id)

    const result = await redeem(existingActor, { code })
    expect(result.user.id).toBe(existingUser.id)
    expect(result.teamId).toBe(team.id)
    expect(result.role).toBe('member')
  })

  it('(d) already a member throws ALREADY_MEMBER and uses is unchanged', async () => {
    const team = await seedTeam()
    const lead = await seedUser({ email: 'lead@example.test' })
    await seedMembership(lead.id, team.id, 'lead')
    const leadActor: Actor = { id: lead.id, isAdmin: false }

    const inv = await createInvitation(leadActor, team.id, {
      email: 'lead@example.test',
      role: 'member',
    })
    const code = await fetchOutboxInviteCode(inv.id)

    // Lead is already a member of this team
    expect(await errorCode(() => redeem(leadActor, { code }))).toBe('ALREADY_MEMBER')

    // uses is unchanged
    const [invRows] = await pool.query('SELECT uses FROM invitations WHERE id = ?', [inv.id])
    expect((invRows as { uses: number }[])[0]?.uses).toBe(0)
  })

  it('(e) unauthenticated redeem with existing account: verifies password (no duplicate, no 500) and wrong password 403s', async () => {
    const team = await seedTeam()
    const lead = await seedUser({ email: 'lead@example.test' })
    await seedMembership(lead.id, team.id, 'lead')
    const leadActor: Actor = { id: lead.id, isAdmin: false }

    const pwHash = await hashPassword('correct-horse-battery-staple')
    const user = await seedUser({ email: 'known@example.test', passwordHash: pwHash })

    const inv = await createInvitation(leadActor, team.id, {
      email: 'known@example.test',
      role: 'member',
    })
    const code = await fetchOutboxInviteCode(inv.id)

    // Wrong password -> FORBIDDEN
    expect(
      await errorCode(() =>
        redeem(null, {
          code,
          email: 'known@example.test',
          password: 'wrong-password',
        }),
      ),
    ).toBe('FORBIDDEN')

    // Correct password -> succeeds
    const result = await redeem(null, {
      code,
      email: 'known@example.test',
      password: 'correct-horse-battery-staple',
    })

    expect(result.user.id).toBe(user.id)

    // Ensure exactly ONE user row exists for this email
    const [userRows] = await pool.query('SELECT COUNT(*) AS c FROM users WHERE email = ?', [
      'known@example.test',
    ])
    expect((userRows as { c: number }[])[0]?.c).toBe(1)
  })

  it('(f) handles exhausted, expired, and revoked invitations with exact error codes', async () => {
    const team = await seedTeam()
    const lead = await seedUser({ email: 'lead@example.test' })
    await seedMembership(lead.id, team.id, 'lead')
    const leadActor: Actor = { id: lead.id, isAdmin: false }

    // 1. Revoked
    const invRevoked = await createInvitation(leadActor, team.id, {
      email: 'rev@example.test',
      role: 'viewer',
    })
    const codeRev = await fetchOutboxInviteCode(invRevoked.id)
    await pool.query('UPDATE invitations SET revoked_at = CURRENT_TIMESTAMP(3) WHERE id = ?', [
      invRevoked.id,
    ])
    expect(
      await errorCode(() => redeem(null, { code: codeRev, email: 'rev@example.test', password: 'Password123!' })),
    ).toBe('INVITE_REVOKED')

    // 2. Expired
    const invExpired = await createInvitation(leadActor, team.id, {
      email: 'exp@example.test',
      role: 'viewer',
    })
    const codeExp = await fetchOutboxInviteCode(invExpired.id)
    await pool.query(
      'UPDATE invitations SET expires_at = DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 1 DAY) WHERE id = ?',
      [invExpired.id],
    )
    expect(
      await errorCode(() => redeem(null, { code: codeExp, email: 'exp@example.test', password: 'Password123!' })),
    ).toBe('INVITE_EXPIRED')

    // 3. Exhausted
    const invExhausted = await createInvitation(leadActor, team.id, {
      email: 'exh@example.test',
      role: 'viewer',
    })
    const codeExh = await fetchOutboxInviteCode(invExhausted.id)
    await pool.query('UPDATE invitations SET uses = 1 WHERE id = ?', [invExhausted.id])
    expect(
      await errorCode(() => redeem(null, { code: codeExh, email: 'exh@example.test', password: 'Password123!' })),
    ).toBe('INVITE_EXHAUSTED')

    // Historical row with uses = 2 is exhausted
    const invExhausted2 = await createInvitation(leadActor, team.id, {
      email: 'exh2@example.test',
      role: 'viewer',
    })
    const codeExh2 = await fetchOutboxInviteCode(invExhausted2.id)
    await pool.query('UPDATE invitations SET max_uses = 5, uses = 2 WHERE id = ?', [invExhausted2.id])
    expect(
      await errorCode(() => redeem(null, { code: codeExh2, email: 'exh2@example.test', password: 'Password123!' })),
    ).toBe('INVITE_EXHAUSTED')
  })

  it('(g) rejects disabled accounts on both unauthenticated and authenticated branches', async () => {
    const team = await seedTeam()
    const lead = await seedUser({ email: 'lead-dis@example.test' })
    await seedMembership(lead.id, team.id, 'lead')
    const leadActor: Actor = { id: lead.id, isAdmin: false }

    const pwHash = await hashPassword('KnownPassword123')
    const disabledUser = await seedUser({
      email: 'disabled-user@example.test',
      passwordHash: pwHash,
      status: 'disabled',
    })

    const inv = await createInvitation(leadActor, team.id, {
      email: 'disabled-user@example.test',
      role: 'member',
    })
    const code = await fetchOutboxInviteCode(inv.id)

    // Unauthenticated redeem with disabled user's credentials -> FORBIDDEN
    expect(
      await errorCode(() =>
        redeem(null, {
          code,
          email: 'disabled-user@example.test',
          password: 'KnownPassword123',
        }),
      ),
    ).toBe('FORBIDDEN')

    // Authenticated redeem with disabled actor -> FORBIDDEN
    const disabledActor: Actor = { id: disabledUser.id, isAdmin: false }
    expect(
      await errorCode(() =>
        redeem(disabledActor, { code }),
      ),
    ).toBe('FORBIDDEN')
  })

  it('(h) validates password boundary when creating a new account during redeem', async () => {
    const team = await seedTeam()
    const lead = await seedUser({ email: 'lead-pw@example.test' })
    await seedMembership(lead.id, team.id, 'lead')
    const leadActor: Actor = { id: lead.id, isAdmin: false }

    const inv = await createInvitation(leadActor, team.id, {
      email: 'new-acc@example.test',
      role: 'member',
    })
    const code = await fetchOutboxInviteCode(inv.id)

    // Password < 8 characters
    expect(
      await errorCode(() =>
        redeem(null, {
          code,
          email: 'new-acc@example.test',
          password: 'short',
        }),
      ),
    ).toBe('VALIDATION_ERROR')

    // Password > 72 bytes
    expect(
      await errorCode(() =>
        redeem(null, {
          code,
          email: 'new-acc@example.test',
          password: 'a'.repeat(73),
        }),
      ),
    ).toBe('VALIDATION_ERROR')
  })

  it('enforces single-use on historical invitations with max_uses > 1 even after member is removed', async () => {
    const team = await seedTeam({ name: 'Historical Team' })
    const lead = await seedUser({ email: 'lead-hist@example.test' })
    await seedMembership(lead.id, team.id, 'lead')
    const leadActor: Actor = { id: lead.id, isAdmin: false }

    const inv = await createInvitation(leadActor, team.id, {
      email: 'historical@example.test',
      role: 'member',
    })
    // Simulate historical row with max_uses = 5
    await pool.query('UPDATE invitations SET max_uses = 5 WHERE id = ?', [inv.id])
    const code = await fetchOutboxInviteCode(inv.id)

    // First redemption succeeds
    const result = await redeem(null, {
      code,
      email: 'historical@example.test',
      password: 'password123',
    })
    expect(result.teamId).toBe(team.id)

    // Remove the member as lead
    await removeMember(leadActor, team.id, result.user.id)

    // Try redeeming the same token again as the invitee
    const userActor: Actor = { id: result.user.id, isAdmin: false }
    expect(await errorCode(() => redeem(userActor, { code }))).toBe('INVITE_EXHAUSTED')

    // Verify usage still 1
    const [invRows] = await pool.query('SELECT uses FROM invitations WHERE id = ?', [inv.id])
    expect((invRows as { uses: number }[])[0]!.uses).toBe(1)

    // No replacement membership
    const [memRows] = await pool.query(
      'SELECT * FROM memberships WHERE team_id = ? AND user_id = ?',
      [team.id, result.user.id],
    )
    expect((memRows as unknown[]).length).toBe(0)

    // Exactly one joined event exists (no second joined event)
    const [eventRows] = await pool.query(
      "SELECT * FROM membership_events WHERE team_id = ? AND subject_user_id = ? AND action = 'joined'",
      [team.id, result.user.id],
    )
    expect((eventRows as unknown[]).length).toBe(1)
  })
})
