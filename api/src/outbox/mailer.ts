// The outbox worker's mail transport.
//
// One Nodemailer transport is built at module load from `config`. Both drivers
// are real SMTP: `mailpit` (dev/test) points at whatever `config.smtpUrl`
// names, and `resend` (prod) talks to Resend's SMTP endpoint. There is no
// fake, stream or JSON transport in any path.

import nodemailer from 'nodemailer'
import type { Transporter } from 'nodemailer'
import { config } from '../config'

export interface Mail {
  to: string
  subject: string
  text: string
  html?: string
}

/** Resend's SMTP endpoint; the API key rides as the URL password. */
const RESEND_HOST = 'smtp.resend.com'
const RESEND_PORT = 465
const RESEND_USER = 'resend'

/**
 * Reads the Resend API key out of `config.smtpUrl`.
 *
 * `.env.example` documents the production form:
 *   smtp://resend:<RESEND_API_KEY>@smtp.resend.com:465
 * so the key is the URL's password component — no second env var.
 */
function resendPassword(smtpUrl: string): string {
  const encoded = new URL(smtpUrl).password
  if (encoded === '') {
    throw new Error('MAIL_DRIVER=resend requires the API key as the password in SMTP_URL')
  }
  return decodeURIComponent(encoded)
}

function buildTransport(): Transporter {
  if (config.mailDriver === 'resend') {
    return nodemailer.createTransport({
      host: RESEND_HOST,
      port: RESEND_PORT,
      secure: true,
      auth: { user: RESEND_USER, pass: resendPassword(config.smtpUrl) },
    })
  }
  // `mailpit` (dev/test): real SMTP, no auth.
  return nodemailer.createTransport(config.smtpUrl)
}

const transport = buildTransport()

/** Sends one message through the configured transport, from `config.mailFrom`. */
export async function sendMail(mail: Mail): Promise<void> {
  await transport.sendMail({
    from: config.mailFrom,
    to: mail.to,
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
  })
}
