import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { resetDb, seedUser, seedTeam, seedMembership } from '../helpers/db'
import { closeDb, pool } from '../../src/db/client'
import {
  addMember,
  listMembers,
  setMemberRole,
  removeMember,
} from '../../src/services/memberships'
import { ApiError } from '../../src/http/errors'
import { encodeCursor } from '../../src/http/cursor'
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

async function fetchEvents(teamId: number): Promise<MembershipEventRow[]> {
  const [rows] = await pool.query(
    'SELECT id, team_id, actor_id, subject_user_id, action, from_role, to_role FROM membership_events WHERE team_id = ? ORDER BY id ASC',
    [teamId],
  )
  return rows as MembershipEventRow[]
}

async function fetchMembershipRole(teamId: number, userId: number): Promise<string | null> {
  const [rows] = await pool.query(
    'SELECT role FROM memberships WHERE team_id = ? AND user_id = ?',
    [teamId, userId],
  )
  const row = (rows as { role: string }[])[0]
  return row ? row.role : null
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

describe('memberships service', () => {
  beforeEach(resetDb)
  afterAll(closeDb)

  it('addMember: admin direct-adds user, writes joined event, throws ALREADY_MEMBER on duplicate', async () => {
    const admin: Actor = { id: (await seedUser()).id, isAdmin: true }
    const nonAdmin: Actor = { id: (await seedUser()).id, isAdmin: false }
    const team = await seedTeam()
    const targetUser = await seedUser({ email: 'target@example.test' })

    // Non-admin cannot direct-add
    expect(await errorCode(() => addMember(nonAdmin, team.id, targetUser.id, 'member'))).toBe('FORBIDDEN')

    // Admin direct-adds
    await addMember(admin, team.id, targetUser.id, 'member')
    expect(await fetchMembershipRole(team.id, targetUser.id)).toBe('member')

    // Event recorded
    const events = await fetchEvents(team.id)
    expect(events).toHaveLength(1)
    expect(events[0]?.action).toBe('joined')
    expect(events[0]?.actor_id).toBe(admin.id)
    expect(events[0]?.subject_user_id).toBe(targetUser.id)
    expect(events[0]?.from_role).toBeNull()
    expect(events[0]?.to_role).toBe('member')

    // Duplicate add -> ALREADY_MEMBER (409)
    expect(await errorCode(() => addMember(admin, team.id, targetUser.id, 'lead'))).toBe('ALREADY_MEMBER')
  })

  it('setMemberRole: writes role_changed event, prevents demoting the last lead with LAST_LEAD (422)', async () => {
    const team = await seedTeam()
    const leadUser = await seedUser({ email: 'lead@example.test' })
    const memberUser = await seedUser({ email: 'member@example.test' })

    await seedMembership(leadUser.id, team.id, 'lead')
    await seedMembership(memberUser.id, team.id, 'member')

    const leadActor: Actor = { id: leadUser.id, isAdmin: false }
    const memberActor: Actor = { id: memberUser.id, isAdmin: false }

    // Non-lead cannot manage roles -> FORBIDDEN
    expect(await errorCode(() => setMemberRole(memberActor, team.id, memberUser.id, 'lead'))).toBe('FORBIDDEN')

    // Attempting to demote the only lead -> LAST_LEAD (422), role stays 'lead'
    expect(await errorCode(() => setMemberRole(leadActor, team.id, leadUser.id, 'member'))).toBe('LAST_LEAD')
    expect(await fetchMembershipRole(team.id, leadUser.id)).toBe('lead')

    // Promote member to lead (now there are 2 leads)
    await setMemberRole(leadActor, team.id, memberUser.id, 'lead')
    expect(await fetchMembershipRole(team.id, memberUser.id)).toBe('lead')

    // Demoting one of the two leads is now allowed
    await setMemberRole(leadActor, team.id, leadUser.id, 'member')
    expect(await fetchMembershipRole(team.id, leadUser.id)).toBe('member')

    // Check events
    const events = await fetchEvents(team.id)
    expect(events).toHaveLength(2)
    expect(events[0]?.action).toBe('role_changed')
    expect(events[0]?.from_role).toBe('member')
    expect(events[0]?.to_role).toBe('lead')
    expect(events[1]?.action).toBe('role_changed')
    expect(events[1]?.from_role).toBe('lead')
    expect(events[1]?.to_role).toBe('member')
  })

  it('removeMember: writes removed event, prevents removing the last lead with LAST_LEAD (422)', async () => {
    const team = await seedTeam()
    const leadUser = await seedUser({ email: 'lead@example.test' })
    const memberUser = await seedUser({ email: 'member@example.test' })

    await seedMembership(leadUser.id, team.id, 'lead')
    await seedMembership(memberUser.id, team.id, 'member')

    const leadActor: Actor = { id: leadUser.id, isAdmin: false }

    // Attempting to remove the last lead -> LAST_LEAD (422)
    expect(await errorCode(() => removeMember(leadActor, team.id, leadUser.id))).toBe('LAST_LEAD')
    expect(await fetchMembershipRole(team.id, leadUser.id)).toBe('lead')

    // Removing a normal member succeeds
    await removeMember(leadActor, team.id, memberUser.id)
    expect(await fetchMembershipRole(team.id, memberUser.id)).toBeNull()

    // Check event
    const events = await fetchEvents(team.id)
    expect(events).toHaveLength(1)
    expect(events[0]?.action).toBe('removed')
    expect(events[0]?.actor_id).toBe(leadActor.id)
    expect(events[0]?.subject_user_id).toBe(memberUser.id)
    expect(events[0]?.from_role).toBe('member')
    expect(events[0]?.to_role).toBeNull()
  })

  it('listMembers: returns paginated members with user info and nextCursor', async () => {
    const team = await seedTeam()
    const lead = await seedUser({ displayName: 'Lead User', email: 'lead@example.test' })
    const u1 = await seedUser({ displayName: 'User One', email: 'one@example.test' })
    const u2 = await seedUser({ displayName: 'User Two', email: 'two@example.test' })

    await seedMembership(lead.id, team.id, 'lead')
    await seedMembership(u1.id, team.id, 'member')
    await seedMembership(u2.id, team.id, 'viewer')

    const actor: Actor = { id: lead.id, isAdmin: false }

    // First page with limit 2
    const page1 = await listMembers(actor, team.id, undefined, 2)
    expect(page1.members).toHaveLength(2)
    expect(page1.nextCursor).toBeTruthy()
    expect(page1.members[0]?.user?.displayName).toBe('Lead User')
    expect(page1.members[1]?.user?.displayName).toBe('User One')

    // Second page with nextCursor
    const page2 = await listMembers(actor, team.id, page1.nextCursor ?? undefined, 2)
    expect(page2.members).toHaveLength(1)
    expect(page2.nextCursor).toBeNull()
    expect(page2.members[0]?.user?.displayName).toBe('User Two')
  })

  it('prevents last lead race on concurrent demotions so at least one lead remains', async () => {
    const team = await seedTeam()
    const lead1 = await seedUser({ email: 'lead1-race@example.test' })
    const lead2 = await seedUser({ email: 'lead2-race@example.test' })
    await seedMembership(lead1.id, team.id, 'lead')
    await seedMembership(lead2.id, team.id, 'lead')

    const actor1: Actor = { id: lead1.id, isAdmin: false }
    const actor2: Actor = { id: lead2.id, isAdmin: false }

    // Both leads concurrently attempt to demote each other to member
    const results = await Promise.allSettled([
      setMemberRole(actor1, team.id, lead2.id, 'member'),
      setMemberRole(actor2, team.id, lead1.id, 'member'),
    ])

    const fulfilled = results.filter((r) => r.status === 'fulfilled')
    const rejected = results.filter((r) => r.status === 'rejected')

    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
      code: 'FORBIDDEN',
    })

    // Exactly one lead remains
    const [leadRows] = await pool.query(
      'SELECT COUNT(*) as count FROM memberships WHERE team_id = ? AND role = "lead"',
      [team.id],
    )
    expect((leadRows as { count: number }[])[0]?.count).toBe(1)
  })

  it('rejects malformed member keysets instead of silently repeating the first page', async () => {
    const lead = await seedUser()
    const team = await seedTeam()
    await seedMembership(lead.id, team.id, 'lead')
    const actor: Actor = { id: lead.id, isAdmin: false }
    for (const values of [{ wrongKey: 1 }, { id: '1' }, { id: 1.5 }, { id: -1 }, { id: Number.MAX_SAFE_INTEGER + 1 }]) {
      const cursor = encodeCursor(values, `team:${team.id}:members`)
      await expect(listMembers(actor, team.id, cursor)).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        status: 422,
      })
    }
  })

  it('enforces lead requirement for admins on membership:manage (no admin bypass, R9 404/403) while admitting admins to setMemberRole', async () => {
    const team = await seedTeam()
    const adminUser = await seedUser({ email: 'admin-lead@example.test', isAdmin: true })
    const targetUser = await seedUser({ email: 'target-mem@example.test' })
    const soleLead = await seedUser({ email: 'sole-lead@example.test' })
    await seedMembership(soleLead.id, team.id, 'lead')
    await seedMembership(targetUser.id, team.id, 'viewer')

    const adminActor: Actor = { id: adminUser.id, isAdmin: true }

    // Admin with no membership on team -> 404 NOT_FOUND on removeMember per R9
    expect(await errorCode(() => removeMember(adminActor, team.id, targetUser.id))).toBe('NOT_FOUND')

    // Admin as viewer on team -> 403 FORBIDDEN on removeMember
    await seedMembership(adminUser.id, team.id, 'viewer')
    expect(await errorCode(() => removeMember(adminActor, team.id, targetUser.id))).toBe('FORBIDDEN')

    // Admin is admitted to setMemberRole via membership:role:manage
    await setMemberRole(adminActor, team.id, targetUser.id, 'member')
    expect(await fetchMembershipRole(team.id, targetUser.id)).toBe('member')
  })
})
