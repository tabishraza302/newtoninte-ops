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
const WORKER_LEASE_SEC_DEFAULT = 300
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
  workerLeaseSec: number
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
  }
  return parsed
}

function envBool(
  env: Record<string, string | undefined>,
  name: string,
  fallback: boolean,
  errors: string[],
): boolean {
  const raw = env[name]
  if (raw === undefined || raw.trim() === '') return fallback
  const value = raw.trim().toLowerCase()
  if (value === 'true' || value === '1') return true
  if (value === 'false' || value === '0') return false
  errors.push(`${name} must be a boolean ('true' | '1' | 'false' | '0'), got: ${raw}`)
  return fallback
}

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const errors: string[] = []

  // Validate/collect everything first; the throw decision comes after all checks.
  const port = numberSetting(env, 'PORT', PORT_DEFAULT, errors)
  const databaseUrl = requireString(env, 'DATABASE_URL', errors)
  const jwtSecret = requireString(env, 'JWT_SECRET', errors)
  const accessTtlSec = numberSetting(env, 'ACCESS_TOKEN_TTL_SEC', ACCESS_TOKEN_TTL_SEC_DEFAULT, errors)
  const refreshTtlSec = numberSetting(env, 'REFRESH_TOKEN_TTL_SEC', REFRESH_TOKEN_TTL_SEC_DEFAULT, errors)
  const refreshGraceSec = numberSetting(env, 'REFRESH_GRACE_SEC', REFRESH_GRACE_SEC_DEFAULT, errors)
  const cookieSecure = envBool(env, 'COOKIE_SECURE', COOKIE_SECURE_DEFAULT, errors)

  const mailDriverRaw = env['MAIL_DRIVER']?.trim()
  let mailDriver: Config['mailDriver'] = MAIL_DRIVER_DEFAULT
  if (mailDriverRaw !== undefined && mailDriverRaw !== '') {
    if (mailDriverRaw === 'resend' || mailDriverRaw === 'mailpit') {
      mailDriver = mailDriverRaw
    } else {
      errors.push(`MAIL_DRIVER must be one of 'resend' | 'mailpit', got: ${mailDriverRaw}`)
    }
  }

  const smtpUrl = env['SMTP_URL']?.trim() || SMTP_URL_DEFAULT
  const mailFrom = env['MAIL_FROM']?.trim() || MAIL_FROM_DEFAULT
  const appBaseUrl = env['APP_BASE_URL']?.trim() || APP_BASE_URL_DEFAULT
  const inviteTtlDays = numberSetting(env, 'INVITE_TTL_DAYS', INVITE_TTL_DAYS_DEFAULT, errors)
  const resetTtlSec = numberSetting(env, 'RESET_TTL_SEC', RESET_TTL_SEC_DEFAULT, errors)
  const workerIntervalMs = numberSetting(env, 'WORKER_INTERVAL_MS', WORKER_INTERVAL_MS_DEFAULT, errors)
  const workerBatchSize = numberSetting(env, 'WORKER_BATCH_SIZE', WORKER_BATCH_SIZE_DEFAULT, errors)
  const workerLeaseSec = numberSetting(env, 'WORKER_LEASE_SEC', WORKER_LEASE_SEC_DEFAULT, errors)
  const idempotencyTtlSec = numberSetting(env, 'IDEMPOTENCY_TTL_SEC', IDEMPOTENCY_TTL_SEC_DEFAULT, errors)

  if (errors.length > 0) {
    throw new Error(`Invalid configuration:\n${errors.map((e) => `  - ${e}`).join('\n')}`)
  }

  return {
    port,
    databaseUrl,
    jwtSecret,
    accessTtlSec,
    refreshTtlSec,
    refreshGraceSec,
    cookieSecure,
    mailDriver,
    smtpUrl,
    mailFrom,
    inviteTtlDays,
    resetTtlSec,
    workerIntervalMs,
    workerBatchSize,
    workerLeaseSec,
    idempotencyTtlSec,
    appBaseUrl,
  }
}

export const config: Config = loadConfig(process.env)
