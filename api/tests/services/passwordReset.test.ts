import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import { resetDb, seedUser } from '../helpers/db'
import { closeDb, pool } from '../../src/db/client'
import { forgotPassword, resetPassword } from '../../src/services/passwordReset'
import { handlers } from '../../src/outbox/handlers'
import { hashPassword, verifyPassword, sha256 } from '../../src/services/crypto'
import { issueFamily } from '../../src/services/sessions'
import { ApiError } from '../../src/http/errors'

const MAILPIT_API = 'http://localhost:8025/api/v1/messages'

interface MailpitAddress {
  Name: string
  Address: string
}

interface MailpitMessageSummary {
  ID: string
  Subject: string
  To: MailpitAddress[]
}

interface MailpitMessageDetail {
  Text: string
  HTML: string
}

interface MailpitList {
  messages: MailpitMessageSummary[]
}

interface OutboxJobRow {
  id: number
  type: string
  payload: string | { to: string; code: string }
  status: string
  dedupe_key: string
}

interface ResetTokenRow {
  id: number
  user_id: number
  token_hash: string
  expires_at: Date
  consumed_at: Date | null
}

interface RefreshTokenRow {
  id: number
  user_id: number
  revoked_at: Date | null
}

interface UserRow {
  id: number
  email: string
  password_hash: string
}

async function clearMailbox(): Promise<void> {
  await fetch(MAILPIT_API, { method: 'DELETE' })
}

async function fetchOutboxJobs(): Promise<OutboxJobRow[]> {
  const [rows] = await pool.query(
    'SELECT id, type, payload, status, dedupe_key FROM outbox_jobs ORDER BY id ASC',
  )
  return (rows as OutboxJobRow[]).map((r) => ({
    ...r,
    payload: typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload,
  }))
}

async function fetchResetTokens(userId: number): Promise<ResetTokenRow[]> {
  const [rows] = await pool.query(
    'SELECT id, user_id, token_hash, expires_at, consumed_at FROM password_reset_tokens WHERE user_id = ? ORDER BY id ASC',
    [userId],
  )
  return rows as ResetTokenRow[]
}

async function fetchRefreshTokens(userId: number): Promise<RefreshTokenRow[]> {
  const [rows] = await pool.query(
    'SELECT id, user_id, revoked_at FROM refresh_tokens WHERE user_id = ? ORDER BY id ASC',
    [userId],
  )
  return rows as RefreshTokenRow[]
}

async function fetchUser(userId: number): Promise<UserRow> {
  const [rows] = await pool.query(
    'SELECT id, email, password_hash FROM users WHERE id = ?',
    [userId],
  )
  const user = (rows as UserRow[])[0]
  if (!user) throw new Error(`User ${userId} not found`)
  return user
}

describe('password reset service (Task 2.14)', () => {
  beforeEach(async () => {
    await resetDb()
    await clearMailbox()
  })
  afterAll(closeDb)

  it('forgot for unknown email resolves and enqueues nothing', async () => {
    await expect(forgotPassword('unknown@example.test')).resolves.toBeUndefined()
    const jobs = await fetchOutboxJobs()
    expect(jobs).toHaveLength(0)
  })

  it('forgot for known email enqueues one email.reset job', async () => {
    const user = await seedUser({ email: 'alice@example.test' })

    await forgotPassword('  ALICE@EXAMPLE.TEST ')

    const jobs = await fetchOutboxJobs()
    expect(jobs).toHaveLength(1)
    const job = jobs[0]!
    expect(job.type).toBe('email.reset')
    const payload = job.payload as { to: string; code: string }
    expect(payload.to).toBe('alice@example.test')
    expect(typeof payload.code).toBe('string')
    expect(payload.code.length).toBeGreaterThan(20)
    expect(job.dedupe_key).toBe(`reset:${sha256(payload.code)}`)

    const resetTokens = await fetchResetTokens(user.id)
    expect(resetTokens).toHaveLength(1)
    expect(resetTokens[0]!.token_hash).toBe(sha256(payload.code))
    expect(resetTokens[0]!.consumed_at).toBeNull()
  })

  it('resetPassword with valid token updates password, so old password fails and new password verifies', async () => {
    const originalPassword = 'OldPassword123!'
    const newPassword = 'NewPassword456!'
    const initialHash = await hashPassword(originalPassword)
    const user = await seedUser({
      email: 'bob@example.test',
      passwordHash: initialHash,
    })

    await forgotPassword(user.email)
    const jobs = await fetchOutboxJobs()
    const payload = jobs[0]!.payload as { to: string; code: string }
    const token = payload.code

    await resetPassword(token, newPassword)

    const updatedUser = await fetchUser(user.id)
    const oldMatches = await verifyPassword(originalPassword, updatedUser.password_hash)
    const newMatches = await verifyPassword(newPassword, updatedUser.password_hash)
    expect(oldMatches).toBe(false)
    expect(newMatches).toBe(true)

    const resetTokens = await fetchResetTokens(user.id)
    expect(resetTokens[0]!.consumed_at).not.toBeNull()
  })

  it('resetPassword revokes all active refresh tokens for the user', async () => {
    const user = await seedUser({ email: 'carol@example.test' })
    await issueFamily(user.id, { userAgent: 'Browser1' })
    await issueFamily(user.id, { userAgent: 'Browser2' })

    const activeBefore = await fetchRefreshTokens(user.id)
    expect(activeBefore).toHaveLength(2)
    expect(activeBefore.every((t) => t.revoked_at === null)).toBe(true)

    await forgotPassword(user.email)
    const jobs = await fetchOutboxJobs()
    const payload = jobs[0]!.payload as { to: string; code: string }
    const token = payload.code

    await resetPassword(token, 'BrandNewPass789!')

    const activeAfter = await fetchRefreshTokens(user.id)
    expect(activeAfter).toHaveLength(2)
    expect(activeAfter.every((t) => t.revoked_at !== null)).toBe(true)
  })

  it('reusing the reset token throws VALIDATION_ERROR (422)', async () => {
    const user = await seedUser({ email: 'dave@example.test' })
    await forgotPassword(user.email)
    const jobs = await fetchOutboxJobs()
    const payload = jobs[0]!.payload as { to: string; code: string }
    const token = payload.code

    await resetPassword(token, 'PasswordFirstTime!')

    let error: unknown
    try {
      await resetPassword(token, 'PasswordSecondTime!')
    } catch (e: unknown) {
      error = e
    }

    expect(error).toBeInstanceOf(ApiError)
    const apiError = error as ApiError
    expect(apiError.code).toBe('VALIDATION_ERROR')
    expect(apiError.status).toBe(422)
  })

  it('email.reset handler sends real email to Mailpit sink', async () => {
    const to = 'resetuser@example.test'
    const code = 'sample_reset_token_abc123'

    const handler = handlers['email.reset']
    await handler({ to, code })

    const message = await vi.waitFor(
      async () => {
        const res = await fetch(MAILPIT_API)
        const list = (await res.json()) as MailpitList
        const msg = list.messages.find((m) =>
          m.To.some((recipient) => recipient.Address === to),
        )
        expect(msg).toBeDefined()
        return msg!
      },
      { timeout: 5000, interval: 50 },
    )

    expect(message.Subject).toBe('Reset your Newtonite password')

    const detailRes = await fetch(`http://localhost:8025/api/v1/message/${message.ID}`)
    const detail = (await detailRes.json()) as MailpitMessageDetail
    expect(detail.Text).toContain(`/reset-password?token=${code}`)
    expect(detail.HTML).toContain(`/reset-password?token=${code}`)
  })
})
