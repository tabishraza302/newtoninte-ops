import { describe, it, expect } from 'vitest'
import { sendMail } from '../../src/outbox/mailer'
import { inviteEmail, resetEmail, assignedEmail } from '../../src/outbox/templates'

// Mailpit is the dev/test SMTP sink; its HTTP API is where a delivered message
// can be observed. This is the same server the mailer talks to over SMTP.
const MAILPIT_API = 'http://localhost:8025/api/v1/messages'

/** The subset of Mailpit's message shape this test relies on (verified live). */
interface MailpitAddress {
  Name: string
  Address: string
}
interface MailpitMessage {
  Subject: string
  To: MailpitAddress[]
}
interface MailpitList {
  messages: MailpitMessage[]
}

describe('templates', () => {
  it('inviteEmail interpolates the link and team name into subject, text and html', () => {
    const link = 'https://app.example.test/invite?token=inv_abc123'
    const msg = inviteEmail({ teamName: 'Acme Rockets', link })

    expect(msg.subject.length).toBeGreaterThan(0)
    expect(msg.text).toContain(link)
    expect(msg.text).toContain('Acme Rockets')
    expect(msg.html).toContain(link)
    expect(msg.html).toContain('Acme Rockets')
    expect(msg.html.length).toBeGreaterThan(0)
  })

  it('resetEmail interpolates the link into subject, text and html', () => {
    const link = 'https://app.example.test/reset?token=rst_abc123'
    const msg = resetEmail({ link })

    expect(msg.subject.length).toBeGreaterThan(0)
    expect(msg.text).toContain(link)
    expect(msg.html).toContain(link)
    expect(msg.html.length).toBeGreaterThan(0)
  })

  it('assignedEmail interpolates the item title, team name and link', () => {
    const link = 'https://app.example.test/items/item_abc123'
    const msg = assignedEmail({ itemTitle: 'Ship the outbox', teamName: 'Acme Rockets', link })

    expect(msg.subject.length).toBeGreaterThan(0)
    expect(msg.text).toContain(link)
    expect(msg.text).toContain('Ship the outbox')
    expect(msg.text).toContain('Acme Rockets')
    expect(msg.html).toContain(link)
    expect(msg.html).toContain('Ship the outbox')
    expect(msg.html).toContain('Acme Rockets')
    expect(msg.html.length).toBeGreaterThan(0)
  })
})

describe.skipIf(!process.env.SMTP_URL)('sendMail (real SMTP via Mailpit)', () => {
  it('delivers a message that Mailpit actually receives', async () => {
    // Clear the mailbox first so a message from an earlier run cannot make this
    // assertion pass falsely.
    const cleared = await fetch(MAILPIT_API, { method: 'DELETE' })
    expect(cleared.ok).toBe(true)

    const to = 'to@example.test'
    const subject = `mailer-it-${Date.now()}-${Math.random().toString(36).slice(2)}`

    await sendMail({ to, subject, text: 'integration body', html: '<p>integration body</p>' })

    // Delivery is effectively synchronous, but poll with a bounded deadline so
    // a slow write cannot make the test flaky.
    const deadline = Date.now() + 5000
    let found = false
    while (!found && Date.now() < deadline) {
      const res = await fetch(MAILPIT_API)
      const body = (await res.json()) as MailpitList
      found = body.messages.some(
        (m) => m.Subject === subject && m.To.some((r) => r.Address === to),
      )
      if (!found) await new Promise((resolve) => setTimeout(resolve, 150))
    }

    expect(found).toBe(true)
  }, 15000)
})
