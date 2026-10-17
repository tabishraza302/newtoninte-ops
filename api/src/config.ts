const ACCESS_TOKEN_TTL_SEC_DEFAULT = 900
const REFRESH_TOKEN_TTL_SEC_DEFAULT = 2592000
const REFRESH_GRACE_SEC_DEFAULT = 10
const COOKIE_SECURE_DEFAULT = false
const MAIL_DRIVER_DEFAULT = 'mailpit' as const
const SMTP_URL_DEFAULT = 'smtp://mailpit:1025'
const MAIL_FROM_DEFAULT = 'Newtonite Ops <no-reply@localhost>'
const APP_BASE_URL_DEFAULT = 'http://localhost:5173'
const INVITE_TTL_DAYS_DEFAULT = 7
const RESET_TTL_SEC_DEFAULT = 3600
const IDEMPOTENCY_TTL_SEC_DEFAULT = 86400
const WORKER_INTERVAL_MS_DEFAULT = 3000
const WORKER_BATCH_SIZE_DEFAULT = 10
const PORT_DEFAULT = 3000

export interface Config {
  port: number
  databaseUrl: string
  jwtSecret: string
  accessTtlSec: number
  refreshTtlSec: number
  refreshGraceSec: number
  cookieSecure: boolean
  mailDriver: 'resend' | 'mailpit'
  smtpUrl: string
  mailFrom: string
  inviteTtlDays: number
  resetTtlSec: number
  workerIntervalMs: number
  workerBatchSize: number
  idempotencyTtlSec: number
  appBaseUrl: string
}

function requireString(env: Record<string, string | undefined>, name: string, errors: string[]): string {
  const value = env[name]
  if (typeof value !== 'string' || value.trim() === '') {
    errors.push(`Missing required environment variable: ${name}`)
    return ''
  }
  return value
}

function numberSetting(
  env: Record<string, string | undefined>,
  name: string,
  fallback: number,
  errors: string[],
): number {
  const raw = env[name]
  if (raw === undefined || raw.trim() === '') return fallback
  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) {
    errors.push(`${name} must be a finite number, got: ${raw}`)
    return fallback
  }
  return parsed
}

function envBool(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw.trim() === '') return fallback
  const value = raw.trim().toLowerCase()
  if (value === 'true' || value === '1') return true
  if (value === 'false' || value === '0') return false
  return fallback
}

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const errors: string[] = []

  const databaseUrl = requireString(env, 'DATABASE_URL', errors)
  const jwtSecret = requireString(env, 'JWT_SECRET', errors)

  const mailDriverRaw = env['MAIL_DRIVER']?.trim()
  let mailDriver: Config['mailDriver'] = MAIL_DRIVER_DEFAULT
  if (mailDriverRaw !== undefined && mailDriverRaw !== '') {
    if (mailDriverRaw === 'resend' || mailDriverRaw === 'mailpit') {
      mailDriver = mailDriverRaw
    } else {
      errors.push(`MAIL_DRIVER must be one of 'resend' | 'mailpit', got: ${mailDriverRaw}`)
    }
  }

  if (errors.length > 0) {
    throw new Error(`Invalid configuration:\n${errors.map((e) => `  - ${e}`).join('\n')}`)
  }

  return {
    port: numberSetting(env, 'PORT', PORT_DEFAULT, errors),
    databaseUrl,
    jwtSecret,
    accessTtlSec: numberSetting(env, 'ACCESS_TOKEN_TTL_SEC', ACCESS_TOKEN_TTL_SEC_DEFAULT, errors),
    refreshTtlSec: numberSetting(env, 'REFRESH_TOKEN_TTL_SEC', REFRESH_TOKEN_TTL_SEC_DEFAULT, errors),
    refreshGraceSec: numberSetting(env, 'REFRESH_GRACE_SEC', REFRESH_GRACE_SEC_DEFAULT, errors),
    cookieSecure: envBool(env['COOKIE_SECURE'], COOKIE_SECURE_DEFAULT),
    mailDriver,
    smtpUrl: env['SMTP_URL']?.trim() || SMTP_URL_DEFAULT,
    mailFrom: env['MAIL_FROM']?.trim() || MAIL_FROM_DEFAULT,
    inviteTtlDays: numberSetting(env, 'INVITE_TTL_DAYS', INVITE_TTL_DAYS_DEFAULT, errors),
    resetTtlSec: numberSetting(env, 'RESET_TTL_SEC', RESET_TTL_SEC_DEFAULT, errors),
    workerIntervalMs: numberSetting(env, 'WORKER_INTERVAL_MS', WORKER_INTERVAL_MS_DEFAULT, errors),
    workerBatchSize: numberSetting(env, 'WORKER_BATCH_SIZE', WORKER_BATCH_SIZE_DEFAULT, errors),
    idempotencyTtlSec: numberSetting(env, 'IDEMPOTENCY_TTL_SEC', IDEMPOTENCY_TTL_SEC_DEFAULT, errors),
    appBaseUrl: env['APP_BASE_URL']?.trim() || APP_BASE_URL_DEFAULT,
  }
}

export const config: Config = loadConfig(process.env)
