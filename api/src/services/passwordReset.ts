import { and, eq, gt, isNull, sql } from 'drizzle-orm'
import { config } from '../config'
import { db } from '../db/client'
import { passwordResetTokens, users } from '../db/schema'
import { withTransaction } from '../db/tx'
import { ApiError } from '../http/errors'
import { hashPassword, randomToken, sha256 } from './crypto'
import { enqueue } from './outbox'
import { revokeAllForUser } from './sessions'

export async function forgotPassword(email: string): Promise<void> {
  const normalizedEmail = email.toLowerCase().trim()
  const [user] = await db
    .select({ id: users.id, email: users.email, status: users.status })
    .from(users)
    .where(eq(users.email, normalizedEmail))
    .limit(1)

  if (!user || user.status === 'disabled') {
    return
  }

  const token = randomToken()
  const tokenHash = sha256(token)

  await withTransaction(async (tx) => {
    await tx.insert(passwordResetTokens).values({
      userId: user.id,
      tokenHash,
      expiresAt: sql`DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL ${config.resetTtlSec} SECOND)`,
    })

    await enqueue(tx, {
      type: 'email.reset',
      payload: { to: user.email, code: token },
      dedupeKey: `reset:${tokenHash}`,
    })
  })
}

export async function resetPassword(token: string, newPassword: string): Promise<void> {
  if (newPassword.length < 8) {
    throw ApiError.of('VALIDATION_ERROR', 'Password must be at least 8 characters')
  }
  if (Buffer.byteLength(newPassword, 'utf8') > 72) {
    throw ApiError.of('VALIDATION_ERROR', 'Password must not exceed 72 bytes')
  }

  const tokenHash = sha256(token)

  await withTransaction(async (tx) => {
    const [tokenRow] = await tx
      .select({
        id: passwordResetTokens.id,
        userId: passwordResetTokens.userId,
        expiresAt: passwordResetTokens.expiresAt,
        consumedAt: passwordResetTokens.consumedAt,
      })
      .from(passwordResetTokens)
      .where(eq(passwordResetTokens.tokenHash, tokenHash))
      .for('update')

    if (
      !tokenRow ||
      tokenRow.consumedAt !== null ||
      new Date(tokenRow.expiresAt).getTime() <= Date.now()
    ) {
      throw ApiError.of('VALIDATION_ERROR', 'Invalid or expired password reset token')
    }

    const [user] = await tx
      .select({ id: users.id, status: users.status })
      .from(users)
      .where(eq(users.id, tokenRow.userId))
      .for('update')

    if (!user || user.status === 'disabled') {
      throw ApiError.of('FORBIDDEN')
    }

    const [casResult] = await tx
      .update(passwordResetTokens)
      .set({ consumedAt: sql`CURRENT_TIMESTAMP(3)` })
      .where(
        and(
          eq(passwordResetTokens.id, tokenRow.id),
          isNull(passwordResetTokens.consumedAt),
        ),
      )

    if (casResult.affectedRows === 0) {
      throw ApiError.of('VALIDATION_ERROR', 'Invalid or expired password reset token')
    }

    const passwordHash = await hashPassword(newPassword)

    await tx
      .update(users)
      .set({ passwordHash })
      .where(eq(users.id, user.id))

    await revokeAllForUser(user.id, tx)
  })
}
