// Pure email templates for the outbox worker.
//
// Each function takes plain data and returns the three fields a Nodemailer
// message needs, so templates can be unit-tested without a transport. Every
// interpolated value is HTML-escaped before it reaches the markup; links are
// escaped as an `href` value so query parameters stay intact in a browser.

export interface EmailContent {
  subject: string
  text: string
  html: string
}

/** Escapes text so it is inert inside an HTML document. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Renders `url` as an anchor whose visible label is escaped text. */
function linkHtml(url: string, label: string): string {
  return `<a href="${escapeHtml(url)}">${escapeHtml(label)}</a>`
}

/** Invitation to join a team. */
export function inviteEmail(a: { teamName: string; link: string }): EmailContent {
  const subject = `You're invited to ${a.teamName}`
  const text =
    `You've been invited to join ${a.teamName}.\n\n` +
    `Accept your invitation here:\n${a.link}\n`
  const html =
    `<p>You've been invited to join <strong>${escapeHtml(a.teamName)}</strong>.</p>\n` +
    `<p>${linkHtml(a.link, 'Accept your invitation')}</p>\n`
  return { subject, text, html }
}

/** Password reset link. */
export function resetEmail(a: { link: string }): EmailContent {
  const subject = 'Reset your Newtonite password'
  const text =
    `We received a request to reset your password.\n\n` +
    `Reset it here:\n${a.link}\n\n` +
    `If you didn't ask for this, you can ignore this email.\n`
  const html =
    `<p>We received a request to reset your password.</p>\n` +
    `<p>${linkHtml(a.link, 'Reset your password')}</p>\n` +
    `<p>If you didn't ask for this, you can ignore this email.</p>\n`
  return { subject, text, html }
}

/** Notice that a work item was assigned to the recipient. */
export function assignedEmail(a: { itemTitle: string; teamName: string; link: string }): EmailContent {
  const subject = `Assigned to you: ${a.itemTitle}`
  const text =
    `You've been assigned "${a.itemTitle}" in ${a.teamName}.\n\n` +
    `View it here:\n${a.link}\n`
  const html =
    `<p>You've been assigned <strong>${escapeHtml(a.itemTitle)}</strong> ` +
    `in ${escapeHtml(a.teamName)}.</p>\n` +
    `<p>${linkHtml(a.link, 'View the item')}</p>\n`
  return { subject, text, html }
}
