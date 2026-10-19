import type { Request, Response } from 'express'
import { desc, eq } from 'drizzle-orm'
import { decodeJwt } from 'jose'
import { db } from '../db/client'
import { notifications, users } from '../db/schema'
import type { Actor } from '../domain/types'
import {
  countVisibleUnreadNotifications,
  fetchVisibleNotifications,
  type NotificationView,
} from './notifications'

export interface StreamOptions {
  pollIntervalMs?: number
  heartbeatIntervalMs?: number
  backpressureTimeoutMs?: number
}

/**
 * Notification SSE Stream Contract:
 * - Bounded Snapshot: Initial connection delivers up to DEFAULT_SNAPSHOT_LIMIT (50) recent visible notifications.
 *   Complete persistent history is accessible via keyset-paginated GET /notifications.
 * - Accurate History Count: unreadCount always reflects the full visible unread count across the user's lifetime.
 * - Sliding Lookback Polling: Recurring 1-second ticks scan the most recent DEFAULT_POLL_BATCH_SIZE (100)
 *   recipient notification IDs using the indexed (recipientUserId, id) descending scan. This captures
 *   concurrent out-of-order and delayed lower-ID commits without whole-table scans or missed late commits.
 * - Bounded Connection Memory: Tracks at most DEFAULT_MAX_SEEN_CACHE_SIZE (500) IDs in connection memory via FIFO eviction,
 *   preventing process memory exhaustion on long-lived connections.
 * - Catch-up Disconnection Semantics: SSE does not claim exactly-once or full-replay semantics across long disconnects;
 *   clients catch up on historical records through the paginated /notifications feed.
 */
export const SNAPSHOT_LIMIT = 50
export const POLL_BATCH_SIZE = 100
export const MAX_SEEN_CACHE_SIZE = 500

