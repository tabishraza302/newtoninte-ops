import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider, useAuth, type User } from './AuthContext'
import { apiFetch, getAccessToken, setAccessToken, setOnUnauthorized } from '../api/client'

function createDeferred<T>() {
  let resolve!: (val: T) => void
  let reject!: (err: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  })
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <AuthProvider>{children}</AuthProvider>
      </QueryClientProvider>
    )
  }
}

describe('AuthContext race and lifecycle safety', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    setAccessToken(null)
    setOnUnauthorized(null)
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('logout while login pending stays anon and cancels stale login', async () => {
    const deferredLogin = createDeferred<Response>()
    const loginStarted = createDeferred<void>()
    let loginSignal: AbortSignal | null | undefined

    globalThis.fetch = vi.fn().mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url === '/auth/refresh') {
        return new Response('Unauthorized', { status: 401 })
      }
      if (url === '/auth/login') {
        loginSignal = init?.signal ?? undefined
        loginStarted.resolve()
        return deferredLogin.promise
      }
      if (url === '/auth/logout') {
        return new Response(null, { status: 204 })
      }
      throw new Error(`Unexpected request to ${url}`)
    })

    const { result } = renderHook(() => useAuth(), { wrapper: createWrapper() })

    await waitFor(() => expect(result.current.status).toBe('anon'))

    // Start login
    let loginPromise: Promise<void>
    act(() => {
      loginPromise = result.current.login('alice@example.com', 'password123')
    })

    await loginStarted.promise

    // Immediately trigger logout while login is in flight
    await act(async () => {
      await result.current.logout()
    })

    // Login's network signal must have been aborted
    expect(loginSignal?.aborted).toBe(true)
    expect(result.current.status).toBe('anon')
    expect(result.current.user).toBeNull()
    expect(getAccessToken()).toBeNull()

    // Late login resolves
    const aliceUser: User = { id: 1, email: 'alice@example.com', displayName: 'Alice', isAdmin: false }
    deferredLogin.resolve(
      new Response(JSON.stringify({ accessToken: 'alice-token', user: aliceUser }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    await act(async () => {
      await loginPromise.catch(() => {})
    })

    // Late login must NOT overwrite anon status
    expect(result.current.status).toBe('anon')
    expect(result.current.user).toBeNull()
    expect(getAccessToken()).toBeNull()
  })

  it('overlapping logins ensures newest login wins and previous is aborted', async () => {
    const deferredLogin1 = createDeferred<Response>()
    const deferredLogin2 = createDeferred<Response>()
    const login1Started = createDeferred<void>()
    let signal1: AbortSignal | null | undefined
    let signal2: AbortSignal | null | undefined

    globalThis.fetch = vi.fn().mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url === '/auth/refresh') {
        return new Response('Unauthorized', { status: 401 })
      }
      if (url === '/auth/login') {
        const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {}
        if (body.email === 'user1@example.com') {
          signal1 = init?.signal ?? undefined
          login1Started.resolve()
          return deferredLogin1.promise
        }
        if (body.email === 'user2@example.com') {
          signal2 = init?.signal ?? undefined
          return deferredLogin2.promise
        }
      }
      throw new Error(`Unexpected request to ${url}`)
    })

    const { result } = renderHook(() => useAuth(), { wrapper: createWrapper() })

    await waitFor(() => expect(result.current.status).toBe('anon'))

    let p1: Promise<void>
    let p2: Promise<void>

    act(() => {
      p1 = result.current.login('user1@example.com', 'pw1')
    })

    await login1Started.promise

    act(() => {
      p2 = result.current.login('user2@example.com', 'pw2')
    })

    // Newer login must abort the previous in-flight login
    expect(signal1?.aborted).toBe(true)
    expect(signal2?.aborted).toBe(false)

    const user2: User = { id: 2, email: 'user2@example.com', displayName: 'User Two', isAdmin: false }
    deferredLogin2.resolve(
      new Response(JSON.stringify({ accessToken: 'token-2', user: user2 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    await act(async () => {
      await p2
    })

    expect(result.current.status).toBe('authed')
    expect(result.current.user?.email).toBe('user2@example.com')
    expect(getAccessToken()).toBe('token-2')

    // Older login completes afterwards
    const user1: User = { id: 1, email: 'user1@example.com', displayName: 'User One', isAdmin: false }
    deferredLogin1.resolve(
      new Response(JSON.stringify({ accessToken: 'token-1', user: user1 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    await act(async () => {
      await p1.catch(() => {})
    })

    // Newest login remains active
    expect(result.current.status).toBe('authed')
    expect(result.current.user?.email).toBe('user2@example.com')
    expect(getAccessToken()).toBe('token-2')
  })

  it('session restore pending logout cannot restore tokens', async () => {
    const deferredRestore = createDeferred<Response>()
    const restoreStarted = createDeferred<void>()
    let restoreSignal: AbortSignal | null | undefined

    globalThis.fetch = vi.fn().mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url === '/auth/refresh') {
        restoreSignal = init?.signal ?? undefined
        restoreStarted.resolve()
        return deferredRestore.promise
      }
      if (url === '/auth/logout') {
        return new Response(null, { status: 204 })
      }
      throw new Error(`Unexpected request to ${url}`)
    })

    const { result } = renderHook(() => useAuth(), { wrapper: createWrapper() })

    await restoreStarted.promise

    // Logout while restore is pending
    await act(async () => {
      await result.current.logout()
    })

    expect(restoreSignal?.aborted).toBe(true)
    expect(result.current.status).toBe('anon')

    // Late restore completes with user
    const restoredUser: User = { id: 99, email: 'restored@example.com', displayName: 'Restored', isAdmin: false }
    deferredRestore.resolve(
      new Response(JSON.stringify({ accessToken: 'restored-token', user: restoredUser }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    await act(async () => {
      await Promise.resolve()
    })

    expect(result.current.status).toBe('anon')
    expect(result.current.user).toBeNull()
    expect(getAccessToken()).toBeNull()
  })

  it('serializes login after in-flight logout and prevents old logout finally from clearing new login', async () => {
    const deferredLogout = createDeferred<Response>()
    const logoutStarted = createDeferred<void>()
    const callOrder: string[] = []

    globalThis.fetch = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url === '/auth/refresh') {
        return new Response('Unauthorized', { status: 401 })
      }
      if (url === '/auth/logout') {
        logoutStarted.resolve()
        callOrder.push('logout-start')
        return deferredLogout.promise.then((res) => {
          callOrder.push('logout-finish')
          return res
        })
      }
      if (url === '/auth/login') {
        callOrder.push('login-start')
        const newUser: User = { id: 5, email: 'new@example.com', displayName: 'New User', isAdmin: false }
        return new Response(JSON.stringify({ accessToken: 'new-token-5', user: newUser }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      throw new Error(`Unexpected request to ${url}`)
    })

    const { result } = renderHook(() => useAuth(), { wrapper: createWrapper() })

    await waitFor(() => expect(result.current.status).toBe('anon'))

    // Start logout
    let logoutPromise: Promise<void>
    act(() => {
      logoutPromise = result.current.logout()
    })

    await logoutStarted.promise

    // Client credentials invalidated immediately
    expect(result.current.status).toBe('anon')
    expect(getAccessToken()).toBeNull()

    // Now start login while logout network call is pending
    let loginPromise: Promise<void>
    act(() => {
      loginPromise = result.current.login('new@example.com', 'pw')
    })

    // Login must wait for logout request to finish so logout Set-Cookie arrives before login
    expect(callOrder).toEqual(['logout-start'])

    // Finish logout
    deferredLogout.resolve(new Response(null, { status: 204 }))

    await act(async () => {
      await logoutPromise
      await loginPromise
    })

    expect(callOrder).toEqual(['logout-start', 'logout-finish', 'login-start'])
    expect(result.current.status).toBe('authed')
    expect(result.current.user?.email).toBe('new@example.com')
    expect(getAccessToken()).toBe('new-token-5')
  })

  it('unauthorized event invalidates pending login and clears auth state', async () => {
    const deferredLogin = createDeferred<Response>()
    const loginStarted = createDeferred<void>()
    let loginSignal: AbortSignal | null | undefined

    globalThis.fetch = vi.fn().mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url === '/auth/refresh') {
        return new Response('Unauthorized', { status: 401 })
      }
      if (url === '/auth/login') {
        loginSignal = init?.signal ?? undefined
        loginStarted.resolve()
        return deferredLogin.promise
      }
      if (url === '/some-api') {
        return new Response('Unauthorized', { status: 401 })
      }
      throw new Error(`Unexpected request to ${url}`)
    })

    const { result } = renderHook(() => useAuth(), { wrapper: createWrapper() })

    await waitFor(() => expect(result.current.status).toBe('anon'))

    let loginPromise: Promise<void>
    act(() => {
      loginPromise = result.current.login('alice@example.com', 'pw')
    })

    await loginStarted.promise

    // Exhausted 401 triggers onUnauthorized callback
    await act(async () => {
      await apiFetch('/some-api').catch(() => {})
    })

    // Resolve login
    const user: User = { id: 1, email: 'alice@example.com', displayName: 'Alice', isAdmin: false }
    deferredLogin.resolve(
      new Response(JSON.stringify({ accessToken: 'alice-token', user }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    await act(async () => {
      await loginPromise.catch(() => {})
    })

    // Unauthorized triggered during login, late login response must not authenticate
    expect(result.current.status).toBe('anon')
    expect(result.current.user).toBeNull()
    expect(getAccessToken()).toBeNull()
  })
})
