import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  datetime,
  index,
  int,
  mysqlEnum,
  mysqlTable,
  unique,
  varchar,
} from 'drizzle-orm/mysql-core'
import { ROLES } from '../domain/types'

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
