import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiFetch, getAccessToken, setAccessToken } from './client'

describe('api client', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    setAccessToken(null)
  })

  afterEach(() => {
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

    const mockFetch = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()

      if (url === '/items') {
        return new Response(JSON.stringify({ error: 'unauthorized' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      if (url === '/auth/refresh') {
        throw new Error('Network failure')
      }

      throw new Error(`Unexpected request to ${url}`)
    })

    globalThis.fetch = mockFetch

    await expect(apiFetch('/items')).rejects.toThrow('Network failure')
    expect(getAccessToken()).toBeNull()
  })
})
