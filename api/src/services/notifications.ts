import { and, desc, eq, inArray, isNull, lt, sql } from 'drizzle-orm'
import { db } from '../db/client'
import { activityEvents, memberships, notifications, users, workItems } from '../db/schema'
import type { Tx } from '../db/tx'
import { withTransaction } from '../db/tx'
import { buildPage, decodeIdCursor, DEFAULT_LIMIT, MAX_LIMIT } from '../http/cursor'
import { ApiError } from '../http/errors'
import { authorize } from '../policy'
import { STATUSES, type Actor, type NotificationType, type Status } from '../domain/types'

export interface CreateNotificationsInput {
  activityEventId: number
  type: NotificationType
  actorId: number
  teamId: number
  recipientUserIds: readonly number[]
}

/**
 * Persists recipient notifications for an activity event.
 * Deduplicates recipient IDs, removes the actor, and selects only current
 * memberships for the supplied team and IDs inside `tx` using locking
 * `.for('share')` reads. Bulk inserts one row per remaining recipient.
 */
export async function createNotifications(tx: Tx, input: CreateNotificationsInput): Promise<void> {
  const uniqueRecipientIds = Array.from(new Set(input.recipientUserIds)).filter(
    (id) => id !== input.actorId,
  )
  if (uniqueRecipientIds.length === 0) {
    return
  }

  const validMembers = await tx
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(
      and(
        eq(memberships.teamId, input.teamId),
        inArray(memberships.userId, uniqueRecipientIds),
      ),
    )
    .for('share')

  if (validMembers.length === 0) {
    return
  }

  const rows = validMembers.map((m) => ({
    recipientUserId: m.userId,
    activityEventId: input.activityEventId,
    type: input.type,
  }))

  await tx.insert(notifications).values(rows)
}

/**
 * Returns user IDs of current team leads with a shared lock inside `tx`.
 */
export async function teamLeadRecipientIds(tx: Tx, teamId: number): Promise<number[]> {
  const rows = await tx
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(and(eq(memberships.teamId, teamId), eq(memberships.role, 'lead')))
    .for('share')
  return rows.map((r) => r.userId)
}

export interface NotificationView {
  id: number
  type: NotificationType
  workItemId: number
  itemTitle: string
  actor: { id: number; displayName: string } | null
  fromStatus: Status | null
  toStatus: Status | null
  createdAt: Date
  readAt: Date | null
}

export interface NotificationRow {
  id: number
  type: NotificationType
  readAt: Date | null
  createdAt: Date
  activityEventType: string
  fromValue: string | null
  toValue: string | null
  workItemId: number
  itemTitle: string
  actorId: number | null
  actorDisplayName: string | null
}

export function mapNotificationRow(r: NotificationRow): NotificationView {
  const isStatus = r.activityEventType === 'status_changed'
  const fromStatus =
    isStatus && r.fromValue && (STATUSES as readonly string[]).includes(r.fromValue)
      ? (r.fromValue as Status)
      : null
  const toStatus =
    isStatus && r.toValue && (STATUSES as readonly string[]).includes(r.toValue)
      ? (r.toValue as Status)
      : null

  return {
    id: r.id,
    type: r.type,
    workItemId: r.workItemId,
    itemTitle: r.itemTitle,
    actor:
      r.actorId !== null && r.actorDisplayName !== null
        ? { id: r.actorId, displayName: r.actorDisplayName }
        : null,
    fromStatus,
    toStatus,
    createdAt: r.createdAt,
    readAt: r.readAt,
  }
}

/**
 * Fetches visible notifications for a recipient, optionally filtered to a specific set of IDs.
 */
export async function fetchVisibleNotifications(
  recipientUserId: number,
  specificIds?: number[],
): Promise<NotificationView[]> {
  const conditions = [
    eq(notifications.recipientUserId, recipientUserId),
    eq(memberships.userId, recipientUserId),
  ]
  if (specificIds && specificIds.length > 0) {
    conditions.push(inArray(notifications.id, specificIds))
  }

  const rows = await db
    .select({
      id: notifications.id,
      type: notifications.type,
      readAt: notifications.readAt,
      createdAt: notifications.createdAt,
      activityEventType: activityEvents.type,
      fromValue: activityEvents.fromValue,
      toValue: activityEvents.toValue,
      workItemId: workItems.id,
      itemTitle: workItems.title,
      actorId: activityEvents.actorId,
      actorDisplayName: users.displayName,
    })
    .from(notifications)
    .innerJoin(activityEvents, eq(notifications.activityEventId, activityEvents.id))
    .innerJoin(workItems, eq(activityEvents.workItemId, workItems.id))
    .innerJoin(
      memberships,
      and(
        eq(workItems.teamId, memberships.teamId),
        eq(memberships.userId, recipientUserId),
      ),
    )
    .leftJoin(users, eq(activityEvents.actorId, users.id))
    .where(and(...conditions))
    .orderBy(desc(notifications.id))

  return rows.map(mapNotificationRow)
}

