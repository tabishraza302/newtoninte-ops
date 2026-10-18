import { and, asc, eq, gt, inArray, isNull, notInArray, sql } from 'drizzle-orm'
import { aliasedTable } from 'drizzle-orm'
import { db } from '../db/client'
import { activityEvents, users, workItems } from '../db/schema'
import { buildPage, decodeCursor, DEFAULT_LIMIT, MAX_LIMIT } from '../http/cursor'
import { ApiError } from '../http/errors'
import { authorize, membershipsOf, scopeTeamIds } from '../policy'
import type { Actor, ItemType, Priority, Status } from '../domain/types'

export type ViewName = 'assigned_to_me' | 'unassigned_urgent' | 'awaiting_my_approval' | 'overdue'

export const VALID_VIEWS: readonly ViewName[] = [
  'assigned_to_me',
  'unassigned_urgent',
  'awaiting_my_approval',
  'overdue',
]

const PRIORITY_ORDER: readonly Priority[] = ['low', 'medium', 'high', 'urgent']

export interface ListItemsQuery {
  team?: number | undefined
  status?: Status | undefined
  priority?: Priority | undefined
  assignee?: number | undefined
  type?: ItemType | undefined
  q?: string | undefined
  view?: ViewName | undefined
  cursor?: string | undefined
  limit?: number | undefined
}

export type WorkItemRow = typeof workItems.$inferSelect & {
  creator?: { id: number; displayName: string; email: string } | undefined
  assignee?: { id: number; displayName: string; email: string } | null | undefined
}

export type ActivityEventRow = typeof activityEvents.$inferSelect & {
  actor?: { id: number; displayName: string; email: string } | null
}

function escapeLike(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_')
}

function computeScopeFingerprint(targetTeamIds: number[], query: ListItemsQuery): string {
  const sortedTeams = [...targetTeamIds].sort((a, b) => a - b).join(',')
  return [
    `teams:${sortedTeams}`,
    `view:${query.view ?? ''}`,
    `status:${query.status ?? ''}`,
    `priority:${query.priority ?? ''}`,
    `assignee:${query.assignee ?? ''}`,
    `type:${query.type ?? ''}`,
    `q:${query.q ?? ''}`,
  ].join(';')
}

/**
 * Lists work items visible to actor, optionally filtered by view, team, or attributes.
 * Keyset-paginated on (priority DESC, created_at DESC, id DESC).
 */
