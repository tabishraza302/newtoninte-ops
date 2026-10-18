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
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.email, normalizedEmail))
    .limit(1)

  if (!user) {
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
  const tokenHash = sha256(token)

  await withTransaction(async (tx) => {
    const [casResult] = await tx
      .update(passwordResetTokens)
      .set({ consumedAt: sql`CURRENT_TIMESTAMP(3)` })
      .where(
        and(
          eq(passwordResetTokens.tokenHash, tokenHash),
          isNull(passwordResetTokens.consumedAt),
          gt(passwordResetTokens.expiresAt, sql`CURRENT_TIMESTAMP(3)`),
        ),
      )

    if (casResult.affectedRows === 0) {
      throw ApiError.of('VALIDATION_ERROR', 'Invalid or expired password reset token')
    }

    const [tokenRow] = await tx
      .select({ userId: passwordResetTokens.userId })
      .from(passwordResetTokens)
      .where(eq(passwordResetTokens.tokenHash, tokenHash))
      .limit(1)

    if (!tokenRow) {
      throw ApiError.of('VALIDATION_ERROR', 'Invalid or expired password reset token')
    }

    const passwordHash = await hashPassword(newPassword)

    await tx
      .update(users)
      .set({ passwordHash })
      .where(eq(users.id, tokenRow.userId))

    await revokeAllForUser(tokenRow.userId)
  })
}
