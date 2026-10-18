import { and, eq, isNull, sql } from 'drizzle-orm'
import { config } from '../config'
import { db } from '../db/client'
import { refreshTokens } from '../db/schema'
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
  const runner = tx ?? db
  const familyId = uuid()
  const refreshToken = randomToken()
  const tokenHash = sha256(refreshToken)

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

/**
 * Rotates a refresh token per spec §8.7 / §11.3:
 * 1. Finds token by `sha256(presentedToken)` with row lock.
 * 2. If unrevoked: mints successor in same family, marks old token revoked and sets `replaced_by`.
 * 3. If revoked within `config.refreshGraceSec`: benign race -> mints successor, revokes any active token in family.
 * 4. If revoked beyond grace period: token theft -> revokes the whole family and throws UNAUTHENTICATED.
 */
export async function rotate(
  presentedToken: string,
  ctx: SessionCtx = {},
): Promise<RotatedSession> {
  const presentedHash = sha256(presentedToken)

  return withTransaction(async (tx) => {
    const [tokenRow] = await tx
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, presentedHash))
      .for('update')

    if (!tokenRow) {
      throw ApiError.of('UNAUTHENTICATED')
    }

    // Expiry check
    if (new Date(tokenRow.expiresAt).getTime() <= Date.now()) {
      throw ApiError.of('UNAUTHENTICATED')
    }

    const familyId = tokenRow.familyId

    // Handled revoked token
    if (tokenRow.revokedAt !== null) {
      const revokedAtMs = new Date(tokenRow.revokedAt).getTime()
      const graceMs = config.refreshGraceSec * 1000
      const isWithinGrace = Date.now() - revokedAtMs <= graceMs

      if (isWithinGrace) {
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

        return { userId: tokenRow.userId, refreshToken: nextToken, familyId }
      }

      // Beyond grace window: theft! Nuke the entire family
      await tx
        .update(refreshTokens)
        .set({ revokedAt: sql`CURRENT_TIMESTAMP(3)` })
        .where(and(eq(refreshTokens.familyId, familyId), isNull(refreshTokens.revokedAt)))

      throw ApiError.of('UNAUTHENTICATED')
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

    return { userId: tokenRow.userId, refreshToken: nextToken, familyId }
  })
}

/**
 * Revokes all tokens in a session family.
 */
export async function revokeFamily(familyId: string): Promise<void> {
  await db
    .update(refreshTokens)
    .set({ revokedAt: sql`CURRENT_TIMESTAMP(3)` })
    .where(and(eq(refreshTokens.familyId, familyId), isNull(refreshTokens.revokedAt)))
}

/**
 * Revokes all active refresh tokens for a user across all families.
 */
export async function revokeAllForUser(userId: number): Promise<void> {
  await db
    .update(refreshTokens)
    .set({ revokedAt: sql`CURRENT_TIMESTAMP(3)` })
    .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)))
}
