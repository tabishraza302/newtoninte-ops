import { config } from '../config'
import { sendMail } from './mailer'
import { assignedEmail, inviteEmail, resetEmail } from './templates'
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
    typeof payload.to === 'string' &&
    'teamName' in payload &&
    typeof payload.teamName === 'string' &&
    'code' in payload &&
    typeof payload.code === 'string'
  ) {
    return {
      to: payload.to,
      teamName: payload.teamName,
      code: payload.code,
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
export interface EmailResetParams {
  to: string
  code: string
}

function parseEmailResetParams(payload: unknown): EmailResetParams {
  if (
    typeof payload === 'object' &&
    payload !== null &&
    'to' in payload &&
    typeof payload.to === 'string' &&
    'code' in payload &&
    typeof payload.code === 'string'
  ) {
    return {
      to: payload.to,
      code: payload.code,
    }
  }
  throw new Error('Invalid email.reset payload: expected { to, code }')
}

/**
 * Builds the password reset link `${config.appBaseUrl}/reset-password?token=${code}`
 * and sends the reset email via Nodemailer.
 */
export async function emailReset(p: EmailResetParams): Promise<void> {
  const link = `${config.appBaseUrl}/reset-password?token=${encodeURIComponent(p.code)}`
  const { subject, text, html } = resetEmail({ link })
  await sendMail({ to: p.to, subject, text, html })
}

export interface EmailAssignedParams {
  to: string
  itemTitle: string
  teamName: string
  itemId: number
}

function parseEmailAssignedParams(payload: unknown): EmailAssignedParams {
  if (
    typeof payload === 'object' &&
    payload !== null &&
    'to' in payload &&
    typeof payload.to === 'string' &&
    'itemTitle' in payload &&
    typeof payload.itemTitle === 'string' &&
    'teamName' in payload &&
    typeof payload.teamName === 'string' &&
    'itemId' in payload &&
    typeof payload.itemId === 'number'
  ) {
    return {
      to: payload.to,
      itemTitle: payload.itemTitle,
      teamName: payload.teamName,
      itemId: payload.itemId,
    }
  }
  throw new Error('Invalid email.assigned payload: expected { to, itemTitle, teamName, itemId }')
}

/**
 * Builds the item link `${config.appBaseUrl}/items/${itemId}`
 * and sends the assigned email via Nodemailer.
 */
export async function emailAssigned(p: EmailAssignedParams): Promise<void> {
  const link = `${config.appBaseUrl}/items/${p.itemId}`
  const { subject, text, html } = assignedEmail({ itemTitle: p.itemTitle, teamName: p.teamName, link })
  await sendMail({ to: p.to, subject, text, html })
}

/**
 * Registry of handlers for outbox jobs.
 */
export const handlers: Record<OutboxJobType, JobHandler> = {
  'email.invite': async (payload: unknown) => {
    const params = parseEmailInviteParams(payload)
    await emailInvite(params)
  },
  'email.reset': async (payload: unknown) => {
    const params = parseEmailResetParams(payload)
    await emailReset(params)
  },
  'email.assigned': async (payload: unknown) => {
    const params = parseEmailAssignedParams(payload)
    await emailAssigned(params)
  },
}