/**
 * Keyset-paginated notification feed visible to actor.
 * Joins notifications -> activityEvents -> workItems and current team membership.
 */
export async function listNotifications(
  actor: Actor,
  query: { cursor?: string; limit?: number },
): Promise<{ notifications: NotificationView[]; nextCursor: string | null }> {
  const limit = query.limit ?? DEFAULT_LIMIT
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw ApiError.of('VALIDATION_ERROR', `limit must be an integer between 1 and ${MAX_LIMIT}`)
  }

  const scope = `notifications:user:${actor.id}`
  const cursorId = decodeIdCursor(query.cursor, scope)

  const conditions = [
    eq(notifications.recipientUserId, actor.id),
    eq(memberships.userId, actor.id),
  ]
  if (cursorId !== null) {
    conditions.push(lt(notifications.id, cursorId))
  }

  const rows = await db
    .select({
      id: notifications.id,
      type: notifications.type,
      readAt: notifications.readAt,
      createdAt: notifications.createdAt,
      activityEventType: activityEvents.type,
      fromValue: activityEvents.fromValue,
      toValue: activityEvents.toValue,
      workItemId: workItems.id,
      itemTitle: workItems.title,
      actorId: activityEvents.actorId,
      actorDisplayName: users.displayName,
    })
    .from(notifications)
    .innerJoin(activityEvents, eq(notifications.activityEventId, activityEvents.id))
    .innerJoin(workItems, eq(activityEvents.workItemId, workItems.id))
    .innerJoin(
      memberships,
      and(
        eq(workItems.teamId, memberships.teamId),
        eq(memberships.userId, actor.id),
      ),
    )
    .leftJoin(users, eq(activityEvents.actorId, users.id))
    .where(and(...conditions))
    .orderBy(desc(notifications.id))
    .limit(limit + 1)

  const views: NotificationView[] = rows.map(mapNotificationRow)

  const { page, nextCursor } = buildPage(
    views,
    limit,
    (row) => ({ id: row.id }),
    scope,
  )

  return { notifications: page, nextCursor }
}

/**
 * Counts all visible unread notifications for a recipient user.
 */
export async function countVisibleUnreadNotifications(recipientUserId: number): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(notifications)
    .innerJoin(activityEvents, eq(notifications.activityEventId, activityEvents.id))
    .innerJoin(workItems, eq(activityEvents.workItemId, workItems.id))
    .innerJoin(
      memberships,
      and(
        eq(workItems.teamId, memberships.teamId),
        eq(memberships.userId, recipientUserId),
      ),
    )
    .where(
      and(
        eq(notifications.recipientUserId, recipientUserId),
        isNull(notifications.readAt),
      ),
    )

  return Number(row?.count ?? 0)
}

/**
 * Counts all visible unread notifications for the actor.
 */
export async function getNotificationsSummary(actor: Actor): Promise<{ unreadCount: number }> {
  const unreadCount = await countVisibleUnreadNotifications(actor.id)
  return { unreadCount }
}

/**
 * Marks a single notification as read if visible to the actor and owned by the actor.
 */
export async function markNotificationRead(actor: Actor, id: number): Promise<void> {
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw ApiError.of('VALIDATION_ERROR', 'Notification ID must be a positive integer')
  }

  await withTransaction(async (tx) => {
    const [row] = await tx
      .select({
        id: notifications.id,
        readAt: notifications.readAt,
        teamId: workItems.teamId,
        creatorId: workItems.createdBy,
        assigneeId: workItems.assigneeId,
      })
      .from(notifications)
      .innerJoin(activityEvents, eq(notifications.activityEventId, activityEvents.id))
      .innerJoin(workItems, eq(activityEvents.workItemId, workItems.id))
      .where(
        and(
          eq(notifications.id, id),
          eq(notifications.recipientUserId, actor.id),
        ),
      )
      .for('update')

    if (!row) {
      throw ApiError.of('NOT_FOUND')
    }

    await authorize(
      actor,
      'item:read',
      {
        kind: 'item',
        teamId: row.teamId,
        creatorId: row.creatorId,
        assigneeId: row.assigneeId,
      },
      tx,
    )

    if (row.readAt === null) {
      await tx
        .update(notifications)
        .set({
          readAt: sql`CURRENT_TIMESTAMP(3)`,
        })
        .where(eq(notifications.id, id))
    }
  })
}

/**
 * Marks all visible unread notifications as read for the actor.
 */
export async function markAllNotificationsRead(actor: Actor): Promise<void> {
  await db.execute(sql`
    UPDATE ${notifications}
    INNER JOIN ${activityEvents} ON ${notifications.activityEventId} = ${activityEvents.id}
    INNER JOIN ${workItems} ON ${activityEvents.workItemId} = ${workItems.id}
    INNER JOIN ${memberships} ON ${workItems.teamId} = ${memberships.teamId} AND ${memberships.userId} = ${actor.id}
    SET ${notifications.readAt} = CURRENT_TIMESTAMP(3)
    WHERE ${notifications.recipientUserId} = ${actor.id}
      AND ${notifications.readAt} IS NULL
  `)
}
