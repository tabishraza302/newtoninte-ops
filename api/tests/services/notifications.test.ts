import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { closeDb, db } from '../../src/db/client'
import { activityEvents, memberships, notifications } from '../../src/db/schema'
import { encodeCursor } from '../../src/http/cursor'
import { ApiError } from '../../src/http/errors'
import {
  addComment,
  assignItem,
  claimItem,
  createItem,
  transitionItem,
  type CreateItemInput,
} from '../../src/services/items'
import {
  getNotificationsSummary,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '../../src/services/notifications'
import { withIdempotency } from '../../src/services/idempotency'
import { resetDb, seedItem, seedMembership, seedTeam, seedUser } from '../helpers/db'
import type { Actor } from '../../src/domain/types'

describe('notifications service', () => {
  beforeEach(resetDb)
  afterAll(closeDb)

  describe('createItem triggers', () => {
    it('create assigned to another user creates exactly one unread notification for that user', async () => {
      const creator = await seedUser()
      const assignee = await seedUser()
      const team = await seedTeam()
      await seedMembership(creator.id, team.id, 'lead')
      await seedMembership(assignee.id, team.id, 'member')

      const actor: Actor = { id: creator.id, isAdmin: false }
      await createItem(actor, {
        teamId: team.id,
        title: 'Assigned item',
        type: 'task',
        priority: 'high',
        assigneeId: assignee.id,
      })

      const rows = await db
        .select()
        .from(notifications)
        .where(eq(notifications.recipientUserId, assignee.id))

      expect(rows).toHaveLength(1)
      expect(rows[0]!.type).toBe('assigned')
      expect(rows[0]!.readAt).toBeNull()

      // Creator gets none
      const creatorRows = await db
        .select()
        .from(notifications)
        .where(eq(notifications.recipientUserId, creator.id))
      expect(creatorRows).toHaveLength(0)
    })

    it('self-assignment or unassigned creation produces no notifications', async () => {
      const user = await seedUser()
      const team = await seedTeam()
      await seedMembership(user.id, team.id, 'lead')
      const actor: Actor = { id: user.id, isAdmin: false }

      // Self-assigned
      await createItem(actor, {
        teamId: team.id,
        title: 'Self-assigned item',
        type: 'task',
        priority: 'low',
        assigneeId: user.id,
      })

      // Unassigned
      await createItem(actor, {
        teamId: team.id,
        title: 'Unassigned item',
        type: 'task',
        priority: 'medium',
      })

      const rows = await db.select().from(notifications)
      expect(rows).toHaveLength(0)
    })

    it('idempotent replay returns same item and produces still only one notification', async () => {
      const creator = await seedUser()
      const assignee = await seedUser()
      const team = await seedTeam()
      await seedMembership(creator.id, team.id, 'lead')
      await seedMembership(assignee.id, team.id, 'member')

      const actor: Actor = { id: creator.id, isAdmin: false }
      const key = 'test-idempotency-create-item'
      const input: CreateItemInput = {
        teamId: team.id,
        title: 'Idempotent Item',
        type: 'task',
        priority: 'urgent',
        assigneeId: assignee.id,
      }

      const res1 = await withIdempotency(
        creator.id,
        key,
        'POST /items',
        input,
        async (tx) => {
          const item = await createItem(actor, input, tx)
          return {
            status: 201,
            body: item,
            resourceId: item.id,
          }
        },
      )

      const res2 = await withIdempotency(
        creator.id,
        key,
        'POST /items',
        input,
        async (tx) => {
          const item = await createItem(actor, input, tx)
          return {
            status: 201,
            body: item,
            resourceId: item.id,
          }
        },
      )

      expect(res1.replayed).toBe(false)
      expect(res2.replayed).toBe(true)
      expect(res1.status).toBe(201)
      expect(res2.status).toBe(201)
      expect(res1.body.id).toBe(res2.body.id)
      expect(res2.body.title).toBe('Idempotent Item')

      const rows = await db
        .select()
        .from(notifications)
        .where(eq(notifications.recipientUserId, assignee.id))
      expect(rows).toHaveLength(1)
      expect(rows[0]?.type).toBe('assigned')
    })
  })

  describe('assignItem triggers', () => {
    it('reassign B then C creates separate notifications for B and C', async () => {
      const lead = await seedUser()
      const userB = await seedUser()
      const userC = await seedUser()
      const team = await seedTeam()
      await seedMembership(lead.id, team.id, 'lead')
      await seedMembership(userB.id, team.id, 'member')
      await seedMembership(userC.id, team.id, 'member')

      const item = await seedItem(team.id, { createdBy: lead.id })
      const actor: Actor = { id: lead.id, isAdmin: false }

      // Assign to B (version 1 -> 2)
      await assignItem(actor, item.id, userB.id, 1)

      const bRows = await db
        .select()
        .from(notifications)
        .where(eq(notifications.recipientUserId, userB.id))
      expect(bRows).toHaveLength(1)
      expect(bRows[0]!.type).toBe('assigned')

      // Assign to C (version 2 -> 3)
      await assignItem(actor, item.id, userC.id, 2)

      const cRows = await db
        .select()
        .from(notifications)
        .where(eq(notifications.recipientUserId, userC.id))
      expect(cRows).toHaveLength(1)
      expect(cRows[0]!.type).toBe('assigned')
    })

    it('same-assignee no-op and stale assignment produce no new notifications', async () => {
      const lead = await seedUser()
      const member = await seedUser()
      const team = await seedTeam()
      await seedMembership(lead.id, team.id, 'lead')
      await seedMembership(member.id, team.id, 'member')

      const item = await seedItem(team.id, { createdBy: lead.id, assigneeId: member.id, version: 1 })
      const actor: Actor = { id: lead.id, isAdmin: false }

      // Same assignee no-op
      await assignItem(actor, item.id, member.id, 1)

      const rowsAfterNoop = await db.select().from(notifications)
      expect(rowsAfterNoop).toHaveLength(0)

      // Stale expected version conflict
      let staleErr: unknown
      try {
        await assignItem(actor, item.id, member.id, 999)
      } catch (e) {
        staleErr = e
      }
      expect(staleErr).toBeInstanceOf(ApiError)
      expect((staleErr as ApiError).code).toBe('STALE_STATE')

      const rowsAfterStale = await db.select().from(notifications)
      expect(rowsAfterStale).toHaveLength(0)
    })
  })

  describe('addComment triggers', () => {
    it('comment by a third user notifies creator and current assignee only', async () => {
      const creator = await seedUser()
      const assignee = await seedUser()
      const commenter = await seedUser()
      const other = await seedUser()
      const team = await seedTeam()
      await seedMembership(creator.id, team.id, 'member')
      await seedMembership(assignee.id, team.id, 'member')
      await seedMembership(commenter.id, team.id, 'member')
      await seedMembership(other.id, team.id, 'member')

      const item = await seedItem(team.id, { createdBy: creator.id, assigneeId: assignee.id })
      const actor: Actor = { id: commenter.id, isAdmin: false }

      await addComment(actor, item.id, 'Looking into this now')

      const creatorRows = await db
        .select()
        .from(notifications)
        .where(eq(notifications.recipientUserId, creator.id))
      expect(creatorRows).toHaveLength(1)
      expect(creatorRows[0]!.type).toBe('comment_added')

      const assigneeRows = await db
        .select()
        .from(notifications)
        .where(eq(notifications.recipientUserId, assignee.id))
      expect(assigneeRows).toHaveLength(1)
      expect(assigneeRows[0]!.type).toBe('comment_added')

      // Commenter excluded
      const commenterRows = await db
        .select()
        .from(notifications)
        .where(eq(notifications.recipientUserId, commenter.id))
      expect(commenterRows).toHaveLength(0)

      // Unrelated user excluded
      const otherRows = await db
        .select()
        .from(notifications)
        .where(eq(notifications.recipientUserId, other.id))
      expect(otherRows).toHaveLength(0)
    })

    it('creator=assignee gets exactly one notification and commenter gets none', async () => {
      const user = await seedUser()
      const commenter = await seedUser()
      const team = await seedTeam()
      await seedMembership(user.id, team.id, 'member')
      await seedMembership(commenter.id, team.id, 'member')

      const item = await seedItem(team.id, { createdBy: user.id, assigneeId: user.id })
      const actor: Actor = { id: commenter.id, isAdmin: false }

      await addComment(actor, item.id, 'Update for you')

      const userRows = await db
        .select()
        .from(notifications)
        .where(eq(notifications.recipientUserId, user.id))
      expect(userRows).toHaveLength(1)
      expect(userRows[0]!.type).toBe('comment_added')
    })

    it('viewer creator still receives comment notification', async () => {
      const creator = await seedUser()
      const commenter = await seedUser()
      const team = await seedTeam()
      await seedMembership(creator.id, team.id, 'viewer')
      await seedMembership(commenter.id, team.id, 'member')

      const item = await seedItem(team.id, { createdBy: creator.id, assigneeId: null })
      const actor: Actor = { id: commenter.id, isAdmin: false }

      await addComment(actor, item.id, 'Note on item')

      const rows = await db
        .select()
        .from(notifications)
        .where(eq(notifications.recipientUserId, creator.id))
      expect(rows).toHaveLength(1)
      expect(rows[0]!.type).toBe('comment_added')
    })
  })

  describe('transitionItem triggers', () => {
    it('submit (in_progress -> awaiting_approval) notifies current leads excluding actor', async () => {
      const member = await seedUser()
      const lead1 = await seedUser()
      const lead2 = await seedUser()
      const team = await seedTeam()
      await seedMembership(member.id, team.id, 'member')
      await seedMembership(lead1.id, team.id, 'lead')
      await seedMembership(lead2.id, team.id, 'lead')

      const item = await seedItem(team.id, {
        createdBy: member.id,
        assigneeId: member.id,
        status: 'in_progress',
      })

      const actor: Actor = { id: member.id, isAdmin: false }
      await transitionItem(actor, item.id, 'awaiting_approval')

      const l1Rows = await db
        .select()
        .from(notifications)
        .where(eq(notifications.recipientUserId, lead1.id))
      expect(l1Rows).toHaveLength(1)
      expect(l1Rows[0]!.type).toBe('approval_requested')

      const l2Rows = await db
        .select()
        .from(notifications)
        .where(eq(notifications.recipientUserId, lead2.id))
      expect(l2Rows).toHaveLength(1)
      expect(l2Rows[0]!.type).toBe('approval_requested')

      // Submitter member receives no notification
      const mRows = await db
        .select()
        .from(notifications)
        .where(eq(notifications.recipientUserId, member.id))
      expect(mRows).toHaveLength(0)
    })

    it('lead submitting approval excludes themselves from notification', async () => {
      const lead1 = await seedUser()
      const lead2 = await seedUser()
      const team = await seedTeam()
      await seedMembership(lead1.id, team.id, 'lead')
      await seedMembership(lead2.id, team.id, 'lead')

      const item = await seedItem(team.id, {
        createdBy: lead1.id,
        assigneeId: lead1.id,
        status: 'in_progress',
      })

      const actor: Actor = { id: lead1.id, isAdmin: false }
      await transitionItem(actor, item.id, 'awaiting_approval')

      const l1Rows = await db
        .select()
        .from(notifications)
        .where(eq(notifications.recipientUserId, lead1.id))
      expect(l1Rows).toHaveLength(0)

      const l2Rows = await db
        .select()
        .from(notifications)
        .where(eq(notifications.recipientUserId, lead2.id))
      expect(l2Rows).toHaveLength(1)
    })

    it('approve/send-back with reason produces one workflow_decision notification per intended recipient, not a comment alert', async () => {
      const lead = await seedUser()
      const creator = await seedUser()
      const assignee = await seedUser()
      const team = await seedTeam()
      await seedMembership(lead.id, team.id, 'lead')
      await seedMembership(creator.id, team.id, 'member')
      await seedMembership(assignee.id, team.id, 'member')

      const item = await seedItem(team.id, {
        createdBy: creator.id,
        assigneeId: assignee.id,
        status: 'awaiting_approval',
      })

      const actor: Actor = { id: lead.id, isAdmin: false }
      await transitionItem(actor, item.id, 'resolved', 'Approved! Good work.')

      const creatorRows = await db
        .select()
        .from(notifications)
        .where(eq(notifications.recipientUserId, creator.id))
      expect(creatorRows).toHaveLength(1)
      expect(creatorRows[0]!.type).toBe('workflow_decision')

      const assigneeRows = await db
        .select()
        .from(notifications)
        .where(eq(notifications.recipientUserId, assignee.id))
      expect(assigneeRows).toHaveLength(1)
      expect(assigneeRows[0]!.type).toBe('workflow_decision')

      // Verify no extra comment_added notification was created
      const allRows = await db.select().from(notifications)
      expect(allRows.every((r) => r.type === 'workflow_decision')).toBe(true)
    })

    it('close, reopen, and cancel emit workflow_decision; start and claim emit none', async () => {
      const lead = await seedUser()
      const member = await seedUser()
      const team = await seedTeam()
      await seedMembership(lead.id, team.id, 'lead')
      await seedMembership(member.id, team.id, 'member')

      const leadActor: Actor = { id: lead.id, isAdmin: false }
      const memberActor: Actor = { id: member.id, isAdmin: false }

      // 1. Start (open -> in_progress) emits NONE
      const item1 = await seedItem(team.id, { createdBy: lead.id, assigneeId: member.id, status: 'open' })
      await transitionItem(memberActor, item1.id, 'in_progress')
      const startRows = await db.select().from(notifications)
      expect(startRows).toHaveLength(0)

      // 2. Claim (claimItem) emits NONE
      const item2 = await seedItem(team.id, { createdBy: lead.id, assigneeId: null, status: 'open' })
      await claimItem(memberActor, item2.id)
      const claimRows = await db.select().from(notifications)
      expect(claimRows).toHaveLength(0)

      // 3. Cancel (in_progress -> cancelled) emits workflow_decision
      await transitionItem(leadActor, item1.id, 'cancelled')
      const cancelRows = await db
        .select()
        .from(notifications)
        .where(eq(notifications.recipientUserId, member.id))
      expect(cancelRows).toHaveLength(1)
      expect(cancelRows[0]!.type).toBe('workflow_decision')

      // 4. Close (resolved -> closed) emits workflow_decision
      const item3 = await seedItem(team.id, { createdBy: member.id, assigneeId: member.id, status: 'resolved' })
      await transitionItem(leadActor, item3.id, 'closed')
      const closeRows = await db
        .select()
        .from(notifications)
        .where(eq(notifications.recipientUserId, member.id))
      expect(closeRows).toHaveLength(2)

      // 5. Reopen (resolved -> in_progress) emits workflow_decision
      const item4 = await seedItem(team.id, { createdBy: member.id, assigneeId: member.id, status: 'resolved' })
      await transitionItem(leadActor, item4.id, 'in_progress')
      const reopenRows = await db
        .select()
        .from(notifications)
        .where(eq(notifications.recipientUserId, member.id))
      expect(reopenRows).toHaveLength(3)
    })

    it('failed authorization or transition rollback produces no persisted notification', async () => {
      const viewer = await seedUser()
      const member = await seedUser()
      const team = await seedTeam()
      await seedMembership(viewer.id, team.id, 'viewer')
      await seedMembership(member.id, team.id, 'member')

      const item = await seedItem(team.id, { createdBy: member.id, assigneeId: member.id, status: 'open' })
      const actor: Actor = { id: viewer.id, isAdmin: false }

      // Viewer cannot start work
      let err: unknown
      try {
        await transitionItem(actor, item.id, 'in_progress')
      } catch (e) {
        err = e
      }
      expect(err).toBeInstanceOf(ApiError)
      expect((err as ApiError).code).toBe('FORBIDDEN')

      const rows = await db.select().from(notifications)
      expect(rows).toHaveLength(0)
    })
  })

  describe('listNotifications and getNotificationsSummary', () => {
    it('lists notifications newest-first, scoped to recipient and filtered by team membership', async () => {
      const lead = await seedUser()
      const member = await seedUser()
      const team = await seedTeam()
      await seedMembership(lead.id, team.id, 'lead')
      await seedMembership(member.id, team.id, 'member')

      const leadActor: Actor = { id: lead.id, isAdmin: false }
      const memberActor: Actor = { id: member.id, isAdmin: false }

      const item = await createItem(leadActor, {
        teamId: team.id,
        title: 'Project Setup',
        type: 'task',
        priority: 'high',
        assigneeId: member.id,
      })

      await addComment(leadActor, item.id, 'Please review the README')

      const summary = await getNotificationsSummary(memberActor)
      expect(summary.unreadCount).toBe(2)

      const page1 = await listNotifications(memberActor, { limit: 1 })
      expect(page1.notifications).toHaveLength(1)
      expect(page1.notifications[0]!.type).toBe('comment_added')
      expect(page1.notifications[0]!.itemTitle).toBe('Project Setup')
      expect(page1.notifications[0]!.actor).toEqual({ id: lead.id, displayName: lead.displayName })
      expect(page1.notifications[0]!.fromStatus).toBeNull()
      expect(page1.notifications[0]!.toStatus).toBeNull()
      expect(page1.nextCursor).not.toBeNull()

      const page2 = await listNotifications(memberActor, { cursor: page1.nextCursor!, limit: 1 })
      expect(page2.notifications).toHaveLength(1)
      expect(page2.notifications[0]!.type).toBe('assigned')
      expect(page2.notifications[0]!.itemTitle).toBe('Project Setup')
      expect(page2.nextCursor).toBeNull()
    })

    it('populates fromStatus and toStatus for status_changed events only', async () => {
      const lead = await seedUser()
      const member = await seedUser()
      const team = await seedTeam()
      await seedMembership(lead.id, team.id, 'lead')
      await seedMembership(member.id, team.id, 'member')

      const leadActor: Actor = { id: lead.id, isAdmin: false }
      const memberActor: Actor = { id: member.id, isAdmin: false }

      const item = await seedItem(team.id, {
        createdBy: member.id,
        assigneeId: member.id,
        status: 'awaiting_approval',
      })

      await transitionItem(leadActor, item.id, 'resolved')

      const result = await listNotifications(memberActor, {})
      expect(result.notifications).toHaveLength(1)
      expect(result.notifications[0]!.type).toBe('workflow_decision')
      expect(result.notifications[0]!.fromStatus).toBe('awaiting_approval')
      expect(result.notifications[0]!.toStatus).toBe('resolved')
    })

    it('membership removal hides history and unread count; rejoining restores them', async () => {
      const lead = await seedUser()
      const member = await seedUser()
      const team = await seedTeam()
      await seedMembership(lead.id, team.id, 'lead')
      await seedMembership(member.id, team.id, 'member')

      const leadActor: Actor = { id: lead.id, isAdmin: false }
      const memberActor: Actor = { id: member.id, isAdmin: false }

      await createItem(leadActor, {
        teamId: team.id,
        title: 'Work item',
        type: 'task',
        priority: 'medium',
        assigneeId: member.id,
      })

      const initialSummary = await getNotificationsSummary(memberActor)
      expect(initialSummary.unreadCount).toBe(1)

      // Remove membership
      await db
        .delete(memberships)
        .where(and(eq(memberships.userId, member.id), eq(memberships.teamId, team.id)))

      // Should now be hidden
      const hiddenSummary = await getNotificationsSummary(memberActor)
      expect(hiddenSummary.unreadCount).toBe(0)

      const hiddenList = await listNotifications(memberActor, {})
      expect(hiddenList.notifications).toHaveLength(0)

      // Rejoining restores
      await seedMembership(member.id, team.id, 'member')

      const restoredSummary = await getNotificationsSummary(memberActor)
      expect(restoredSummary.unreadCount).toBe(1)

      const restoredList = await listNotifications(memberActor, {})
      expect(restoredList.notifications).toHaveLength(1)
    })

    it('admin without membership has no access override', async () => {
      const creator = await seedUser()
      const assignee = await seedUser()
      const admin = await seedUser({ isAdmin: true })
      const team = await seedTeam()
      await seedMembership(creator.id, team.id, 'lead')
      await seedMembership(assignee.id, team.id, 'member')

      const creatorActor: Actor = { id: creator.id, isAdmin: false }
      const adminActor: Actor = { id: admin.id, isAdmin: true }

      await createItem(creatorActor, {
        teamId: team.id,
        title: 'Secret item',
        type: 'task',
        priority: 'high',
        assigneeId: assignee.id,
      })

      const adminSummary = await getNotificationsSummary(adminActor)
      expect(adminSummary.unreadCount).toBe(0)

      const adminList = await listNotifications(adminActor, {})
      expect(adminList.notifications).toHaveLength(0)
    })

    it('rejects foreign-scope cursor and invalid limits', async () => {
      const userA = await seedUser()
      const userB = await seedUser()
      const actorA: Actor = { id: userA.id, isAdmin: false }

      const foreignCursor = encodeCursor({ id: 10 }, `notifications:user:${userB.id}`)

      let errCursor: unknown
      try {
        await listNotifications(actorA, { cursor: foreignCursor })
      } catch (e) {
        errCursor = e
      }
      expect(errCursor).toBeInstanceOf(ApiError)
      expect((errCursor as ApiError).code).toBe('VALIDATION_ERROR')

      let errLimitMin: unknown
      try {
        await listNotifications(actorA, { limit: 0 })
      } catch (e) {
        errLimitMin = e
      }
      expect(errLimitMin).toBeInstanceOf(ApiError)
      expect((errLimitMin as ApiError).code).toBe('VALIDATION_ERROR')

      let errLimitMax: unknown
      try {
        await listNotifications(actorA, { limit: 101 })
      } catch (e) {
        errLimitMax = e
      }
      expect(errLimitMax).toBeInstanceOf(ApiError)
      expect((errLimitMax as ApiError).code).toBe('VALIDATION_ERROR')
    })
  })

  describe('markNotificationRead and markAllNotificationsRead', () => {
    it('markNotificationRead sets readAt, repeated read preserves original timestamp', async () => {
      const lead = await seedUser()
      const member = await seedUser()
      const team = await seedTeam()
      await seedMembership(lead.id, team.id, 'lead')
      await seedMembership(member.id, team.id, 'member')

      const leadActor: Actor = { id: lead.id, isAdmin: false }
      const memberActor: Actor = { id: member.id, isAdmin: false }

      await createItem(leadActor, {
        teamId: team.id,
        title: 'Task 1',
        type: 'task',
        priority: 'medium',
        assigneeId: member.id,
      })

      const listBefore = await listNotifications(memberActor, {})
      const notifId = listBefore.notifications[0]!.id

      await markNotificationRead(memberActor, notifId)

      const listAfter = await listNotifications(memberActor, {})
      const firstReadAt = listAfter.notifications[0]!.readAt
      expect(firstReadAt).not.toBeNull()

      const summaryAfter = await getNotificationsSummary(memberActor)
      expect(summaryAfter.unreadCount).toBe(0)

      // Repeated read
      await markNotificationRead(memberActor, notifId)
      const listAfterRepeat = await listNotifications(memberActor, {})
      expect(listAfterRepeat.notifications[0]!.readAt?.getTime()).toBe(firstReadAt!.getTime())
    })

    it('markNotificationRead returns 404 for other user, missing ID, or revoked team', async () => {
      const lead = await seedUser()
      const userA = await seedUser()
      const userB = await seedUser()
      const team = await seedTeam()
      await seedMembership(lead.id, team.id, 'lead')
      await seedMembership(userA.id, team.id, 'member')
      await seedMembership(userB.id, team.id, 'member')

      const leadActor: Actor = { id: lead.id, isAdmin: false }
      const actorA: Actor = { id: userA.id, isAdmin: false }
      const actorB: Actor = { id: userB.id, isAdmin: false }

      await createItem(leadActor, {
        teamId: team.id,
        title: 'Task A',
        type: 'task',
        priority: 'medium',
        assigneeId: userA.id,
      })

      const listA = await listNotifications(actorA, {})
      const notifId = listA.notifications[0]!.id

      // User B cannot mark user A's notification
      let errOther: unknown
      try {
        await markNotificationRead(actorB, notifId)
      } catch (e) {
        errOther = e
      }
      expect(errOther).toBeInstanceOf(ApiError)
      expect((errOther as ApiError).code).toBe('NOT_FOUND')

      // Missing ID
      let errMissing: unknown
      try {
        await markNotificationRead(actorA, 999999)
      } catch (e) {
        errMissing = e
      }
      expect(errMissing).toBeInstanceOf(ApiError)
      expect((errMissing as ApiError).code).toBe('NOT_FOUND')

      // Revoked membership returns 404
      await db
        .delete(memberships)
        .where(and(eq(memberships.userId, userA.id), eq(memberships.teamId, team.id)))

      let errRevoked: unknown
      try {
        await markNotificationRead(actorA, notifId)
      } catch (e) {
        errRevoked = e
      }
      expect(errRevoked).toBeInstanceOf(ApiError)
      expect((errRevoked as ApiError).code).toBe('NOT_FOUND')
    })

    it('markAllNotificationsRead updates all visible unread notifications and preserves already-read', async () => {
      const lead = await seedUser()
      const member = await seedUser()
      const otherUser = await seedUser()
      const team1 = await seedTeam()
      const team2 = await seedTeam()
      const revokedTeam = await seedTeam()

      await seedMembership(lead.id, team1.id, 'lead')
      await seedMembership(member.id, team1.id, 'member')
      await seedMembership(lead.id, team2.id, 'lead')
      await seedMembership(otherUser.id, team2.id, 'member')
      await seedMembership(lead.id, revokedTeam.id, 'lead')
      await seedMembership(member.id, revokedTeam.id, 'member')

      const leadActor: Actor = { id: lead.id, isAdmin: false }
      const memberActor: Actor = { id: member.id, isAdmin: false }
      const otherActor: Actor = { id: otherUser.id, isAdmin: false }

      // Create three items for member in active team1
      const item1 = await createItem(leadActor, {
        teamId: team1.id,
        title: 'Task 1',
        type: 'task',
        priority: 'medium',
        assigneeId: member.id,
      })
      const item2 = await createItem(leadActor, {
        teamId: team1.id,
        title: 'Task 2',
        type: 'task',
        priority: 'high',
        assigneeId: member.id,
      })
      const item3 = await createItem(leadActor, {
        teamId: team1.id,
        title: 'Task 3',
        type: 'task',
        priority: 'low',
        assigneeId: member.id,
      })

      // Create an item for member in revokedTeam
      const revokedItem = await createItem(leadActor, {
        teamId: revokedTeam.id,
        title: 'Revoked Team Task',
        type: 'task',
        priority: 'medium',
        assigneeId: member.id,
      })

      // Create one item for otherUser in team2
      await createItem(leadActor, {
        teamId: team2.id,
        title: 'Other Task',
        type: 'task',
        priority: 'medium',
        assigneeId: otherUser.id,
      })

      // Revoke member's membership from revokedTeam
      await db
        .delete(memberships)
        .where(and(eq(memberships.userId, member.id), eq(memberships.teamId, revokedTeam.id)))

      // Locate revoked-team notification in DB and confirm it starts unread
      const [revokedDbRow] = await db
        .select({ id: notifications.id, readAt: notifications.readAt })
        .from(notifications)
        .innerJoin(activityEvents, eq(notifications.activityEventId, activityEvents.id))
        .where(
          and(
            eq(activityEvents.workItemId, revokedItem.id),
            eq(notifications.recipientUserId, member.id),
          ),
        )
      expect(revokedDbRow).toBeDefined()
      expect(revokedDbRow?.readAt).toBeNull()

      // For timestamp stability, persist a deliberately old read timestamp for item 1 instead of relying
      // on two operations executing in different clock milliseconds
      const [item1DbRow] = await db
        .select({ id: notifications.id })
        .from(notifications)
        .innerJoin(activityEvents, eq(notifications.activityEventId, activityEvents.id))
        .where(
          and(
            eq(activityEvents.workItemId, item1.id),
            eq(notifications.recipientUserId, member.id),
          ),
        )
      expect(item1DbRow).toBeDefined()
      const oldReadAt = new Date('2024-01-01T12:00:00.000Z')
      await db
        .update(notifications)
        .set({ readAt: oldReadAt })
        .where(eq(notifications.id, item1DbRow!.id))

      // Request limit: 1 to prove markAll marks unloaded rows beyond the current page
      const pagedBefore = await listNotifications(memberActor, { limit: 1 })
      expect(pagedBefore.notifications).toHaveLength(1)
      expect(pagedBefore.nextCursor).not.toBeNull()

      // Mark all read
      await markAllNotificationsRead(memberActor)

      // Active inbox unread summary drops to 0
      const memberSummary = await getNotificationsSummary(memberActor)
      expect(memberSummary.unreadCount).toBe(0)

      // All active notifications are now marked read, including unloaded rows (Task 2 & Task 3)
      const memberNotifsAfter = await listNotifications(memberActor, {})
      expect(memberNotifsAfter.notifications.length).toBeGreaterThanOrEqual(3)
      expect(memberNotifsAfter.notifications.every((n) => n.readAt !== null)).toBe(true)

      // Deliberately old persisted read timestamp for item 1 was preserved
      const item1NotifAfter = memberNotifsAfter.notifications.find((n) => n.id === item1DbRow!.id)
      expect(item1NotifAfter?.readAt?.getTime()).toBe(oldReadAt.getTime())

      // Revoked-team notification for same recipient strictly remains unread in the database
      const [revokedDbRowAfter] = await db
        .select({ id: notifications.id, readAt: notifications.readAt })
        .from(notifications)
        .where(eq(notifications.id, revokedDbRow!.id))
      expect(revokedDbRowAfter?.readAt).toBeNull()

      // Other user unread count remains 1
      const otherSummary = await getNotificationsSummary(otherActor)
      expect(otherSummary.unreadCount).toBe(1)

      // A new notification created after markAllNotificationsRead stays unread
      await createItem(leadActor, {
        teamId: team1.id,
        title: 'New Task After Mark All',
        type: 'task',
        priority: 'low',
        assigneeId: member.id,
      })
      const memberSummaryWithNew = await getNotificationsSummary(memberActor)
      expect(memberSummaryWithNew.unreadCount).toBe(1)

      const memberNotifsWithNew = await listNotifications(memberActor, {})
      const newNotif = memberNotifsWithNew.notifications.find(
        (n) => n.itemTitle === 'New Task After Mark All',
      )
      expect(newNotif).toBeDefined()
      expect(newNotif?.readAt).toBeNull()
    })
  })
})
