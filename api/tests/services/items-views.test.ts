import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { closeDb } from '../../src/db/client'
import { listItems } from '../../src/services/items'
import { resetDb, seedItem, seedMembership, seedTeam, seedUser } from '../helpers/db'
import type { Actor } from '../../src/domain/types'

describe('items service - dashboard views (Task 3.2)', () => {
  beforeEach(resetDb)
  afterAll(closeDb)

  describe('assigned_to_me', () => {
    it('returns open items assigned to me, excludes closed, cancelled, and other assignees', async () => {
      const me = await seedUser({ displayName: 'Me' })
      const other = await seedUser({ displayName: 'Other' })
      const team = await seedTeam()
      await seedMembership(me.id, team.id, 'member')
      await seedMembership(other.id, team.id, 'member')

      const openMine = await seedItem(team.id, {
        createdBy: me.id,
        assigneeId: me.id,
        status: 'open',
        title: 'Open Assigned to Me',
      })
      const inProgressMine = await seedItem(team.id, {
        createdBy: me.id,
        assigneeId: me.id,
        status: 'in_progress',
        title: 'In Progress Assigned to Me',
      })
      const closedMine = await seedItem(team.id, {
        createdBy: me.id,
        assigneeId: me.id,
        status: 'closed',
        title: 'Closed Assigned to Me',
      })
      const cancelledMine = await seedItem(team.id, {
        createdBy: me.id,
        assigneeId: me.id,
        status: 'cancelled',
        title: 'Cancelled Assigned to Me',
      })
      const openOther = await seedItem(team.id, {
        createdBy: me.id,
        assigneeId: other.id,
        status: 'open',
        title: 'Open Assigned to Other',
      })
      const unassigned = await seedItem(team.id, {
        createdBy: me.id,
        assigneeId: null,
        status: 'open',
        title: 'Unassigned',
      })

      const actor: Actor = { id: me.id, isAdmin: false }
      const result = await listItems(actor, { view: 'assigned_to_me' })

      const returnedIds = result.items.map((i) => i.id)
      expect(returnedIds).toContain(openMine.id)
      expect(returnedIds).toContain(inProgressMine.id)
      expect(returnedIds).not.toContain(closedMine.id)
      expect(returnedIds).not.toContain(cancelledMine.id)
      expect(returnedIds).not.toContain(openOther.id)
      expect(returnedIds).not.toContain(unassigned.id)
      expect(returnedIds).toHaveLength(2)
    })
  })

  describe('unassigned_urgent', () => {
    it('returns unassigned open high/urgent items, excludes assigned, non-open, and low/medium', async () => {
      const user = await seedUser()
      const team = await seedTeam()
      await seedMembership(user.id, team.id, 'member')

      const urgentUnassignedOpen = await seedItem(team.id, {
        createdBy: user.id,
        assigneeId: null,
        status: 'open',
        priority: 'urgent',
        title: 'Urgent Unassigned Open',
      })
      const highUnassignedOpen = await seedItem(team.id, {
        createdBy: user.id,
        assigneeId: null,
        status: 'open',
        priority: 'high',
        title: 'High Unassigned Open',
      })
      const mediumUnassignedOpen = await seedItem(team.id, {
        createdBy: user.id,
        assigneeId: null,
        status: 'open',
        priority: 'medium',
        title: 'Medium Unassigned Open',
      })
      const urgentAssignedOpen = await seedItem(team.id, {
        createdBy: user.id,
        assigneeId: user.id,
        status: 'open',
        priority: 'urgent',
        title: 'Urgent Assigned Open',
      })
      const urgentUnassignedInProgress = await seedItem(team.id, {
        createdBy: user.id,
        assigneeId: null,
        status: 'in_progress',
        priority: 'urgent',
        title: 'Urgent Unassigned InProgress',
      })
      const urgentUnassignedClosed = await seedItem(team.id, {
        createdBy: user.id,
        assigneeId: null,
        status: 'closed',
        priority: 'urgent',
        title: 'Urgent Unassigned Closed',
      })

      const actor: Actor = { id: user.id, isAdmin: false }
      const result = await listItems(actor, { view: 'unassigned_urgent' })

      const returnedIds = result.items.map((i) => i.id)
      expect(returnedIds).toContain(urgentUnassignedOpen.id)
      expect(returnedIds).toContain(highUnassignedOpen.id)
      expect(returnedIds).not.toContain(mediumUnassignedOpen.id)
      expect(returnedIds).not.toContain(urgentAssignedOpen.id)
      expect(returnedIds).not.toContain(urgentUnassignedInProgress.id)
      expect(returnedIds).not.toContain(urgentUnassignedClosed.id)
      expect(returnedIds).toHaveLength(2)
    })
  })

  describe('awaiting_my_approval', () => {
    it('returns items in awaiting_approval status only for teams where actor is lead', async () => {
      const user = await seedUser()
      const teamLead = await seedTeam({ name: 'Lead Team', slug: 'lead-team' })
      const teamMember = await seedTeam({ name: 'Member Team', slug: 'member-team' })
      const teamViewer = await seedTeam({ name: 'Viewer Team', slug: 'viewer-team' })

      await seedMembership(user.id, teamLead.id, 'lead')
      await seedMembership(user.id, teamMember.id, 'member')
      await seedMembership(user.id, teamViewer.id, 'viewer')

      const approvalInLeadTeam = await seedItem(teamLead.id, {
        createdBy: user.id,
        status: 'awaiting_approval',
        title: 'Needs Lead Approval',
      })
      const openInLeadTeam = await seedItem(teamLead.id, {
        createdBy: user.id,
        status: 'open',
        title: 'Open in Lead Team',
      })
      const approvalInMemberTeam = await seedItem(teamMember.id, {
        createdBy: user.id,
        status: 'awaiting_approval',
        title: 'Needs Approval in Member Team',
      })
      const approvalInViewerTeam = await seedItem(teamViewer.id, {
        createdBy: user.id,
        status: 'awaiting_approval',
        title: 'Needs Approval in Viewer Team',
      })

      const actor: Actor = { id: user.id, isAdmin: false }
      const result = await listItems(actor, { view: 'awaiting_my_approval' })

      const returnedIds = result.items.map((i) => i.id)
      expect(returnedIds).toContain(approvalInLeadTeam.id)
      expect(returnedIds).not.toContain(openInLeadTeam.id)
      expect(returnedIds).not.toContain(approvalInMemberTeam.id)
      expect(returnedIds).not.toContain(approvalInViewerTeam.id)
      expect(returnedIds).toHaveLength(1)
    })

    it('returns empty list when actor has no lead role in any team', async () => {
      const viewerUser = await seedUser()
      const team = await seedTeam()
      await seedMembership(viewerUser.id, team.id, 'viewer')

      await seedItem(team.id, {
        createdBy: viewerUser.id,
        status: 'awaiting_approval',
        title: 'Pending Approval',
      })

      const actor: Actor = { id: viewerUser.id, isAdmin: false }
      const result = await listItems(actor, { view: 'awaiting_my_approval' })

      expect(result.items).toEqual([])
      expect(result.nextCursor).toBeNull()
    })

    it('returns empty list when querying a team where actor is not lead', async () => {
      const user = await seedUser()
      const teamLead = await seedTeam({ name: 'Lead Team', slug: 'lead-team' })
      const teamMember = await seedTeam({ name: 'Member Team', slug: 'member-team' })

      await seedMembership(user.id, teamLead.id, 'lead')
      await seedMembership(user.id, teamMember.id, 'member')

      await seedItem(teamMember.id, {
        createdBy: user.id,
        status: 'awaiting_approval',
      })

      const actor: Actor = { id: user.id, isAdmin: false }
      const result = await listItems(actor, {
        view: 'awaiting_my_approval',
        team: teamMember.id,
      })

      expect(result.items).toEqual([])
      expect(result.nextCursor).toBeNull()
    })
  })

  describe('overdue', () => {
    it('returns items with past due date and non-terminal status', async () => {
      const user = await seedUser()
      const team = await seedTeam()
      await seedMembership(user.id, team.id, 'member')

      const oneHourAgo = new Date(Date.now() - 3600 * 1000)
      const oneHourAhead = new Date(Date.now() + 3600 * 1000)

      const overdueOpen = await seedItem(team.id, {
        createdBy: user.id,
        status: 'open',
        dueAt: oneHourAgo,
        title: 'Overdue Open',
      })
      const overdueInProgress = await seedItem(team.id, {
        createdBy: user.id,
        status: 'in_progress',
        dueAt: oneHourAgo,
        title: 'Overdue In Progress',
      })
      const futureDue = await seedItem(team.id, {
        createdBy: user.id,
        status: 'open',
        dueAt: oneHourAhead,
        title: 'Future Due',
      })
      const noDueDate = await seedItem(team.id, {
        createdBy: user.id,
        status: 'open',
        dueAt: null,
        title: 'No Due Date',
      })
      const overdueClosed = await seedItem(team.id, {
        createdBy: user.id,
        status: 'closed',
        dueAt: oneHourAgo,
        title: 'Overdue Closed',
      })
      const overdueCancelled = await seedItem(team.id, {
        createdBy: user.id,
        status: 'cancelled',
        dueAt: oneHourAgo,
        title: 'Overdue Cancelled',
      })

      const actor: Actor = { id: user.id, isAdmin: false }
      const result = await listItems(actor, { view: 'overdue' })

      const returnedIds = result.items.map((i) => i.id)
      expect(returnedIds).toContain(overdueOpen.id)
      expect(returnedIds).toContain(overdueInProgress.id)
      expect(returnedIds).not.toContain(futureDue.id)
      expect(returnedIds).not.toContain(noDueDate.id)
      expect(returnedIds).not.toContain(overdueClosed.id)
      expect(returnedIds).not.toContain(overdueCancelled.id)
      expect(returnedIds).toHaveLength(2)
    })
  })

  describe('view composition and pagination', () => {
    it('composes view with team filter and cursor pagination', async () => {
      const me = await seedUser()
      const teamA = await seedTeam({ name: 'A', slug: 'a' })
      const teamB = await seedTeam({ name: 'B', slug: 'b' })
      await seedMembership(me.id, teamA.id, 'member')
      await seedMembership(me.id, teamB.id, 'member')

      const itemA1 = await seedItem(teamA.id, {
        createdBy: me.id,
        assigneeId: me.id,
        status: 'open',
        priority: 'high',
      })
      const itemA2 = await seedItem(teamA.id, {
        createdBy: me.id,
        assigneeId: me.id,
        status: 'open',
        priority: 'low',
      })
      await seedItem(teamB.id, {
        createdBy: me.id,
        assigneeId: me.id,
        status: 'open',
        priority: 'urgent',
      })

      const actor: Actor = { id: me.id, isAdmin: false }

      const page1 = await listItems(actor, {
        view: 'assigned_to_me',
        team: teamA.id,
        limit: 1,
      })
      expect(page1.items).toHaveLength(1)
      expect(page1.items[0]?.id).toBe(itemA1.id)
      expect(page1.nextCursor).not.toBeNull()

      const page2 = await listItems(actor, {
        view: 'assigned_to_me',
        team: teamA.id,
        limit: 1,
        cursor: page1.nextCursor ?? undefined,
      })
      expect(page2.items).toHaveLength(1)
      expect(page2.items[0]?.id).toBe(itemA2.id)
      expect(page2.nextCursor).toBeNull()
    })
  })
})
