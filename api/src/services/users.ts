import { and, desc, eq, isNull, lt, or, sql, type SQL } from 'drizzle-orm'
import { db } from '../db/client'
import { withTransaction } from '../db/tx'
import { membershipEvents, memberships, refreshTokens, teams, users, type UserRow } from '../db/schema'
import { ROLES, type Actor, type Role } from '../domain/types'
import { ApiError } from '../http/errors'
import { buildPage, decodeIdCursor, DEFAULT_LIMIT, MAX_LIMIT } from '../http/cursor'
import { can } from '../policy'
import { config } from '../config'
import { hashPassword } from './crypto'
import { recordAdminAudit } from './adminAudit'

/**
 * The explicit column list for a user as the API returns it: every `users`
 * column except `password_hash`. `db.select()` would spread the hash into the
 * response, so the omission has to be stated column by column - the same rule
 * `jobColumns` follows for outbox payloads in `services/jobs.ts`.
 */
export const publicUserColumns = {
  id: users.id,
  email: users.email,
  displayName: users.displayName,
  isAdmin: users.isAdmin,
  status: users.status,
  createdAt: users.createdAt,
  updatedAt: users.updatedAt,
} as const

export type PublicUser = Omit<UserRow, 'passwordHash'>

/** Drops `password_hash` from a whole row - for the paths that must read it (password checks). */
export function toPublicUser(row: UserRow): PublicUser {
  const { passwordHash, ...user } = row
  return user
}

export interface ListUsersQuery {
  q?: string | undefined
  cursor?: string | undefined
  limit?: number | undefined
}

export interface ListUsersResult {
  users: PublicUser[]
  nextCursor: string | null
  userCreationEnabled: boolean
}

export interface CreateUserInput {
  email: string
  displayName: string
  password: string
  teamId?: number | undefined
  role?: Role | undefined
}

function escapeLike(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_')
}

function isDupEntry(err: unknown): boolean {
  const target = err && typeof err === 'object' && 'cause' in err && err.cause ? err.cause : err
  if (target && typeof target === 'object') {
    const code = 'code' in target ? target.code : undefined
    const errno = 'errno' in target ? target.errno : undefined
    return code === 'ER_DUP_ENTRY' || errno === 1062
  }
  return false
}

async function authorizeUserManage(actor: Actor): Promise<void> {
  const allowed = await can(actor, 'user:manage')
  if (!allowed) {
    throw ApiError.of('FORBIDDEN')
  }
}

/**
 * Lists users paginated by keyset (`id DESC`) with optional literal search over
 * email and displayName. Scoped cursor prevents cross-query replaying.
 */
export async function listUsers(
  actor: Actor,
  query: ListUsersQuery = {},
): Promise<ListUsersResult> {
  await authorizeUserManage(actor)

  const limit = query.limit ?? DEFAULT_LIMIT
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw ApiError.of('VALIDATION_ERROR', `limit must be an integer between 1 and ${MAX_LIMIT}`, {
      limit,
    })
  }

  const q = query.q ?? ''
  const scope = `admin:users:q=${q}`
  const conditions: SQL[] = []

  if (q !== '') {
    const escaped = escapeLike(q)
    conditions.push(
      or(
        sql`${users.email} LIKE ${`%${escaped}%`} ESCAPE '\\\\'`,
        sql`${users.displayName} LIKE ${`%${escaped}%`} ESCAPE '\\\\'`,
      )!,
    )
  }

  const cursorId = decodeIdCursor(query.cursor, scope)
  if (cursorId !== null) {
    conditions.push(lt(users.id, cursorId))
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined

  const rows: PublicUser[] = await db
    .select(publicUserColumns)
    .from(users)
    .where(whereClause)
    .orderBy(desc(users.id))
    .limit(limit + 1)

  const pageResult = buildPage(
    rows,
    limit,
    (row) => ({ id: row.id }),
    scope,
  )

  return {
    users: pageResult.page,
    nextCursor: pageResult.nextCursor,
    userCreationEnabled: config.adminUserCreationEnabled,
  }
}

/**
 * Creates a new active, non-admin user.
 * Optional paired teamId/role viewer|member|lead adds team membership and joined audit atomically.
 */
