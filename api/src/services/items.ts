import { and, asc, eq, gt, inArray, isNull, notInArray, sql, type SQL } from 'drizzle-orm'
import { aliasedTable } from 'drizzle-orm'
import { db } from '../db/client'
import { activityEvents, comments, teams, users, workItems } from '../db/schema'
import type { CommentRow } from '../db/schema'
import { withTransaction, type Tx } from '../db/tx'
import { buildPage, decodeCursor, decodeIdCursor, DEFAULT_LIMIT, MAX_LIMIT } from '../http/cursor'
import { ApiError } from '../http/errors'
import { authorize, can, membershipsOf, roleIn, scopeTeamIds } from '../policy'
import { ITEM_TYPES, PRIORITIES } from '../domain/types'
import type { Actor, ItemType, Priority, Status } from '../domain/types'
import { recordActivity, recordFieldChanges } from './activity'
import { createNotifications, teamLeadRecipientIds } from './notifications'
import { enqueue } from './outbox'
import { emailAssigned } from '../outbox/handlers'
export { emailAssigned }

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
    `team:${query.team ?? ''}`,
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
  const limit = query.limit ?? DEFAULT_LIMIT
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw ApiError.of('VALIDATION_ERROR', `limit must be an integer between 1 and ${MAX_LIMIT}`, { limit })
  }

  if (query.view !== undefined && !VALID_VIEWS.includes(query.view)) {
    throw ApiError.of('VALIDATION_ERROR', `Unknown view: ${String(query.view)}`)
  }

  if (query.q !== undefined && query.q.length > 100) {
    throw ApiError.of('VALIDATION_ERROR', 'Search query exceeds 100 characters')
  }

  const myTeamIds = await scopeTeamIds(actor)
  let targetTeamIds: number[]
  if (query.team !== undefined) {
    if (!myTeamIds.includes(query.team)) {
      throw ApiError.of('NOT_FOUND')
    }
    targetTeamIds = [query.team]
  } else {
    targetTeamIds = myTeamIds
  }

  if (query.view === 'awaiting_my_approval') {
    const memberships = await membershipsOf(actor.id)
    const leadTeamIds = memberships.filter((m) => m.role === 'lead').map((m) => m.teamId)
    targetTeamIds = targetTeamIds.filter((tId) => leadTeamIds.includes(tId))
  }

  const scopeFingerprint = computeScopeFingerprint(targetTeamIds, query)

  let cursorCondition: SQL | undefined
  if (query.cursor !== undefined && query.cursor !== '') {
    const cursorValues = decodeCursor(query.cursor, scopeFingerprint)
    if (cursorValues) {
      const priorityStr = typeof cursorValues.priority === 'string' ? cursorValues.priority : ''
      const pRank = PRIORITY_ORDER.indexOf(priorityStr as Priority) + 1
      const createdAtStr = typeof cursorValues.createdAt === 'string' ? cursorValues.createdAt : ''
      const idNum = typeof cursorValues.id === 'number' ? cursorValues.id : NaN
      const createdAtDate = new Date(createdAtStr)

      if (pRank === 0 || !createdAtStr || Number.isNaN(createdAtDate.getTime()) || !Number.isSafeInteger(idNum) || idNum <= 0) {
        throw ApiError.of('VALIDATION_ERROR', 'Malformed cursor values')
      }

      cursorCondition = sql`(FIELD(${workItems.priority}, 'low', 'medium', 'high', 'urgent'), ${workItems.createdAt}, ${workItems.id}) < (${pRank}, ${createdAtStr}, ${idNum})`
    }
  }

  if (targetTeamIds.length === 0) {
    return { items: [], nextCursor: null }
  }

  const conditions = [inArray(workItems.teamId, targetTeamIds)]

  if (query.view !== undefined) {
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
      case 'awaiting_my_approval':
        conditions.push(eq(workItems.status, 'awaiting_approval'))
        break
      case 'overdue':
        conditions.push(sql`${workItems.dueAt} IS NOT NULL AND ${workItems.dueAt} < NOW(3)`)
        conditions.push(notInArray(workItems.status, ['closed', 'cancelled']))
        break
    }
  }

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
  if (query.q !== undefined && query.q.length > 0) {
    const escaped = escapeLike(query.q)
    conditions.push(sql`${workItems.title} LIKE ${`%${escaped}%`} ESCAPE '\\\\'`)
  }
  if (cursorCondition) {
    conditions.push(cursorCondition)
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
export async function getItem(actor: Actor, id: number, executor: Tx | typeof db = db): Promise<WorkItemRow> {
  const creator = aliasedTable(users, 'creator')
  const assignee = aliasedTable(users, 'assignee')

  const [row] = await executor
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

  const cursorId = decodeIdCursor(cursor, scope)
  if (cursorId !== null) {
    conditions.push(gt(activityEvents.id, cursorId))
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

export interface CreateItemInput {
  teamId: number
  title: string
  description?: string | null
  type: ItemType
  priority: Priority
  dueAt?: Date | string | null
  assigneeId?: number | null
}

/**
 * Creates a new work item in the specified team.
 * Authorizes `item:create` on the team.
 * If assigneeId is provided, validates that assignee is in the team.
 * Members may only self-assign; leads may assign any member/lead.
 * Writes `created` event with initial metadata; writes `assignee_changed` if assigned.
 * Enqueues `email.assigned` if assigned to another user.
 */
export async function createItem(actor: Actor, input: CreateItemInput, externalTx?: Tx): Promise<WorkItemRow> {
  await authorize(actor, 'item:create', { kind: 'team', teamId: input.teamId })

  if (!input.title || typeof input.title !== 'string' || input.title.trim().length === 0 || input.title.length > 200) {
    throw ApiError.of('VALIDATION_ERROR', 'Title is required and must not exceed 200 characters')
  }

  if (input.description !== undefined && input.description !== null && Buffer.byteLength(input.description, 'utf8') > 65535) {
    throw ApiError.of('VALIDATION_ERROR', 'Description exceeds maximum allowed size of 65,535 bytes')
  }
  if (!ITEM_TYPES.includes(input.type)) {
    throw ApiError.of('VALIDATION_ERROR', `Invalid item type: ${String(input.type)}`)
  }

  if (!PRIORITIES.includes(input.priority)) {
    throw ApiError.of('VALIDATION_ERROR', `Invalid priority: ${String(input.priority)}`)
  }

  let dueAtDate: Date | null = null
  if (input.dueAt !== undefined && input.dueAt !== null) {
    dueAtDate = input.dueAt instanceof Date ? input.dueAt : new Date(input.dueAt)
    if (Number.isNaN(dueAtDate.getTime())) {
      throw ApiError.of('VALIDATION_ERROR', 'Invalid dueAt date')
    }
  }

  if (input.assigneeId !== undefined && input.assigneeId !== null) {
    const actorRole = await roleIn(actor.id, input.teamId)
    if (actorRole === 'member' && input.assigneeId !== actor.id) {
      throw ApiError.of('FORBIDDEN', 'Members may only assign items to themselves')
    }

    const assigneeRole = await roleIn(input.assigneeId, input.teamId)
    if (assigneeRole !== 'member' && assigneeRole !== 'lead') {
      throw ApiError.of('VALIDATION_ERROR', 'Assignee must be a member or lead of the team')
    }
  }

  const runTx = async (tx: Tx) => {
    await authorize(actor, 'item:create', { kind: 'team', teamId: input.teamId }, tx)
    if (input.assigneeId !== undefined && input.assigneeId !== null) {
      const actorRole = await roleIn(actor.id, input.teamId, tx)
      if (actorRole === 'member' && input.assigneeId !== actor.id) {
        throw ApiError.of('FORBIDDEN', 'Members may only assign items to themselves')
      }
      const assigneeRole = await roleIn(input.assigneeId, input.teamId, tx)
      if (assigneeRole !== 'member' && assigneeRole !== 'lead') {
        throw ApiError.of('VALIDATION_ERROR', 'Assignee must be a member or lead of the team')
      }
    }

    const [result] = await tx.insert(workItems).values({
      teamId: input.teamId,
      title: input.title.trim(),
      description: input.description ?? null,
      type: input.type,
      priority: input.priority,
      status: 'open',
      assigneeId: input.assigneeId ?? null,
      createdBy: actor.id,
      dueAt: dueAtDate,
      version: 1,
    })

    const id = Number(result.insertId)

    await recordActivity(tx, {
      workItemId: id,
      actorId: actor.id,
      type: 'created',
      metadata: {
        title: input.title.trim(),
        description: input.description ?? null,
        type: input.type,
        priority: input.priority,
        status: 'open',
        assigneeId: input.assigneeId ?? null,
        dueAt: dueAtDate ? dueAtDate.toISOString() : null,
        createdBy: actor.id,
      },
    })

    if (input.assigneeId !== undefined && input.assigneeId !== null) {
      const activityId = await recordActivity(tx, {
        workItemId: id,
        actorId: actor.id,
        type: 'assignee_changed',
        fromValue: null,
        toValue: String(input.assigneeId),
      })

      await createNotifications(tx, {
        activityEventId: activityId,
        type: 'assigned',
        actorId: actor.id,
        teamId: input.teamId,
        recipientUserIds: [input.assigneeId],
      })

      if (input.assigneeId !== actor.id) {
        const [teamRow] = await tx
          .select({ name: teams.name })
          .from(teams)
          .where(eq(teams.id, input.teamId))
          .limit(1)
        const [assigneeUser] = await tx
          .select({ email: users.email })
          .from(users)
          .where(eq(users.id, input.assigneeId))
          .limit(1)

        if (teamRow && assigneeUser) {
          await enqueue(tx, {
            type: 'email.assigned',
            payload: {
              to: assigneeUser.email,
              itemTitle: input.title.trim(),
              teamName: teamRow.name,
              itemId: id,
            },
            dedupeKey: `assigned:item:${id}:version:1`,
          })
        }
      }
    }

    return id
  }

  if (externalTx) {
    const insertedId = await runTx(externalTx)
    return getItem(actor, insertedId, externalTx)
  }

  const insertedId = await withTransaction(runTx)
  return getItem(actor, insertedId)
}

const ALLOWED_PATCH_FIELDS: Record<string, true> = {
  title: true,
  description: true,
  type: true,
  dueAt: true,
  due_at: true,
  priority: true,
  version: true,
}

export interface PatchItemInput {
  title?: string
  description?: string | null
  type?: ItemType
  dueAt?: Date | string | null
  due_at?: Date | string | null
  priority?: Priority
  version: number
  [key: string]: unknown
}

/**
 * Partially updates a work item.
 * Authorizes per present field (`priority` -> `item:editPriority`, others -> `item:editContent`).
 * Rejects `status` and `assignee` with VALIDATION_ERROR (422).
 * Enforces optimistic concurrency via CAS on `version`.
 * On version conflict, throws VERSION_CONFLICT (409) with current item in details.
 * Records granular field changes.
 */
export async function patchItem(actor: Actor, id: number, input: PatchItemInput): Promise<WorkItemRow> {
  if ('status' in input) {
    throw ApiError.of('VALIDATION_ERROR', 'status cannot be patched directly; use /transition')
  }
  if ('assignee' in input || 'assigneeId' in input || 'assignee_id' in input) {
    throw ApiError.of('VALIDATION_ERROR', 'assignee cannot be patched directly; use /claim or /assign')
  }

  for (const key of Object.keys(input)) {
    if (!ALLOWED_PATCH_FIELDS[key]) {
      throw ApiError.of('VALIDATION_ERROR', `Unknown field: ${key}`)
    }
  }

  if (typeof input.version !== 'number') {
    throw ApiError.of('VALIDATION_ERROR', 'version must be a number')
  }

  if ('title' in input && input.title !== undefined) {
    if (typeof input.title !== 'string' || input.title.trim().length === 0 || input.title.length > 200) {
      throw ApiError.of('VALIDATION_ERROR', 'Title must be non-empty and at most 200 characters')
    }
  }

  if ('description' in input && input.description !== undefined && input.description !== null && Buffer.byteLength(input.description, 'utf8') > 65535) {
    throw ApiError.of('VALIDATION_ERROR', 'Description exceeds maximum allowed size of 65,535 bytes')
  }

  if ('type' in input && input.type !== undefined) {
    if (!ITEM_TYPES.includes(input.type)) {
      throw ApiError.of('VALIDATION_ERROR', `Invalid item type: ${String(input.type)}`)
    }
  }

  if ('priority' in input && input.priority !== undefined) {
    if (!PRIORITIES.includes(input.priority)) {
      throw ApiError.of('VALIDATION_ERROR', `Invalid priority: ${String(input.priority)}`)
    }
  }

  const [existing] = await db.select().from(workItems).where(eq(workItems.id, id)).limit(1)
  if (!existing) {
    throw ApiError.of('NOT_FOUND')
  }

  const role = await roleIn(actor.id, existing.teamId)
  if (role === null) {
    throw ApiError.of('NOT_FOUND')
  }

  const hasContentField =
    'title' in input ||
    'description' in input ||
    'type' in input ||
    'dueAt' in input ||
    'due_at' in input

  if (hasContentField) {
    await authorize(actor, 'item:editContent', {
      kind: 'item',
      teamId: existing.teamId,
      creatorId: existing.createdBy,
      assigneeId: existing.assigneeId,
    })
  }

  if ('priority' in input) {
    await authorize(actor, 'item:editPriority', {
      kind: 'item',
      teamId: existing.teamId,
      creatorId: existing.createdBy,
      assigneeId: existing.assigneeId,
    })
  }

  const updateValues: Record<string, unknown> = {
    version: sql`version + 1`,
    updatedAt: sql`CURRENT_TIMESTAMP(3)`,
  }

  const beforeRecord: Record<string, unknown> = {
    title: existing.title,
    description: existing.description,
    type: existing.type,
    priority: existing.priority,
    due_at: existing.dueAt,
  }
  const afterRecord: Record<string, unknown> = { ...beforeRecord }

  if ('title' in input && input.title !== undefined) {
    const t = input.title.trim()
    updateValues.title = t
    afterRecord.title = t
  }
  if ('description' in input) {
    const d = input.description ?? null
    updateValues.description = d
    afterRecord.description = d
  }
  if ('type' in input && input.type !== undefined) {
    updateValues.type = input.type
    afterRecord.type = input.type
  }
  if ('priority' in input && input.priority !== undefined) {
    updateValues.priority = input.priority
    afterRecord.priority = input.priority
  }
  if ('dueAt' in input || 'due_at' in input) {
    const raw = 'dueAt' in input ? input.dueAt : input.due_at
    let d: Date | null = null
    if (raw !== undefined && raw !== null) {
      d = raw instanceof Date ? raw : new Date(raw)
      if (Number.isNaN(d.getTime())) {
        throw ApiError.of('VALIDATION_ERROR', 'Invalid dueAt date')
      }
    }
    updateValues.dueAt = d
    afterRecord.due_at = d
  }

  await withTransaction(async (tx) => {
    if (hasContentField) {
      await authorize(actor, 'item:editContent', {
        kind: 'item',
        teamId: existing.teamId,
        creatorId: existing.createdBy,
        assigneeId: existing.assigneeId,
      }, tx)
    }
    if ('priority' in input) {
      await authorize(actor, 'item:editPriority', {
        kind: 'item',
        teamId: existing.teamId,
        creatorId: existing.createdBy,
        assigneeId: existing.assigneeId,
      }, tx)
    }
    const [result] = await tx
      .update(workItems)
      .set(updateValues)
      .where(and(eq(workItems.id, id), eq(workItems.version, input.version)))

    if (result.affectedRows === 0) {
      const currentItem = await getItem(actor, id, tx)
      throw ApiError.of('VERSION_CONFLICT', 'Item version conflict', currentItem)
    }

    await recordFieldChanges(tx, id, actor.id, beforeRecord, afterRecord)
  })

  return getItem(actor, id)
}

/**
 * Atomically claims an unassigned open work item for the caller.
 * Authorizes `item:claim` before updating.
 * Updates status to `in_progress` and assignee_id to caller via CAS.
 * Throws ALREADY_CLAIMED (409) if 0 rows matched.
 * Records `assignee_changed` and `status_changed` events.
 */
export async function claimItem(actor: Actor, id: number): Promise<WorkItemRow> {
  const [existing] = await db.select().from(workItems).where(eq(workItems.id, id)).limit(1)
  if (!existing) {
    throw ApiError.of('NOT_FOUND')
  }

  await authorize(actor, 'item:claim', {
    kind: 'item',
    teamId: existing.teamId,
    creatorId: existing.createdBy,
    assigneeId: existing.assigneeId,
  })

  await withTransaction(async (tx) => {
    await authorize(actor, 'item:claim', {
      kind: 'item',
      teamId: existing.teamId,
      creatorId: existing.createdBy,
      assigneeId: existing.assigneeId,
    }, tx)
    const [result] = await tx
      .update(workItems)
      .set({
        assigneeId: actor.id,
        status: 'in_progress',
        version: sql`version + 1`,
        updatedAt: sql`CURRENT_TIMESTAMP(3)`,
      })
      .where(
        and(
          eq(workItems.id, id),
          eq(workItems.teamId, existing.teamId),
          eq(workItems.status, 'open'),
          isNull(workItems.assigneeId),
        ),
      )

    if (result.affectedRows === 0) {
      throw ApiError.of('ALREADY_CLAIMED', 'Item is already claimed or not open')
    }

    await recordActivity(tx, {
      workItemId: id,
      actorId: actor.id,
      type: 'assignee_changed',
      fromValue: null,
      toValue: String(actor.id),
    })

    await recordActivity(tx, {
      workItemId: id,
      actorId: actor.id,
      type: 'status_changed',
      fromValue: 'open',
      toValue: 'in_progress',
    })
  })

  return getItem(actor, id)
}

/**
 * Assigns a work item to a team member (lead only).
 * Authorizes `item:assign`.
 * Validates assignee is a member or lead of the item's team (422).
 * Performs CAS on version (409 STALE_STATE on failure).
 * Records `assignee_changed` event.
 * Enqueues `email.assigned` if assigned to another user.
 */
export async function assignItem(
  actor: Actor,
  id: number,
  assigneeId: number,
  expectedVersion: number,
): Promise<WorkItemRow> {
  const [existing] = await db.select().from(workItems).where(eq(workItems.id, id)).limit(1)
  if (!existing) {
    throw ApiError.of('NOT_FOUND')
  }

  await authorize(actor, 'item:assign', {
    kind: 'item',
    teamId: existing.teamId,
    creatorId: existing.createdBy,
    assigneeId: existing.assigneeId,
  })

  const assigneeRole = await roleIn(assigneeId, existing.teamId)
  if (assigneeRole !== 'member' && assigneeRole !== 'lead') {
    throw ApiError.of('VALIDATION_ERROR', 'Assignee must be a member or lead of the team')
  }

  await withTransaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(workItems)
      .where(eq(workItems.id, id))
      .for('update')

    if (!current) {
      throw ApiError.of('NOT_FOUND')
    }

    if (current.version !== expectedVersion) {
      throw ApiError.of('STALE_STATE', 'Item version conflict or stale state')
    }

    await authorize(actor, 'item:assign', {
      kind: 'item',
      teamId: current.teamId,
      creatorId: current.createdBy,
      assigneeId: current.assigneeId,
    }, tx)

    const currentAssigneeRole = await roleIn(assigneeId, current.teamId, tx)
    if (currentAssigneeRole !== 'member' && currentAssigneeRole !== 'lead') {
      throw ApiError.of('VALIDATION_ERROR', 'Assignee must be a member or lead of the team')
    }

    if (current.assigneeId === assigneeId) {
      return
    }

    const [result] = await tx
      .update(workItems)
      .set({
        assigneeId,
        version: sql`version + 1`,
        updatedAt: sql`CURRENT_TIMESTAMP(3)`,
      })
      .where(and(eq(workItems.id, id), eq(workItems.version, expectedVersion)))

    if (result.affectedRows === 0) {
      throw ApiError.of('STALE_STATE', 'Item version conflict or stale state')
    }

    const activityId = await recordActivity(tx, {
      workItemId: id,
      actorId: actor.id,
      type: 'assignee_changed',
      fromValue: current.assigneeId !== null ? String(current.assigneeId) : null,
      toValue: String(assigneeId),
    })

    await createNotifications(tx, {
      activityEventId: activityId,
      type: 'assigned',
      actorId: actor.id,
      teamId: current.teamId,
      recipientUserIds: [assigneeId],
    })

    if (assigneeId !== actor.id) {
      const [teamRow] = await tx
        .select({ name: teams.name })
        .from(teams)
        .where(eq(teams.id, current.teamId))
        .limit(1)
      const [assigneeUser] = await tx
        .select({ email: users.email })
        .from(users)
        .where(eq(users.id, assigneeId))
        .limit(1)

      if (teamRow && assigneeUser) {
        await enqueue(tx, {
          type: 'email.assigned',
          payload: {
            to: assigneeUser.email,
            itemTitle: current.title,
            teamName: teamRow.name,
            itemId: id,
          },
          dedupeKey: `assigned:item:${id}:version:${expectedVersion + 1}`,
        })
      }
    }
  })

  return getItem(actor, id)
}

type TransitionAction =
  | 'item:submit'
  | 'item:sendBack'
  | 'item:approve'
  | 'item:close'
  | 'item:reopen'
  | 'item:cancel'

interface TransitionConfig {
  action?: TransitionAction
  isStart?: boolean
}

const LEGAL_TRANSITIONS: Record<Status, Partial<Record<Status, TransitionConfig>>> = {
  open: {
    in_progress: { isStart: true },
    cancelled: { action: 'item:cancel' },
  },
  in_progress: {
    awaiting_approval: { action: 'item:submit' },
    cancelled: { action: 'item:cancel' },
  },
  awaiting_approval: {
    resolved: { action: 'item:approve' },
    in_progress: { action: 'item:sendBack' },
    cancelled: { action: 'item:cancel' },
  },
  resolved: {
    closed: { action: 'item:close' },
    in_progress: { action: 'item:reopen' },
  },
  closed: {},
  cancelled: {},
}

/**
 * Transitions a work item to a new status according to the state machine (§6).
 * Validates transition legality (422 INVALID_TRANSITION).
 * Authorizes caller per transition rules.
 * Enforces atomic CAS on `status` (409 STALE_STATE).
 * Records `status_changed` event.
 * If `reason` is present, records a comment and a `comment_added` event.
 */
export async function transitionItem(
  actor: Actor,
  id: number,
  to: Status,
  reason?: string,
  expectedVersion?: number,
): Promise<WorkItemRow> {
  if (reason !== undefined) {
    if (typeof reason !== 'string' || reason.length > 10000 || Buffer.byteLength(reason, 'utf8') > 65535) {
      throw ApiError.of('VALIDATION_ERROR', 'Reason must not exceed 10000 characters or 65,535 bytes')
    }
  }

  const [existing] = await db.select().from(workItems).where(eq(workItems.id, id)).limit(1)
  if (!existing) {
    throw ApiError.of('NOT_FOUND')
  }

  const role = await roleIn(actor.id, existing.teamId)
  if (role === null) {
    throw ApiError.of('NOT_FOUND')
  }

  const allowedForCurrent = LEGAL_TRANSITIONS[existing.status]
  const config = allowedForCurrent?.[to]
  if (!config) {
    throw ApiError.of('INVALID_TRANSITION', `Cannot transition from ${existing.status} to ${to}`)
  }

  if (to === 'in_progress') {
    if (existing.assigneeId === null) {
      throw ApiError.of(
        'INVALID_TRANSITION',
        config.isStart
          ? 'Unassigned items must be claimed, not transitioned'
          : 'Cannot transition to in_progress without an assignee',
      )
    }
    const assigneeRole = await roleIn(existing.assigneeId, existing.teamId)
    if (assigneeRole !== 'member' && assigneeRole !== 'lead') {
      throw ApiError.of('INVALID_TRANSITION', 'Item assignee must be a member or lead of the team to be in_progress')
    }
  }

  if (config.isStart) {
    if (role !== 'lead' && (role !== 'member' || actor.id !== existing.assigneeId)) {
      throw ApiError.of('FORBIDDEN', 'Only the assignee or a lead may start this item')
    }
  } else if (config.action) {
    await authorize(actor, config.action, {
      kind: 'item',
      teamId: existing.teamId,
      creatorId: existing.createdBy,
      assigneeId: existing.assigneeId,
    })
  }

  await withTransaction(async (tx) => {
    const [locked] = await tx
      .select()
      .from(workItems)
      .where(eq(workItems.id, id))
      .for('update')

    if (!locked) {
      throw ApiError.of('NOT_FOUND')
    }

    if (locked.status !== existing.status) {
      throw ApiError.of('STALE_STATE', 'Item status has changed')
    }

    if (expectedVersion !== undefined && locked.version !== expectedVersion) {
      throw ApiError.of('STALE_STATE', 'Item version conflict or stale state')
    }

    const currentActorRole = await roleIn(actor.id, locked.teamId, tx)
    if (currentActorRole === null) {
      throw ApiError.of('NOT_FOUND')
    }

    if (to === 'in_progress') {
      if (locked.assigneeId === null) {
        throw ApiError.of(
          'INVALID_TRANSITION',
          config.isStart
            ? 'Unassigned items must be claimed, not transitioned'
            : 'Cannot transition to in_progress without an assignee',
        )
      }
      const lockedAssigneeRole = await roleIn(locked.assigneeId, locked.teamId, tx)
      if (lockedAssigneeRole !== 'member' && lockedAssigneeRole !== 'lead') {
        throw ApiError.of('INVALID_TRANSITION', 'Item assignee must be a member or lead of the team to be in_progress')
      }
    }

    if (config.isStart) {
      if (currentActorRole !== 'lead' && (currentActorRole !== 'member' || actor.id !== locked.assigneeId)) {
        throw ApiError.of('FORBIDDEN', 'Only the assignee or a lead may start this item')
      }
    } else if (config.action) {
      await authorize(actor, config.action, {
        kind: 'item',
        teamId: locked.teamId,
        creatorId: locked.createdBy,
        assigneeId: locked.assigneeId,
      }, tx)
    }

    const [result] = await tx
      .update(workItems)
      .set({
        status: to,
        version: sql`version + 1`,
        updatedAt: sql`CURRENT_TIMESTAMP(3)`,
      })
      .where(
        and(
          eq(workItems.id, id),
          eq(workItems.status, existing.status),
          ...(expectedVersion !== undefined ? [eq(workItems.version, expectedVersion)] : []),
        ),
      )

    if (result.affectedRows === 0) {
      throw ApiError.of('STALE_STATE', 'Item status has changed')
    }
    const statusActivityId = await recordActivity(tx, {
      workItemId: id,
      actorId: actor.id,
      type: 'status_changed',
      fromValue: existing.status,
      toValue: to,
    })

    const trimmedReason = reason?.trim()
    if (trimmedReason && trimmedReason.length > 0) {
      await tx.insert(comments).values({
        workItemId: id,
        authorId: actor.id,
        body: trimmedReason,
      })

      await recordActivity(tx, {
        workItemId: id,
        actorId: actor.id,
        type: 'comment_added',
        metadata: { body: trimmedReason },
      })
    }

    const fromStatus = existing.status
    if (fromStatus === 'open' && to === 'in_progress') {
      // Explicitly classify start (open -> in_progress) as no notification
    } else if (fromStatus === 'in_progress' && to === 'awaiting_approval') {
      const leadIds = await teamLeadRecipientIds(tx, locked.teamId)
      await createNotifications(tx, {
        activityEventId: statusActivityId,
        type: 'approval_requested',
        actorId: actor.id,
        teamId: locked.teamId,
        recipientUserIds: leadIds,
      })
    } else if (
      (fromStatus === 'awaiting_approval' && (to === 'resolved' || to === 'in_progress')) ||
      (fromStatus === 'resolved' && (to === 'closed' || to === 'in_progress')) ||
      ((fromStatus === 'open' || fromStatus === 'in_progress' || fromStatus === 'awaiting_approval') && to === 'cancelled')
    ) {
      const recipientUserIds: number[] = [locked.createdBy]
      if (locked.assigneeId !== null) {
        recipientUserIds.push(locked.assigneeId)
      }
      await createNotifications(tx, {
        activityEventId: statusActivityId,
        type: 'workflow_decision',
        actorId: actor.id,
        teamId: locked.teamId,
        recipientUserIds,
      })
    }
  })

  return getItem(actor, id)
}

/**
 * Appends an immutable comment to a work item.
 * Authorizes `item:comment`.
 * Validates body length between 1 and 10,000 characters (422).
 * Inserts comment row and records `comment_added` event in the same transaction.
 */
export async function addComment(actor: Actor, id: number, body: string): Promise<CommentRow> {
  const [existing] = await db.select().from(workItems).where(eq(workItems.id, id)).limit(1)
  if (!existing) {
    throw ApiError.of('NOT_FOUND')
  }

  await authorize(actor, 'item:comment', {
    kind: 'item',
    teamId: existing.teamId,
    creatorId: existing.createdBy,
    assigneeId: existing.assigneeId,
  })

  if (typeof body !== 'string' || body.trim().length === 0 || body.length > 10000 || Buffer.byteLength(body, 'utf8') > 65535) {
    throw ApiError.of('VALIDATION_ERROR', 'Comment body must be between 1 and 10000 characters and at most 65,535 bytes')
  }

  const comment = await withTransaction(async (tx) => {
    const [locked] = await tx
      .select()
      .from(workItems)
      .where(eq(workItems.id, id))
      .for('update')

    if (!locked) {
      throw ApiError.of('NOT_FOUND')
    }

    await authorize(actor, 'item:comment', {
      kind: 'item',
      teamId: locked.teamId,
      creatorId: locked.createdBy,
      assigneeId: locked.assigneeId,
    }, tx)
    const [result] = await tx.insert(comments).values({
      workItemId: id,
      authorId: actor.id,
      body: body,
    })
    const commentId = Number(result.insertId)

    const activityId = await recordActivity(tx, {
      workItemId: id,
      actorId: actor.id,
      type: 'comment_added',
      metadata: { body: body },
    })

    const recipientUserIds: number[] = [locked.createdBy]
    if (locked.assigneeId !== null) {
      recipientUserIds.push(locked.assigneeId)
    }

    await createNotifications(tx, {
      activityEventId: activityId,
      type: 'comment_added',
      actorId: actor.id,
      teamId: locked.teamId,
      recipientUserIds,
    })
    const [row] = await tx.select().from(comments).where(eq(comments.id, commentId)).limit(1)
    if (!row) {
      throw ApiError.of('INTERNAL_ERROR', 'Failed to read created comment')
    }
    return row
  })

  return comment
}
