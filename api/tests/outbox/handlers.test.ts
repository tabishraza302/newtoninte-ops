import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import { resetDb } from '../helpers/db'
import { closeDb, pool } from '../../src/db/client'
import { withTransaction } from '../../src/db/tx'
import { enqueue } from '../../src/services/outbox'
import { runOnce } from '../../src/outbox/worker'
import { emailAssigned, emailInvite, handlers } from '../../src/outbox/handlers'

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

describe('email handlers', () => {
  beforeEach(async () => {
    await resetDb()
  })
  afterAll(closeDb)

  it('emailInvite sends an invitation email to Mailpit with redeem code and link', async () => {
    const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const to = `newuser_${id}@example.test`
    const teamName = `Rocket Scientists ${id}`
    const code = `inv_secret_${id}`

    await emailInvite({ to, teamName, code })

    // Poll Mailpit for the delivered message using vi.waitFor
    const foundMessage = await vi.waitFor(
      async () => {
        const res = await fetch(MAILPIT_API)
        const list = (await res.json()) as MailpitList
        const msg = list.messages.find(
          (m) => m.To.some((recipient) => recipient.Address === to) && m.Subject.includes(teamName),
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
    const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const dedupeKey = `test-handler-invite-${id}`
    const to = `teammate_${id}@example.test`
    const teamName = `Core Ops ${id}`
    const code = `code_e2e_${id}`

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
          (m) => m.To.some((recipient) => recipient.Address === to) && m.Subject.includes(teamName),
        )
        expect(found).toBe(true)
      },
      { timeout: 5000, interval: 50 },
    )
  })

  it('emailAssigned delivers email to Mailpit with item title, team name, and item link', async () => {
    const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const to = `assignee_${id}@example.test`
    const teamName = `Mission Control ${id}`
    const itemTitle = `Engine pressure sensor spike ${id}`
    const itemId = 10000 + Math.floor(Math.random() * 10000)

    await emailAssigned({ to, teamName, itemTitle, itemId })

    const foundMessage = await vi.waitFor(
      async () => {
        const res = await fetch(MAILPIT_API)
        const list = (await res.json()) as MailpitList
        const msg = list.messages.find(
          (m) => m.To.some((recipient) => recipient.Address === to) && m.Subject.includes(itemTitle),
        )
        expect(msg).toBeDefined()
        return msg!
      },
      { timeout: 5000, interval: 50 },
    )

    expect(foundMessage.Subject).toContain(itemTitle)

    const detailRes = await fetch(`http://localhost:8025/api/v1/message/${foundMessage.ID}`)
    const detail = (await detailRes.json()) as MailpitMessageDetail

    expect(detail.Text).toContain(itemTitle)
    expect(detail.Text).toContain(teamName)
    expect(detail.Text).toContain(`/items/${itemId}`)
    expect(detail.HTML).toContain(itemTitle)
    expect(detail.HTML).toContain(teamName)
  })

  it('email.assigned handler rejects invalid payload', async () => {
    await expect(handlers['email.assigned']({})).rejects.toThrow('Invalid email.assigned payload')
  })
})
