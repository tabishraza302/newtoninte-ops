import { and, desc, eq, lt, or, sql } from 'drizzle-orm'
import { db } from '../db/client'
import { adminAuditEvents, users } from '../db/schema'
import type { Tx } from '../db/tx'
import { buildPage, decodeIdCursor, DEFAULT_LIMIT, MAX_LIMIT } from '../http/cursor'
import { ApiError } from '../http/errors'
import { can } from '../policy'
import type { Actor, AdminAuditAction, AdminAuditActor, AdminAuditEvent } from '../domain/types'

export type { AdminAuditActor, AdminAuditEvent }

export interface RecordAdminAuditInput {
  actorId: number
  action: AdminAuditAction
  targetType: 'user' | 'team' | 'membership' | 'job'
  targetId: number
  metadata: Record<string, unknown>
}

export interface ListAdminAuditQuery {
  action?: AdminAuditAction
  q?: string
  cursor?: string
  limit?: number
}

export interface ListAdminAuditResult {
  events: AdminAuditEvent[]
  nextCursor: string | null
}

function escapeLike(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_')
}
const SEARCHABLE_METADATA_FIELDS = [
  'name',
  'slug',
  'teamName',
  'email',
  'displayName',
  'fromStatus',
  'toStatus',
  'fromRole',
  'toRole',
  'type',
  'previousLastError',
] as const

// Public audit metadata is allowlisted; internal journal identifiers stay server-side.
const PUBLIC_METADATA_FIELDS: Record<AdminAuditAction, readonly string[]> = {
  user_created: ['email', 'displayName'],
  user_status_changed: ['email', 'displayName', 'fromStatus', 'toStatus'],
  team_created: ['name', 'slug'],
  membership_added: ['teamName', 'email', 'displayName', 'fromRole', 'toRole'],
  membership_role_changed: ['teamName', 'email', 'displayName', 'fromRole', 'toRole'],
  membership_removed: ['teamName', 'email', 'displayName', 'fromRole', 'toRole'],
  job_retried: ['type', 'previousAttempts', 'previousLastError'],
}


/**
 * Records an immutable administrative audit event inside the caller's transaction.
 * Serializes no caller-specific business rules.
 */
export async function recordAdminAudit(
  tx: Tx,
  input: RecordAdminAuditInput,
): Promise<void> {
  await tx.insert(adminAuditEvents).values({
    actorId: input.actorId,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    metadata: input.metadata,
  })
}

/**
 * Lists administrative audit events newest-first with keyset pagination.
 * Scoped to action and literal search query. Requires 'user:manage'.
 */
export async function listAdminAudit(
  actor: Actor,
  query?: ListAdminAuditQuery,
): Promise<ListAdminAuditResult> {
  const allowed = await can(actor, 'user:manage')
  if (!allowed) {
    throw ApiError.of('FORBIDDEN')
  }

  const effectiveLimit = query?.limit ?? DEFAULT_LIMIT
  if (!Number.isInteger(effectiveLimit) || effectiveLimit < 1 || effectiveLimit > MAX_LIMIT) {
    throw ApiError.of('VALIDATION_ERROR', `limit must be an integer between 1 and ${MAX_LIMIT}`)
  }

  const action = query?.action
  const q = query?.q?.trim() ?? ''
  const scope = `admin:audit:action=${action ?? ''};q=${q}`

  const cursorId = decodeIdCursor(query?.cursor, scope)

  const conditions = []

  if (cursorId !== null) {
    conditions.push(lt(adminAuditEvents.id, cursorId))
  }

  if (action !== undefined) {
    conditions.push(eq(adminAuditEvents.action, action))
  }

  if (q !== '') {
    const escaped = escapeLike(q)
    const pattern = `%${escaped}%`
    const searchConditions = [
      sql`${users.email} LIKE ${pattern} ESCAPE '\\\\'`,
      sql`${users.displayName} LIKE ${pattern} ESCAPE '\\\\'`,
      ...SEARCHABLE_METADATA_FIELDS.map(
        (field) =>
          sql`CAST(JSON_UNQUOTE(JSON_EXTRACT(${adminAuditEvents.metadata}, ${`$.${field}`})) AS CHAR) LIKE ${pattern} ESCAPE '\\\\'`,
      ),
    ]
    conditions.push(or(...searchConditions)!)
  }

  const rows = await db
    .select({
      id: adminAuditEvents.id,
      action: adminAuditEvents.action,
      targetType: adminAuditEvents.targetType,
      metadata: adminAuditEvents.metadata,
      createdAt: adminAuditEvents.createdAt,
      actorId: users.id,
      actorEmail: users.email,
      actorDisplayName: users.displayName,
    })
    .from(adminAuditEvents)
    .innerJoin(users, eq(adminAuditEvents.actorId, users.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(adminAuditEvents.id))
    .limit(effectiveLimit + 1)

  const mappedRows: AdminAuditEvent[] = rows.map((r) => ({
    id: r.id,
    actor: {
      id: r.actorId,
      email: r.actorEmail,
      displayName: r.actorDisplayName,
    },
    action: r.action,
    targetType: r.targetType,
    metadata: Object.fromEntries(
      PUBLIC_METADATA_FIELDS[r.action]
        .filter((key) => Object.hasOwn(r.metadata, key))
        .map((key) => [key, r.metadata[key]]),
    ),
    createdAt: r.createdAt,
  }))

  const { page, nextCursor } = buildPage(
    mappedRows,
    effectiveLimit,
    (r) => ({ id: r.id }),
    scope,
  )

  return {
    events: page,
    nextCursor,
  }
}
