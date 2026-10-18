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
  it('submit/cancel require team membership for the assignee/creator clause', async () => {
    const team = await seedTeam()
    const nonMember = await seedUser({ email: 'nm@x' }); const viewer = await seedUser({ email: 'vw@x' })
    await seedMembership(viewer.id, team.id, 'viewer')
    const owned = await seedItem(team.id, { assigneeId: nonMember.id, createdBy: nonMember.id })
    const ownedRes = { kind: 'item' as const, teamId: team.id, creatorId: owned.createdBy, assigneeId: owned.assigneeId }
    const a = (id: number, isAdmin = false): Actor => ({ id, isAdmin })
    // non-member named as assignee → submit denied
    expect(await can(a(nonMember.id), 'item:submit', ownedRes)).toBe(false)
    // non-member named as creator → cancel denied
    expect(await can(a(nonMember.id), 'item:cancel', ownedRes)).toBe(false)
    // viewer named as assignee → submit denied (viewer column is — in §7)
    const viewerItem = await seedItem(team.id, { assigneeId: viewer.id, createdBy: viewer.id })
    const viewerRes = { kind: 'item' as const, teamId: team.id, creatorId: viewerItem.createdBy, assigneeId: viewerItem.assigneeId }
    expect(await can(a(viewer.id), 'item:submit', viewerRes)).toBe(false)
  })
})
