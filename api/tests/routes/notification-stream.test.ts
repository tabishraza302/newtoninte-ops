import http from 'node:http'
import type { AddressInfo } from 'node:net'
import express from 'express'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { SignJWT } from 'jose'
import { createApp } from '../../src/app'
import { config } from '../../src/config'
import { closeDb, db, pool } from '../../src/db/client'
import { activityEvents, memberships, notifications, users } from '../../src/db/schema'
import { withTransaction } from '../../src/db/tx'
import type { Actor } from '../../src/domain/types'
import { currentActor, requireAuth } from '../../src/http/middleware/auth'
import { createItem } from '../../src/services/items'
import { createNotifications, markNotificationRead } from '../../src/services/notifications'
import { handleNotificationStream } from '../../src/services/notificationStream'
import { signAccessToken } from '../../src/services/tokens'
import { resetDb, seedItem, seedMembership, seedTeam, seedUser } from '../helpers/db'

interface SseEvent {
  event?: string
  data?: string
}

interface SseClient {
  events: SseEvent[]
  waitForEvent: (eventName: string, timeoutMs?: number) => Promise<SseEvent>
  close: () => void
  req: http.ClientRequest
  resPromise: Promise<http.IncomingMessage>
}

const openClients: SseClient[] = []

function openSseStream(
  baseUrl: string,
  token: string,
  path = '/test/notifications/stream',
): SseClient {
  const events: SseEvent[] = []
  const listeners: Array<() => void> = []

  let clientRes: http.IncomingMessage | null = null

  const { promise: resPromise, resolve: resolveRes } =
    Promise.withResolvers<http.IncomingMessage>()

  const req = http.request(
    `${baseUrl}${path}`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
    (res) => {
      clientRes = res
      resolveRes(res)

      let buffer = ''
      res.on('data', (chunk: Buffer | string) => {
        buffer += chunk.toString('utf8')
        const blocks = buffer.split(/\r?\n\r?\n/)
        buffer = blocks.pop() ?? ''

        for (const block of blocks) {
          if (!block.trim() || block.startsWith(':')) continue
          const lines = block.split(/\r?\n/)
          let eventName: string | undefined
          let dataStr = ''
          for (const line of lines) {
            if (line.startsWith('event:')) {
              eventName = line.slice('event:'.length).trim()
            } else if (line.startsWith('data:')) {
              const d = line.slice('data:'.length).trim()
              dataStr = dataStr ? `${dataStr}\n${d}` : d
            }
          }
          const sseEvent: SseEvent = { data: dataStr }
          if (eventName !== undefined) {
            sseEvent.event = eventName
          }
          events.push(sseEvent)
          for (const listener of [...listeners]) {
            listener()
          }
        }
      })
    },
  )

  req.end()

  const waitForEvent = (eventName: string, timeoutMs = 4000): Promise<SseEvent> => {
    const existing = events.find((e) => e.event === eventName)
    if (existing) return Promise.resolve(existing)

    const { promise, resolve, reject } = Promise.withResolvers<SseEvent>()

    const timer = setTimeout(() => {
      cleanupListener()
      reject(
        new Error(
          `Timed out waiting for event "${eventName}". Events seen: ${JSON.stringify(events)}`,
        ),
      )
    }, timeoutMs)

    const check = () => {
      const found = events.find((e) => e.event === eventName)
      if (found) {
        cleanupListener()
        resolve(found)
      }
    }

    const cleanupListener = () => {
      clearTimeout(timer)
      const idx = listeners.indexOf(check)
      if (idx !== -1) listeners.splice(idx, 1)
    }

    listeners.push(check)
    return promise
  }

  const close = () => {
    try {
      req.destroy()
    } catch {
      // ignore
    }
    try {
      clientRes?.destroy()
    } catch {
      // ignore
    }
  }

  const client: SseClient = { events, waitForEvent, close, req, resPromise }
  openClients.push(client)
  return client
}

