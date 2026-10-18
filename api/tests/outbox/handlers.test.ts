import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import { resetDb } from '../helpers/db'
import { closeDb, pool } from '../../src/db/client'
import { withTransaction } from '../../src/db/tx'
import { enqueue } from '../../src/services/outbox'
import { runOnce } from '../../src/outbox/worker'
import { emailInvite, handlers } from '../../src/outbox/handlers'

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

interface JobRow {
  status: string
  payload: unknown
}

async function fetchJob(dedupeKey: string): Promise<JobRow> {
  const [rows] = await pool.query(
    'SELECT status, payload FROM outbox_jobs WHERE dedupe_key = ?',
    [dedupeKey],
  )
  const row = (rows as JobRow[])[0]
  if (!row) throw new Error(`Job not found for dedupeKey: ${dedupeKey}`)
  return row
}

async function clearMailbox(): Promise<void> {
  await fetch(MAILPIT_API, { method: 'DELETE' })
}

describe('email handlers', () => {
  beforeEach(async () => {
    await resetDb()
    await clearMailbox()
  })
  afterAll(closeDb)

  it('emailInvite sends an invitation email to Mailpit with redeem code and link', async () => {
    const to = 'newuser@example.test'
    const teamName = 'Rocket Scientists'
    const code = 'inv_secret_999'

    await emailInvite({ to, teamName, code })

    // Poll Mailpit for the delivered message using vi.waitFor
    const foundMessage = await vi.waitFor(
      async () => {
        const res = await fetch(MAILPIT_API)
        const list = (await res.json()) as MailpitList
        const msg = list.messages.find(
          (m) => m.To.some((recipient) => recipient.Address === to),
        )
        expect(msg).toBeDefined()
        return msg!
      },
      { timeout: 5000, interval: 50 },
    )

    expect(foundMessage.Subject).toContain(teamName)

    // Verify message text and html contain the redeem link and code
    const detailRes = await fetch(`http://localhost:8025/api/v1/message/${foundMessage.ID}`)
    const detail = (await detailRes.json()) as MailpitMessageDetail

    expect(detail.Text).toContain(code)
    expect(detail.Text).toContain(teamName)
    expect(detail.Text).toContain('/redeem?code=')
    expect(detail.HTML).toContain(code)
    expect(detail.HTML).toContain(teamName)
  })

  it('runOnce with real handlers processes email.invite, marks done, nulls payload, and delivers email', async () => {
    const dedupeKey = 'test-handler-invite-e2e'
    const to = 'teammate@example.test'
    const teamName = 'Core Ops'
    const code = 'code_e2e_456'

    await withTransaction(async (tx) => {
      await enqueue(tx, {
        type: 'email.invite',
        payload: { to, teamName, code },
        dedupeKey,
      })
    })

    const processed = await runOnce({ handlers })
    expect(processed).toBe(1)

    // Verify row state in database: status is done, payload is NULL (token scrubbed)
    const row = await fetchJob(dedupeKey)
    expect(row.status).toBe('done')
    expect(row.payload).toBeNull()

    // Verify email arrived in Mailpit using vi.waitFor
    await vi.waitFor(
      async () => {
        const res = await fetch(MAILPIT_API)
        const list = (await res.json()) as MailpitList
        const found = list.messages.some(
          (m) => m.To.some((recipient) => recipient.Address === to),
        )
        expect(found).toBe(true)
      },
      { timeout: 5000, interval: 50 },
    )
  })

  it('email.assigned handler throws not implemented stub (to be replaced in Task 4.3)', async () => {
    await expect(handlers['email.assigned']({})).rejects.toThrow('not implemented')
  })
})
