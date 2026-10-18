import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Notifications } from './Notifications'
import { AppRoutes } from '../App'
import { AuthContext, AuthProvider, type AuthContextValue, type User } from '../auth/AuthContext'
import { AppLayout } from '../components/AppLayout'
import type { CollaborationNotification } from '../api/types'
import { createTestQueryClient } from '../test/test-utils'

const mockMemberUser: User = {
  id: 10,
  email: 'member@example.com',
  displayName: 'Member Bob',
  isAdmin: false,
}

const mockAdminUser: User = {
  id: 20,
  email: 'admin@example.com',
  displayName: 'Admin Charlie',
  isAdmin: true,
}

function authContext(user: User | null = mockMemberUser, status: 'authed' | 'loading' | 'anon' = 'authed'): AuthContextValue {
  return {
    user,
    status,
    login: vi.fn(),
    logout: vi.fn(),
    setAuthUser: vi.fn(),
  }
}

function renderNotifications(
  queryClient: QueryClient = createTestQueryClient(),
  authVal: AuthContextValue = authContext(),
) {
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthContext.Provider value={authVal}>
        <MemoryRouter initialEntries={['/notifications']}>
          <Notifications />
        </MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>,
  )
}

const sampleNotifications: CollaborationNotification[] = [
  {
    id: 101,
    type: 'assigned',
    workItemId: 1,
    itemTitle: 'Fix database connection pooling',
    actor: { id: 2, displayName: 'Lead Dana' },
    fromStatus: null,
    toStatus: null,
    createdAt: '2026-10-18T10:00:00.000Z',
    readAt: null,
  },
  {
    id: 102,
    type: 'comment_added',
    workItemId: 1,
    itemTitle: 'Fix database connection pooling',
    actor: { id: 3, displayName: 'Peer Frank' },
    fromStatus: null,
    toStatus: null,
    createdAt: '2026-10-18T10:30:00.000Z',
    readAt: '2026-10-18T10:35:00.000Z',
  },
  {
    id: 103,
    type: 'approval_requested',
    workItemId: 2,
    itemTitle: 'Migrate caching layer to Redis',
    actor: { id: 10, displayName: 'Member Bob' },
    fromStatus: null,
    toStatus: null,
    createdAt: '2026-10-18T11:00:00.000Z',
    readAt: null,
  },
  {
    id: 104,
    type: 'workflow_decision',
    workItemId: 2,
    itemTitle: 'Migrate caching layer to Redis',
    actor: { id: 2, displayName: 'Lead Dana' },
    fromStatus: 'awaiting_approval',
    toStatus: 'resolved',
    createdAt: '2026-10-18T11:30:00.000Z',
    readAt: null,
  },
  {
    id: 105,
    type: 'workflow_decision',
    workItemId: 3,
    itemTitle: 'Refactor search endpoints',
    actor: { id: 2, displayName: 'Lead Dana' },
    fromStatus: 'awaiting_approval',
    toStatus: 'in_progress',
    createdAt: '2026-10-18T12:00:00.000Z',
    readAt: null,
  },
  {
    id: 106,
    type: 'workflow_decision',
    workItemId: 3,
    itemTitle: 'Refactor search endpoints',
    actor: { id: 2, displayName: 'Lead Dana' },
    fromStatus: 'resolved',
    toStatus: 'closed',
    createdAt: '2026-10-18T12:30:00.000Z',
    readAt: null,
  },
  {
    id: 107,
    type: 'workflow_decision',
    workItemId: 4,
    itemTitle: 'Implement webhook ingestion',
    actor: null,
    fromStatus: 'resolved',
    toStatus: 'in_progress',
    createdAt: '2026-10-18T13:00:00.000Z',
    readAt: null,
  },
  {
    id: 108,
    type: 'workflow_decision',
    workItemId: 5,
    itemTitle: 'Deprecated service cleanup',
    actor: { id: 2, displayName: 'Lead Dana' },
    fromStatus: 'open',
    toStatus: 'cancelled',
    createdAt: '2026-10-18T13:30:00.000Z',
    readAt: null,
  },
]

