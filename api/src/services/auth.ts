import { eq } from 'drizzle-orm'
import { db } from '../db/client'
import { refreshTokens, users } from '../db/schema'
import type { Actor, Role } from '../domain/types'
import { ApiError } from '../http/errors'
import { membershipsOf } from '../policy'
import { sha256, verifyPassword } from './crypto'
import { issueFamily, revokeFamily, type SessionCtx } from './sessions'
import { signAccessToken } from './tokens'
import { publicUserColumns, toPublicUser, type PublicUser } from './users'

export async function login(
  email: string,
  password: string,
  ctx: SessionCtx = {},
): Promise<{ user: PublicUser; accessToken: string; refreshToken: string }> {
  if (Buffer.byteLength(password, 'utf8') > 72) {
    throw ApiError.of('UNAUTHENTICATED')
  }
  const normalizedEmail = email.toLowerCase().trim()
  const [row] = await db
    .select({ ...publicUserColumns, passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.email, normalizedEmail))
    .limit(1)

  if (!row || !(await verifyPassword(password, row.passwordHash))) {
    throw ApiError.of('UNAUTHENTICATED')
  }

  if (row.status === 'disabled') {
    throw ApiError.of('FORBIDDEN')
  }

  const user = toPublicUser(row)
  const accessToken = await signAccessToken(user.id)
  const { refreshToken } = await issueFamily(user.id, ctx)

  return { user, accessToken, refreshToken }
}

export async function logout(presentedToken: string | undefined): Promise<void> {
  if (!presentedToken) {
    return
  }

  const tokenHash = sha256(presentedToken)
  const [row] = await db
    .select({ familyId: refreshTokens.familyId })
    .from(refreshTokens)
    .where(eq(refreshTokens.tokenHash, tokenHash))
    .limit(1)

  if (!row) {
    return
  }

  await revokeFamily(row.familyId)
}

export async function me(
  actor: Actor,
): Promise<{ user: PublicUser; memberships: Array<{ teamId: number; role: Role }> }> {
  const [user] = await db
    .select(publicUserColumns)
    .from(users)
    .where(eq(users.id, actor.id))
    .limit(1)

  if (!user || user.status === 'disabled') {
    throw ApiError.of('UNAUTHENTICATED')
  }

  const userMemberships = await membershipsOf(actor.id)

  return { user, memberships: userMemberships }
}
