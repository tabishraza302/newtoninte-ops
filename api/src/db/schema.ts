import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  datetime,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  text,
  unique,
  varchar,
} from 'drizzle-orm/mysql-core'
import { ITEM_TYPES, OUTBOX_TYPES, PRIORITIES, ROLES, STATUSES } from '../domain/types'

// Identity & access tables (spec §5.1).
//
// Row-type convention (binding for every table in this repo):
//   export type <Entity>Row = typeof <table>.$inferSelect
//   export type New<Entity> = typeof <table>.$inferInsert
//
// Timestamps are UTC DATETIME(3) with millisecond precision; defaults come from
// the database (`CURRENT_TIMESTAMP(3)`), never from a JS `$defaultFn`.

export const users = mysqlTable('users', {
  id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  displayName: varchar('display_name', { length: 120 }).notNull(),
  isAdmin: boolean('is_admin').notNull().default(false),
  status: mysqlEnum('status', ['active', 'disabled']).notNull().default('active'),
  createdAt: datetime('created_at', { fsp: 3 })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP(3)`),
  updatedAt: datetime('updated_at', { fsp: 3 })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)`),
})

export const teams = mysqlTable('teams', {
  id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
  name: varchar('name', { length: 120 }).notNull(),
  slug: varchar('slug', { length: 80 }).notNull().unique(),
  createdAt: datetime('created_at', { fsp: 3 })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP(3)`),
  updatedAt: datetime('updated_at', { fsp: 3 })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)`),
})

