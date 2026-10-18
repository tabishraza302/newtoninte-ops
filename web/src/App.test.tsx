import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { App, AppRoutes } from './App'
import { AuthProvider } from './auth/AuthContext'
import { createTestQueryClient } from './test/test-utils'

const mockAuthedUser = {
  id: 1,
  email: 'alice@example.com',
  displayName: 'Alice Engineer',
  isAdmin: false,
}

describe('App', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    globalThis.fetch = vi.fn().mockImplementation((url: string | URL | Request) => {
      const urlStr = typeof url === 'string' ? url : url.toString()
      if (urlStr.includes('/auth/refresh')) {
        return Promise.resolve(new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 }))
      }
      if (urlStr.includes('/items/')) {
        return Promise.resolve(new Response(JSON.stringify({ error: 'not found' }), { status: 404 }))
      }
      if (urlStr.includes('/items')) {
        return Promise.resolve(new Response(JSON.stringify({ items: [], nextCursor: null }), { status: 200 }))
      }
      return Promise.resolve(new Response('not found', { status: 404 }))
    })
  })

  it('renders login page when unauthenticated', async () => {
    render(<App />)
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Log In/i })).toBeInTheDocument()
    })
  })

  it('redirects direct navigation to private route when anon to /login', async () => {
    const queryClient = createTestQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <MemoryRouter initialEntries={['/items']}>
            <AppRoutes />
          </MemoryRouter>
        </AuthProvider>
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Log In/i })).toBeInTheDocument()
    })
  })

  it('does not fetch private /items while restoring session or after unauthorized restore', async () => {
    let resolveRefresh!: (value: Response) => void
    const refreshPromise = new Promise<Response>((resolve) => {
      resolveRefresh = resolve
    })

    globalThis.fetch = vi.fn().mockImplementation((url: string | URL | Request) => {
      const urlStr = typeof url === 'string' ? url : url.toString()
      if (urlStr.includes('/auth/refresh')) {
        return refreshPromise
      }
      if (urlStr.includes('/items')) {
        return Promise.resolve(new Response(JSON.stringify({ items: [], nextCursor: null }), { status: 200 }))
      }
      return Promise.resolve(new Response('not found', { status: 404 }))
    })

    const queryClient = createTestQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <MemoryRouter initialEntries={['/items']}>
            <AppRoutes />
          </MemoryRouter>
        </AuthProvider>
      </QueryClientProvider>,
    )

    // Restoring session indicator should be visible
    expect(screen.getByRole('status')).toHaveTextContent(/Restoring session/i)

    // Verify /items was NOT fetched
    expect(globalThis.fetch).not.toHaveBeenCalledWith(expect.stringContaining('/items'), expect.anything())

    // Complete restore with 401
    resolveRefresh(new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 }))

    // Should redirect to login
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Log In/i })).toBeInTheDocument()
    })

    // Verify /items was STILL never called
    const calledUrls = vi.mocked(globalThis.fetch).mock.calls.map((call) => String(call[0]))
    expect(calledUrls.some((u: string) => u.includes('/items'))).toBe(false)
  })

  it('routes to /dashboard when authenticated', async () => {
    globalThis.fetch = vi.fn().mockImplementation((url: string | URL | Request) => {
      const urlStr = typeof url === 'string' ? url : url.toString()
      if (urlStr.includes('/auth/refresh')) {
        return Promise.resolve(
          new Response(JSON.stringify({ accessToken: 'fake-token', user: mockAuthedUser }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }
      if (urlStr.includes('/auth/me')) {
        return Promise.resolve(
          new Response(JSON.stringify({ user: mockAuthedUser, memberships: [] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }
      if (urlStr.includes('/teams')) {
        return Promise.resolve(
          new Response(JSON.stringify({ teams: [] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }
      if (urlStr.includes('/notifications/summary')) {
        return Promise.resolve(
          new Response(JSON.stringify({ unreadCount: 0 }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }
      if (urlStr.includes('/items')) {
        return Promise.resolve(
          new Response(JSON.stringify({ items: [], nextCursor: null }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }
      return Promise.resolve(new Response('not found', { status: 404 }))
    })

    const queryClient = createTestQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <MemoryRouter initialEntries={['/dashboard']}>
            <AppRoutes />
          </MemoryRouter>
        </AuthProvider>
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Dashboard/i })).toBeInTheDocument()
    })
  })

  it('routes to /items when authenticated', async () => {
    globalThis.fetch = vi.fn().mockImplementation((url: string | URL | Request) => {
      const urlStr = typeof url === 'string' ? url : url.toString()
      if (urlStr.includes('/auth/refresh')) {
        return Promise.resolve(
          new Response(JSON.stringify({ accessToken: 'fake-token', user: mockAuthedUser }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }
      if (urlStr.includes('/auth/me')) {
        return Promise.resolve(
          new Response(JSON.stringify({ user: mockAuthedUser, memberships: [] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }
      if (urlStr.includes('/teams')) {
        return Promise.resolve(
          new Response(JSON.stringify({ teams: [] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }
      if (urlStr.includes('/notifications/summary')) {
        return Promise.resolve(
          new Response(JSON.stringify({ unreadCount: 0 }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }
      if (urlStr.includes('/items')) {
        return Promise.resolve(
          new Response(JSON.stringify({ items: [], nextCursor: null }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }
      return Promise.resolve(new Response('not found', { status: 404 }))
    })

    const queryClient = createTestQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <MemoryRouter initialEntries={['/items']}>
            <AppRoutes />
          </MemoryRouter>
        </AuthProvider>
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Items/i })).toBeInTheDocument()
    })
  })

  it('routes to /items/:id when authenticated', async () => {
    globalThis.fetch = vi.fn().mockImplementation((url: string | URL | Request) => {
      const urlStr = typeof url === 'string' ? url : url.toString()
      if (urlStr.includes('/auth/refresh')) {
        return Promise.resolve(
          new Response(JSON.stringify({ accessToken: 'fake-token', user: mockAuthedUser }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }
      if (urlStr.includes('/auth/me')) {
        return Promise.resolve(
          new Response(JSON.stringify({ user: mockAuthedUser, memberships: [] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }
      if (urlStr.includes('/items/123/activity')) {
        return Promise.resolve(
          new Response(JSON.stringify({ events: [], nextCursor: null }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }
      if (urlStr.includes('/notifications/summary')) {
        return Promise.resolve(
          new Response(JSON.stringify({ unreadCount: 0 }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }
      if (urlStr.includes('/items/123')) {
        return Promise.resolve(new Response(JSON.stringify({ error: 'not found' }), { status: 404 }))
      }
      return Promise.resolve(new Response('not found', { status: 404 }))
    })

    const queryClient = createTestQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <MemoryRouter initialEntries={['/items/123']}>
            <AppRoutes />
          </MemoryRouter>
        </AuthProvider>
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Item not found/i })).toBeInTheDocument()
    })
  })

  it('redirects direct navigation to /notifications when anon to /login', async () => {
    const queryClient = createTestQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <MemoryRouter initialEntries={['/notifications']}>
            <AppRoutes />
          </MemoryRouter>
        </AuthProvider>
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Log In/i })).toBeInTheDocument()
    })
  })

  it('routes to /notifications when authenticated', async () => {
    globalThis.fetch = vi.fn().mockImplementation((url: string | URL | Request) => {
      const urlStr = typeof url === 'string' ? url : url.toString()
      if (urlStr.includes('/auth/refresh')) {
        return Promise.resolve(
          new Response(JSON.stringify({ accessToken: 'fake-token', user: mockAuthedUser }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }
      if (urlStr.includes('/auth/me')) {
        return Promise.resolve(
          new Response(JSON.stringify({ user: mockAuthedUser, memberships: [] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }
      if (urlStr.includes('/notifications/summary')) {
        return Promise.resolve(
          new Response(JSON.stringify({ unreadCount: 0 }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }
      if (urlStr.includes('/notifications')) {
        return Promise.resolve(
          new Response(JSON.stringify({ notifications: [], nextCursor: null }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }
      return Promise.resolve(new Response('not found', { status: 404 }))
    })

    const queryClient = createTestQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <MemoryRouter initialEntries={['/notifications']}>
            <AppRoutes />
          </MemoryRouter>
        </AuthProvider>
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Notifications/i })).toBeInTheDocument()
    })
  })

  it('verifies count errors are not displayed as zero', async () => {
    globalThis.fetch = vi.fn().mockImplementation((url: string | URL | Request) => {
      const urlStr = typeof url === 'string' ? url : url.toString()
      if (urlStr.includes('/auth/refresh')) {
        return Promise.resolve(
          new Response(JSON.stringify({ accessToken: 'fake-token', user: mockAuthedUser }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }
      if (urlStr.includes('/auth/me')) {
        return Promise.resolve(
          new Response(JSON.stringify({ user: mockAuthedUser, memberships: [] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }
      if (urlStr.includes('/notifications/summary')) {
        return Promise.resolve(new Response(JSON.stringify({ error: 'Internal Error' }), { status: 500 }))
      }
      if (urlStr.includes('/teams')) {
        return Promise.resolve(
          new Response(JSON.stringify({ teams: [] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }
      if (urlStr.includes('/items')) {
        return Promise.resolve(
          new Response(JSON.stringify({ items: [], nextCursor: null }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }
      return Promise.resolve(new Response('not found', { status: 404 }))
    })

    const queryClient = createTestQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <MemoryRouter initialEntries={['/dashboard']}>
            <AppRoutes />
          </MemoryRouter>
        </AuthProvider>
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Dashboard/i })).toBeInTheDocument()
    })

    // Count error should NOT be displayed as "0" or "0 unread"
    const navLink = await screen.findByRole('link', {
      name: /Notifications \(unread count unavailable\)/i,
    })
    expect(navLink).toBeInTheDocument()
    expect(navLink.textContent).not.toContain('0')
    expect(navLink.getAttribute('href')).toBe('/notifications')
  })
})
