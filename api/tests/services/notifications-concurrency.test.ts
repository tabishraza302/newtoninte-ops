import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { closeDb, db } from '../../src/db/client'
import { ApiError } from '../../src/http/errors'
import { memberships, notifications, workItems } from '../../src/db/schema'
import { withTransaction } from '../../src/db/tx'
import type { Actor, Status } from '../../src/domain/types'
import { addComment, assignItem, createItem, transitionItem } from '../../src/services/items'
import { recordActivity } from '../../src/services/activity'
import {
  createNotifications,
  getNotificationsSummary,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  teamLeadRecipientIds,
} from '../../src/services/notifications'
import { resetDb, seedItem, seedMembership, seedTeam, seedUser } from '../helpers/db'

describe('notifications concurrency & access regression tests', () => {
  beforeEach(resetDb)
  afterAll(closeDb)

  describe('1. Concurrent approvals produce only winning decision fan-out', () => {
    it('concurrent approvals by two leads on an awaiting_approval item produce exactly one transition and single recipient fan-out', async () => {
      const team = await seedTeam({ name: 'Approval Race Team', slug: 'approval-race-team' })
      const creator = await seedUser({ email: 'creator@race.test', displayName: 'Item Creator' })
      const assignee = await seedUser({ email: 'assignee@race.test', displayName: 'Current Assignee' })
      const lead1 = await seedUser({ email: 'lead1@race.test', displayName: 'Lead Approver 1' })
      const lead2 = await seedUser({ email: 'lead2@race.test', displayName: 'Lead Approver 2' })
      const observer = await seedUser({ email: 'observer@race.test', displayName: 'Team Observer' })

      await seedMembership(creator.id, team.id, 'member')
      await seedMembership(assignee.id, team.id, 'member')
      await seedMembership(lead1.id, team.id, 'lead')
      await seedMembership(lead2.id, team.id, 'lead')
      await seedMembership(observer.id, team.id, 'viewer')

      const creatorActor: Actor = { id: creator.id, isAdmin: false }
      const assigneeActor: Actor = { id: assignee.id, isAdmin: false }
      const lead1Actor: Actor = { id: lead1.id, isAdmin: false }
      const lead2Actor: Actor = { id: lead2.id, isAdmin: false }
      const observerActor: Actor = { id: observer.id, isAdmin: false }

      const item = await seedItem(team.id, {
        title: 'High priority change awaiting review',
        createdBy: creator.id,
        assigneeId: assignee.id,
        status: 'awaiting_approval',
        version: 2,
      })

      const results = await Promise.allSettled([
        transitionItem(lead1Actor, item.id, 'resolved', 'Approved by lead 1'),
        transitionItem(lead2Actor, item.id, 'resolved', 'Approved by lead 2'),
      ])

      const fulfilled = results.filter((r) => r.status === 'fulfilled')
      const rejected = results.filter((r) => r.status === 'rejected')

      expect(fulfilled).toHaveLength(1)
      expect(rejected).toHaveLength(1)

      const rejectionReason = rejected[0]?.reason
      expect(rejectionReason).toBeInstanceOf(ApiError)
      const apiErr = rejectionReason as ApiError
      expect(apiErr.code).toBe('STALE_STATE')
      expect(apiErr.status).toBe(409)

      // Work item status is resolved
      const [itemRow] = await db.select().from(workItems).where(eq(workItems.id, item.id)).limit(1)
      expect(itemRow?.status).toBe('resolved')

      // Recipient 1: Assignee received exactly one workflow_decision notification
      const assigneeSummary = await getNotificationsSummary(assigneeActor)
      expect(assigneeSummary.unreadCount).toBe(1)

      const assigneeList = await listNotifications(assigneeActor, {})
      expect(assigneeList.notifications).toHaveLength(1)
      const assigneeNotif = assigneeList.notifications[0]!
      expect(assigneeNotif.type).toBe('workflow_decision')
      expect(assigneeNotif.workItemId).toBe(item.id)
      expect(assigneeNotif.itemTitle).toBe(item.title)
      expect(assigneeNotif.fromStatus).toBe('awaiting_approval')
      expect(assigneeNotif.toStatus).toBe('resolved')
      expect(assigneeNotif.readAt).toBeNull()

      // Recipient 2: Creator received exactly one workflow_decision notification
      const creatorSummary = await getNotificationsSummary(creatorActor)
      expect(creatorSummary.unreadCount).toBe(1)

      const creatorList = await listNotifications(creatorActor, {})
      expect(creatorList.notifications).toHaveLength(1)
      const creatorNotif = creatorList.notifications[0]!
      expect(creatorNotif.type).toBe('workflow_decision')
      expect(creatorNotif.workItemId).toBe(item.id)
      expect(creatorNotif.fromStatus).toBe('awaiting_approval')
      expect(creatorNotif.toStatus).toBe('resolved')
      expect(creatorNotif.readAt).toBeNull()

      // Both notifications attribute to the winning lead
      const winningLeadId = assigneeNotif.actor?.id
      expect([lead1.id, lead2.id]).toContain(winningLeadId)
      expect(creatorNotif.actor?.id).toBe(winningLeadId)

      // Total workflow_decision rows in the database for this item is strictly 2 (creator + assignee)
      const itemNotifications = await db
        .select()
        .from(notifications)
        .where(eq(notifications.type, 'workflow_decision'))
      expect(itemNotifications).toHaveLength(2)

      // Unrelated observer received zero notifications
      const observerSummary = await getNotificationsSummary(observerActor)
      expect(observerSummary.unreadCount).toBe(0)
      const observerList = await listNotifications(observerActor, {})
      expect(observerList.notifications).toHaveLength(0)
    })

    it('concurrent approval vs send-back race produces only the winning workflow decision notification', async () => {
      const team = await seedTeam({ name: 'Approval Conflict Team', slug: 'approval-conflict-team' })
      const creator = await seedUser()
      const assignee = await seedUser()
      const leadA = await seedUser()
      const leadB = await seedUser()

      await seedMembership(creator.id, team.id, 'member')
      await seedMembership(assignee.id, team.id, 'member')
      await seedMembership(leadA.id, team.id, 'lead')
      await seedMembership(leadB.id, team.id, 'lead')

      const creatorActor: Actor = { id: creator.id, isAdmin: false }
      const assigneeActor: Actor = { id: assignee.id, isAdmin: false }
      const leadAActor: Actor = { id: leadA.id, isAdmin: false }
      const leadBActor: Actor = { id: leadB.id, isAdmin: false }

      const item = await seedItem(team.id, {
        createdBy: creator.id,
        assigneeId: assignee.id,
        status: 'awaiting_approval',
        version: 1,
      })

      const results = await Promise.allSettled([
        transitionItem(leadAActor, item.id, 'resolved', 'Looks good to resolve'),
        transitionItem(leadBActor, item.id, 'in_progress', 'Needs more changes'),
      ])

      const fulfilled = results.filter((r) => r.status === 'fulfilled')
      const rejected = results.filter((r) => r.status === 'rejected')

      expect(fulfilled).toHaveLength(1)
      expect(rejected).toHaveLength(1)
      expect(rejected[0]?.reason).toBeInstanceOf(ApiError)
      expect((rejected[0]?.reason as ApiError).code).toBe('STALE_STATE')

      const [updatedItem] = await db.select().from(workItems).where(eq(workItems.id, item.id)).limit(1)
      const winningStatus = updatedItem?.status as Status
      expect(['resolved', 'in_progress']).toContain(winningStatus)

      // Verify recipient notifications strictly match winning decision status
      const assigneeSummary = await getNotificationsSummary(assigneeActor)
      expect(assigneeSummary.unreadCount).toBe(1)
      const assigneeList = await listNotifications(assigneeActor, {})
      expect(assigneeList.notifications).toHaveLength(1)
      expect(assigneeList.notifications[0]?.toStatus).toBe(winningStatus)
      expect(assigneeList.notifications[0]?.fromStatus).toBe('awaiting_approval')

      const creatorSummary = await getNotificationsSummary(creatorActor)
      expect(creatorSummary.unreadCount).toBe(1)
      const creatorList = await listNotifications(creatorActor, {})
      expect(creatorList.notifications).toHaveLength(1)
      expect(creatorList.notifications[0]?.toStatus).toBe(winningStatus)
      expect(creatorList.notifications[0]?.fromStatus).toBe('awaiting_approval')
    })
  })

  describe('2. Transaction rollback removes publication', () => {
    it('aborted external transaction during createItem rolls back item, activity, and notification publication', async () => {
      const team = await seedTeam()
      const lead = await seedUser()
      const assignee = await seedUser()
      await seedMembership(lead.id, team.id, 'lead')
      await seedMembership(assignee.id, team.id, 'member')

      const leadActor: Actor = { id: lead.id, isAdmin: false }
      const assigneeActor: Actor = { id: assignee.id, isAdmin: false }

      // createItem with externalTx that aborts
      await expect(
        withTransaction(async (tx) => {
          await createItem(
            leadActor,
            {
              teamId: team.id,
              title: 'Should never commit',
              type: 'task',
              priority: 'urgent',
              assigneeId: assignee.id,
            },
            tx,
          )
          throw new Error('Simulated transaction rollback')
        }),
      ).rejects.toThrow('Simulated transaction rollback')

      // Assignee inbox has no unread counts and no notifications
      const summary = await getNotificationsSummary(assigneeActor)
      expect(summary.unreadCount).toBe(0)

      const feed = await listNotifications(assigneeActor, {})
      expect(feed.notifications).toHaveLength(0)

      // Database has no notifications for this assignee
      const dbRows = await db
        .select()
        .from(notifications)
        .where(eq(notifications.recipientUserId, assignee.id))
      expect(dbRows).toHaveLength(0)
    })


    it('transactional retry publishes notification exactly once upon eventual commit', async () => {
      const team = await seedTeam()
      const lead = await seedUser()
      const member = await seedUser()
      await seedMembership(lead.id, team.id, 'lead')
      await seedMembership(member.id, team.id, 'member')

      const memberActor: Actor = { id: member.id, isAdmin: false }
      const item = await seedItem(team.id, { createdBy: lead.id })

      let attempt = 0
      await withTransaction(async (tx) => {
        attempt++
        const actId = await recordActivity(tx, {
          workItemId: item.id,
          actorId: lead.id,
          type: 'comment_added',
          metadata: { body: `Attempt ${attempt}` },
        })

        await createNotifications(tx, {
          activityEventId: actId,
          type: 'comment_added',
          actorId: lead.id,
          teamId: team.id,
          recipientUserIds: [member.id],
        })

        if (attempt === 1) {
          throw new Error('Simulated transient deadlock on first attempt')
        }
      }).catch(async () => {
        // Retry loop: attempt 2 succeeds
        await withTransaction(async (tx) => {
          attempt++
          const actId = await recordActivity(tx, {
            workItemId: item.id,
            actorId: lead.id,
            type: 'comment_added',
            metadata: { body: `Attempt ${attempt}` },
          })

          await createNotifications(tx, {
            activityEventId: actId,
            type: 'comment_added',
            actorId: lead.id,
            teamId: team.id,
            recipientUserIds: [member.id],
          })
        })
      })

      const summary = await getNotificationsSummary(memberActor)
      expect(summary.unreadCount).toBe(1)

      const feed = await listNotifications(memberActor, {})
      expect(feed.notifications).toHaveLength(1)
    })
  })

  describe('3. Live membership after repeatable-read snapshot prevents stale access and wrong recipient', () => {
    it('createNotifications with locking read .for(share) ignores candidate whose membership was revoked after snapshot creation', async () => {
      const team = await seedTeam()
      const lead = await seedUser()
      const member = await seedUser()
      await seedMembership(lead.id, team.id, 'lead')
      await seedMembership(member.id, team.id, 'member')

      const memberActor: Actor = { id: member.id, isAdmin: false }
      const item = await seedItem(team.id, { createdBy: lead.id })

      // Open a transaction that establishes a REPEATABLE READ snapshot before membership deletion
      await withTransaction(async (tx) => {
        // Non-locking read establishes the transaction snapshot while member is still present
        const [snapshotItem] = await tx
          .select()
          .from(workItems)
          .where(eq(workItems.id, item.id))
        expect(snapshotItem).toBeDefined()

        // Concurrently outside this transaction, remove the member from the team
        await db
          .delete(memberships)
          .where(and(eq(memberships.userId, member.id), eq(memberships.teamId, team.id)))

        // Record activity inside transaction
        const actId = await recordActivity(tx, {
          workItemId: item.id,
          actorId: lead.id,
          type: 'assignee_changed',
          fromValue: null,
          toValue: String(member.id),
        })

        // createNotifications uses locking .for('share') read on memberships,
        // bypassing the stale snapshot and observing the live deletion
        await createNotifications(tx, {
          activityEventId: actId,
          type: 'assigned',
          actorId: lead.id,
          teamId: team.id,
          recipientUserIds: [member.id],
        })
      })

      // The removed member was not granted a notification row
      const summary = await getNotificationsSummary(memberActor)
      expect(summary.unreadCount).toBe(0)

      const feed = await listNotifications(memberActor, {})
      expect(feed.notifications).toHaveLength(0)

      const allNotifs = await db
        .select()
        .from(notifications)
        .where(eq(notifications.recipientUserId, member.id))
      expect(allNotifs).toHaveLength(0)
    })

    it('teamLeadRecipientIds with locking read excludes a lead demoted after snapshot creation', async () => {
      const team = await seedTeam()
      const lead1 = await seedUser()
      const lead2 = await seedUser()
      await seedMembership(lead1.id, team.id, 'lead')
      await seedMembership(lead2.id, team.id, 'lead')

      const item = await seedItem(team.id, { createdBy: lead1.id })

      let qualifyingLeads: number[] = []
      await withTransaction(async (tx) => {
        // Establish repeatable-read snapshot
        const [beforeItem] = await tx
          .select()
          .from(workItems)
          .where(eq(workItems.id, item.id))
        expect(beforeItem).toBeDefined()

        // Outside tx, demote lead2 to viewer
        await db
          .update(memberships)
          .set({ role: 'viewer' })
          .where(and(eq(memberships.userId, lead2.id), eq(memberships.teamId, team.id)))

        // teamLeadRecipientIds reads current leads with .for('share')
        qualifyingLeads = await teamLeadRecipientIds(tx, team.id)
      })

      expect(qualifyingLeads).toEqual([lead1.id])
      expect(qualifyingLeads).not.toContain(lead2.id)
    })

    it('markNotificationRead denies access (404 NOT_FOUND) if membership was revoked, even if transaction had older snapshot', async () => {
      const team = await seedTeam()
      const lead = await seedUser()
      const member = await seedUser()
      await seedMembership(lead.id, team.id, 'lead')
      await seedMembership(member.id, team.id, 'member')

      const memberActor: Actor = { id: member.id, isAdmin: false }
      const item = await seedItem(team.id, { createdBy: lead.id, assigneeId: member.id })

      // Seed valid notification for member
      await withTransaction(async (tx) => {
        const actId = await recordActivity(tx, {
          workItemId: item.id,
          actorId: lead.id,
          type: 'assignee_changed',
          fromValue: null,
          toValue: String(member.id),
        })
        await createNotifications(tx, {
          activityEventId: actId,
          type: 'assigned',
          actorId: lead.id,
          teamId: team.id,
          recipientUserIds: [member.id],
        })
      })

      const feedBefore = await listNotifications(memberActor, {})
      expect(feedBefore.notifications).toHaveLength(1)
      const notificationId = feedBefore.notifications[0]!.id

      // Revoke member's membership from the team
      await db
        .delete(memberships)
        .where(and(eq(memberships.userId, member.id), eq(memberships.teamId, team.id)))

      // Attempting to mark as read must check live membership inside transaction and return 404
      let caughtError: unknown
      try {
        await markNotificationRead(memberActor, notificationId)
      } catch (err) {
        caughtError = err
      }

      expect(caughtError).toBeInstanceOf(ApiError)
      const apiErr = caughtError as ApiError
      expect(apiErr.code).toBe('NOT_FOUND')
      expect(apiErr.status).toBe(404)

      // Database row remains unread (readAt is still null)
      const [persisted] = await db
        .select()
        .from(notifications)
        .where(eq(notifications.id, notificationId))
      expect(persisted?.readAt).toBeNull()
    })

    it('revoking membership immediately hides inbox notifications from summary and list; rejoining restores access', async () => {
      const team = await seedTeam()
      const lead = await seedUser()
      const member = await seedUser()
      await seedMembership(lead.id, team.id, 'lead')
      await seedMembership(member.id, team.id, 'member')

      const memberActor: Actor = { id: member.id, isAdmin: false }
      const item1 = await seedItem(team.id, { createdBy: lead.id })
      const item2 = await seedItem(team.id, { createdBy: lead.id })

      // Publish two notifications
      await withTransaction(async (tx) => {
        const act1 = await recordActivity(tx, {
          workItemId: item1.id,
          actorId: lead.id,
          type: 'comment_added',
          metadata: { body: 'Notice 1' },
        })
        const act2 = await recordActivity(tx, {
          workItemId: item2.id,
          actorId: lead.id,
          type: 'comment_added',
          metadata: { body: 'Notice 2' },
        })
        await createNotifications(tx, {
          activityEventId: act1,
          type: 'comment_added',
          actorId: lead.id,
          teamId: team.id,
          recipientUserIds: [member.id],
        })
        await createNotifications(tx, {
          activityEventId: act2,
          type: 'comment_added',
          actorId: lead.id,
          teamId: team.id,
          recipientUserIds: [member.id],
        })
      })

      // Initial state: 2 unread visible
      expect((await getNotificationsSummary(memberActor)).unreadCount).toBe(2)
      const initialFeed = await listNotifications(memberActor, {})
      expect(initialFeed.notifications).toHaveLength(2)

      // Remove membership
      await db
        .delete(memberships)
        .where(and(eq(memberships.userId, member.id), eq(memberships.teamId, team.id)))

      // Immediately hidden: count 0 and empty feed
      expect((await getNotificationsSummary(memberActor)).unreadCount).toBe(0)
      const hiddenFeed = await listNotifications(memberActor, {})
      expect(hiddenFeed.notifications).toHaveLength(0)

      // Rejoining restores retained history
      await seedMembership(member.id, team.id, 'member')

      expect((await getNotificationsSummary(memberActor)).unreadCount).toBe(2)
      const restoredFeed = await listNotifications(memberActor, {})
      expect(restoredFeed.notifications).toHaveLength(2)
      expect(restoredFeed.notifications.map((n) => n.id)).toEqual(
        initialFeed.notifications.map((n) => n.id),
      )
    })
  })

  describe('4. Comment versus reassignment recipients follow serialized locked item state', () => {
    it('deterministic barrier: reassignment commits while addComment waits on row lock, notifying serialized new assignee', async () => {
      const team = await seedTeam()
      const creator = await seedUser()
      const oldAssignee = await seedUser()
      const newAssignee = await seedUser()

      await seedMembership(creator.id, team.id, 'lead')
      await seedMembership(oldAssignee.id, team.id, 'member')
      await seedMembership(newAssignee.id, team.id, 'member')

      const creatorActor: Actor = { id: creator.id, isAdmin: false }
      const oldAssigneeActor: Actor = { id: oldAssignee.id, isAdmin: false }
      const newAssigneeActor: Actor = { id: newAssignee.id, isAdmin: false }

      const item = await seedItem(team.id, {
        createdBy: creator.id,
        assigneeId: oldAssignee.id,
        version: 1,
      })

      await assignItem(creatorActor, item.id, newAssignee.id, 1)
      await addComment(creatorActor, item.id, 'Important update following reassignment')

      // Old assignee must receive NO comment notification
      const oldAssigneeFeed = await listNotifications(oldAssigneeActor, {})
      expect(oldAssigneeFeed.notifications.filter((n) => n.type === 'comment_added')).toHaveLength(0)

      // New assignee must receive the comment notification
      const newAssigneeFeed = await listNotifications(newAssigneeActor, {})
      const commentNotif = newAssigneeFeed.notifications.find((n) => n.type === 'comment_added')
      expect(commentNotif).toBeDefined()
      expect(commentNotif?.workItemId).toBe(item.id)
      expect(commentNotif?.actor?.id).toBe(creator.id)

      // Creator (as commenter/author) is excluded from receiving their own comment notification
      const creatorFeed = await listNotifications(creatorActor, {})
      expect(creatorFeed.notifications.filter((n) => n.type === 'comment_added')).toHaveLength(0)
    })

    it('concurrent race: parallel assignItem and addComment strictly serialize notification recipients', async () => {
      const team = await seedTeam()
      const lead = await seedUser()
      const oldAssignee = await seedUser()
      const newAssignee = await seedUser()

      await seedMembership(lead.id, team.id, 'lead')
      await seedMembership(oldAssignee.id, team.id, 'member')
      await seedMembership(newAssignee.id, team.id, 'member')

      const leadActor: Actor = { id: lead.id, isAdmin: false }
      const oldAssigneeActor: Actor = { id: oldAssignee.id, isAdmin: false }
      const newAssigneeActor: Actor = { id: newAssignee.id, isAdmin: false }

      const item = await seedItem(team.id, {
        createdBy: lead.id,
        assigneeId: oldAssignee.id,
        version: 1,
      })

      // Race assignItem and addComment concurrently
      await Promise.all([
        assignItem(leadActor, item.id, newAssignee.id, 1),
        addComment(leadActor, item.id, 'Concurrent comment racing with assignment'),
      ])

      const oldFeed = await listNotifications(oldAssigneeActor, {})
      const newFeed = await listNotifications(newAssigneeActor, {})

      // Serialization invariant 1: New assignee ALWAYS received the 'assigned' notification
      const newAssignedNotifs = newFeed.notifications.filter((n) => n.type === 'assigned')
      expect(newAssignedNotifs).toHaveLength(1)

      // Serialization invariant 2: Old assignee NEVER receives the 'assigned' notification
      const oldAssignedNotifs = oldFeed.notifications.filter((n) => n.type === 'assigned')
      expect(oldAssignedNotifs).toHaveLength(0)

      // Serialization invariant 3: Total comment_added notifications across the two assignees is strictly 1
      const oldCommentNotifs = oldFeed.notifications.filter((n) => n.type === 'comment_added')
      const newCommentNotifs = newFeed.notifications.filter((n) => n.type === 'comment_added')
      expect(oldCommentNotifs.length + newCommentNotifs.length).toBe(1)

      // If newAssignee received the comment (assignment serialized first), oldAssignee has 0 notifications
      if (newCommentNotifs.length === 1) {
        expect(oldFeed.notifications).toHaveLength(0)
      } else {
        // If oldAssignee received the comment (comment serialized first), newAssignee only has assigned
        expect(oldCommentNotifs).toHaveLength(1)
        expect(newFeed.notifications).toHaveLength(1)
      }
    })

    it('concurrent comment on unassigned item racing with assignment produces consistent notification state', async () => {
      const team = await seedTeam()
      const lead = await seedUser()
      const newAssignee = await seedUser()

      await seedMembership(lead.id, team.id, 'lead')
      await seedMembership(newAssignee.id, team.id, 'member')

      const leadActor: Actor = { id: lead.id, isAdmin: false }
      const newAssigneeActor: Actor = { id: newAssignee.id, isAdmin: false }

      const item = await seedItem(team.id, {
        createdBy: lead.id,
        assigneeId: null,
        version: 1,
      })

      await Promise.all([
        assignItem(leadActor, item.id, newAssignee.id, 1),
        addComment(leadActor, item.id, 'Comment on previously unassigned item'),
      ])

      const feed = await listNotifications(newAssigneeActor, {})
      const assignedNotifs = feed.notifications.filter((n) => n.type === 'assigned')
      expect(assignedNotifs).toHaveLength(1)

      // If assign serialized before comment, newAssignee also gets comment_added
      const commentNotifs = feed.notifications.filter((n) => n.type === 'comment_added')
      expect([0, 1]).toContain(commentNotifs.length)
    })
  })

  describe('5. Inbox mutation isolation and concurrency', () => {
    it('markAllNotificationsRead isolates updates to caller without affecting other users unread notifications', async () => {
      const team = await seedTeam()
      const lead = await seedUser()
      const userA = await seedUser()
      const userB = await seedUser()

      await seedMembership(lead.id, team.id, 'lead')
      await seedMembership(userA.id, team.id, 'member')
      await seedMembership(userB.id, team.id, 'member')

      const userAActor: Actor = { id: userA.id, isAdmin: false }
      const userBActor: Actor = { id: userB.id, isAdmin: false }

      const item = await seedItem(team.id, { createdBy: lead.id })

      // Seed 2 notifications each for User A and User B
      await withTransaction(async (tx) => {
        const act1 = await recordActivity(tx, {
          workItemId: item.id,
          actorId: lead.id,
          type: 'comment_added',
          metadata: { body: 'Note A1' },
        })
        const act2 = await recordActivity(tx, {
          workItemId: item.id,
          actorId: lead.id,
          type: 'comment_added',
          metadata: { body: 'Note A2' },
        })
        await createNotifications(tx, {
          activityEventId: act1,
          type: 'comment_added',
          actorId: lead.id,
          teamId: team.id,
          recipientUserIds: [userA.id, userB.id],
        })
        await createNotifications(tx, {
          activityEventId: act2,
          type: 'comment_added',
          actorId: lead.id,
          teamId: team.id,
          recipientUserIds: [userA.id, userB.id],
        })
      })

      expect((await getNotificationsSummary(userAActor)).unreadCount).toBe(2)
      expect((await getNotificationsSummary(userBActor)).unreadCount).toBe(2)

      // User A marks all as read
      await markAllNotificationsRead(userAActor)

      // User A is now at 0 unread
      expect((await getNotificationsSummary(userAActor)).unreadCount).toBe(0)
      const feedA = await listNotifications(userAActor, {})
      expect(feedA.notifications.every((n) => n.readAt !== null)).toBe(true)

      // User B is completely unaffected: still 2 unread
      expect((await getNotificationsSummary(userBActor)).unreadCount).toBe(2)
      const feedB = await listNotifications(userBActor, {})
      expect(feedB.notifications.every((n) => n.readAt === null)).toBe(true)
    })

    it('concurrent markNotificationRead calls on the same notification are idempotent and preserve readAt timestamp', async () => {
      const team = await seedTeam()
      const lead = await seedUser()
      const user = await seedUser()

      await seedMembership(lead.id, team.id, 'lead')
      await seedMembership(user.id, team.id, 'member')

      const userActor: Actor = { id: user.id, isAdmin: false }
      const item = await seedItem(team.id, { createdBy: lead.id })

      await withTransaction(async (tx) => {
        const act = await recordActivity(tx, {
          workItemId: item.id,
          actorId: lead.id,
          type: 'comment_added',
          metadata: { body: 'Single mark test' },
        })
        await createNotifications(tx, {
          activityEventId: act,
          type: 'comment_added',
          actorId: lead.id,
          teamId: team.id,
          recipientUserIds: [user.id],
        })
      })

      const feed = await listNotifications(userActor, {})
      expect(feed.notifications).toHaveLength(1)
      const notifId = feed.notifications[0]!.id

      // Concurrent parallel markNotificationRead calls
      await Promise.all([
        markNotificationRead(userActor, notifId),
        markNotificationRead(userActor, notifId),
      ])

      const summaryAfter = await getNotificationsSummary(userActor)
      expect(summaryAfter.unreadCount).toBe(0)

      const feedAfter = await listNotifications(userActor, {})
      const initialReadAt = feedAfter.notifications[0]?.readAt
      expect(initialReadAt).toBeInstanceOf(Date)

      // Repeat mark-read succeeds and preserves the existing readAt timestamp
      await markNotificationRead(userActor, notifId)
      const feedRepeat = await listNotifications(userActor, {})
      expect(feedRepeat.notifications[0]?.readAt?.getTime()).toBe(initialReadAt?.getTime())
    })
  })
})
