import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { closeDb, db, pool } from '../../src/db/client'
import { adminAuditEvents, membershipEvents, memberships, outboxJobs, refreshTokens, teams, users } from '../../src/db/schema'
import { withTransaction } from '../../src/db/tx'
import * as audit from '../../src/services/adminAudit'
import { createUser, setUserStatus } from '../../src/services/users'
import { createTeam, adminRemoveTeamMember } from '../../src/services/teams'
import { addMember, setMemberRole } from '../../src/services/memberships'
import { retryJob } from '../../src/services/jobs'
import { config } from '../../src/config'
import { resetDb, seedMembership, seedTeam, seedUser } from '../helpers/db'

async function admin() {
  const user = await seedUser({ isAdmin: true })
  return { id: user.id, isAdmin: true }
}
async function events() {
  return db.select().from(adminAuditEvents).orderBy(adminAuditEvents.id)
}
async function failedJob() {
  const [job] = await db.insert(outboxJobs).values({
    type: 'email.reset',
    payload: { token: 'never-expose-me' },
    status: 'failed',
    attempts: 5,
    availableAt: new Date(),
    lastError: 'SMTP refused',
    dedupeKey: `audit-retry-${Math.random()}`,
  }).$returningId()
  return job!.id
}

describe('administrative audit journal', () => {
  beforeEach(resetDb)
  afterEach(() => vi.restoreAllMocks())
  afterAll(closeDb)

  it('requires administration and returns only the public actor projection', async () => {
    const actor = await admin()
    await createTeam(actor, { name: 'Operations', slug: 'operations' })
    await expect(audit.listAdminAudit({ id: actor.id, isAdmin: false })).rejects.toMatchObject({ code: 'FORBIDDEN' })
    const result = await audit.listAdminAudit(actor)
    expect(result.events).toHaveLength(1)
    expect(result.events[0]).toMatchObject({ action: 'team_created', targetType: 'team', metadata: { name: 'Operations', slug: 'operations' } })
    expect(Object.keys(result.events[0]!.actor).sort()).toEqual(['displayName', 'email', 'id'])
    expect(JSON.stringify(result)).not.toMatch(/passwordHash|password_hash|tokenHash|payload/)
  })

  it('paginates newest first and binds cursors to both action and literal search', async () => {
    const actor = await admin()
    await createTeam(actor, { name: 'One', slug: 'one' })
    await createTeam(actor, { name: 'Two', slug: 'two' })
    await createTeam(actor, { name: 'Three', slug: 'three' })
    const stored = await events()
    const first = await audit.listAdminAudit(actor, { action: 'team_created', limit: 1 })
    expect(first.events.map((event) => event.id)).toEqual([stored[2]!.id])
    const second = await audit.listAdminAudit(actor, { action: 'team_created', limit: 1, cursor: first.nextCursor! })
    expect(second.events.map((event) => event.id)).toEqual([stored[1]!.id])
    await expect(audit.listAdminAudit(actor, { action: 'user_created', cursor: first.nextCursor! })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    await expect(audit.listAdminAudit(actor, { action: 'team_created', q: 'other', cursor: first.nextCursor! })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    await expect(audit.listAdminAudit(actor, { limit: 0 })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
  })

  it('searches actor and target metadata case-insensitively without treating wildcards as patterns', async () => {
    const actor = await admin()
    const literal = 'Target %_\\ north'
    await createTeam(actor, { name: literal, slug: 'literal' })
    await createTeam(actor, { name: 'Target other north', slug: 'decoy' })
    const result = await audit.listAdminAudit(actor, { q: '%_\\' })
    expect(result.events).toHaveLength(1)
    expect(result.events[0]!.metadata.name).toBe(literal)
    const fullResult = await audit.listAdminAudit(actor, { q: literal })
    expect(fullResult.events).toHaveLength(1)
    expect(fullResult.events[0]!.metadata.name).toBe(literal)
    expect((await audit.listAdminAudit(actor, { q: 'TARGET' })).events).toHaveLength(2)
    const [user] = await db.select().from(users).where(eq(users.id, actor.id))
    expect((await audit.listAdminAudit(actor, { q: user!.email.toUpperCase() })).events).toHaveLength(2)
  })

  it('rolls back a recorded event with its caller transaction', async () => {
    const actor = await admin()
    await expect(withTransaction(async (tx) => {
      await audit.recordAdminAudit(tx, { actorId: actor.id, action: 'team_created', targetType: 'team', targetId: 1, metadata: { name: 'Rolled back' } })
      throw new Error('abort')
    })).rejects.toThrow('abort')
    expect(await events()).toEqual([])
  })

  it('records status transitions only, retaining repeated-disable token revocation', async () => {
    const actor = await admin()
    const user = await seedUser()
    await setUserStatus(actor, user.id, 'active')
    expect(await events()).toEqual([])
    await setUserStatus(actor, user.id, 'disabled')
    await db.insert(refreshTokens).values({ userId: user.id, tokenHash: 'late-token', familyId: 'late-family', expiresAt: new Date(Date.now() + 60000) })
    await setUserStatus(actor, user.id, 'disabled')
    const [token] = await db.select().from(refreshTokens)
    expect(token!.revokedAt).not.toBeNull()
    await setUserStatus(actor, user.id, 'active')
    const rows = await events()
    expect(rows.map((event) => event.metadata)).toEqual([
      { email: user.email, displayName: user.displayName, fromStatus: 'active', toStatus: 'disabled' },
      { email: user.email, displayName: user.displayName, fromStatus: 'disabled', toStatus: 'active' },
    ])
    await expect(setUserStatus(actor, 999999, 'disabled')).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(await events()).toHaveLength(2)
  })

  it('records normalized user creation and initial membership atomically without credentials', async () => {
    config.adminUserCreationEnabled = true
    const actor = await admin()
    const team = await seedTeam()
    const user = await createUser(actor, { email: ' New@Example.test ', displayName: ' New User ', password: 'safe-password', teamId: team.id, role: 'member' })
    const [membership] = await db.select().from(memberships).where(eq(memberships.userId, user.id))
    const rows = await events()
    const userEvent = rows.find((e) => e.action === 'user_created')
    const memEvent = rows.find((e) => e.action === 'membership_added')
    expect(userEvent).toMatchObject({
      action: 'user_created',
      targetType: 'user',
      targetId: user.id,
      metadata: { email: 'new@example.test', displayName: 'New User' },
    })
    expect(memEvent).toMatchObject({
      action: 'membership_added',
      targetType: 'membership',
      targetId: membership!.id,
      metadata: {
        teamId: team.id,
        teamName: team.name,
        userId: user.id,
        email: 'new@example.test',
        displayName: 'New User',
        fromRole: null,
        toRole: 'member',
      },
    })
    await expect(createUser(actor, { email: 'new@example.test', displayName: 'Duplicate', password: 'safe-password' })).rejects.toMatchObject({ code: 'EMAIL_TAKEN' })
    expect(await events()).toHaveLength(2)
  })

  it('records member addition, admin role change, and removal with durable subject identity', async () => {
    const actor = await admin()
    const team = await seedTeam()
    const user = await seedUser()
    await addMember(actor, team.id, user.id, 'member')
    const [membership] = await db.select().from(memberships)
    await expect(addMember(actor, team.id, user.id, 'viewer')).rejects.toMatchObject({ code: 'ALREADY_MEMBER' })
    await setMemberRole(actor, team.id, user.id, 'viewer')
    await setMemberRole(actor, team.id, user.id, 'viewer')
    await adminRemoveTeamMember(actor, team.id, user.id)
    const rows = await events()
    expect(rows.map((event) => event.action)).toEqual(['membership_added', 'membership_role_changed', 'membership_removed'])
    expect(rows.map((event) => event.targetId)).toEqual([membership!.id, membership!.id, membership!.id])
    expect(rows.map((event) => event.metadata)).toEqual([
      { teamId: team.id, teamName: team.name, userId: user.id, email: user.email, displayName: user.displayName, fromRole: null, toRole: 'member' },
      { teamId: team.id, teamName: team.name, userId: user.id, email: user.email, displayName: user.displayName, fromRole: 'member', toRole: 'viewer' },
      { teamId: team.id, teamName: team.name, userId: user.id, email: user.email, displayName: user.displayName, fromRole: 'viewer', toRole: null },
    ])
    await expect(setMemberRole(actor, team.id, user.id, 'lead')).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(await events()).toHaveLength(3)
  })

  it('preserves lead role management without fabricating administrative history', async () => {
    const team = await seedTeam()
    const lead = await seedUser()
    const user = await seedUser()
    await seedMembership(lead.id, team.id, 'lead')
    await seedMembership(user.id, team.id, 'member')
    await setMemberRole({ id: lead.id, isAdmin: false }, team.id, user.id, 'viewer')
    expect(await events()).toEqual([])
    expect(await db.select().from(membershipEvents)).toHaveLength(1)
  })

  it('serializes concurrent final-lead demotion and removal and records only the winner', async () => {
    const actor = await admin()
    const otherAdmin = await admin()
    const team = await seedTeam()
    const one = await seedUser()
    const two = await seedUser()
    await seedMembership(one.id, team.id, 'lead')
    await seedMembership(two.id, team.id, 'lead')
    const results = await Promise.allSettled([
      setMemberRole(actor, team.id, one.id, 'member'),
      adminRemoveTeamMember(otherAdmin, team.id, two.id),
    ])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.find((result) => result.status === 'rejected')).toMatchObject({ reason: { code: 'LAST_LEAD' } })
    expect(await db.select().from(memberships).where(and(eq(memberships.teamId, team.id), eq(memberships.role, 'lead')))).toHaveLength(1)
    expect(await events()).toHaveLength(1)
  })

  it('concurrent retries reset only one failed job and preserve its prior context without payload', async () => {
    const actor = await admin()
    const id = await failedJob()
    const results = await Promise.allSettled([retryJob(actor, id), retryJob(actor, id)])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.find((result) => result.status === 'rejected')).toMatchObject({ reason: { code: 'VALIDATION_ERROR' } })
    const [job] = await db.select().from(outboxJobs).where(eq(outboxJobs.id, id))
    expect(job).toMatchObject({ status: 'pending', attempts: 0, lockedAt: null, lockedBy: null, lastError: 'SMTP refused' })
    expect(await events()).toMatchObject([{ action: 'job_retried', targetType: 'job', targetId: id, metadata: { type: 'email.reset', previousAttempts: 5, previousLastError: 'SMTP refused' } }])
    expect(JSON.stringify(await events())).not.toContain('never-expose-me')
    await expect(retryJob(actor, 999999)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(await events()).toHaveLength(1)
  })

  it('rolls back source mutations and local history when the audit insert fails', async () => {
    config.adminUserCreationEnabled = true
    const actor = await admin()
    const team = await seedTeam()
    const user = await seedUser()
    const existingMemUser = await seedUser()
    await seedMembership(existingMemUser.id, team.id, 'member')
    const id = await failedJob()
    await pool.query("CREATE TRIGGER reject_admin_audit BEFORE INSERT ON admin_audit_events FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit unavailable'")
    try {
      await expect(createTeam(actor, { name: 'Abort', slug: 'abort' })).rejects.toThrow()
      await expect(setUserStatus(actor, user.id, 'disabled')).rejects.toThrow()
      await expect(addMember(actor, team.id, user.id, 'member')).rejects.toThrow()
      await expect(retryJob(actor, id)).rejects.toThrow()
      await expect(createUser(actor, { email: 'rollback@example.test', displayName: 'Rollback', password: 'safe-password', teamId: team.id, role: 'member' })).rejects.toThrow()
      await expect(setMemberRole(actor, team.id, existingMemUser.id, 'viewer')).rejects.toThrow()
      await expect(adminRemoveTeamMember(actor, team.id, existingMemUser.id)).rejects.toThrow()

      expect(await db.select().from(teams).where(eq(teams.slug, 'abort'))).toEqual([])
      expect((await db.select().from(users).where(eq(users.id, user.id)))[0]!.status).toBe('active')
      expect(await db.select().from(users).where(eq(users.email, 'rollback@example.test'))).toEqual([])
      expect(await db.select().from(memberships).where(eq(memberships.userId, user.id))).toEqual([])
      const [stillMem] = await db.select().from(memberships).where(eq(memberships.userId, existingMemUser.id))
      expect(stillMem?.role).toBe('member')
      expect(await db.select().from(membershipEvents)).toEqual([])
      expect((await db.select().from(outboxJobs).where(eq(outboxJobs.id, id)))[0]!.status).toBe('failed')
      expect(await events()).toEqual([])
    } finally {
      await pool.query('DROP TRIGGER reject_admin_audit')
    }
  })
})
