import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  useInfiniteNotifications,
  useNotificationsSummary,
  useMarkNotificationRead,
  useMarkAllNotificationsRead,
} from './hooks'
import type { CollaborationNotification } from './types'
import { createTestQueryClient } from '../test/test-utils'
import { AuthProvider, useAuth, type User } from '../auth/AuthContext'
import { setAccessToken, setOnUnauthorized } from './client'

// --- Response Fixture Helpers ---

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
function createNotification(overrides: Partial<CollaborationNotification> = {}): CollaborationNotification {
  return {
    id: 1,
    type: 'assigned',
    workItemId: 101,
    itemTitle: 'Default Task Title',
    actor: { id: 10, displayName: 'Alice Lead' },
    fromStatus: null,
    toStatus: null,
    createdAt: '2026-10-18T10:00:00.000Z',
    readAt: null,
    ...overrides,
  }
}

// --- Minimal Consumer Components ---
// Exercising exported hooks via realistic consumer interfaces rather than internal query cache inspections

function NotificationCountBadge({ userId }: { userId: number | undefined }) {
  const { data, isLoading, isError, error, isSuccess, isFetching } = useNotificationsSummary(userId)

  return (
    <div data-testid="notification-badge-root">
      {userId === undefined ? (
        <span data-testid="badge-state">disabled-restoring</span>
      ) : isError ? (
        <span data-testid="badge-state" data-error="true" role="alert">
          {error?.message || 'Count unavailable'}
        </span>
      ) : isLoading ? (
        <span data-testid="badge-state">loading</span>
      ) : isSuccess && data ? (
        <span data-testid="badge-state" data-unread={data.unreadCount}>
          {data.unreadCount > 0 ? `${data.unreadCount} unread` : 'No unread'}
        </span>
      ) : (
        <span data-testid="badge-state">idle</span>
      )}
      <span data-testid="badge-fetching">{isFetching ? 'fetching' : 'idle'}</span>
    </div>
  )
}

function NotificationInboxList({ userId }: { userId: number | undefined }) {
  const {
    data,
    isLoading,
    isError,
    error,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
  } = useInfiniteNotifications(userId)

  if (userId === undefined) {
    return <div data-testid="inbox-list-state">disabled-restoring</div>
  }

  if (isError) {
    return (
      <div data-testid="inbox-list-state" data-error="true" role="alert">
        {error?.message || 'Failed to load inbox'}
      </div>
    )
  }

  if (isLoading) {
    return <div data-testid="inbox-list-state">loading</div>
  }

  const items = data?.pages.flatMap((page) => page.notifications) ?? []

  if (items.length === 0) {
    return <div data-testid="inbox-list-state">empty</div>
  }

  return (
    <div data-testid="inbox-list-state">
      <ul data-testid="notification-items">
        {items.map((n) => (
          <li key={n.id} data-testid={`item-${n.id}`}>
            <span data-testid={`item-title-${n.id}`}>{n.itemTitle}</span>
            <span data-testid={`item-type-${n.id}`}>{n.type}</span>
            <span data-testid={`item-status-${n.id}`}>{n.readAt ? 'read' : 'unread'}</span>
          </li>
        ))}
      </ul>
      {hasNextPage && (
        <button
          data-testid="load-more-btn"
          disabled={isFetchingNextPage}
          onClick={() => void fetchNextPage()}
        >
          {isFetchingNextPage ? 'Loading more...' : 'Load more'}
        </button>
      )}
    </div>
  )
}

