import { and, eq, isNull, sql } from 'drizzle-orm'
import { config } from '../config'
import { db } from '../db/client'
import { refreshTokens, users } from '../db/schema'
import { withTransaction, type Tx } from '../db/tx'
import { ApiError } from '../http/errors'
import { randomToken, sha256, uuid } from './crypto'

export interface SessionCtx {
  userAgent?: string
  ip?: string
}

export interface IssuedSession {
  refreshToken: string
  familyId: string
}

export interface RotatedSession {
  userId: number
  refreshToken: string
  familyId: string
}

/**
 * Mints a new session family for `userId`.
 * Writes an initial refresh token to `refresh_tokens`.
 */
export async function issueFamily(
  userId: number,
  ctx: SessionCtx = {},
  tx?: Tx,
): Promise<IssuedSession> {
  const familyId = uuid()
  const refreshToken = randomToken()
  const tokenHash = sha256(refreshToken)

  const execute = async (runner: Tx) => {
    const [user] = await runner
      .select({ id: users.id, status: users.status })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
      .for('update')

    if (!user || user.status === 'disabled') {
      throw ApiError.of('FORBIDDEN')
    }

    await runner.insert(refreshTokens).values({
      userId,
      familyId,
      tokenHash,
      expiresAt: sql`DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL ${config.refreshTtlSec} SECOND)`,
      userAgent: ctx.userAgent ? ctx.userAgent.slice(0, 255) : null,
      ip: ctx.ip ? ctx.ip.slice(0, 45) : null,
    })

    return { refreshToken, familyId }
  }

  if (tx) {
    return await execute(tx)
  }
  return await withTransaction(execute)
}

/**
 * Rotates a refresh token per spec §8.7 / §11.3:
 * 1. Finds token by `sha256(presentedToken)` with row lock.
 * 2. If unrevoked: mints successor in same family, marks old token revoked and sets `replaced_by`.
 * 3. If revoked within `config.refreshGraceSec` AND replaced_by is set:
 *    benign race -> mints successor, revokes any active token in family.
 * 4. If revoked beyond grace period (or replaced_by is null):
 *    token theft -> revokes the whole family on `tx`, commits, then throws UNAUTHENTICATED.
 */
export async function rotate(
  presentedToken: string,
  ctx: SessionCtx = {},
): Promise<RotatedSession> {
  const presentedHash = sha256(presentedToken)

  type RotateOutcome =
    | { kind: 'ok'; session: RotatedSession }
    | { kind: 'unauthenticated' }
    | { kind: 'theft' }

  const result = await withTransaction<RotateOutcome>(async (tx) => {
    const [candidate] = await tx
      .select({ id: refreshTokens.id, userId: refreshTokens.userId })
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, presentedHash))
      .limit(1)

    if (!candidate) {
      return { kind: 'unauthenticated' }
    }

    // Lock user row first to enforce global lock ordering (users -> refresh_tokens)
    const [user] = await tx
      .select({ id: users.id, status: users.status })
      .from(users)
      .where(eq(users.id, candidate.userId))
      .limit(1)
      .for('update')

    const [tokenRow] = await tx
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.id, candidate.id))
      .for('update')

    if (!tokenRow) {
      return { kind: 'unauthenticated' }
    }

    const familyId = tokenRow.familyId

    if (!user || user.status === 'disabled') {
      await tx
        .update(refreshTokens)
        .set({
          revokedAt: sql`COALESCE(revoked_at, CURRENT_TIMESTAMP(3))`,
          replacedBy: null,
        })
        .where(eq(refreshTokens.familyId, familyId))
      return { kind: 'unauthenticated' }
    }

    // Expiry check
    if (new Date(tokenRow.expiresAt).getTime() <= Date.now()) {
      return { kind: 'unauthenticated' }
    }

    // Handle revoked token
    if (tokenRow.revokedAt !== null) {
      const revokedAtMs = new Date(tokenRow.revokedAt).getTime()
      const graceMs = config.refreshGraceSec * 1000
      const isWithinGrace = Date.now() - revokedAtMs <= graceMs

      if (tokenRow.replacedBy !== null && isWithinGrace) {
        // Benign race: revoke any currently active token in family and issue successor
        await tx
          .update(refreshTokens)
          .set({ revokedAt: sql`CURRENT_TIMESTAMP(3)` })
          .where(and(eq(refreshTokens.familyId, familyId), isNull(refreshTokens.revokedAt)))

        const nextToken = randomToken()
        const nextHash = sha256(nextToken)

        const [inserted] = await tx.insert(refreshTokens).values({
          userId: tokenRow.userId,
          familyId,
          tokenHash: nextHash,
          expiresAt: sql`DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL ${config.refreshTtlSec} SECOND)`,
          userAgent: ctx.userAgent ? ctx.userAgent.slice(0, 255) : null,
          ip: ctx.ip ? ctx.ip.slice(0, 45) : null,
        })

        await tx
          .update(refreshTokens)
          .set({ replacedBy: inserted.insertId })
          .where(eq(refreshTokens.id, tokenRow.id))

        return {
          kind: 'ok',
          session: { userId: tokenRow.userId, refreshToken: nextToken, familyId },
        }
      }

      // Beyond grace window, replacedBy is null, or explicitly revoked: theft! Nuke the entire family on tx
      await tx
        .update(refreshTokens)
        .set({
          revokedAt: sql`COALESCE(revoked_at, CURRENT_TIMESTAMP(3))`,
          replacedBy: null,
        })
        .where(eq(refreshTokens.familyId, familyId))

      return { kind: 'theft' }
    }

    // Active token rotation
    const nextToken = randomToken()
    const nextHash = sha256(nextToken)

    const [inserted] = await tx.insert(refreshTokens).values({
      userId: tokenRow.userId,
      familyId,
      tokenHash: nextHash,
      expiresAt: sql`DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL ${config.refreshTtlSec} SECOND)`,
      userAgent: ctx.userAgent ? ctx.userAgent.slice(0, 255) : null,
      ip: ctx.ip ? ctx.ip.slice(0, 45) : null,
    })

    await tx
      .update(refreshTokens)
      .set({
        revokedAt: sql`CURRENT_TIMESTAMP(3)`,
        replacedBy: inserted.insertId,
        lastUsedAt: sql`CURRENT_TIMESTAMP(3)`,
      })
      .where(eq(refreshTokens.id, tokenRow.id))

    return {
      kind: 'ok',
      session: { userId: tokenRow.userId, refreshToken: nextToken, familyId },
    }
  })

  if (result.kind === 'ok') {
    return result.session
  }
  throw ApiError.of('UNAUTHENTICATED')
}

/**
 * Revokes all tokens in a session family.
 */
export async function revokeFamily(familyId: string, tx?: Tx): Promise<void> {
  const runner = tx ?? db
  await runner
    .update(refreshTokens)
    .set({
      revokedAt: sql`COALESCE(revoked_at, CURRENT_TIMESTAMP(3))`,
      replacedBy: null,
    })
    .where(eq(refreshTokens.familyId, familyId))
}

/**
 * Revokes all active refresh tokens for a user across all families.
 * Clears replacedBy on all rows so no rotated ancestor can resurrect a family.
 */
export async function revokeAllForUser(userId: number, tx?: Tx): Promise<void> {
  const runner = tx ?? db
  await runner
    .update(refreshTokens)
    .set({
      revokedAt: sql`COALESCE(revoked_at, CURRENT_TIMESTAMP(3))`,
      replacedBy: null,
    })
    .where(eq(refreshTokens.userId, userId))
}
