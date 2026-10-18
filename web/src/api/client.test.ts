import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiFetch, getAccessToken, setAccessToken, setOnUnauthorized, ApiError } from './client'

function createDeferred<T>() {
  let resolve!: (val: T) => void
  let reject!: (err: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('api client', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    setOnUnauthorized(null)
    setAccessToken(null)
  })

  afterEach(() => {
    setOnUnauthorized(null)
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })
  it('sends Authorization header and json content-type when token and payload are set', async () => {
    setAccessToken('initial-token')

    const mockFetch = vi.fn().mockImplementation(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers)
      expect(headers.get('Authorization')).toBe('Bearer initial-token')
      expect(headers.get('Content-Type')).toBe('application/json')
      expect(init?.credentials).toBe('include')
      expect(init?.body).toBe(JSON.stringify({ hello: 'world' }))

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })

    globalThis.fetch = mockFetch

    const result = await apiFetch<{ ok: boolean }>('/items', {
      method: 'POST',
      json: { hello: 'world' },
    })

    expect(result).toEqual({ ok: true })
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('triggers /auth/refresh once on 401, stores new token, and replays request', async () => {
    setAccessToken('expired-token')

    const fetchHistory: string[] = []

    const mockFetch = vi.fn().mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      fetchHistory.push(url)

      if (url === '/items' && fetchHistory.length === 1) {
        const headers = new Headers(init?.headers)
        expect(headers.get('Authorization')).toBe('Bearer expired-token')
        return new Response(JSON.stringify({ error: 'token expired' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      if (url === '/auth/refresh') {
        expect(init?.method).toBe('POST')
        expect(init?.credentials).toBe('include')
        return new Response(
          JSON.stringify({ accessToken: 'renewed-token', user: { id: 1 } }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        )
      }

      if (url === '/items' && fetchHistory.length === 3) {
        const headers = new Headers(init?.headers)
        expect(headers.get('Authorization')).toBe('Bearer renewed-token')
        return new Response(JSON.stringify({ data: 'item-list' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      throw new Error(`Unexpected request to ${url}`)
    })

    globalThis.fetch = mockFetch

    const result = await apiFetch<{ data: string }>('/items')

    expect(result).toEqual({ data: 'item-list' })
    expect(getAccessToken()).toBe('renewed-token')
    expect(mockFetch).toHaveBeenCalledTimes(3)
    expect(fetchHistory).toEqual(['/items', '/auth/refresh', '/items'])
  })

  it('clears token and throws error if replay returns second 401', async () => {
    setAccessToken('stale-token')

    const mockFetch = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()

      if (url === '/items') {
        return new Response(JSON.stringify({ error: 'unauthorized' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      if (url === '/auth/refresh') {
        return new Response(
          JSON.stringify({ accessToken: 'rotated-token' }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        )
      }

      throw new Error(`Unexpected request to ${url}`)
    })

    globalThis.fetch = mockFetch

    await expect(apiFetch('/items')).rejects.toThrow()
    expect(getAccessToken()).toBeNull()
  })

  it('clears token and throws error if /auth/refresh returns 401', async () => {
    setAccessToken('stale-token')

    const mockFetch = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()

      if (url === '/items') {
        return new Response(JSON.stringify({ error: 'unauthorized' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      if (url === '/auth/refresh') {
        return new Response(JSON.stringify({ error: 'session invalid' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      throw new Error(`Unexpected request to ${url}`)
    })

    globalThis.fetch = mockFetch

    await expect(apiFetch('/items')).rejects.toThrow()
    expect(getAccessToken()).toBeNull()
  })

  it('clears token and throws error if /auth/refresh rejects with network failure', async () => {
    setAccessToken('stale-token')
    const unauthorizedSpy = vi.fn()
    setOnUnauthorized(unauthorizedSpy)

    const mockFetch = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()

      if (url === '/items') {
        return new Response(JSON.stringify({ error: 'unauthorized' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      if (url === '/auth/refresh') {
        throw new TypeError('Network failure')
      }

      throw new Error(`Unexpected request to ${url}`)
    })

    globalThis.fetch = mockFetch

    await expect(apiFetch('/items')).rejects.toThrow('Network failure')
    expect(getAccessToken()).toBeNull()
    expect(unauthorizedSpy).toHaveBeenCalledTimes(1)
  })

  it('deduplicates concurrent 401s to a single /auth/refresh and replays each request', async () => {
    setAccessToken('expired-token')
    let refreshCallCount = 0
    const deferredRefresh = createDeferred<Response>()
    const refreshStarted = createDeferred<void>()

    const mockFetch = vi.fn().mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      const headers = new Headers(init?.headers)
      const auth = headers.get('Authorization')

      if (url === '/items/1') {
        if (auth === 'Bearer expired-token') {
          return new Response(JSON.stringify({ error: 'unauthorized' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        if (auth === 'Bearer singleflight-token') {
          return new Response(JSON.stringify({ id: 1, title: 'Item 1' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }
      }

      if (url === '/items/2') {
        if (auth === 'Bearer expired-token') {
          return new Response(JSON.stringify({ error: 'unauthorized' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        if (auth === 'Bearer singleflight-token') {
          return new Response(JSON.stringify({ id: 2, title: 'Item 2' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }
      }

      if (url === '/auth/refresh') {
        refreshCallCount++
        refreshStarted.resolve()
        return deferredRefresh.promise
      }

      throw new Error(`Unexpected request to ${url}`)
    })

    globalThis.fetch = mockFetch

    const p1 = apiFetch<{ id: number; title: string }>('/items/1')
    const p2 = apiFetch<{ id: number; title: string }>('/items/2')

    // Wait for the single-flight refresh to start
    await refreshStarted.promise

    expect(refreshCallCount).toBe(1)

    deferredRefresh.resolve(
      new Response(JSON.stringify({ accessToken: 'singleflight-token' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    const [res1, res2] = await Promise.all([p1, p2])

    expect(res1).toEqual({ id: 1, title: 'Item 1' })
    expect(res2).toEqual({ id: 2, title: 'Item 2' })
    expect(refreshCallCount).toBe(1)
    expect(getAccessToken()).toBe('singleflight-token')
  })

  it('late 401 resolving after first refresh and retry completed reuses refreshed token without second refresh', async () => {
    setAccessToken('token-1')
    let refreshCalls = 0
    const deferredReq2 = createDeferred<Response>()
    const deferredRefresh = createDeferred<Response>()
    const refreshStarted = createDeferred<void>()

    const mockFetch = vi.fn().mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      const headers = new Headers(init?.headers)
      const auth = headers.get('Authorization')

      if (url === '/items/1') {
        if (auth === 'Bearer token-1') {
          return new Response(JSON.stringify({ error: 'unauthorized' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        if (auth === 'Bearer token-2') {
          return new Response(JSON.stringify({ data: 'item-1-ok' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }
      }

      if (url === '/items/2') {
        if (auth === 'Bearer token-1') {
          return deferredReq2.promise
        }
        if (auth === 'Bearer token-2') {
          return new Response(JSON.stringify({ data: 'item-2-ok' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }
      }

      if (url === '/auth/refresh') {
        refreshCalls++
        refreshStarted.resolve()
        return deferredRefresh.promise
      }

      throw new Error(`Unexpected request to ${url}`)
    })

    globalThis.fetch = mockFetch

    // Both requests sent with token-1
    const p1 = apiFetch<{ data: string }>('/items/1')
    const p2 = apiFetch<{ data: string }>('/items/2')

    // Wait for req1 401 to trigger refresh
    await refreshStarted.promise
    expect(refreshCalls).toBe(1)

    // Complete refresh for req1
    deferredRefresh.resolve(
      new Response(JSON.stringify({ accessToken: 'token-2' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    // Req 1 completes its retry and resolves
    const res1 = await p1
    expect(res1).toEqual({ data: 'item-1-ok' })
    expect(getAccessToken()).toBe('token-2')

    // Now Req 2's initial 401 arrives late (after refresh and retry for Req 1 already finished!)
    deferredReq2.resolve(
      new Response(JSON.stringify({ error: 'unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    const res2 = await p2
    expect(res2).toEqual({ data: 'item-2-ok' })

    // Exactly one refresh occurred, both requests succeeded!
    expect(refreshCalls).toBe(1)
    expect(getAccessToken()).toBe('token-2')
  })

  it('does not restore tokens or retry when logout occurs while refresh is pending', async () => {
    setAccessToken('stale-token')
    const deferredRefresh = createDeferred<Response>()
    const refreshStarted = createDeferred<void>()

    const mockFetch = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url === '/items') {
        return new Response(JSON.stringify({ error: 'unauthorized' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (url === '/auth/refresh') {
        refreshStarted.resolve()
        return deferredRefresh.promise
      }
      throw new Error(`Unexpected request to ${url}`)
    })

    globalThis.fetch = mockFetch

    const requestPromise = apiFetch('/items')

    await refreshStarted.promise

    // User logs out while refresh is in-flight
    setAccessToken(null)

    deferredRefresh.resolve(
      new Response(JSON.stringify({ accessToken: 'late-restored-token' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    await expect(requestPromise).rejects.toThrow(ApiError)
    expect(getAccessToken()).toBeNull()
  })

  it('does not refresh or replay when old request gets 401 after account switch', async () => {
    setAccessToken('user-a-token')
    let refreshCalls = 0
    let replayCalls = 0
    const deferredRequest = createDeferred<Response>()

    const mockFetch = vi.fn().mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      const headers = new Headers(init?.headers)
      const auth = headers.get('Authorization')

      if (url === '/user-data') {
        if (auth === 'Bearer user-a-token') {
          return deferredRequest.promise
        }
        if (auth === 'Bearer user-b-token') {
          replayCalls++
          return new Response(JSON.stringify({ user: 'B' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }
      }

      if (url === '/auth/refresh') {
        refreshCalls++
        return new Response(JSON.stringify({ accessToken: 'refreshed' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      throw new Error(`Unexpected request to ${url}`)
    })

    globalThis.fetch = mockFetch

    const requestPromise = apiFetch('/user-data')

    // Switch account while request is in flight
    setAccessToken('user-b-token')

    // Now old request gets 401
    deferredRequest.resolve(
      new Response(JSON.stringify({ error: 'revoked' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    await expect(requestPromise).rejects.toThrow(ApiError)
    expect(refreshCalls).toBe(0)
    expect(replayCalls).toBe(0)
    expect(getAccessToken()).toBe('user-b-token')
  })
  it('stale API 200 response completed after account switch is rejected and not applied under new account', async () => {
    setAccessToken('user-a-token')
    const deferredRequest = createDeferred<Response>()

    const mockFetch = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url === '/sensitive-items') {
        return deferredRequest.promise
      }
      throw new Error(`Unexpected request to ${url}`)
    })

    globalThis.fetch = mockFetch

    const requestPromise = apiFetch('/sensitive-items')

    // User switches to account B while request is in flight
    setAccessToken('user-b-token')

    // Now user A's request completes with 200 OK
    deferredRequest.resolve(
      new Response(JSON.stringify({ secretData: 'User A Secrets' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    // Stale response must be rejected, not returned
    await expect(requestPromise).rejects.toThrow(ApiError)
    expect(getAccessToken()).toBe('user-b-token')
  })

  it('rejects stale response when session switches while body parsing is deferred', async () => {
    setAccessToken('account-a-token')
    const deferredBody = createDeferred<string>()

    const mockFetch = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url === '/deferred-stream') {
        return {
          status: 200,
          ok: true,
          headers: new Headers({ 'Content-Type': 'application/json' }),
          text: () => deferredBody.promise,
        } as unknown as Response
      }
      throw new Error(`Unexpected request to ${url}`)
    })

    globalThis.fetch = mockFetch

    const reqPromise = apiFetch('/deferred-stream')

    // Response headers arrived, now switch session while body text is reading
    setAccessToken('account-b-token')

    // Body stream finishes
    deferredBody.resolve(JSON.stringify({ secret: 'account-a-data' }))

    // Must reject stale response immediately after body parse
    await expect(reqPromise).rejects.toThrow(ApiError)
    expect(getAccessToken()).toBe('account-b-token')
  })

  it('notifies unauthorized handler once and preserves error body on exhausted refresh', async () => {
    setAccessToken('stale-token')
    const unauthorizedSpy = vi.fn()
    setOnUnauthorized(unauthorizedSpy)
    const deferredRefresh = createDeferred<Response>()
    const refreshStarted = createDeferred<void>()

    const mockFetch = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url === '/item-a') {
        return new Response(JSON.stringify({ error: 'expired a' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (url === '/item-b') {
        return new Response(JSON.stringify({ error: 'expired b' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (url === '/auth/refresh') {
        refreshStarted.resolve()
        return deferredRefresh.promise
      }
      throw new Error(`Unexpected request to ${url}`)
    })

    globalThis.fetch = mockFetch

    const p1 = apiFetch('/item-a')
    const p2 = apiFetch('/item-b')

    // Wait until refresh has started
    await refreshStarted.promise

    deferredRefresh.resolve(
      new Response(JSON.stringify({ error: 'session dead' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    const err1 = await p1.catch((e: unknown) => e)
    const err2 = await p2.catch((e: unknown) => e)

    expect(err1).toBeInstanceOf(ApiError)
    expect(err2).toBeInstanceOf(ApiError)
    expect((err1 as ApiError).data).toEqual({ error: 'expired a' })
    expect((err2 as ApiError).data).toEqual({ error: 'expired b' })
    expect(unauthorizedSpy).toHaveBeenCalledTimes(1)
    expect(getAccessToken()).toBeNull()
  })

  it('auth endpoint 401 throws original failure without refresh and does not clear active account', async () => {
    setAccessToken('legitimate-token')
    let refreshCalls = 0
    const unauthorizedSpy = vi.fn()
    setOnUnauthorized(unauthorizedSpy)

    const mockFetch = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url === '/auth/login') {
        return new Response(JSON.stringify({ message: 'invalid email or password' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (url === '/auth/refresh') {
        refreshCalls++
        return new Response('{}', { status: 200 })
      }
      throw new Error(`Unexpected request to ${url}`)
    })

    globalThis.fetch = mockFetch

    const err = await apiFetch('/auth/login', {
      method: 'POST',
      json: { email: 'wrong@test.com', password: 'bad' },
    }).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).toBe(401)
    expect((err as ApiError).data).toEqual({ message: 'invalid email or password' })
    expect(refreshCalls).toBe(0)
    expect(unauthorizedSpy).not.toHaveBeenCalled()
    expect(getAccessToken()).toBe('legitimate-token')
  })
})
