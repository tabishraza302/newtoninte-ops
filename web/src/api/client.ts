let accessToken: string | null = null

export function setAccessToken(t: string | null): void {
  accessToken = t
}

export function getAccessToken(): string | null {
  return accessToken
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

export async function apiFetch<T>(path: string, init?: ApiFetchOptions): Promise<T> {
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
    let refreshRes: Response
    try {
      refreshRes = await fetch('/auth/refresh', {
        method: 'POST',
        credentials: 'include',
      })
    } catch (err) {
      setAccessToken(null)
      throw err
    }

    if (refreshRes.ok && refreshRes.status === 200) {
      const data = (await refreshRes.json()) as { accessToken?: string }
      if (typeof data.accessToken === 'string') {
        setAccessToken(data.accessToken)

        const retryHeaders = new Headers(init?.headers)
        retryHeaders.set('Authorization', `Bearer ${data.accessToken}`)
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
          if (retryRes.status === 401) {
            setAccessToken(null)
          }
          const errorBody = await parseResponseBody<unknown>(retryRes)
          throw new ApiError(
            retryRes.status,
            `Request failed with status ${retryRes.status}`,
            errorBody,
          )
        }

        return parseResponseBody<T>(retryRes)
      }
    }

    setAccessToken(null)
    const errBody = await parseResponseBody<unknown>(res)
    throw new ApiError(401, 'Unauthorized', errBody)
  }

  if (!res.ok) {
    const errorBody = await parseResponseBody<unknown>(res)
    throw new ApiError(res.status, `Request failed with status ${res.status}`, errorBody)
  }

  return parseResponseBody<T>(res)
}