export async function listItems(
  actor: Actor,
  query: ListItemsQuery,
): Promise<{ items: WorkItemRow[]; nextCursor: string | null }> {
  const myTeamIds = await scopeTeamIds(actor)
  if (myTeamIds.length === 0) {
    return { items: [], nextCursor: null }
  }

  let targetTeamIds: number[]
  if (query.team !== undefined) {
    if (!myTeamIds.includes(query.team)) {
      throw ApiError.of('NOT_FOUND')
    }
    targetTeamIds = [query.team]
  } else {
    targetTeamIds = myTeamIds
  }

  const conditions = []

  if (query.view !== undefined) {
    if (!VALID_VIEWS.includes(query.view)) {
      throw ApiError.of('VALIDATION_ERROR', `Unknown view: ${String(query.view)}`)
    }

    switch (query.view) {
      case 'assigned_to_me':
        conditions.push(eq(workItems.assigneeId, actor.id))
        conditions.push(notInArray(workItems.status, ['closed', 'cancelled']))
        break
      case 'unassigned_urgent':
        conditions.push(isNull(workItems.assigneeId))
        conditions.push(eq(workItems.status, 'open'))
        conditions.push(inArray(workItems.priority, ['high', 'urgent']))
        break
      case 'awaiting_my_approval': {
        const memberships = await membershipsOf(actor.id)
        const leadTeamIds = memberships.filter((m) => m.role === 'lead').map((m) => m.teamId)
        targetTeamIds = targetTeamIds.filter((tId) => leadTeamIds.includes(tId))
        if (targetTeamIds.length === 0) {
          return { items: [], nextCursor: null }
        }
        conditions.push(eq(workItems.status, 'awaiting_approval'))
        break
      }
      case 'overdue':
        conditions.push(sql`${workItems.dueAt} IS NOT NULL AND ${workItems.dueAt} < NOW(3)`)
        conditions.push(notInArray(workItems.status, ['closed', 'cancelled']))
        break
    }
  }

  conditions.push(inArray(workItems.teamId, targetTeamIds))

  if (query.status !== undefined) {
    conditions.push(eq(workItems.status, query.status))
  }
  if (query.priority !== undefined) {
    conditions.push(eq(workItems.priority, query.priority))
  }
  if (query.assignee !== undefined) {
    conditions.push(eq(workItems.assigneeId, query.assignee))
  }
  if (query.type !== undefined) {
    conditions.push(eq(workItems.type, query.type))
  }

  if (query.q !== undefined) {
    if (query.q.length > 100) {
      throw ApiError.of('VALIDATION_ERROR', 'Search query exceeds 100 characters')
    }
    if (query.q.length > 0) {
      const escaped = escapeLike(query.q)
      conditions.push(sql`${workItems.title} LIKE ${`%${escaped}%`} ESCAPE '\\\\'`)
    }
  }

  const scopeFingerprint = computeScopeFingerprint(targetTeamIds, query)

  if (query.cursor !== undefined && query.cursor !== '') {
    const cursorValues = decodeCursor(query.cursor, scopeFingerprint)
    if (cursorValues) {
      const priorityStr = typeof cursorValues.priority === 'string' ? cursorValues.priority : ''
      const pRank = PRIORITY_ORDER.indexOf(priorityStr as Priority) + 1
      const createdAtStr = typeof cursorValues.createdAt === 'string' ? cursorValues.createdAt : ''
      const idNum = typeof cursorValues.id === 'number' ? cursorValues.id : NaN

      if (pRank === 0 || !createdAtStr || Number.isNaN(idNum)) {
        throw ApiError.of('VALIDATION_ERROR', 'Malformed cursor values')
      }

      conditions.push(
        sql`(FIELD(${workItems.priority}, 'low', 'medium', 'high', 'urgent'), ${workItems.createdAt}, ${workItems.id}) < (${pRank}, ${createdAtStr}, ${idNum})`,
      )
    }
  }

  const limit = query.limit ?? DEFAULT_LIMIT
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw ApiError.of('VALIDATION_ERROR', `limit must be an integer between 1 and ${MAX_LIMIT}`, { limit })
  }

  const creator = aliasedTable(users, 'creator')
  const assignee = aliasedTable(users, 'assignee')

  const rows = await db
    .select({
      item: workItems,
      creator: {
        id: creator.id,
        displayName: creator.displayName,
        email: creator.email,
      },
      assignee: {
        id: assignee.id,
        displayName: assignee.displayName,
        email: assignee.email,
      },
    })
    .from(workItems)
    .leftJoin(creator, eq(workItems.createdBy, creator.id))
    .leftJoin(assignee, eq(workItems.assigneeId, assignee.id))
    .where(and(...conditions))
    .orderBy(
      sql`FIELD(${workItems.priority}, 'low', 'medium', 'high', 'urgent') DESC`,
      sql`${workItems.createdAt} DESC`,
      sql`${workItems.id} DESC`,
    )
    .limit(limit + 1)

  const mappedItems: WorkItemRow[] = rows.map((r) => ({
    ...r.item,
    ...(r.creator?.id ? { creator: r.creator } : {}),
    assignee: r.assignee?.id ? r.assignee : null,
  }))

  const pageResult = buildPage(
    mappedItems,
    limit,
    (row) => ({
      priority: row.priority,
      createdAt: row.createdAt.toISOString(),
      id: row.id,
    }),
    scopeFingerprint,
  )

  return {
    items: pageResult.page,
    nextCursor: pageResult.nextCursor,
  }
}

