import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { resetDb, seedMembership, seedTeam, seedUser } from '../helpers/db'
import { closeDb, pool } from '../../src/db/client'
import { createInvitation, redeem, type RedeemResult } from '../../src/services/invitations'
import { setMemberRole, removeMember } from '../../src/services/memberships'
import { ApiError } from '../../src/http/errors'
import type { Actor } from '../../src/domain/types'

interface MembershipEventRow {
  id: number
  team_id: number
  actor_id: number
  subject_user_id: number
  action: string
  from_role: string | null
  to_role: string | null
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

async function fetchMembershipEvents(teamId: number): Promise<MembershipEventRow[]> {
  const [rows] = await pool.query(
    'SELECT id, team_id, actor_id, subject_user_id, action, from_role, to_role FROM membership_events WHERE team_id = ? ORDER BY id ASC',
    [teamId],
  )
  return rows as MembershipEventRow[]
}

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

describe('invite race, last lead, and membership events tests (Task 2.21)', () => {
  beforeEach(resetDb)
  afterAll(closeDb)

  it('(a) §13 "Invite race": two parallel redeem() calls for a max_uses=1 invite with the same valid code+email -> exactly ONE succeeds (200), the other gets 409 (INVITE_EXHAUSTED or ALREADY_MEMBER), exactly one membership created, and uses === 1', async () => {
    const team = await seedTeam({ name: 'Race Team', slug: 'race-team' })
    const lead = await seedUser({ email: 'lead@race.test' })
    await seedMembership(lead.id, team.id, 'lead')
    const leadActor: Actor = { id: lead.id, isAdmin: false }

    const candidateEmail = 'candidate@race.test'
    const inv = await createInvitation(leadActor, team.id, {
      email: candidateEmail,
      role: 'member',
      maxUses: 1,
    })
    const code = await fetchOutboxInviteCode(inv.id)

    // Launch two parallel redeem calls with the same code and email
    const results = await Promise.allSettled([
      redeem(null, {
        code,
        email: candidateEmail,
        password: 'Password123!',
        displayName: 'Candidate 1',
      }),
      redeem(null, {
        code,
        email: candidateEmail,
        password: 'Password123!',
        displayName: 'Candidate 2',
      }),
    ])

    const fulfilled = results.filter(
      (r): r is PromiseFulfilledResult<RedeemResult> =>
        r.status === 'fulfilled',
    )
    const rejected = results.filter(
      (r): r is PromiseRejectedResult => r.status === 'rejected',
    )

    // Exactly one succeeds
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)

    // The other gets 409 (either INVITE_EXHAUSTED or ALREADY_MEMBER)
    const error = rejected[0]?.reason
    expect(error).toBeInstanceOf(ApiError)
    const apiError = error as ApiError
    expect(apiError.status).toBe(409)
    expect(['INVITE_EXHAUSTED', 'ALREADY_MEMBER']).toContain(apiError.code)

    // uses === 1 in DB
    const [invRows] = await pool.query('SELECT uses FROM invitations WHERE id = ?', [inv.id])
    expect((invRows as { uses: number }[])[0]?.uses).toBe(1)

    // Exactly one membership created for this team (plus the original lead)
    const [membershipRows] = await pool.query(
      'SELECT id, role, user_id FROM memberships WHERE team_id = ?',
      [team.id],
    )
    const members = membershipRows as { id: number; role: string; user_id: number }[]
    expect(members).toHaveLength(2)
    const nonLeadMembers = members.filter((m) => m.role === 'member')
    expect(nonLeadMembers).toHaveLength(1)
    expect(nonLeadMembers[0]?.user_id).toBe(fulfilled[0]!.value.user.id)
  })

  it('(b) §13 "Last lead": demoting the only lead throws LAST_LEAD (422) and no membership row is changed', async () => {
    const team = await seedTeam({ name: 'Solo Team', slug: 'solo-team' })
    const onlyLead = await seedUser({ email: 'solo-lead@solo.test' })
    await seedMembership(onlyLead.id, team.id, 'lead')
    const leadActor: Actor = { id: onlyLead.id, isAdmin: false }

    // Attempting to demote the sole lead to 'member' -> LAST_LEAD (422)
    const err = await errorCode(() =>
      setMemberRole(leadActor, team.id, onlyLead.id, 'member'),
    )
    expect(err).toBe('LAST_LEAD')

    // Verify membership role remains 'lead'
    const [rowsAfterDemote] = await pool.query(
      'SELECT role FROM memberships WHERE team_id = ? AND user_id = ?',
      [team.id, onlyLead.id],
    )
    expect((rowsAfterDemote as { role: string }[])[0]?.role).toBe('lead')

    // Attempting to remove the sole lead -> LAST_LEAD (422)
    const removeErr = await errorCode(() =>
      removeMember(leadActor, team.id, onlyLead.id),
    )
    expect(removeErr).toBe('LAST_LEAD')

    // Verify membership is still present and role remains 'lead'
    const [rowsAfterRemove] = await pool.query(
      'SELECT role FROM memberships WHERE team_id = ? AND user_id = ?',
      [team.id, onlyLead.id],
    )
    expect((rowsAfterRemove as { role: string }[])[0]?.role).toBe('lead')
  })

  it('(c) every membership change produces its corresponding membership_events row (joined/role_changed/removed)', async () => {
    const team = await seedTeam({ name: 'Audit Team', slug: 'audit-team' })
    const lead = await seedUser({ email: 'audit-lead@audit.test' })
    await seedMembership(lead.id, team.id, 'lead')
    const leadActor: Actor = { id: lead.id, isAdmin: false }

    // 1. joined event via redeem
    const inv = await createInvitation(leadActor, team.id, {
      email: 'member@audit.test',
      role: 'member',
      maxUses: 1,
    })
    const code = await fetchOutboxInviteCode(inv.id)

    const redeemResult = await redeem(null, {
      code,
      email: 'member@audit.test',
      password: 'AuditPassword123!',
      displayName: 'Audit Member',
    })
    const newUserId = redeemResult.user.id

    // 2. role_changed event via setMemberRole
    await setMemberRole(leadActor, team.id, newUserId, 'viewer')

    // 3. removed event via removeMember
    await removeMember(leadActor, team.id, newUserId)

    // Check all events in order
    const events = await fetchMembershipEvents(team.id)
    expect(events).toHaveLength(3)

    // Verify joined event
    expect(events[0]?.action).toBe('joined')
    expect(events[0]?.subject_user_id).toBe(newUserId)
    expect(events[0]?.from_role).toBeNull()
    expect(events[0]?.to_role).toBe('member')

    // Verify role_changed event
    expect(events[1]?.action).toBe('role_changed')
    expect(events[1]?.subject_user_id).toBe(newUserId)
    expect(events[1]?.actor_id).toBe(lead.id)
    expect(events[1]?.from_role).toBe('member')
    expect(events[1]?.to_role).toBe('viewer')

    // Verify removed event
    expect(events[2]?.action).toBe('removed')
    expect(events[2]?.subject_user_id).toBe(newUserId)
    expect(events[2]?.actor_id).toBe(lead.id)
    expect(events[2]?.from_role).toBe('viewer')
    expect(events[2]?.to_role).toBeNull()
  })
})