export const memberships = mysqlTable(
  'memberships',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
    userId: bigint('user_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => users.id),
    teamId: bigint('team_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => teams.id),
    role: mysqlEnum('role', ROLES).notNull(),
    createdAt: datetime('created_at', { fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
    updatedAt: datetime('updated_at', { fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)`),
  },
  (t) => [
    unique('memberships_user_team_uq').on(t.userId, t.teamId),
    index('memberships_team_role_ix').on(t.teamId, t.role),
  ],
)

// Append-only audit of team-level membership changes — no `updated_at`.
export const membershipEvents = mysqlTable(
  'membership_events',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
    teamId: bigint('team_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => teams.id),
    actorId: bigint('actor_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => users.id),
    subjectUserId: bigint('subject_user_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => users.id),
    action: mysqlEnum('action', ['joined', 'role_changed', 'removed']).notNull(),
    fromRole: mysqlEnum('from_role', ROLES),
    toRole: mysqlEnum('to_role', ROLES),
    createdAt: datetime('created_at', { fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (t) => [index('membership_events_team_id_ix').on(t.teamId, t.id)],
)

// Single-use invitations — no `updated_at`.
export const invitations = mysqlTable(
  'invitations',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
    teamId: bigint('team_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => teams.id),
    role: mysqlEnum('role', ROLES).notNull(),
    email: varchar('email', { length: 255 }).notNull(),
    codeHash: varchar('code_hash', { length: 64 }).notNull(),
    maxUses: int('max_uses').notNull().default(1),
    uses: int('uses').notNull().default(0),
    expiresAt: datetime('expires_at', { fsp: 3 }).notNull(),
    createdBy: bigint('created_by', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => users.id),
    revokedAt: datetime('revoked_at', { fsp: 3 }),
    createdAt: datetime('created_at', { fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (t) => [
    index('invitations_team_ix').on(t.teamId),
    index('invitations_code_hash_ix').on(t.codeHash),
  ],
)

// Single-use refresh tokens — no `updated_at`.
export const refreshTokens = mysqlTable(
  'refresh_tokens',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
    userId: bigint('user_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => users.id),
    tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(),
    familyId: varchar('family_id', { length: 36 }).notNull(),
    expiresAt: datetime('expires_at', { fsp: 3 }).notNull(),
    revokedAt: datetime('revoked_at', { fsp: 3 }),
    replacedBy: bigint('replaced_by', { mode: 'number', unsigned: true }),
    createdAt: datetime('created_at', { fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
    lastUsedAt: datetime('last_used_at', { fsp: 3 }),
    userAgent: varchar('user_agent', { length: 255 }),
    ip: varchar('ip', { length: 45 }),
  },
  (t) => [
    index('refresh_tokens_user_ix').on(t.userId),
    index('refresh_tokens_family_ix').on(t.familyId),
  ],
)

// Single-use password reset tokens — no `updated_at`.
export const passwordResetTokens = mysqlTable('password_reset_tokens', {
  id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
  userId: bigint('user_id', { mode: 'number', unsigned: true })
    .notNull()
    .references(() => users.id),
  tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(),
  expiresAt: datetime('expires_at', { fsp: 3 }).notNull(),
  consumedAt: datetime('consumed_at', { fsp: 3 }),
  createdAt: datetime('created_at', { fsp: 3 })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP(3)`),
})

// Work-item tables (spec §5.2).
export const workItems = mysqlTable(
  'work_items',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
    teamId: bigint('team_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => teams.id),
    title: varchar('title', { length: 200 }).notNull(),
    description: text('description'),
    type: mysqlEnum('type', ITEM_TYPES).notNull(),
    priority: mysqlEnum('priority', PRIORITIES).notNull(),
    status: mysqlEnum('status', STATUSES).notNull().default('open'),
    assigneeId: bigint('assignee_id', { mode: 'number', unsigned: true }).references(() => users.id),
    createdBy: bigint('created_by', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => users.id),
    dueAt: datetime('due_at', { fsp: 3 }),
    version: int('version').notNull().default(1),
    createdAt: datetime('created_at', { fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
    updatedAt: datetime('updated_at', { fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)`),
  },
  (t) => [
    index('work_items_team_status_priority_ix').on(t.teamId, t.status, t.priority),
    index('work_items_team_created_id_ix').on(t.teamId, t.createdAt, t.id),
    index('work_items_assignee_status_ix').on(t.assigneeId, t.status),
    index('work_items_team_assignee_ix').on(t.teamId, t.assigneeId),
  ],
)

// Append-only audit of item changes — no `updated_at`.
export const activityEvents = mysqlTable(
  'activity_events',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
    workItemId: bigint('work_item_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => workItems.id),
    actorId: bigint('actor_id', { mode: 'number', unsigned: true }).references(() => users.id),
    type: varchar('type', { length: 32 }).notNull(),
    fromValue: varchar('from_value', { length: 255 }),
    toValue: varchar('to_value', { length: 255 }),
    metadata: json('metadata'),
    createdAt: datetime('created_at', { fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (t) => [index('activity_events_item_ix').on(t.workItemId, t.id)],
)

// Immutable comments (no edit/delete in v1) — no `updated_at`.
export const comments = mysqlTable(
  'comments',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
    workItemId: bigint('work_item_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => workItems.id),
    authorId: bigint('author_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => users.id),
    body: text('body').notNull(),
    createdAt: datetime('created_at', { fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (t) => [index('comments_item_ix').on(t.workItemId, t.id)],
)

// Infrastructure tables (spec §5.3).

// The outbox queue — mutable lease/attempt state, so `updated_at` is present.
export const outboxJobs = mysqlTable(
  'outbox_jobs',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
    type: mysqlEnum('type', OUTBOX_TYPES).notNull(),
    payload: json('payload'),
    status: mysqlEnum('status', ['pending', 'processing', 'done', 'failed'])
      .notNull()
      .default('pending'),
    attempts: int('attempts').notNull().default(0),
    maxAttempts: int('max_attempts').notNull().default(5),
    availableAt: datetime('available_at', { fsp: 3 }).notNull(),
    lockedAt: datetime('locked_at', { fsp: 3 }),
    lockedBy: varchar('locked_by', { length: 120 }),
    lastError: text('last_error'),
    dedupeKey: varchar('dedupe_key', { length: 200 }).notNull().unique(),
    createdAt: datetime('created_at', { fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
    updatedAt: datetime('updated_at', { fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)`),
  },
  (t) => [index('outbox_status_available_ix').on(t.status, t.availableAt, t.id)],
)

// Idempotency-key store — write-once within its TTL, so no `updated_at`.
export const idempotencyKeys = mysqlTable(
  'idempotency_keys',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
    userId: bigint('user_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => users.id),
    key: varchar('key', { length: 255 }).notNull(),
    endpoint: varchar('endpoint', { length: 120 }).notNull(),
    requestHash: varchar('request_hash', { length: 64 }).notNull(),
    responseStatus: int('response_status').notNull(),
    responseBody: json('response_body').notNull(),
    resourceId: bigint('resource_id', { mode: 'number', unsigned: true }),
    expiresAt: datetime('expires_at', { fsp: 3 }).notNull(),
    createdAt: datetime('created_at', { fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (t) => [unique('idempotency_user_key_uq').on(t.userId, t.key)],
)

// Row / insert types — the repo-wide convention.
export type UserRow = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert

export type TeamRow = typeof teams.$inferSelect
export type NewTeam = typeof teams.$inferInsert

export type MembershipRow = typeof memberships.$inferSelect
export type NewMembership = typeof memberships.$inferInsert

export type MembershipEventRow = typeof membershipEvents.$inferSelect
export type NewMembershipEvent = typeof membershipEvents.$inferInsert

export type InvitationRow = typeof invitations.$inferSelect
export type NewInvitation = typeof invitations.$inferInsert

export type RefreshTokenRow = typeof refreshTokens.$inferSelect
export type NewRefreshToken = typeof refreshTokens.$inferInsert

export type PasswordResetTokenRow = typeof passwordResetTokens.$inferSelect
export type NewPasswordResetToken = typeof passwordResetTokens.$inferInsert

export type WorkItemRow = typeof workItems.$inferSelect
export type NewWorkItem = typeof workItems.$inferInsert

export type ActivityEventRow = typeof activityEvents.$inferSelect
export type NewActivityEvent = typeof activityEvents.$inferInsert

export type CommentRow = typeof comments.$inferSelect
export type NewComment = typeof comments.$inferInsert

export type OutboxJobRow = typeof outboxJobs.$inferSelect
export type NewOutboxJob = typeof outboxJobs.$inferInsert

export type IdempotencyKeyRow = typeof idempotencyKeys.$inferSelect
export type NewIdempotencyKey = typeof idempotencyKeys.$inferInsert