export async function createUser(
  actor: Actor,
  input: CreateUserInput,
): Promise<PublicUser> {
  await authorizeUserManage(actor)

  if (!config.adminUserCreationEnabled) {
    throw ApiError.of('USER_CREATION_DISABLED', 'User creation is disabled')
  }

  const normalizedEmail = input.email.trim().toLowerCase()
  if (!normalizedEmail || !normalizedEmail.includes('@')) {
    throw ApiError.of('VALIDATION_ERROR', 'Invalid email address')
  }

  const trimmedDisplayName = input.displayName.trim()
  if (trimmedDisplayName.length < 1 || trimmedDisplayName.length > 120) {
    throw ApiError.of('VALIDATION_ERROR', 'Display name must be between 1 and 120 characters')
  }

  if (input.password.length < 8) {
    throw ApiError.of('VALIDATION_ERROR', 'Password must be at least 8 characters')
  }
  if (Buffer.byteLength(input.password, 'utf8') > 72) {
    throw ApiError.of('VALIDATION_ERROR', 'Password must not exceed 72 bytes')
  }

  const hasTeamId = input.teamId !== undefined
  const hasRole = input.role !== undefined
  if (hasTeamId !== hasRole) {
    throw ApiError.of('VALIDATION_ERROR', 'teamId and role must be provided together')
  }
  if (hasRole && !ROLES.includes(input.role as Role)) {
    throw ApiError.of('VALIDATION_ERROR', `Invalid role: ${input.role}`)
  }

  const passwordHash = await hashPassword(input.password)

  try {
    return await withTransaction(async (tx) => {
      // 1. Fast-path check for existing email
      const [existingUser] = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, normalizedEmail))
        .limit(1)

      if (existingUser) {
        throw ApiError.of('EMAIL_TAKEN', 'A user with this email already exists')
      }

      // 2. If teamId is specified, verify team exists
      let teamName = ''
      if (hasTeamId) {
        const [team] = await tx
          .select({ id: teams.id, name: teams.name })
          .from(teams)
          .where(eq(teams.id, input.teamId!))
          .limit(1)
          .for('update')
        if (!team) {
          throw ApiError.of('NOT_FOUND', 'Team not found')
        }
        teamName = team.name
      }
      // 3. Insert user
      const [inserted] = await tx.insert(users).values({
        email: normalizedEmail,
        passwordHash,
        displayName: trimmedDisplayName,
        isAdmin: false,
        status: 'active',
      })

      const newUserId = Number(inserted.insertId)

      // 4. Atomically insert membership and joined event if paired teamId/role provided
      if (hasTeamId && input.role) {
        const [memResult] = await tx.insert(memberships).values({
          teamId: input.teamId!,
          userId: newUserId,
          role: input.role,
        })

        await tx.insert(membershipEvents).values({
          teamId: input.teamId!,
          actorId: actor.id,
          subjectUserId: newUserId,
          action: 'joined',
          fromRole: null,
          toRole: input.role,
        })

        await recordAdminAudit(tx, {
          actorId: actor.id,
          action: 'membership_added',
          targetType: 'membership',
          targetId: Number(memResult.insertId),
          metadata: {
            teamId: input.teamId!,
            teamName,
            userId: newUserId,
            email: normalizedEmail,
            displayName: trimmedDisplayName,
            fromRole: null,
            toRole: input.role,
          },
        })
      }

      await recordAdminAudit(tx, {
        actorId: actor.id,
        action: 'user_created',
        targetType: 'user',
        targetId: newUserId,
        metadata: {
          email: normalizedEmail,
          displayName: trimmedDisplayName,
        },
      })
      // 5. Read back public user projection
      const [newUser] = await tx
        .select(publicUserColumns)
        .from(users)
        .where(eq(users.id, newUserId))
        .limit(1)

      if (!newUser) {
        throw ApiError.of('INTERNAL_ERROR', 'Failed to retrieve created user')
      }

      return newUser
    })
  } catch (err: unknown) {
    if (isDupEntry(err)) {
      throw ApiError.of('EMAIL_TAKEN', 'A user with this email already exists')
    }
    throw err
  }
}

/**
 * Enables or disables a user account (spec §7.1 PATCH /admin/users/:id).
 * When status is 'disabled', atomically revokes all active refresh tokens for that user.
 */
export async function setUserStatus(
  actor: Actor,
  id: number,
  status: 'active' | 'disabled',
): Promise<void> {
  await authorizeUserManage(actor)

  await withTransaction(async (tx) => {
    const [user] = await tx
      .select({
        id: users.id,
        email: users.email,
        displayName: users.displayName,
        status: users.status,
      })
      .from(users)
      .where(eq(users.id, id))
      .limit(1)
      .for('update')

    if (!user) {
      throw ApiError.of('NOT_FOUND')
    }

    if (status === 'disabled') {
      await tx
        .update(refreshTokens)
        .set({ revokedAt: new Date() })
        .where(and(eq(refreshTokens.userId, id), isNull(refreshTokens.revokedAt)))
    }

    if (user.status === status) {
      return
    }

    await tx.update(users).set({ status }).where(eq(users.id, id))

    await recordAdminAudit(tx, {
      actorId: actor.id,
      action: 'user_status_changed',
      targetType: 'user',
      targetId: id,
      metadata: {
        email: user.email,
        displayName: user.displayName,
        fromStatus: user.status,
        toStatus: status,
      },
    })
  })
}
