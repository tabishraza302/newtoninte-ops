import type { Request, Response } from 'express'
import { eq } from 'drizzle-orm'
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

    // Record baseline of ALL recipient notification IDs (including membership-hidden rows)
    const allRecipientRows = await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(eq(notifications.recipientUserId, actor.id))
    // Fetch visible notifications for the snapshot
    const initialVisibleNotifications = await fetchVisibleNotifications(actor.id)
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

    for (const row of allRecipientRows) {
      seenNotificationIds.add(row.id)
    }
    for (const notif of initialVisibleNotifications) {
      seenNotificationIds.add(notif.id)
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

      // Scan all recipient notification IDs (using indexed recipient query)
      const currentRows = await db
        .select({ id: notifications.id })
        .from(notifications)
        .where(eq(notifications.recipientUserId, actor.id))

      const unseenIds: number[] = []
      for (const row of currentRows) {
        if (!seenNotificationIds.has(row.id)) {
          unseenIds.push(row.id)
        }
      }

      let newVisibleNotifications: NotificationView[] = []
      if (unseenIds.length > 0) {
        newVisibleNotifications = await fetchVisibleNotifications(actor.id, unseenIds)
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
        seenNotificationIds.add(id)
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