describe('Notifications Page', () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    vi.restoreAllMocks()
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.useRealTimers()
  })

  it('renders visible recipient events, labels, links, fallback actor, and explicit read controls', async () => {
    globalThis.fetch = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.includes('/notifications/summary')) {
        return Promise.resolve(
          new Response(JSON.stringify({ unreadCount: 7 }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }
      if (url.includes('/notifications')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              notifications: sampleNotifications,
              nextCursor: null,
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            },
          ),
        )
      }
      return Promise.resolve(new Response('not found', { status: 404 }))
    })

    const queryClient = createTestQueryClient()
    renderNotifications(queryClient)

    // Initial loading indicator
    expect(screen.getByRole('status')).toHaveTextContent(/Loading notifications\.\.\./i)

    // Wait for real resolved event/count content, not static heading
    await waitFor(() => {
      expect(screen.getByText('7 unread')).toBeInTheDocument()
      expect(screen.getByText('Assigned to you')).toBeInTheDocument()
    })

    expect(screen.getByRole('heading', { name: /Notifications/i })).toBeInTheDocument()

    // Event labels
    expect(screen.getByText('Assigned to you')).toBeInTheDocument()
    expect(screen.getByText('Added a comment')).toBeInTheDocument()
    expect(screen.getByText('Requested approval')).toBeInTheDocument()
    expect(screen.getByText('Approved')).toBeInTheDocument()
    expect(screen.getByText('Sent back')).toBeInTheDocument()
    expect(screen.getByText('Closed')).toBeInTheDocument()
    expect(screen.getByText('Reopened')).toBeInTheDocument()
    expect(screen.getByText('Cancelled')).toBeInTheDocument()

    // Fallback actor for null actor
    expect(screen.getByText('Someone')).toBeInTheDocument()

    // Work item links with current titles
    const links = screen.getAllByRole('link', { name: 'Fix database connection pooling' })
    expect(links[0]).toHaveAttribute('href', '/items/1')

    // Read vs Unread badges
    const unreadBadges = screen.getAllByText('Unread')
    expect(unreadBadges.length).toBe(7)
    const readBadges = screen.getAllByText('Read')
    expect(readBadges.length).toBe(1)

    // Explicit read controls only: unread has Mark as read button, read does not
    const markAsReadButtons = screen.getAllByRole('button', { name: 'Mark as read' })
    expect(markAsReadButtons.length).toBe(7)

    // Clicking an item link must NOT mark read
    fireEvent.click(links[0]!)
    const calledPostUrls = vi.mocked(globalThis.fetch).mock.calls
      .filter((c) => c[1]?.method === 'POST')
      .map((c) => String(c[0]))
    expect(calledPostUrls.length).toBe(0)
  })

  it('renders empty state when there are no notifications', async () => {
    globalThis.fetch = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.includes('/notifications/summary')) {
        return Promise.resolve(
          new Response(JSON.stringify({ unreadCount: 0 }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }
      if (url.includes('/notifications')) {
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
    renderNotifications(queryClient)

    await waitFor(() => {
      expect(screen.getByText("You're all caught up. No notifications yet.")).toBeInTheDocument()
    })

    // Mark all as read button should be disabled when known count is 0
    const markAllButton = screen.getByRole('button', { name: /Mark all as read/i })
    expect(markAllButton).toBeDisabled()
  })

  it('handles initial load error with role="alert" and allows Retry', async () => {
    let failFirst = true
    globalThis.fetch = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.includes('/notifications/summary')) {
        return Promise.resolve(
          new Response(JSON.stringify({ unreadCount: 1 }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }
      if (url.includes('/notifications')) {
        if (failFirst) {
          failFirst = false
          return Promise.resolve(
            new Response(JSON.stringify({ error: { message: 'Network connection timeout' } }), {
              status: 500,
              headers: { 'Content-Type': 'application/json' },
            }),
          )
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({
              notifications: [sampleNotifications[0]!],
              nextCursor: null,
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            },
          ),
        )
      }
      return Promise.resolve(new Response('not found', { status: 404 }))
    })

    const queryClient = createTestQueryClient()
    renderNotifications(queryClient)

    await waitFor(() => {
      const alert = screen.getByRole('alert')
      expect(alert).toHaveTextContent('Network connection timeout')
    })

    const retryBtn = screen.getByRole('button', { name: 'Retry' })
    fireEvent.click(retryBtn)

    await waitFor(() => {
      expect(screen.getByText('Fix database connection pooling')).toBeInTheDocument()
    })
  })

  it('paginates notifications with Load more cursor continuation', async () => {
    globalThis.fetch = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.includes('/notifications/summary')) {
        return Promise.resolve(
          new Response(JSON.stringify({ unreadCount: 2 }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }
      if (url.includes('/notifications')) {
        if (url.includes('cursor=page_2_cursor')) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                notifications: [sampleNotifications[1]!],
                nextCursor: null,
              }),
              {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
              },
            ),
          )
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({
              notifications: [sampleNotifications[0]!],
              nextCursor: 'page_2_cursor',
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            },
          ),
        )
      }
      return Promise.resolve(new Response('not found', { status: 404 }))
    })

    const queryClient = createTestQueryClient()
    renderNotifications(queryClient)

    await waitFor(() => {
      expect(screen.getByText('Assigned to you')).toBeInTheDocument()
    })

    const loadMoreBtn = screen.getByRole('button', { name: /Load more/i })
    expect(loadMoreBtn).toBeInTheDocument()

    fireEvent.click(loadMoreBtn)

    await waitFor(() => {
      expect(screen.getByText('Added a comment')).toBeInTheDocument()
    })

    // Both items flattened
    expect(screen.getByText('Assigned to you')).toBeInTheDocument()
    expect(screen.getByText('Added a comment')).toBeInTheDocument()

    // Next cursor was null, so Load more button is removed
    expect(screen.queryByRole('button', { name: /Load more/i })).not.toBeInTheDocument()
  })

  it('retains loaded rows on later-page failure and exposes retry', async () => {
    let secondPageFailed = true
    globalThis.fetch = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.includes('/notifications/summary')) {
        return Promise.resolve(
          new Response(JSON.stringify({ unreadCount: 2 }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }
      if (url.includes('/notifications')) {
        if (url.includes('cursor=page_2_cursor')) {
          if (secondPageFailed) {
            secondPageFailed = false
            return Promise.resolve(
              new Response(JSON.stringify({ error: { message: 'Gateway error on page 2' } }), {
                status: 502,
                headers: { 'Content-Type': 'application/json' },
              }),
            )
          }
          return Promise.resolve(
            new Response(
              JSON.stringify({
                notifications: [sampleNotifications[1]!],
                nextCursor: null,
              }),
              {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
              },
            ),
          )
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({
              notifications: [sampleNotifications[0]!],
              nextCursor: 'page_2_cursor',
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            },
          ),
        )
      }
      return Promise.resolve(new Response('not found', { status: 404 }))
    })

    const queryClient = createTestQueryClient()
    renderNotifications(queryClient)

    await waitFor(() => {
      expect(screen.getByText('Assigned to you')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /Load more/i }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Gateway error on page 2')
    })

    // First page item remains visible
    expect(screen.getByText('Assigned to you')).toBeInTheDocument()

    // Retry page 2
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    await waitFor(() => {
      expect(screen.getByText('Added a comment')).toBeInTheDocument()
    })
    expect(screen.getByText('Assigned to you')).toBeInTheDocument()
  })

  it('marks a single notification read and invalidates queries to reconcile state', async () => {
    let isRead = false
    globalThis.fetch = vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      const method = init?.method ?? 'GET'

      if (url.includes('/notifications/101/read') && method === 'POST') {
        isRead = true
        return Promise.resolve(new Response(null, { status: 204 }))
      }
      if (url.includes('/notifications/summary')) {
        return Promise.resolve(
          new Response(JSON.stringify({ unreadCount: isRead ? 0 : 1 }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }
      if (url.includes('/notifications')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              notifications: [
                {
                  ...sampleNotifications[0]!,
                  readAt: isRead ? '2026-10-18T10:45:00.000Z' : null,
                },
              ],
              nextCursor: null,
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            },
          ),
        )
      }
      return Promise.resolve(new Response('not found', { status: 404 }))
    })

    const queryClient = createTestQueryClient()
    renderNotifications(queryClient)

    await waitFor(() => {
      expect(screen.getByText('1 unread')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Mark as read' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Mark as read' }))

    await waitFor(() => {
      expect(screen.getByText('0 unread')).toBeInTheDocument()
      expect(screen.getByText('Read')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Mark as read' })).not.toBeInTheDocument()
    })
  })

  it('marks all notifications read and invalidates queries across pages', async () => {
    let allRead = false
    globalThis.fetch = vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      const method = init?.method ?? 'GET'

      if (url.includes('/notifications/read-all') && method === 'POST') {
        allRead = true
        return Promise.resolve(new Response(null, { status: 204 }))
      }
      if (url.includes('/notifications/summary')) {
        return Promise.resolve(
          new Response(JSON.stringify({ unreadCount: allRead ? 0 : 2 }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }
      if (url.includes('/notifications')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              notifications: [
                {
                  ...sampleNotifications[0]!,
                  readAt: allRead ? '2026-10-18T10:45:00.000Z' : null,
                },
                {
                  ...sampleNotifications[2]!,
                  readAt: allRead ? '2026-10-18T10:45:00.000Z' : null,
                },
              ],
              nextCursor: null,
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            },
          ),
        )
      }
      return Promise.resolve(new Response('not found', { status: 404 }))
    })

    const queryClient = createTestQueryClient()
    renderNotifications(queryClient)

    await waitFor(() => {
      expect(screen.getByText('2 unread')).toBeInTheDocument()
    })

    const markAllBtn = screen.getByRole('button', { name: /Mark all as read/i })
    expect(markAllBtn).toBeEnabled()

    fireEvent.click(markAllBtn)

    await waitFor(() => {
      expect(screen.getByText('0 unread')).toBeInTheDocument()
      expect(screen.queryAllByRole('button', { name: 'Mark as read' }).length).toBe(0)
    })

    expect(screen.getByRole('button', { name: /Mark all as read/i })).toBeDisabled()
  })

  it('preserves rows on mutation failure and displays error alert', async () => {
    globalThis.fetch = vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      const method = init?.method ?? 'GET'

      if (url.includes('/notifications/101/read') && method === 'POST') {
        return Promise.resolve(
          new Response(JSON.stringify({ error: { message: 'Database lock timeout' } }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }
      if (url.includes('/notifications/summary')) {
        return Promise.resolve(
          new Response(JSON.stringify({ unreadCount: 1 }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }
      if (url.includes('/notifications')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              notifications: [sampleNotifications[0]!],
              nextCursor: null,
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            },
          ),
        )
      }
      return Promise.resolve(new Response('not found', { status: 404 }))
    })

    const queryClient = createTestQueryClient()
    renderNotifications(queryClient)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Mark as read' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Mark as read' }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Database lock timeout')
    })

    // Rows remain intact
    expect(screen.getByText('Assigned to you')).toBeInTheDocument()
    expect(screen.getByText('Unread')).toBeInTheDocument()
  })

  it('invalidates queries when single mark-read returns 404 to remove revoked rows', async () => {
    let membershipRevoked = false
    globalThis.fetch = vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      const method = init?.method ?? 'GET'

      if (url.includes('/notifications/101/read') && method === 'POST') {
        membershipRevoked = true
        return Promise.resolve(
          new Response(JSON.stringify({ error: { message: 'Not found' } }), {
            status: 404,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }
      if (url.includes('/notifications/summary')) {
        return Promise.resolve(
          new Response(JSON.stringify({ unreadCount: membershipRevoked ? 0 : 1 }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }
      if (url.includes('/notifications')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              notifications: membershipRevoked ? [] : [sampleNotifications[0]!],
              nextCursor: null,
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            },
          ),
        )
      }
      return Promise.resolve(new Response('not found', { status: 404 }))
    })

    const queryClient = createTestQueryClient()
    renderNotifications(queryClient)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Mark as read' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Mark as read' }))

    await waitFor(() => {
      expect(screen.getByText("You're all caught up. No notifications yet.")).toBeInTheDocument()
    })
  })

})

