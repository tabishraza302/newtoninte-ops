import { config } from '../config'
import { sendMail } from './mailer'
import { inviteEmail } from './templates'
import type { JobHandler } from './worker'
import type { OutboxJobType } from '../domain/types'

export interface EmailInviteParams {
  to: string
  teamName: string
  code: string
}

function parseEmailInviteParams(payload: unknown): EmailInviteParams {
  if (
    typeof payload === 'object' &&
    payload !== null &&
    'to' in payload &&
    'teamName' in payload &&
    'code' in payload
  ) {
    const candidate = payload as Record<string, unknown>
    if (
      typeof candidate.to === 'string' &&
      typeof candidate.teamName === 'string' &&
      typeof candidate.code === 'string'
    ) {
      return {
        to: candidate.to,
        teamName: candidate.teamName,
        code: candidate.code,
      }
    }
  }
  throw new Error('Invalid email.invite payload: expected { to, teamName, code }')
}

/**
 * Builds the invitation redeem link `${config.appBaseUrl}/redeem?code=${code}`
 * and sends the invite email via Nodemailer.
 */
export async function emailInvite(p: EmailInviteParams): Promise<void> {
  const link = `${config.appBaseUrl}/redeem?code=${encodeURIComponent(p.code)}`
  const { subject, text, html } = inviteEmail({ teamName: p.teamName, link })
  await sendMail({ to: p.to, subject, text, html })
}

/**
 * Registry of handlers for outbox jobs.
 * `email.reset` and `email.assigned` are plan-mandated stubs replaced in Tasks 2.14 and 4.3.
 */
export const handlers: Record<OutboxJobType, JobHandler> = {
  'email.invite': async (payload: unknown) => {
    const params = parseEmailInviteParams(payload)
    await emailInvite(params)
  },
  'email.reset': async () => {
    // TODO(task 2.14): password reset email handler
    throw new Error('email.reset handler not implemented')
  },
  'email.assigned': async () => {
    // TODO(task 4.3): work item assigned notification handler
    throw new Error('email.assigned handler not implemented')
  },
}