function CombinedNotificationsInbox({
  userId,
  onReadSuccess,
  onReadAllSuccess,
}: {
  userId: number | undefined
  onReadSuccess?: () => void
  onReadAllSuccess?: () => void
}) {
  const summary = useNotificationsSummary(userId)
  const list = useInfiniteNotifications(userId)
  const markRead = useMarkNotificationRead(userId ?? 0)
  const markAllRead = useMarkAllNotificationsRead(userId ?? 0)

  if (userId === undefined) {
    return (
      <div data-testid="inbox-panel">
        <div data-testid="inbox-session-state">inactive</div>
      </div>
    )
  }

  const items = list.data?.pages.flatMap((p) => p.notifications) ?? []

  return (
    <div data-testid="inbox-panel">
      <header>
        <div data-testid="inbox-summary-status">
          {summary.isError ? (
            <span role="alert">Count unavailable</span>
          ) : summary.isLoading ? (
            <span>Loading summary...</span>
          ) : summary.data ? (
            <span data-testid="inbox-unread-count">
              {summary.data.unreadCount > 0 ? `${summary.data.unreadCount} unread` : '0 unread'}
            </span>
          ) : (
            <span>No summary data</span>
          )}
        </div>
        <button
          data-testid="mark-all-read-btn"
          disabled={markAllRead.isPending || (summary.data?.unreadCount ?? 0) === 0}
          onClick={() => {
            markAllRead.mutate(undefined, {
              onSuccess: () => onReadAllSuccess?.(),
            })
          }}
        >
          {markAllRead.isPending ? 'Marking all read...' : 'Mark all read'}
        </button>
      </header>
      <main>
        {list.isError ? (
          <div role="alert">Feed error: {list.error?.message}</div>
        ) : list.isLoading ? (
          <div>Loading list...</div>
        ) : items.length === 0 ? (
          <div data-testid="inbox-empty-message">No notifications found</div>
        ) : (
          <ul data-testid="inbox-item-list">
            {items.map((item) => (
              <li key={item.id} data-testid={`inbox-row-${item.id}`}>
                <span data-testid={`row-title-${item.id}`}>{item.itemTitle}</span>
                <span data-testid={`row-read-status-${item.id}`}>
                  {item.readAt ? 'read' : 'unread'}
                </span>
                {!item.readAt && (
                  <button
                    data-testid={`mark-read-btn-${item.id}`}
                    disabled={markRead.isPending}
                    onClick={() => {
                      markRead.mutate(item.id, {
                        onSuccess: () => onReadSuccess?.(),
                      })
                    }}
                  >
                    Mark read
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  )
}

function AuthSessionConsumer() {
  const { user, status, logout, setAuthUser } = useAuth()
  const userId = status === 'authed' && user ? user.id : undefined

  return (
    <div data-testid="auth-session-root">
      <div data-testid="auth-status">{status}</div>
      <div data-testid="auth-user-label">{user ? `User ${user.id}` : 'Anonymous'}</div>
      <NotificationCountBadge userId={userId} />
      <NotificationInboxList userId={userId} />
      <button data-testid="auth-logout-btn" onClick={() => void logout()}>
        Log out
      </button>
      <button
        data-testid="switch-to-user-b-btn"
        onClick={() => {
          setAuthUser({
            id: 20,
            email: 'bob@example.com',
            displayName: 'Bob Member',
            isAdmin: false,
          })
        }}
      >
        Switch to Bob
      </button>
    </div>
  )
}

// --- Test Suite ---

describe('Notification Hooks Session & Polling Lifecycle', () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    vi.restoreAllMocks()
    originalFetch = globalThis.fetch
    setAccessToken(null)
    setOnUnauthorized(null)
  })

  afterEach(() => {
    vi.useRealTimers()
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
    setAccessToken(null)
    setOnUnauthorized(null)
  })

  describe('1. Auth restoration and undefined user gating', () => {
    it('disables summary and infinite list queries when userId is undefined (auth restoring or anonymous)', async () => {
      const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString()
        return Promise.resolve(jsonResponse({ error: 'unexpected call to ' + url }, 500))
      })
      globalThis.fetch = fetchMock

      const client = createTestQueryClient()
      render(
        <QueryClientProvider client={client}>
          <NotificationCountBadge userId={undefined} />
          <NotificationInboxList userId={undefined} />
        </QueryClientProvider>,
      )

      expect(screen.getByTestId('badge-state')).toHaveTextContent('disabled-restoring')
      expect(screen.getByTestId('inbox-list-state')).toHaveTextContent('disabled-restoring')
      expect(screen.queryByRole('alert')).toBeNull()
      expect(screen.queryByText(/unread/i)).toBeNull()

      // Confirm no network requests were dispatched to notification endpoints
      const notificationCalls = fetchMock.mock.calls.filter((call) => {
        const url = String(call[0])
        return url.includes('/notifications')
      })
      expect(notificationCalls.length).toBe(0)
    })

    it('enables queries and fetches data once auth resolves and userId transitions from undefined to defined', async () => {
      const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString()
        if (url.includes('/notifications/summary')) {
          return Promise.resolve(jsonResponse({ unreadCount: 3 }))
        }
        if (url.includes('/notifications')) {
          return Promise.resolve(
            jsonResponse({
              notifications: [
                createNotification({ id: 1, itemTitle: 'First notification' }),
                createNotification({ id: 2, itemTitle: 'Second notification' }),
              ],
              nextCursor: null,
            }),
          )
        }
        return Promise.resolve(jsonResponse({ error: 'not found' }, 404))
      })
      globalThis.fetch = fetchMock

      const client = createTestQueryClient()
      const { rerender } = render(
        <QueryClientProvider client={client}>
          <NotificationCountBadge userId={undefined} />
          <NotificationInboxList userId={undefined} />
        </QueryClientProvider>,
      )

      expect(screen.getByTestId('badge-state')).toHaveTextContent('disabled-restoring')
      expect(screen.getByTestId('inbox-list-state')).toHaveTextContent('disabled-restoring')

      // Auth completes and provides an authenticated userId (42)
      rerender(
        <QueryClientProvider client={client}>
          <NotificationCountBadge userId={42} />
          <NotificationInboxList userId={42} />
        </QueryClientProvider>,
      )

      await waitFor(() => {
        expect(screen.getByTestId('badge-state')).toHaveTextContent('3 unread')
        expect(screen.getByTestId('item-title-1')).toHaveTextContent('First notification')
        expect(screen.getByTestId('item-title-2')).toHaveTextContent('Second notification')
      })
    })

    it('never queries notifications during AuthProvider session restoration or when session restore fails (anon)', async () => {
      let notificationCallsCount = 0

      globalThis.fetch = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString()
        if (url.includes('/auth/refresh')) {
          return jsonResponse({ error: 'unauthorized' }, 401)
        }
        if (url.includes('/notifications')) {
          notificationCallsCount++
          return jsonResponse({ error: 'should not be called' }, 500)
        }
        return jsonResponse({ error: 'not found' }, 404)
      })

      const client = createTestQueryClient()
      render(
        <QueryClientProvider client={client}>
          <AuthProvider>
            <AuthSessionConsumer />
          </AuthProvider>
        </QueryClientProvider>,
      )

      await waitFor(() => {
        expect(screen.getByTestId('auth-status')).toHaveTextContent('anon')
      })

      expect(screen.getByTestId('badge-state')).toHaveTextContent('disabled-restoring')
      expect(screen.getByTestId('inbox-list-state')).toHaveTextContent('disabled-restoring')
      expect(notificationCallsCount).toBe(0)
    })
  })

  describe('2. Account switching and session isolation', () => {
    it('switching userId from Account A to Account B never displays Account A data to Account B', async () => {
      let currentUserId = 1

      globalThis.fetch = vi.fn().mockImplementation((input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString()
        if (url.includes('/notifications/summary')) {
          return Promise.resolve(
            jsonResponse({
              unreadCount: currentUserId === 1 ? 7 : 0,
            }),
          )
        }
        if (url.includes('/notifications')) {
          return Promise.resolve(
            jsonResponse({
              notifications:
                currentUserId === 1
                  ? [createNotification({ id: 100, itemTitle: 'Confidential Plan A' })]
                  : [],
              nextCursor: null,
            }),
          )
        }
        return Promise.resolve(jsonResponse({ error: 'not found' }, 404))
      })

      const client = createTestQueryClient()

      const { rerender } = render(
        <QueryClientProvider client={client}>
          <CombinedNotificationsInbox userId={1} />
        </QueryClientProvider>,
      )

      await waitFor(() => {
        expect(screen.getByTestId('inbox-unread-count')).toHaveTextContent('7 unread')
        expect(screen.getByTestId('row-title-100')).toHaveTextContent('Confidential Plan A')
      })

      // Switch to User B (id: 2)
      currentUserId = 2
      rerender(
        <QueryClientProvider client={client}>
          <CombinedNotificationsInbox userId={2} />
        </QueryClientProvider>,
      )

      // CRITICAL SECURITY ASSERTION:
      // User A data must NEVER be displayed under User B session
      expect(screen.queryByText('Confidential Plan A')).toBeNull()
      expect(screen.queryByText('7 unread')).toBeNull()

      await waitFor(() => {
        expect(screen.getByTestId('inbox-unread-count')).toHaveTextContent('0 unread')
        expect(screen.getByTestId('inbox-empty-message')).toHaveTextContent('No notifications found')
      })

      // User A's confidential item remains completely absent
      expect(screen.queryByText('Confidential Plan A')).toBeNull()
    })

    it('switching accounts via AuthProvider clears cache and prevents data leakage', async () => {
      const userA: User = {
        id: 10,
        email: 'alice@example.com',
        displayName: 'Alice Lead',
        isAdmin: false,
      }

      let activeUser: User = userA

      globalThis.fetch = vi.fn().mockImplementation((input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString()
        if (url.includes('/auth/refresh')) {
          return Promise.resolve(
            jsonResponse({
              accessToken: 'mock-token-' + activeUser.id,
              user: activeUser,
            }),
          )
        }
        if (url.includes('/notifications/summary')) {
          return Promise.resolve(
            jsonResponse({
              unreadCount: activeUser.id === 10 ? 4 : 1,
            }),
          )
        }
        if (url.includes('/notifications')) {
          return Promise.resolve(
            jsonResponse({
              notifications:
                activeUser.id === 10
                  ? [createNotification({ id: 10, itemTitle: 'Alice Secret Project' })]
                  : [createNotification({ id: 20, itemTitle: 'Bob Assigned Task' })],
              nextCursor: null,
            }),
          )
        }
        return Promise.resolve(jsonResponse({ error: 'not found' }, 404))
      })

      const client = createTestQueryClient()
      render(
        <QueryClientProvider client={client}>
          <AuthProvider>
            <AuthSessionConsumer />
          </AuthProvider>
        </QueryClientProvider>,
      )

      await waitFor(() => {
        expect(screen.getByTestId('auth-status')).toHaveTextContent('authed')
        expect(screen.getByTestId('badge-state')).toHaveTextContent('4 unread')
        expect(screen.getByTestId('item-title-10')).toHaveTextContent('Alice Secret Project')
      })

      // Point the mock at Bob before the auth identity changes so the refetch
      // cannot still serve Alice's payload under Bob's query key.
      activeUser = {
        id: 20,
        email: 'bob@example.com',
        displayName: 'Bob Member',
        isAdmin: false,
      }
      fireEvent.click(screen.getByTestId('switch-to-user-b-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('auth-user-label')).toHaveTextContent('User 20')
        expect(screen.getByTestId('badge-state')).toHaveTextContent('1 unread')
        expect(screen.getByTestId('item-title-20')).toHaveTextContent('Bob Assigned Task')
      })

      expect(screen.queryByText('Alice Secret Project')).toBeNull()
      expect(screen.queryByText('4 unread')).toBeNull()
    })

    it('logging out immediately removes notifications from display and disables queries', async () => {
      globalThis.fetch = vi.fn().mockImplementation((input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString()
        if (url.includes('/notifications/summary')) {
          return Promise.resolve(jsonResponse({ unreadCount: 2 }))
        }
        if (url.includes('/notifications')) {
          return Promise.resolve(
            jsonResponse({
              notifications: [createNotification({ id: 50, itemTitle: 'Pending Review' })],
              nextCursor: null,
            }),
          )
        }
        return Promise.resolve(jsonResponse({ error: 'not found' }, 404))
      })

      const client = createTestQueryClient()
      const { rerender } = render(
        <QueryClientProvider client={client}>
          <CombinedNotificationsInbox userId={1} />
        </QueryClientProvider>,
      )

      await waitFor(() => {
        expect(screen.getByTestId('inbox-unread-count')).toHaveTextContent('2 unread')
        expect(screen.getByTestId('row-title-50')).toHaveTextContent('Pending Review')
      })

      // User logs out -> userId becomes undefined
      rerender(
        <QueryClientProvider client={client}>
          <CombinedNotificationsInbox userId={undefined} />
        </QueryClientProvider>,
      )

      expect(screen.getByTestId('inbox-session-state')).toHaveTextContent('inactive')
      expect(screen.queryByText('Pending Review')).toBeNull()
      expect(screen.queryByText('2 unread')).toBeNull()
    })
  })

  describe('3. Polling lifecycle (no polling after unmount or logout)', () => {
    it('stops polling summary query after component unmounts', async () => {
      let fetchCount = 0
      globalThis.fetch = vi.fn().mockImplementation((input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString()
        if (url.includes('/notifications/summary')) {
          fetchCount++
          return Promise.resolve(jsonResponse({ unreadCount: 2 }))
        }
        return Promise.resolve(jsonResponse({ error: 'not found' }, 404))
      })

      const client = createTestQueryClient()
      const { unmount } = render(
        <QueryClientProvider client={client}>
          <NotificationCountBadge userId={1} />
        </QueryClientProvider>,
      )

      await waitFor(() => {
        expect(screen.getByTestId('badge-state')).toHaveTextContent('2 unread')
      })
      expect(fetchCount).toBe(1)

      // Turn on fake timers to test polling intervals
      vi.useFakeTimers()

      // Unmount the component
      unmount()

      const callsAtUnmount = fetchCount

      // Advance time by 30 seconds
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000)
      })

      // Advance time by another 60 seconds
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000)
      })

      // Verify fetchCount has NOT increased after unmount
      expect(fetchCount).toBe(callsAtUnmount)
    })

    it('stops polling when user logs out while component remains mounted', async () => {
      let fetchCount = 0
      globalThis.fetch = vi.fn().mockImplementation((input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString()
        if (url.includes('/notifications/summary')) {
          fetchCount++
          return Promise.resolve(jsonResponse({ unreadCount: 2 }))
        }
        return Promise.resolve(jsonResponse({ error: 'not found' }, 404))
      })

      const client = createTestQueryClient()
      const { rerender } = render(
        <QueryClientProvider client={client}>
          <NotificationCountBadge userId={1} />
        </QueryClientProvider>,
      )

      await waitFor(() => {
        expect(screen.getByTestId('badge-state')).toHaveTextContent('2 unread')
      })
      expect(fetchCount).toBe(1)

      vi.useFakeTimers()

      // Simulate logout while badge remains mounted (e.g. in persistent AppLayout header)
      rerender(
        <QueryClientProvider client={client}>
          <NotificationCountBadge userId={undefined} />
        </QueryClientProvider>,
      )

      expect(screen.getByTestId('badge-state')).toHaveTextContent('disabled-restoring')
      const callsAtLogout = fetchCount

      // Advance 30s and 60s
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000)
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000)
      })

      expect(fetchCount).toBe(callsAtLogout)
    })
  })

  describe('4. Foreground discovery and error handling', () => {
    it('invalidation or refetch discovers new unread count when server state changes', async () => {
      let serverCount = 1
      globalThis.fetch = vi.fn().mockImplementation((input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString()
        if (url.includes('/notifications/summary')) {
          return Promise.resolve(jsonResponse({ unreadCount: serverCount }))
        }
        return Promise.resolve(jsonResponse({ error: 'not found' }, 404))
      })

      const client = createTestQueryClient()
      render(
        <QueryClientProvider client={client}>
          <NotificationCountBadge userId={1} />
        </QueryClientProvider>,
      )

      await waitFor(() => {
        expect(screen.getByTestId('badge-state')).toHaveTextContent('1 unread')
      })

      serverCount = 5
      await act(async () => {
        await client.invalidateQueries({ queryKey: ['notifications', 1, 'summary'] })
      })
      await waitFor(() => {
        expect(screen.getByTestId('badge-state')).toHaveTextContent('5 unread')
      })

      serverCount = 0
      await act(async () => {
        await client.invalidateQueries({ queryKey: ['notifications', 1, 'summary'] })
      })
      await waitFor(() => {
        expect(screen.getByTestId('badge-state')).toHaveTextContent('No unread')
      })
    })

    it('initial summary count failure is not fabricated as zero', async () => {
      globalThis.fetch = vi.fn().mockImplementation((input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString()
        if (url.includes('/notifications/summary')) {
          return Promise.resolve(
            jsonResponse({ error: { message: 'Database connection failed' } }, 500),
          )
        }
        return Promise.resolve(jsonResponse({ error: 'not found' }, 404))
      })

      const client = createTestQueryClient()
      render(
        <QueryClientProvider client={client}>
          <NotificationCountBadge userId={1} />
        </QueryClientProvider>,
      )

      await waitFor(() => {
        expect(screen.getByTestId('badge-state')).toHaveAttribute('data-error', 'true')
      })

      expect(screen.getByRole('alert')).toBeInTheDocument()

      // Failure must not be displayed as a known-zero unread count.
      // Do not assert absence of the digit "0" — HTTP status text can include it (500).
      expect(screen.queryByText(/0 unread/i)).toBeNull()
      expect(screen.queryByText(/No unread/i)).toBeNull()
      expect(screen.getByTestId('badge-state')).not.toHaveAttribute('data-unread', '0')
    })

    it('subsequent fetch failure does not fabricate zero over previously confirmed count', async () => {
      let shouldFail = false

      globalThis.fetch = vi.fn().mockImplementation((input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString()
        if (url.includes('/notifications/summary')) {
          if (shouldFail) {
            return Promise.resolve(
              jsonResponse({ error: { message: 'Gateway timeout' } }, 504),
            )
          }
          return Promise.resolve(jsonResponse({ unreadCount: 4 }))
        }
        return Promise.resolve(jsonResponse({ error: 'not found' }, 404))
      })

      const client = createTestQueryClient()
      render(
        <QueryClientProvider client={client}>
          <NotificationCountBadge userId={1} />
        </QueryClientProvider>,
      )

      await waitFor(() => {
        expect(screen.getByTestId('badge-state')).toHaveTextContent('4 unread')
      })

      // Next refetch fails with 504
      shouldFail = true

      await act(async () => {
        await client.refetchQueries({ queryKey: ['notifications', 1, 'summary'] })
      })

      // CRITICAL: Count must NOT become zero upon fetch error!
      expect(screen.queryByText(/0 unread/i)).toBeNull()
      expect(screen.queryByText(/No unread/i)).toBeNull()
    })
    it('inbox list failure distinguishes error from empty inbox and does not show false empty state', async () => {
      globalThis.fetch = vi.fn().mockImplementation((input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString()
        if (url.includes('/notifications')) {
          return Promise.resolve(
            jsonResponse({ error: { message: 'Internal server error' } }, 500),
          )
        }
        return Promise.resolve(jsonResponse({ error: 'not found' }, 404))
      })

      const client = createTestQueryClient()
      render(
        <QueryClientProvider client={client}>
          <NotificationInboxList userId={1} />
        </QueryClientProvider>,
      )

      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeInTheDocument()
      })

      // Must NOT display false empty state
      expect(screen.queryByText('empty')).toBeNull()
      expect(screen.queryByText(/No notifications/i)).toBeNull()
    })
  })

  describe('5. Mutation lifecycle and cache reconciliation', () => {
    it('marking a notification as read invalidates query cache and updates consumer count and status', async () => {
      let isItemRead = false

      globalThis.fetch = vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString()
        const method = init?.method ?? 'GET'

        if (url.includes('/notifications/101/read') && method === 'POST') {
          isItemRead = true
          return Promise.resolve(new Response(null, { status: 204 }))
        }

        if (url.includes('/notifications/summary')) {
          return Promise.resolve(
            jsonResponse({ unreadCount: isItemRead ? 1 : 2 }),
          )
        }

        if (url.includes('/notifications')) {
          return Promise.resolve(
            jsonResponse({
              notifications: [
                createNotification({
                  id: 101,
                  itemTitle: 'Code Review Request',
                  readAt: isItemRead ? '2026-10-18T14:00:00.000Z' : null,
                }),
                createNotification({
                  id: 102,
                  itemTitle: 'Task Assigned',
                  readAt: null,
                }),
              ],
              nextCursor: null,
            }),
          )
        }

        return Promise.resolve(jsonResponse({ error: 'not found' }, 404))
      })

      const client = createTestQueryClient()
      render(
        <QueryClientProvider client={client}>
          <CombinedNotificationsInbox userId={1} />
        </QueryClientProvider>,
      )

      await waitFor(() => {
        expect(screen.getByTestId('inbox-unread-count')).toHaveTextContent('2 unread')
        expect(screen.getByTestId('row-read-status-101')).toHaveTextContent('unread')
        expect(screen.getByTestId('mark-read-btn-101')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('mark-read-btn-101'))

      await waitFor(() => {
        expect(screen.getByTestId('inbox-unread-count')).toHaveTextContent('1 unread')
        expect(screen.getByTestId('row-read-status-101')).toHaveTextContent('read')
        expect(screen.queryByTestId('mark-read-btn-101')).toBeNull()
      })
    })

    it('marking notification read with 404 response invalidates queries to prune revoked notifications', async () => {
      let itemRevoked = false

      globalThis.fetch = vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString()
        const method = init?.method ?? 'GET'

        if (url.includes('/notifications/999/read') && method === 'POST') {
          itemRevoked = true
          return Promise.resolve(
            jsonResponse({ error: { message: 'Notification not found' } }, 404),
          )
        }

        if (url.includes('/notifications/summary')) {
          return Promise.resolve(
            jsonResponse({ unreadCount: itemRevoked ? 0 : 1 }),
          )
        }

        if (url.includes('/notifications')) {
          return Promise.resolve(
            jsonResponse({
              notifications: itemRevoked
                ? []
                : [createNotification({ id: 999, itemTitle: 'Revoked Team Notification' })],
              nextCursor: null,
            }),
          )
        }

        return Promise.resolve(jsonResponse({ error: 'not found' }, 404))
      })

      const client = createTestQueryClient()
      render(
        <QueryClientProvider client={client}>
          <CombinedNotificationsInbox userId={1} />
        </QueryClientProvider>,
      )

      await waitFor(() => {
        expect(screen.getByTestId('inbox-unread-count')).toHaveTextContent('1 unread')
        expect(screen.getByTestId('mark-read-btn-999')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('mark-read-btn-999'))

      await waitFor(() => {
        expect(screen.getByTestId('inbox-unread-count')).toHaveTextContent('0 unread')
        expect(screen.getByTestId('inbox-empty-message')).toHaveTextContent('No notifications found')
      })

      expect(screen.queryByTestId('row-title-999')).toBeNull()
    })

    it('markAllNotificationsRead invalidates queries and updates consumer to zero unread', async () => {
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
            jsonResponse({ unreadCount: allRead ? 0 : 3 }),
          )
        }

        if (url.includes('/notifications')) {
          return Promise.resolve(
            jsonResponse({
              notifications: [
                createNotification({ id: 1, readAt: allRead ? '2026-10-18T15:00:00.000Z' : null }),
                createNotification({ id: 2, readAt: allRead ? '2026-10-18T15:00:00.000Z' : null }),
                createNotification({ id: 3, readAt: allRead ? '2026-10-18T15:00:00.000Z' : null }),
              ],
              nextCursor: null,
            }),
          )
        }

        return Promise.resolve(jsonResponse({ error: 'not found' }, 404))
      })

      const client = createTestQueryClient()
      render(
        <QueryClientProvider client={client}>
          <CombinedNotificationsInbox userId={1} />
        </QueryClientProvider>,
      )

      await waitFor(() => {
        expect(screen.getByTestId('inbox-unread-count')).toHaveTextContent('3 unread')
      })

      const markAllBtn = screen.getByTestId('mark-all-read-btn')
      expect(markAllBtn).toBeEnabled()
      fireEvent.click(markAllBtn)

      await waitFor(() => {
        expect(screen.getByTestId('inbox-unread-count')).toHaveTextContent('0 unread')
        expect(screen.queryByRole('button', { name: 'Mark read' })).toBeNull()
      })
    })
  })
})
