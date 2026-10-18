import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { resetDb, seedUser, seedTeam, seedMembership } from '../helpers/db'
import { closeDb, pool } from '../../src/db/client'
import {
  createInvitation,
  listInvitations,
  revokeInvitation,
  type InvitationView,
} from '../../src/services/invitations'
import { ApiError } from '../../src/http/errors'
import type { Actor } from '../../src/domain/types'

interface OutboxRow {
  id: number
  type: string
  payload: unknown
  dedupe_key: string
  status: string
}
async function fetchOutboxJobs(): Promise<OutboxRow[]> {
  const [rows] = await pool.query(
    'SELECT id, type, payload, dedupe_key, status FROM outbox_jobs ORDER BY id ASC',
  )
  return (rows as Array<{ id: number; type: string; payload: unknown; dedupe_key: string; status: string }>).map((r) => {
    let payload = r.payload
    if (typeof payload === 'string') {
      try {
        payload = JSON.parse(payload) as unknown
      } catch {
        // keep string
      }
    }
    return { ...r, payload }
  })
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

describe('invitations service (part 1: create / list / revoke)', () => {
  beforeEach(resetDb)
  afterAll(closeDb)

  it('createInvitation: lead creates invitation, enqueues outbox job, never exposes codeHash; member gets FORBIDDEN', async () => {
    const team = await seedTeam({ name: 'Alpha Squad' })
    const leadUser = await seedUser({ email: 'lead@example.test' })
    const memberUser = await seedUser({ email: 'member@example.test' })

    await seedMembership(leadUser.id, team.id, 'lead')
    await seedMembership(memberUser.id, team.id, 'member')

    const leadActor: Actor = { id: leadUser.id, isAdmin: false }
    const memberActor: Actor = { id: memberUser.id, isAdmin: false }

    // Member cannot create invitation -> FORBIDDEN
    expect(
      await errorCode(() =>
        createInvitation(memberActor, team.id, {
          email: 'invitee@example.test',
          role: 'member',
        }),
      ),
    ).toBe('FORBIDDEN')

    // Lead creates invitation
    const invitation = await createInvitation(leadActor, team.id, {
      email: 'invitee@example.test',
      role: 'member',
      maxUses: 1,
    })

    expect(invitation.id).toBeGreaterThan(0)
    expect(invitation.teamId).toBe(team.id)
    expect(invitation.email).toBe('invitee@example.test')
    expect(invitation.role).toBe('member')
    expect(invitation.maxUses).toBe(1)
    expect(invitation.uses).toBe(0)
    expect(invitation.revokedAt).toBeNull()
    expect(invitation.expiresAt.getTime()).toBeGreaterThan(Date.now())
    // Ensure codeHash is never exposed on the view
    expect('codeHash' in invitation).toBe(false)
    expect('code_hash' in invitation).toBe(false)

    // Exactly one outbox job of type email.invite was enqueued
    const jobs = await fetchOutboxJobs()
    expect(jobs).toHaveLength(1)
    expect(jobs[0]?.type).toBe('email.invite')
    expect(jobs[0]?.dedupe_key).toBe(`invite:${invitation.id}`)
    expect(jobs[0]?.status).toBe('pending')

    const payload = jobs[0]?.payload as Record<string, unknown>
    expect(payload.to).toBe('invitee@example.test')
    expect(payload.teamName).toBe('Alpha Squad')
    expect(typeof payload.code).toBe('string')
    expect((payload.code as string).length).toBeGreaterThan(16)
  })

  it('revokeInvitation: lead revokes invitation setting revokedAt; non-lead gets FORBIDDEN', async () => {
    const team = await seedTeam()
    const leadUser = await seedUser({ email: 'lead@example.test' })
    const memberUser = await seedUser({ email: 'member@example.test' })

    await seedMembership(leadUser.id, team.id, 'lead')
    await seedMembership(memberUser.id, team.id, 'member')

    const leadActor: Actor = { id: leadUser.id, isAdmin: false }
    const memberActor: Actor = { id: memberUser.id, isAdmin: false }

    const invitation = await createInvitation(leadActor, team.id, {
      email: 'revoke-me@example.test',
      role: 'viewer',
    })

    // Member cannot revoke -> FORBIDDEN
    expect(await errorCode(() => revokeInvitation(memberActor, invitation.id))).toBe('FORBIDDEN')

    // Lead revokes
    await revokeInvitation(leadActor, invitation.id)

    // Verify revokedAt is set
    const list = await listInvitations(leadActor, team.id)
    const found = list.invitations.find((i) => i.id === invitation.id)
    expect(found?.revokedAt).toBeInstanceOf(Date)
  })

  it('listInvitations: returns paginated invitations without codeHash', async () => {
    const team = await seedTeam()
    const leadUser = await seedUser({ email: 'lead@example.test' })
    await seedMembership(leadUser.id, team.id, 'lead')
    const leadActor: Actor = { id: leadUser.id, isAdmin: false }

    const inv1 = await createInvitation(leadActor, team.id, { email: 'i1@example.test', role: 'viewer' })
    const inv2 = await createInvitation(leadActor, team.id, { email: 'i2@example.test', role: 'member' })
    const inv3 = await createInvitation(leadActor, team.id, { email: 'i3@example.test', role: 'lead' })

    // Page 1 with limit 2
    const p1 = await listInvitations(leadActor, team.id, undefined, 2)
    expect(p1.invitations).toHaveLength(2)
    expect(p1.invitations[0]?.email).toBe('i1@example.test')
    expect(p1.invitations[1]?.email).toBe('i2@example.test')
    expect(p1.nextCursor).toBeTruthy()

    // Page 2
    const p2 = await listInvitations(leadActor, team.id, p1.nextCursor ?? undefined, 2)
    expect(p2.invitations).toHaveLength(1)
    expect(p2.invitations[0]?.email).toBe('i3@example.test')
    expect(p2.nextCursor).toBeNull()

    // No codeHash exposed anywhere
    for (const inv of [...p1.invitations, ...p2.invitations]) {
      expect('codeHash' in inv).toBe(false)
      expect('code_hash' in inv).toBe(false)
    }
  })

  it('createInvitation normalizes email and enforces valid maxUses', async () => {
    const team = await seedTeam()
    const lead = await seedUser({ email: 'lead-norm@example.test' })
    await seedMembership(lead.id, team.id, 'lead')
    const leadActor: Actor = { id: lead.id, isAdmin: false }

    const inv = await createInvitation(leadActor, team.id, {
      email: '  MixedCaseInvite@Example.COM  ',
      role: 'member',
    })
    expect(inv.email).toBe('mixedcaseinvite@example.com')

    // Invalid maxUses
    await expect(
      createInvitation(leadActor, team.id, {
        email: 'test@example.com',
        role: 'member',
        maxUses: 0,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
  })
})