describe('AppLayout Shared Header Badge & Auth Gating', () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    vi.restoreAllMocks()
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('renders positive unread badge with 99+ cap and exact accessible name for member and admin', async () => {
    globalThis.fetch = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.includes('/notifications/summary')) {
        return Promise.resolve(
          new Response(JSON.stringify({ unreadCount: 150 }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }
      return Promise.resolve(new Response('not found', { status: 404 }))
    })

    const queryClient = createTestQueryClient()

    // Test member view
    const { unmount } = render(
      <QueryClientProvider client={queryClient}>
        <AuthContext.Provider value={authContext(mockMemberUser)}>
          <MemoryRouter initialEntries={['/dashboard']}>
            <AppLayout><div>Page Content</div></AppLayout>
          </MemoryRouter>
        </AuthContext.Provider>
      </QueryClientProvider>,
    )

    await waitFor(() => {
      const link = screen.getByRole('link', { name: 'Notifications (150 unread)' })
      expect(link).toBeInTheDocument()
      expect(link).toHaveTextContent('99+')
    })

    unmount()

    // Test admin view
    render(
      <QueryClientProvider client={queryClient}>
        <AuthContext.Provider value={authContext(mockAdminUser)}>
          <MemoryRouter initialEntries={['/admin/jobs']}>
            <AppLayout><div>Admin Page Content</div></AppLayout>
          </MemoryRouter>
        </AuthContext.Provider>
      </QueryClientProvider>,
    )

    await waitFor(() => {
      const link = screen.getByRole('link', { name: 'Notifications (150 unread)' })
      expect(link).toBeInTheDocument()
      expect(link).toHaveTextContent('99+')
    })
  })

  it('omits zero badge when unread count is 0', async () => {
    globalThis.fetch = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.includes('/notifications/summary')) {
        return Promise.resolve(
          new Response(JSON.stringify({ unreadCount: 0 }), {
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
        <AuthContext.Provider value={authContext(mockMemberUser)}>
          <MemoryRouter initialEntries={['/dashboard']}>
            <AppLayout><div>Page Content</div></AppLayout>
          </MemoryRouter>
        </AuthContext.Provider>
      </QueryClientProvider>,
    )

    await waitFor(() => {
      const link = screen.getByRole('link', { name: 'Notifications' })
      expect(link).toBeInTheDocument()
      expect(link.textContent).toBe('Notifications')
    })
  })

  it('does not send notification queries during anonymous or session restoration state', async () => {
    let summaryFetched = false
    globalThis.fetch = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.includes('/notifications')) {
        summaryFetched = true
      }
      return Promise.resolve(new Response('not found', { status: 404 }))
    })

    const queryClient = createTestQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <AuthContext.Provider value={authContext(null, 'loading')}>
          <MemoryRouter initialEntries={['/notifications']}>
            <AppRoutes />
          </MemoryRouter>
        </AuthContext.Provider>
      </QueryClientProvider>,
    )

    // No notification queries should have been initiated while restoring session
    expect(summaryFetched).toBe(false)
  })

  it('clears notification state across account switch without data leaks', async () => {
    let currentUser = mockMemberUser

    globalThis.fetch = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.includes('/notifications/summary')) {
        return Promise.resolve(
          new Response(JSON.stringify({ unreadCount: currentUser.id === 10 ? 5 : 0 }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }
      return Promise.resolve(new Response('not found', { status: 404 }))
    })

    const queryClient = createTestQueryClient()

    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <AuthContext.Provider value={authContext(currentUser)}>
          <MemoryRouter initialEntries={['/dashboard']}>
            <AppLayout><div>Content</div></AppLayout>
          </MemoryRouter>
        </AuthContext.Provider>
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Notifications (5 unread)' })).toBeInTheDocument()
    })

    // Simulate account switch: clear queryClient cache and update auth user
    queryClient.clear()
    currentUser = mockAdminUser

    rerender(
      <QueryClientProvider client={queryClient}>
        <AuthContext.Provider value={authContext(currentUser)}>
          <MemoryRouter initialEntries={['/admin/jobs']}>
            <AppLayout><div>Content</div></AppLayout>
          </MemoryRouter>
        </AuthContext.Provider>
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Notifications' })).toBeInTheDocument()
      expect(screen.queryByRole('link', { name: 'Notifications (5 unread)' })).not.toBeInTheDocument()
    })
  })
})