describe('Notification SSE stream routes (/notifications/stream)', () => {
  const app = express()
  app.get('/test/notifications/stream', requireAuth(), async (req, res, next) => {
    try {
      const actor = currentActor(req)
      const header = req.headers.authorization ?? ''
      const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : ''
      await handleNotificationStream(actor, token, req, res, { pollIntervalMs: 50 })
    } catch (err) {
      next(err)
    }
  })
  app.use(createApp())
  let server: http.Server
  let baseUrl: string

  beforeAll(async () => {
    server = http.createServer(app)
    const { promise, resolve } = Promise.withResolvers<void>()
    server.listen(0, resolve)
    await promise
    const port = (server.address() as AddressInfo).port
    baseUrl = `http://127.0.0.1:${port}`
  })

  afterAll(async () => {
    const { promise, resolve } = Promise.withResolvers<void>()
    server.close(() => resolve())
    await promise
    await closeDb()
  })

  beforeEach(resetDb)

  afterEach(async () => {
    for (const client of openClients) {
      try {
        client.close()
      } catch {
        // ignore
      }
    }
    openClients.length = 0
  })

  it('rejects unauthenticated requests with 401', async () => {
    const { promise, resolve } = Promise.withResolvers<http.IncomingMessage>()
    const req = http.request(`${baseUrl}/notifications/stream`, { method: 'GET' }, resolve)
    req.end()
    const res = await promise
    expect(res.statusCode).toBe(401)
    res.resume()
    res.destroy()
  })
  it('connects, returns prompt ready headers, and delivers initial snapshot', async () => {
    const team = await seedTeam()
    const creator = await seedUser()
    const recipient = await seedUser()
    await seedMembership(creator.id, team.id, 'lead')
    await seedMembership(recipient.id, team.id, 'member')

    const item = await seedItem(team.id, { createdBy: creator.id })
    const [act] = await db
      .insert(activityEvents)
      .values({
        workItemId: item.id,
        actorId: creator.id,
        type: 'assigned',
      })
      .$returningId()
    await db.insert(notifications).values({
      recipientUserId: recipient.id,
      activityEventId: act!.id,
      type: 'assigned',
    })

    const token = await signAccessToken(recipient.id)
    const client = openSseStream(baseUrl, token, '/notifications/stream')

    const res = await client.resPromise
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('text/event-stream')
    expect(res.headers['cache-control']).toBe('no-cache, no-transform')
    expect(res.headers['x-accel-buffering']).toBe('no')

    const snapshot = await client.waitForEvent('snapshot')
    const parsed = JSON.parse(snapshot.data ?? '{}')
    expect(parsed.unreadCount).toBe(1)
    expect(parsed.notifications).toHaveLength(1)
    expect(parsed.notifications[0].workItemId).toBe(item.id)
    expect(parsed.notifications[0].type).toBe('assigned')

    client.close()
  })

  it('delivers real-time notifications event on committed activity', async () => {
    const team = await seedTeam()
    const creator = await seedUser()
    const recipient = await seedUser()
    await seedMembership(creator.id, team.id, 'lead')
    await seedMembership(recipient.id, team.id, 'member')

    const token = await signAccessToken(recipient.id)
    const client = openSseStream(baseUrl, token)

    await client.waitForEvent('snapshot')

    const creatorActor: Actor = { id: creator.id, isAdmin: false }
    await createItem(creatorActor, {
      teamId: team.id,
      title: 'Real-time Item',
      type: 'task',
      priority: 'high',
      assigneeId: recipient.id,
    })

    const notifEvent = await client.waitForEvent('notifications')
    const parsed = JSON.parse(notifEvent.data ?? '{}')
    expect(parsed.unreadCount).toBe(1)
    expect(parsed.notifications).toHaveLength(1)
    expect(parsed.notifications[0].itemTitle).toBe('Real-time Item')
    expect(parsed.notifications[0].type).toBe('assigned')

    client.close()
  })

  it('does not emit events for rolled back database transactions', async () => {
    const team = await seedTeam()
    const creator = await seedUser()
    const recipient = await seedUser()
    await seedMembership(creator.id, team.id, 'lead')
    await seedMembership(recipient.id, team.id, 'member')

    const token = await signAccessToken(recipient.id)
    const client = openSseStream(baseUrl, token)
    await client.waitForEvent('snapshot')

    const item = await seedItem(team.id, { createdBy: creator.id })

    await expect(
      withTransaction(async (tx) => {
        const [act] = await tx
          .insert(activityEvents)
          .values({
            workItemId: item.id,
            actorId: creator.id,
            type: 'assigned',
          })
          .$returningId()

        await createNotifications(tx, {
          activityEventId: act!.id,
          teamId: team.id,
          type: 'assigned',
          actorId: creator.id,
          recipientUserIds: [recipient.id],
        })

        throw new Error('Forced rollback')
      }),
    ).rejects.toThrow('Forced rollback')

    // Integration test requires real tick observation to prove absence of emission across DB ticks
    const { promise, resolve } = Promise.withResolvers<void>()
    setTimeout(resolve, 150)
    await promise
    expect(client.events.find((e) => e.event === 'notifications')).toBeUndefined()

    client.close()
  })

  it('isolates delivery between two streaming recipients', async () => {
    const team = await seedTeam()
    const lead = await seedUser()
    const userA = await seedUser()
    const userB = await seedUser()
    await seedMembership(lead.id, team.id, 'lead')
    await seedMembership(userA.id, team.id, 'member')
    await seedMembership(userB.id, team.id, 'member')

    const tokenA = await signAccessToken(userA.id)
    const tokenB = await signAccessToken(userB.id)

    const clientA = openSseStream(baseUrl, tokenA)
    const clientB = openSseStream(baseUrl, tokenB)

    await Promise.all([clientA.waitForEvent('snapshot'), clientB.waitForEvent('snapshot')])

    const leadActor: Actor = { id: lead.id, isAdmin: false }
    await createItem(leadActor, {
      teamId: team.id,
      title: 'Item For User A Only',
      type: 'task',
      priority: 'high',
      assigneeId: userA.id,
    })

    const notifA = await clientA.waitForEvent('notifications')
    const parsedA = JSON.parse(notifA.data ?? '{}')
    expect(parsedA.notifications[0].itemTitle).toBe('Item For User A Only')

    // Real tick observation to verify absence of cross-user event emission
    const { promise, resolve } = Promise.withResolvers<void>()
    setTimeout(resolve, 150)
    await promise
    expect(clientB.events.find((e) => e.event === 'notifications')).toBeUndefined()

    clientA.close()
    clientB.close()
  })

  it('enforces current team membership filtering and summary on access loss', async () => {
    const team = await seedTeam()
    const lead = await seedUser()
    const member = await seedUser()
    await seedMembership(lead.id, team.id, 'lead')
    await seedMembership(member.id, team.id, 'member')

    const item1 = await seedItem(team.id, { createdBy: lead.id })
    const [act1] = await db
      .insert(activityEvents)
      .values({ workItemId: item1.id, actorId: lead.id, type: 'assigned' })
      .$returningId()
    await db.insert(notifications).values({
      recipientUserId: member.id,
      activityEventId: act1!.id,
      type: 'assigned',
    })

    const token = await signAccessToken(member.id)
    const client = openSseStream(baseUrl, token)

    const initialSnapshot = await client.waitForEvent('snapshot')
    expect(JSON.parse(initialSnapshot.data ?? '{}').unreadCount).toBe(1)

    // Revoke membership
    await db
      .delete(memberships)
      .where(and(eq(memberships.userId, member.id), eq(memberships.teamId, team.id)))

    // Next tick should emit summary event reflecting 0 visible unread notifications
    const summaryEvent = await client.waitForEvent('summary')
    expect(JSON.parse(summaryEvent.data ?? '{}').unreadCount).toBe(0)

    // New item assigned while not a member: no notifications event emitted
    const item2 = await seedItem(team.id, { createdBy: lead.id })
    const [act2] = await db
      .insert(activityEvents)
      .values({ workItemId: item2.id, actorId: lead.id, type: 'assigned' })
      .$returningId()
    await db.insert(notifications).values({
      recipientUserId: member.id,
      activityEventId: act2!.id,
      type: 'assigned',
    })

    // Real tick observation to verify no notification emitted for non-member
    const { promise, resolve } = Promise.withResolvers<void>()
    setTimeout(resolve, 150)
    await promise
    expect(client.events.find((e) => e.event === 'notifications')).toBeUndefined()

    client.close()
  })

  it('terminates active stream when user is disabled', async () => {
    const team = await seedTeam()
    const user = await seedUser()
    await seedMembership(user.id, team.id, 'member')

    const token = await signAccessToken(user.id)
    const client = openSseStream(baseUrl, token)
    await client.waitForEvent('snapshot')

    const res = await client.resPromise
    const { promise: closePromise, resolve: resolveClose } = Promise.withResolvers<void>()
    res.on('close', resolveClose)
    res.on('end', resolveClose)

    // Disable the user in DB
    await db.update(users).set({ status: 'disabled' }).where(eq(users.id, user.id))

    // Stream should close on next tick
    await closePromise
    client.close()
  })

  it('emits summary event when notification is marked read without sending new notifications', async () => {
    const team = await seedTeam()
    const lead = await seedUser()
    const member = await seedUser()
    await seedMembership(lead.id, team.id, 'lead')
    await seedMembership(member.id, team.id, 'member')

    const item = await seedItem(team.id, { createdBy: lead.id })
    const [act] = await db
      .insert(activityEvents)
      .values({ workItemId: item.id, actorId: lead.id, type: 'assigned' })
      .$returningId()
    const [notif] = await db
      .insert(notifications)
      .values({
        recipientUserId: member.id,
        activityEventId: act!.id,
        type: 'assigned',
      })
      .$returningId()

    const token = await signAccessToken(member.id)
    const client = openSseStream(baseUrl, token)
    await client.waitForEvent('snapshot')

    const memberActor: Actor = { id: member.id, isAdmin: false }
    await markNotificationRead(memberActor, notif!.id)

    const summaryEvent = await client.waitForEvent('summary')
    expect(JSON.parse(summaryEvent.data ?? '{}').unreadCount).toBe(0)
    expect(client.events.find((e) => e.event === 'notifications')).toBeUndefined()

    client.close()
  })

  it('does not toast old history when user rejoins a team during live connection', async () => {
    const team = await seedTeam()
    const lead = await seedUser()
    const user = await seedUser()
    await seedMembership(lead.id, team.id, 'lead')

    // Notification exists while user is NOT a member
    const item = await seedItem(team.id, { createdBy: lead.id })
    const [act] = await db
      .insert(activityEvents)
      .values({ workItemId: item.id, actorId: lead.id, type: 'assigned' })
      .$returningId()
    await db.insert(notifications).values({
      recipientUserId: user.id,
      activityEventId: act!.id,
      type: 'assigned',
    })

    // Connect SSE; baseline tracks recipient's existing notification ID
    const token = await signAccessToken(user.id)
    const client = openSseStream(baseUrl, token)

    const snapshot = await client.waitForEvent('snapshot')
    expect(JSON.parse(snapshot.data ?? '{}').unreadCount).toBe(0)
    expect(JSON.parse(snapshot.data ?? '{}').notifications).toHaveLength(0)

    // User rejoins team
    await seedMembership(user.id, team.id, 'member')

    // Summary event updates count, but NO notifications toast is emitted
    const summaryEvent = await client.waitForEvent('summary')
    expect(JSON.parse(summaryEvent.data ?? '{}').unreadCount).toBe(1)
    expect(client.events.find((e) => e.event === 'notifications')).toBeUndefined()

    client.close()
  })

  it('terminates stream on token expiration and delivers no subsequent activity', async () => {
    const team = await seedTeam()
    const lead = await seedUser()
    const recipient = await seedUser()
    await seedMembership(lead.id, team.id, 'lead')
    await seedMembership(recipient.id, team.id, 'member')

    // Sign a token with 1 second TTL
    const jwtKey = new TextEncoder().encode(config.jwtSecret)
    const iat = Math.floor(Date.now() / 1000)
    const shortLivedToken = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(String(recipient.id))
      .setIssuedAt(iat)
      .setExpirationTime(iat + 1)
      .sign(jwtKey)

    const client = openSseStream(baseUrl, shortLivedToken)
    await client.waitForEvent('snapshot')

    const res = await client.resPromise
    const { promise: streamEnded, resolve: resolveEnded } = Promise.withResolvers<void>()
    res.on('close', resolveEnded)
    res.on('end', resolveEnded)

    // Await stream termination triggered by token expiration
    await streamEnded

    // Verify activity committed after token expiry is not delivered
    const leadActor: Actor = { id: lead.id, isAdmin: false }
    await createItem(leadActor, {
      teamId: team.id,
      title: 'Item created after token expiration',
      type: 'task',
      priority: 'high',
      assigneeId: recipient.id,
    })

    // Integration test requires brief tick observation to verify absence of emission after expiry
    const { promise: delayPromise, resolve: resolveDelay } = Promise.withResolvers<void>()
    setTimeout(resolveDelay, 150)
    await delayPromise

    expect(client.events.find((e) => e.event === 'notifications')).toBeUndefined()
  })

  it('recovers from transient query failure and delivers committed notification on next tick', async () => {
    const team = await seedTeam()
    const creator = await seedUser()
    const recipient = await seedUser()
    await seedMembership(creator.id, team.id, 'lead')
    await seedMembership(recipient.id, team.id, 'member')

    const token = await signAccessToken(recipient.id)
    const client = openSseStream(baseUrl, token)
    await client.waitForEvent('snapshot')

    let shouldFail = true
    let failureInjected = false
    const originalQuery = pool.query.bind(pool)
    pool.query = ((...args: Parameters<typeof originalQuery>) => {
      const firstArg = args[0]
      let sql = ''
      if (typeof firstArg === 'string') {
        sql = firstArg
      } else if (
        firstArg &&
        typeof firstArg === 'object' &&
        'sql' in firstArg &&
        typeof firstArg.sql === 'string'
      ) {
        sql = firstArg.sql
      }

      if (shouldFail && sql.toLowerCase().includes('select') && sql.includes('activity_events')) {
        shouldFail = false
        failureInjected = true
        return Promise.reject(new Error('Simulated transient database query failure'))
      }
      return originalQuery(...args)
    }) as typeof pool.query
    try {
      const creatorActor: Actor = { id: creator.id, isAdmin: false }
      await createItem(creatorActor, {
        teamId: team.id,
        title: 'Transient Failure Recovered Item',
        type: 'task',
        priority: 'high',
        assigneeId: recipient.id,
      })

      const notifEvent = await client.waitForEvent('notifications')
      expect(failureInjected).toBe(true)
      const parsed = JSON.parse(notifEvent.data ?? '{}')
      expect(parsed.unreadCount).toBe(1)
      expect(parsed.notifications).toHaveLength(1)
      expect(parsed.notifications[0].itemTitle).toBe('Transient Failure Recovered Item')
      expect(parsed.notifications[0].type).toBe('assigned')
    } finally {
      pool.query = originalQuery
      client.close()
    }
  })
})