export async function handleNotificationStream(
  actor: Actor,
  token: string,
  req: Request,
  res: Response,
  options?: StreamOptions,
): Promise<void> {
  const pollIntervalMs = options?.pollIntervalMs ?? 1000
  const heartbeatIntervalMs = options?.heartbeatIntervalMs ?? 15000
  const backpressureTimeoutMs = options?.backpressureTimeoutMs ?? 5000

  // 1. Verify user is active in DB before establishing stream
  const [initialUser] = await db
    .select({ status: users.status })
    .from(users)
    .where(eq(users.id, actor.id))
    .limit(1)

  if (!initialUser || initialUser.status === 'disabled') {
    res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'User is disabled or deleted' } })
    return
  }

  // 2. Set headers promptly
  res.status(200)
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders?.()

  // 3. Extract token expiration if available
  let tokenExpiresAtMs: number | null = null
  try {
    const payload = decodeJwt(token)
    if (typeof payload.exp === 'number') {
      tokenExpiresAtMs = payload.exp * 1000
    }
  } catch {
    // Verified by auth middleware; non-fatal if payload inspection fails
  }

  // Internal state
  const seenNotificationIds = new Set<number>()
  const markSeen = (id: number) => {
    seenNotificationIds.add(id)
    while (seenNotificationIds.size > MAX_SEEN_CACHE_SIZE) {
      const oldest = seenNotificationIds.values().next().value
      if (oldest !== undefined) {
        seenNotificationIds.delete(oldest)
      } else {
        break
      }
    }
  }
  let lastUnreadCount = 0
  let isClosed = false
  let isTicking = false
  let pollTimer: NodeJS.Timeout | null = null
  let heartbeatTimer: NodeJS.Timeout | null = null
  let tokenTimer: NodeJS.Timeout | null = null

  const cleanup = () => {
    if (isClosed) return
    isClosed = true
    clearTimeout(pollTimer ?? undefined)
    pollTimer = null
    clearInterval(heartbeatTimer ?? undefined)
    heartbeatTimer = null
    clearTimeout(tokenTimer ?? undefined)
    tokenTimer = null
    seenNotificationIds.clear()
    req.removeListener('close', cleanup)
    res.removeListener('close', cleanup)
    res.removeListener('error', cleanup)
  }

  req.on('close', cleanup)
  res.on('close', cleanup)
  res.on('error', cleanup)

  if (tokenExpiresAtMs !== null) {
    const ttlMs = Math.max(0, tokenExpiresAtMs - Date.now())
    tokenTimer = setTimeout(() => {
      cleanup()
      if (!res.writableEnded && !res.destroyed) {
        res.end()
      }
    }, ttlMs)
  }

  const writeData = async (chunk: string): Promise<boolean> => {
    if (isClosed || res.writableEnded || res.destroyed) {
      return false
    }

    const canWriteMore = res.write(chunk)
    if (canWriteMore) {
      return true
    }

    return new Promise<boolean>((resolve) => {
      let timeoutId: NodeJS.Timeout | null = null

      const onDrain = () => {
        clearTimeout(timeoutId ?? undefined)
        res.removeListener('error', onError)
        res.removeListener('close', onClose)
        resolve(true)
      }

      const onError = () => {
        clearTimeout(timeoutId ?? undefined)
        res.removeListener('drain', onDrain)
        res.removeListener('close', onClose)
        resolve(false)
      }

      const onClose = () => {
        clearTimeout(timeoutId ?? undefined)
        res.removeListener('drain', onDrain)
        res.removeListener('error', onError)
        resolve(false)
      }

      timeoutId = setTimeout(() => {
        res.removeListener('drain', onDrain)
        res.removeListener('error', onError)
        res.removeListener('close', onClose)
        cleanup()
        res.destroy()
        resolve(false)
      }, backpressureTimeoutMs)

      res.once('drain', onDrain)
      res.once('error', onError)
      res.once('close', onClose)
    })
  }

  // 4. Baseline snapshot initialization
  try {

    // Record baseline of bounded recent recipient notification IDs (including membership-hidden rows)
    const recentRecipientRows = await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(eq(notifications.recipientUserId, actor.id))
      .orderBy(desc(notifications.id))
      .limit(POLL_BATCH_SIZE)
    // Fetch bounded visible notifications for the snapshot
    const initialVisibleNotifications = await fetchVisibleNotifications(actor.id, {
      limit: SNAPSHOT_LIMIT,
    })
    lastUnreadCount = await countVisibleUnreadNotifications(actor.id)

    const ok = await writeData(
      `event: snapshot\ndata: ${JSON.stringify({
        notifications: initialVisibleNotifications,
        unreadCount: lastUnreadCount,
      })}\n\n`,
    )
    if (!ok) {
      cleanup()
      return
    }

    for (const row of recentRecipientRows) {
      markSeen(row.id)
    }
    for (const notif of initialVisibleNotifications) {
      markSeen(notif.id)
    }
  } catch {
    cleanup()
    if (!res.writableEnded && !res.destroyed) {
      res.end()
    }
    return
  }

  // Heartbeat comment ping
  heartbeatTimer = setInterval(() => {
    if (isClosed || res.writableEnded || res.destroyed) {
      return
    }
    void writeData(': ping\n\n')
  }, heartbeatIntervalMs)

  // 5. Recurring tick
  const tick = async (): Promise<void> => {
    if (isClosed || res.writableEnded || res.destroyed) {
      return
    }
    if (isTicking) {
      return
    }
    isTicking = true

    try {
      // Re-verify user active
      const [currentUser] = await db
        .select({ status: users.status })
        .from(users)
        .where(eq(users.id, actor.id))
        .limit(1)

      if (!currentUser || currentUser.status === 'disabled') {
        cleanup()
        if (!res.writableEnded && !res.destroyed) {
          res.end()
        }
        return
      }

      // Check token expiry
      if (tokenExpiresAtMs !== null && Date.now() >= tokenExpiresAtMs) {
        cleanup()
        if (!res.writableEnded && !res.destroyed) {
          res.end()
        }
        return
      }

      // Scan bounded recent recipient notification IDs (using indexed recipient query)
      const currentRows = await db
        .select({ id: notifications.id })
        .from(notifications)
        .where(eq(notifications.recipientUserId, actor.id))
        .orderBy(desc(notifications.id))
        .limit(POLL_BATCH_SIZE)

      const unseenIds: number[] = []
      for (let i = currentRows.length - 1; i >= 0; i--) {
        const id = currentRows[i]!.id
        if (!seenNotificationIds.has(id)) {
          unseenIds.push(id)
        }
      }

      let newVisibleNotifications: NotificationView[] = []
      if (unseenIds.length > 0) {
        newVisibleNotifications = await fetchVisibleNotifications(actor.id, {
          specificIds: unseenIds,
        })
      }

      const currentUnreadCount = await countVisibleUnreadNotifications(actor.id)

      if (newVisibleNotifications.length > 0) {
        const ok = await writeData(
          `event: notifications\ndata: ${JSON.stringify({
            notifications: newVisibleNotifications,
            unreadCount: currentUnreadCount,
          })}\n\n`,
        )
        if (!ok) {
          cleanup()
          return
        }
        lastUnreadCount = currentUnreadCount
      } else if (currentUnreadCount !== lastUnreadCount) {
        const ok = await writeData(
          `event: summary\ndata: ${JSON.stringify({
            unreadCount: currentUnreadCount,
          })}\n\n`,
        )
        if (!ok) {
          cleanup()
          return
        }
        lastUnreadCount = currentUnreadCount
      }

      for (const id of unseenIds) {
        markSeen(id)
      }
    } catch {
      // Release tick and continue next cycle
    } finally {
      isTicking = false
      if (!isClosed && !res.writableEnded && !res.destroyed) {
        pollTimer = setTimeout(() => {
          void tick()
        }, pollIntervalMs)
      }
    }
  }

  // Schedule first tick
  pollTimer = setTimeout(() => {
    void tick()
  }, pollIntervalMs)
}
