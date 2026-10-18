import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { resetDb, seedUser, seedTeam, seedMembership, seedItem } from '../helpers/db'
import { can, type Actor } from '../../src/policy'
import { closeDb } from '../../src/db/client'

describe('can', () => {
  beforeEach(resetDb); afterAll(closeDb)
  it('enforces the role matrix', async () => {
    const team = await seedTeam(); const other = await seedTeam({ slug: 'o' })
    const lead = await seedUser({ email: 'l@x' }); const member = await seedUser({ email: 'm@x' })
    const viewer = await seedUser({ email: 'v@x' }); const outsider = await seedUser({ email: 'z@x' })
    await seedMembership(lead.id, team.id, 'lead'); await seedMembership(member.id, team.id, 'member')
    await seedMembership(viewer.id, team.id, 'viewer')
    const item = await seedItem(team.id, { createdBy: member.id, assigneeId: member.id })
    const res = { kind: 'item' as const, teamId: team.id, creatorId: item.createdBy, assigneeId: item.assigneeId }
    const a = (id: number, isAdmin = false): Actor => ({ id, isAdmin })
    // viewer
    expect(await can(a(viewer.id), 'item:read', res)).toBe(true)
    expect(await can(a(viewer.id), 'item:comment', res)).toBe(false)
    expect(await can(a(viewer.id), 'item:claim', res)).toBe(false)
    // member
    expect(await can(a(member.id), 'item:claim', res)).toBe(true)
    expect(await can(a(member.id), 'item:editPriority', res)).toBe(false)
    expect(await can(a(member.id), 'item:approve', res)).toBe(false)
    expect(await can(a(member.id), 'item:submit', res)).toBe(true)      // assignee
    expect(await can(a(member.id), 'item:cancel', res)).toBe(true)      // creator
    // lead
    expect(await can(a(lead.id), 'item:approve', res)).toBe(true)
    expect(await can(a(lead.id), 'item:assign', res)).toBe(true)
    expect(await can(a(lead.id), 'invitation:manage', { kind: 'team', teamId: team.id })).toBe(true)
    expect(await can(a(lead.id), 'membership:manage', { kind: 'team', teamId: team.id })).toBe(true)
    // outsider
    expect(await can(a(outsider.id), 'item:read', res)).toBe(false)
    // admin-only
    expect(await can(a(outsider.id), 'team:create')).toBe(false)
    expect(await can(a(outsider.id, true), 'team:create')).toBe(true)
    expect(await can(a(outsider.id, true), 'team:listAll')).toBe(true)
    expect(await can(a(outsider.id, true), 'job:manage')).toBe(true)
    expect(await can(a(outsider.id, true), 'team:member:add', { kind: 'team', teamId: other.id })).toBe(true)
    // admin has no work-item superpowers
    expect(await can(a(outsider.id, true), 'item:read', res)).toBe(false)
  })
  it('submit requires being the assignee for a non-lead', async () => {
    const team = await seedTeam(); const member = await seedUser(); const other = await seedUser({ email: 'o@x' })
    await seedMembership(member.id, team.id, 'member'); await seedMembership(other.id, team.id, 'member')
    const item = await seedItem(team.id, { assigneeId: other.id, createdBy: other.id })
    const res = { kind: 'item' as const, teamId: team.id, creatorId: item.createdBy, assigneeId: item.assigneeId }
    expect(await can({ id: member.id, isAdmin: false }, 'item:submit', res)).toBe(false)
    expect(await can({ id: other.id, isAdmin: false }, 'item:submit', res)).toBe(true)
  })
})
