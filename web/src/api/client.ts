let accessToken: string | null = null
let sessionEpoch = 0
let refreshPromise: Promise<string | null> | null = null
let refreshEpoch = 0
let refreshAbortController: AbortController | null = null

export function setAccessToken(t: string | null): void {
  accessToken = t
  sessionEpoch++
  if (refreshAbortController) {
    refreshAbortController.abort()
    refreshAbortController = null
  }
  refreshPromise = null
}
export function getAccessToken(): string | null {
  return accessToken
}

type UnauthorizedHandler = () => void
let onUnauthorizedHandler: UnauthorizedHandler | null = null

export function setOnUnauthorized(handler: UnauthorizedHandler | null): void {
  onUnauthorizedHandler = handler
}
export interface ApiFetchOptions extends RequestInit {
  json?: unknown
}

export class ApiError extends Error {
  status: number
  data?: unknown

  constructor(status: number, message: string, data?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.data = data
  }
}

async function parseResponseBody<T>(res: Response): Promise<T> {
  if (res.status === 204) {
    return undefined as unknown as T
  }
  const text = await res.text()
  if (!text) {
    return undefined as unknown as T
  }
  try {
    return JSON.parse(text) as T
  } catch {
    return text as unknown as T
  }
}

async function requestRefresh(epoch: number): Promise<string | null> {
  if (refreshPromise && refreshEpoch === epoch) {
    return refreshPromise
  }

  refreshEpoch = epoch
  const abortController = new AbortController()
  refreshAbortController = abortController

  const p = (async () => {
    try {
      const res = await fetch('/auth/refresh', {
        method: 'POST',
        credentials: 'include',
        signal: abortController.signal,
      })

      if (sessionEpoch !== epoch || abortController.signal.aborted) {
        return null
      }

      if (res.ok && res.status === 200) {
        const data = (await res.json()) as { accessToken?: string }
        if (sessionEpoch !== epoch || abortController.signal.aborted) {
          return null
        }
        if (typeof data.accessToken === 'string') {
          // Internal assignment preserves current session epoch
          accessToken = data.accessToken
          return data.accessToken
        }
      }

      // Refresh failed or returned invalid payload
      if (sessionEpoch === epoch && !abortController.signal.aborted) {
        accessToken = null
        sessionEpoch++
        onUnauthorizedHandler?.()
      }
      return null
    } catch (err) {
      if (abortController.signal.aborted || sessionEpoch !== epoch) {
        return null
      }
      accessToken = null
      sessionEpoch++
      onUnauthorizedHandler?.()
      throw err
    } finally {
      if (refreshEpoch === epoch) {
        refreshPromise = null
      }
      if (refreshAbortController === abortController) {
        refreshAbortController = null
      }
    }
  })()

  refreshPromise = p
  return p
}

export async function apiFetch<T>(path: string, init?: ApiFetchOptions): Promise<T> {
  const requestEpoch = sessionEpoch
  const requestToken = accessToken
  const headers = new Headers(init?.headers)

  if (accessToken) {
    headers.set('Authorization', `Bearer ${accessToken}`)
  }
  let body = init?.body
  if (init?.json !== undefined) {
    body = JSON.stringify(init.json)
    if (!headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json')
    }
  }

  const { json: _json, ...baseInit } = init ?? {}
  const reqInit: RequestInit = {
    ...baseInit,
    headers,
    credentials: 'include',
    ...(body !== undefined ? { body } : {}),
  }
  const res = await fetch(path, reqInit)

  if (res.status === 401) {
    const errBody = await parseResponseBody<unknown>(res)

    // Skip automatic refresh on login, refresh, and password auth endpoints
    const pathname = path.startsWith('http://') || path.startsWith('https://')
      ? new URL(path).pathname
      : (path.split('?')[0] ?? '').split('#')[0] ?? ''

    const isAuthEndpoint =
      pathname === '/auth/login' ||
      pathname === '/auth/refresh' ||
      pathname.startsWith('/auth/password/') ||
      pathname === '/auth/logout'

    if (isAuthEndpoint) {
      throw new ApiError(401, 'Unauthorized', errBody)
    }

    // If session changed while request was in-flight, do not refresh or replay
    if (sessionEpoch !== requestEpoch) {
      throw new ApiError(401, 'Unauthorized', errBody)
    }

    // If another concurrent request in this epoch already refreshed the token,
    // reuse the current token instead of rotating again.
    let refreshedToken: string | null = null
    if (accessToken !== null && accessToken !== requestToken) {
      refreshedToken = accessToken
    } else {
      refreshedToken = await requestRefresh(requestEpoch)
    }

    // If session changed during refresh, or refresh failed to produce a token
    if (sessionEpoch !== requestEpoch || !refreshedToken) {
      throw new ApiError(401, 'Unauthorized', errBody)
    }
    const retryHeaders = new Headers(init?.headers)
    retryHeaders.set('Authorization', `Bearer ${refreshedToken}`)
    if (init?.json !== undefined && !retryHeaders.has('Content-Type')) {
      retryHeaders.set('Content-Type', 'application/json')
    }

    const retryInit: RequestInit = {
      ...baseInit,
      headers: retryHeaders,
      credentials: 'include',
      ...(body !== undefined ? { body } : {}),
    }

    const retryRes = await fetch(path, retryInit)
    if (!retryRes.ok) {
      if (retryRes.status === 401 && sessionEpoch === requestEpoch) {
        accessToken = null
        sessionEpoch++
        onUnauthorizedHandler?.()
      }
      const retryErrorBody = await parseResponseBody<unknown>(retryRes)
      throw new ApiError(
        retryRes.status,
        `Request failed with status ${retryRes.status}`,
        retryErrorBody,
      )
    }

    const retryParsed = await parseResponseBody<T>(retryRes)
    if (sessionEpoch !== requestEpoch) {
      throw new ApiError(401, 'Unauthorized', undefined)
    }

    return retryParsed
  }

  if (!res.ok) {
    const errorBody = await parseResponseBody<unknown>(res)
    throw new ApiError(res.status, `Request failed with status ${res.status}`, errorBody)
  }

  const parsed = await parseResponseBody<T>(res)
  if (sessionEpoch !== requestEpoch) {
    throw new ApiError(401, 'Unauthorized', undefined)
  }

  return parsed
}