/**
 * Fetches a single work item by ID.
 * Throws NOT_FOUND (404) if item does not exist or if actor is not a member of its team.
 */
export async function getItem(actor: Actor, id: number): Promise<WorkItemRow> {
  const creator = aliasedTable(users, 'creator')
  const assignee = aliasedTable(users, 'assignee')

  const [row] = await db
    .select({
      item: workItems,
      creator: {
        id: creator.id,
        displayName: creator.displayName,
        email: creator.email,
      },
      assignee: {
        id: assignee.id,
        displayName: assignee.displayName,
        email: assignee.email,
      },
    })
    .from(workItems)
    .leftJoin(creator, eq(workItems.createdBy, creator.id))
    .leftJoin(assignee, eq(workItems.assigneeId, assignee.id))
    .where(eq(workItems.id, id))
    .limit(1)
  if (!row) {
    throw ApiError.of('NOT_FOUND')
  }

  await authorize(actor, 'item:read', {
    kind: 'item',
    teamId: row.item.teamId,
    creatorId: row.item.createdBy,
    assigneeId: row.item.assigneeId,
  })

  return {
    ...row.item,
    ...(row.creator?.id ? { creator: row.creator } : {}),
    assignee: row.assignee?.id ? row.assignee : null,
  }
}

/**
 * Lists activity events for an item in oldest-first order (id ASC).
 * Keyset-paginated on id.
 */
export async function listActivity(
  actor: Actor,
  itemId: number,
  cursor?: string,
  limit?: number,
): Promise<{ events: ActivityEventRow[]; nextCursor: string | null }> {
  const [item] = await db
    .select({
      id: workItems.id,
      teamId: workItems.teamId,
      createdBy: workItems.createdBy,
      assigneeId: workItems.assigneeId,
    })
    .from(workItems)
    .where(eq(workItems.id, itemId))
    .limit(1)

  if (!item) {
    throw ApiError.of('NOT_FOUND')
  }

  await authorize(actor, 'item:read', {
    kind: 'item',
    teamId: item.teamId,
    creatorId: item.createdBy,
    assigneeId: item.assigneeId,
  })

  const actualLimit = limit ?? DEFAULT_LIMIT
  if (!Number.isInteger(actualLimit) || actualLimit < 1 || actualLimit > MAX_LIMIT) {
    throw ApiError.of('VALIDATION_ERROR', `limit must be an integer between 1 and ${MAX_LIMIT}`, { limit })
  }

  const scope = `activity:${itemId}`
  const conditions = [eq(activityEvents.workItemId, itemId)]

  if (cursor !== undefined && cursor !== '') {
    const cursorValues = decodeCursor(cursor, scope)
    if (cursorValues) {
      const cursorId = typeof cursorValues.id === 'number' ? cursorValues.id : NaN
      if (Number.isNaN(cursorId)) {
        throw ApiError.of('VALIDATION_ERROR', 'Malformed cursor values')
      }
      conditions.push(gt(activityEvents.id, cursorId))
    }
  }

  const rows = await db
    .select({
      event: activityEvents,
      actor: {
        id: users.id,
        displayName: users.displayName,
        email: users.email,
      },
    })
    .from(activityEvents)
    .leftJoin(users, eq(activityEvents.actorId, users.id))
    .where(and(...conditions))
    .orderBy(asc(activityEvents.id))
    .limit(actualLimit + 1)

  const mappedRows: ActivityEventRow[] = rows.map((r) => ({
    ...r.event,
    actor: r.actor?.id ? r.actor : null,
  }))

  const pageResult = buildPage(
    mappedRows,
    actualLimit,
    (row) => ({ id: row.id }),
    scope,
  )

  return {
    events: pageResult.page,
    nextCursor: pageResult.nextCursor,
  }
}
