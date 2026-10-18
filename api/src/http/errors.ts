// The API's single error vocabulary. Every route, service and middleware
// raises failures through `ApiError.of(...)` and lets the error middleware
// (task 1.11) render them with `toEnvelope(...)`, so that the wire format —
// `{ error: { code, message, details? } }` — is identical everywhere and
// clients can switch on `code` rather than on prose.

/**
 * Every error code the API may emit. Clients branch on these; treat them as
 * part of the public contract and never rename one without a migration.
 */
export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VERSION_CONFLICT'
  | 'STALE_STATE'
  | 'ALREADY_CLAIMED'
  | 'INVALID_TRANSITION'
  | 'IDEMPOTENCY_KEY_MISMATCH'
  | 'LAST_LEAD'
  | 'ALREADY_MEMBER'
  | 'INVITE_EXHAUSTED'
  | 'INVITE_EXPIRED'
  | 'INVITE_REVOKED'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR'
  | 'USER_CREATION_DISABLED'
  | 'EMAIL_TAKEN'

/**
 * Code -> HTTP status, verbatim from the plan's Global Constraints table.
 * `Record<ErrorCode, number>` keeps this exhaustive: adding a code without a
 * status is a compile error.
 */
export const ERROR_STATUS: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 422,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VERSION_CONFLICT: 409,
  STALE_STATE: 409,
  ALREADY_CLAIMED: 409,
  INVALID_TRANSITION: 422,
  IDEMPOTENCY_KEY_MISMATCH: 422,
  LAST_LEAD: 422,
  ALREADY_MEMBER: 409,
  INVITE_EXHAUSTED: 409,
  INVITE_EXPIRED: 409,
  INVITE_REVOKED: 409,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
  USER_CREATION_DISABLED: 403,
  EMAIL_TAKEN: 409,
}

/**
 * Fallback copy for when a caller passes no message. Human-readable only —
 * clients must not match on it.
 */
const DEFAULT_MESSAGES: Record<ErrorCode, string> = {
  VALIDATION_ERROR: 'Validation failed',
  UNAUTHENTICATED: 'Authentication required',
  FORBIDDEN: 'Forbidden',
  NOT_FOUND: 'Not found',
  VERSION_CONFLICT: 'Version conflict',
  STALE_STATE: 'Stale state',
  ALREADY_CLAIMED: 'Already claimed',
  INVALID_TRANSITION: 'Invalid transition',
  IDEMPOTENCY_KEY_MISMATCH: 'Idempotency key mismatch',
  LAST_LEAD: 'At least one lead must remain',
  ALREADY_MEMBER: 'Already a member',
  INVITE_EXHAUSTED: 'Invite exhausted',
  INVITE_EXPIRED: 'Invite expired',
  INVITE_REVOKED: 'Invite revoked',
  RATE_LIMITED: 'Too many requests',
  INTERNAL_ERROR: 'Internal server error',
  USER_CREATION_DISABLED: 'User creation is disabled',
  EMAIL_TAKEN: 'Email already taken',
}

/**
 * An expected, classified API failure. Prefer `ApiError.of()` so the status
 * always comes from `ERROR_STATUS` and never drifts.
 */
export class ApiError extends Error {
  readonly code: ErrorCode
  readonly status: number
  readonly details?: unknown

  constructor(code: ErrorCode, message?: string, details?: unknown) {
    super(message ?? DEFAULT_MESSAGES[code])
    this.name = 'ApiError'
    this.code = code
    this.status = ERROR_STATUS[code]
    this.details = details
  }

  static of(code: ErrorCode, message?: string, details?: unknown): ApiError {
    return new ApiError(code, message, details)
  }
}

/**
 * Renders any thrown value into `{ status, body }` for the HTTP layer.
 *
 * `ApiError`s keep their code/status/details. Anything else is a bug we did
 * not plan for: it becomes a generic 500 and its message is deliberately
 * swallowed so internal details never leak to clients (log it upstream
 * instead).
 */
export function toEnvelope(err: unknown): {
  status: number
  body: { error: { code: ErrorCode; message: string; details?: unknown } }
} {
  if (err instanceof ApiError) {
    return {
      status: err.status,
      body: {
        error: {
          code: err.code,
          message: err.message,
          ...(err.details === undefined ? {} : { details: err.details }),
        },
      },
    }
  }

  // Express / body-parser syntax error on malformed JSON payload (client error, not 500)
  if (err && typeof err === 'object') {
    const status = 'status' in err ? err.status : undefined
    const type = 'type' in err ? err.type : undefined

    if (
      (err instanceof SyntaxError && status === 400) ||
      type === 'entity.parse.failed'
    ) {
      return {
        status: ERROR_STATUS.VALIDATION_ERROR,
        body: {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Malformed JSON payload',
          },
        },
      }
    }

    // Express / body-parser payload too large
    if (status === 413 || type === 'entity.too.large') {
      return {
        status: 413,
        body: {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Payload too large',
          },
        },
      }
    }
  }
  return {
    status: ERROR_STATUS.INTERNAL_ERROR,
    body: {
      error: {
        code: 'INTERNAL_ERROR',
        message: DEFAULT_MESSAGES.INTERNAL_ERROR,
      },
    },
  }
}
