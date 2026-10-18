import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { NotificationLiveProvider } from './NotificationLiveProvider'
import { AuthContext, type AuthContextValue, type User } from '../auth/AuthContext'
import type { CollaborationNotification } from '../api/types'
import { createTestQueryClient } from '../test/test-utils'
import { useInfiniteNotifications } from '../api/hooks'
import { connectNotificationStream } from '../api/notificationStream'
import { Notifications } from '../pages/Notifications'

const mockUserOne: User = {
  id: 1,
  email: 'user1@example.com',
  displayName: 'User One',
  isAdmin: false,
}

function makeAuthValue(user: User | null = mockUserOne, status: 'authed' | 'loading' | 'anon' = 'authed'): AuthContextValue {
  return {
    user,
    status,
    login: vi.fn(),
    logout: vi.fn(),
    setAuthUser: vi.fn(),
  }
}

function createNotification(overrides: Partial<CollaborationNotification> = {}): CollaborationNotification {
  return {
    id: 10,
    type: 'assigned',
    workItemId: 100,
    itemTitle: 'Refactor notification stream',
    actor: { id: 3, displayName: 'Alice Engineer' },
    fromStatus: null,
    toStatus: null,
    createdAt: '2026-10-18T12:00:00.000Z',
    readAt: null,
    ...overrides,
  }
}

interface MockSSEStreamController {
  stream: ReadableStream<Uint8Array>
  emitEvent: (event: string, data: unknown) => void
  emitRaw: (raw: string) => void
  close: () => void
}

function createMockSSEStream(): MockSSEStreamController {
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c
    },
  })
  const encoder = new TextEncoder()
  return {
    stream,
    emitEvent: (event: string, data: unknown) => {
      if (!controller) return
      const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
      controller.enqueue(encoder.encode(payload))
    },
    emitRaw: (raw: string) => {
      if (!controller) return
      controller.enqueue(encoder.encode(raw))
    },
    close: () => {
      controller?.close()
    },
  }
}

describe('NotificationLiveProvider', () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    vi.restoreAllMocks()
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    vi.useRealTimers()
    globalThis.fetch = originalFetch
  })

  it('removes revoked team history from the visible inbox after a summary event', async () => {
    const sse = createMockSSEStream()
    const notification = createNotification({ itemTitle: 'Revoked team investigation' })
    let membershipActive = true
    globalThis.fetch = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.includes('/notifications/stream')) {
        return Promise.resolve(new Response(sse.stream, {
          headers: { 'Content-Type': 'text/event-stream' },
        }))
      }
      const body = url.includes('/notifications/summary')
        ? { unreadCount: membershipActive ? 1 : 0 }
        : { notifications: membershipActive ? [notification] : [], nextCursor: null }
      return Promise.resolve(new Response(JSON.stringify(body), {
        headers: { 'Content-Type': 'application/json' },
      }))
    })
    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <AuthContext.Provider value={makeAuthValue()}>
          <MemoryRouter>
            <NotificationLiveProvider>
              <Notifications />
            </NotificationLiveProvider>
          </MemoryRouter>
        </AuthContext.Provider>
      </QueryClientProvider>,
    )
    await screen.findByText('Revoked team investigation')
    await act(async () => {
      sse.emitEvent('snapshot', { notifications: [notification], unreadCount: 1 })
    })
    membershipActive = false
    await act(async () => {
      sse.emitEvent('summary', { unreadCount: 0 })
    })
    await waitFor(() => {
      expect(screen.queryByText('Revoked team investigation')).not.toBeInTheDocument()
    })
    expect(await screen.findByText(/No notifications yet/)).toBeInTheDocument()
    sse.close()
  })

  it('establishes baseline on first snapshot and suppresses toasts for historical notifications', async () => {
    const sse = createMockSSEStream()

    globalThis.fetch = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.includes('/notifications/stream')) {
        return Promise.resolve(
          new Response(sse.stream, {
            status: 200,
            headers: { 'Content-Type': 'text/event-stream' },
          }),
        )
      }
      return Promise.resolve(new Response('not found', { status: 404 }))
    })

    const queryClient = createTestQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <AuthContext.Provider value={makeAuthValue(mockUserOne)}>
          <MemoryRouter>
            <NotificationLiveProvider>
              <div>Dashboard Content</div>
            </NotificationLiveProvider>
          </MemoryRouter>
        </AuthContext.Provider>
      </QueryClientProvider>,
    )

    const notif1 = createNotification({ id: 1, itemTitle: 'Historical Task 1' })
    const notif2 = createNotification({ id: 2, itemTitle: 'Historical Task 2' })

    await act(async () => {
      sse.emitEvent('snapshot', {
        notifications: [notif1, notif2],
        unreadCount: 2,
      })
    })

    await waitFor(() => {
      const summary = queryClient.getQueryData<{ unreadCount: number }>(['notifications', 1, 'summary'])
      expect(summary?.unreadCount).toBe(2)
    })

    expect(screen.queryByTestId('notification-toast-1')).toBeNull()
    expect(screen.queryByTestId('notification-toast-2')).toBeNull()
    expect(screen.queryByTestId('notification-toasts-container')).toBeNull()
  })

  it('displays new notifications in FIFO order with max 3 visible stack', async () => {
    const sse = createMockSSEStream()

    globalThis.fetch = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.includes('/notifications/stream')) {
        return Promise.resolve(
          new Response(sse.stream, {
            status: 200,
            headers: { 'Content-Type': 'text/event-stream' },
          }),
        )
      }
      return Promise.resolve(new Response('not found', { status: 404 }))
    })

    const queryClient = createTestQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <AuthContext.Provider value={makeAuthValue(mockUserOne)}>
          <MemoryRouter>
            <NotificationLiveProvider>
              <div>Dashboard Content</div>
            </NotificationLiveProvider>
          </MemoryRouter>
        </AuthContext.Provider>
      </QueryClientProvider>,
    )

    await act(async () => {
      sse.emitEvent('snapshot', { notifications: [], unreadCount: 0 })
    })

    const n1 = createNotification({ id: 11, itemTitle: 'Item One', workItemId: 101, actor: { id: 3, displayName: 'Alice' } })
    const n2 = createNotification({ id: 12, itemTitle: 'Item Two', workItemId: 102, type: 'comment_added', actor: { id: 4, displayName: 'Bob' } })
    const n3 = createNotification({ id: 13, itemTitle: 'Item Three', workItemId: 103, type: 'approval_requested', actor: { id: 5, displayName: 'Charlie' } })
    const n4 = createNotification({ id: 14, itemTitle: 'Item Four', workItemId: 104, actor: { id: 6, displayName: 'Dana' } })

    await act(async () => {
      sse.emitEvent('notifications', {
        notifications: [n1, n2, n3, n4],
        unreadCount: 4,
      })
    })

    await waitFor(() => {
      expect(screen.getByTestId('notification-toast-11')).toBeInTheDocument()
      expect(screen.getByTestId('notification-toast-12')).toBeInTheDocument()
      expect(screen.getByTestId('notification-toast-13')).toBeInTheDocument()
      expect(screen.queryByTestId('notification-toast-14')).toBeNull()
    })

    const toast1 = screen.getByTestId('notification-toast-11')
    expect(toast1).toHaveTextContent('Alice')
    expect(toast1).toHaveTextContent('Assigned to you')
    expect(toast1).toHaveTextContent('Item One')

    const dismissButtons = screen.getAllByRole('button', { name: 'Dismiss notification' })
    await act(async () => {
      fireEvent.click(dismissButtons[0]!)
    })

    await waitFor(() => {
      expect(screen.queryByTestId('notification-toast-11')).toBeNull()
      expect(screen.getByTestId('notification-toast-14')).toBeInTheDocument()
    })
  })

  it('parses chunked frames and CRLF line breaks accurately', async () => {
    const sse = createMockSSEStream()

    globalThis.fetch = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.includes('/notifications/stream')) {
        return Promise.resolve(
          new Response(sse.stream, {
            status: 200,
            headers: { 'Content-Type': 'text/event-stream' },
          }),
        )
      }
      return Promise.resolve(new Response('not found', { status: 404 }))
    })

    const queryClient = createTestQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <AuthContext.Provider value={makeAuthValue(mockUserOne)}>
          <MemoryRouter>
            <NotificationLiveProvider>
              <div>Dashboard Content</div>
            </NotificationLiveProvider>
          </MemoryRouter>
        </AuthContext.Provider>
      </QueryClientProvider>,
    )

    await act(async () => {
      sse.emitRaw('event: snapshot\r\ndata: {"notifications":[],"unreadCount":0}\r\n\r\n')
    })

    await act(async () => {
      sse.emitRaw('event: notifi')
    })
    await act(async () => {
      sse.emitRaw('cations\r')
    })
    await act(async () => {
      sse.emitRaw('\ndata: {"notifications":[{"id":55,"type":"assigned","workItemId":99,"itemTitle":"Chunk Task","actor":{"id":2,"displayName":"Eve"},"fromStatus":null,"toStatus":null,"createdAt":"2026-10-18T10:00:00Z","readAt":null}],"unreadCount":1}\r\n\r\n')
    })

    await waitFor(() => {
      expect(screen.getByTestId('notification-toast-55')).toBeInTheDocument()
      expect(screen.getByText('Chunk Task')).toBeInTheDocument()
      expect(screen.getByText('Eve')).toBeInTheDocument()
    })
  })

  it('deduplicates existing notifications on reconnect snapshot and only toasts new missed IDs', async () => {
    const sse1 = createMockSSEStream()

    globalThis.fetch = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.includes('/notifications/stream')) {
        return Promise.resolve(
          new Response(sse1.stream, {
            status: 200,
            headers: { 'Content-Type': 'text/event-stream' },
          }),
        )
      }
      return Promise.resolve(new Response('not found', { status: 404 }))
    })

    const queryClient = createTestQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <AuthContext.Provider value={makeAuthValue(mockUserOne)}>
          <MemoryRouter>
            <NotificationLiveProvider>
              <div>Dashboard Content</div>
            </NotificationLiveProvider>
          </MemoryRouter>
        </AuthContext.Provider>
      </QueryClientProvider>,
    )

    const initialNotif = createNotification({ id: 21, itemTitle: 'Initial Task' })

    await act(async () => {
      sse1.emitEvent('snapshot', {
        notifications: [initialNotif],
        unreadCount: 1,
      })
    })

    expect(screen.queryByTestId('notification-toast-21')).toBeNull()

    const newMissedNotif = createNotification({ id: 22, itemTitle: 'Missed Task' })
    await act(async () => {
      sse1.emitEvent('snapshot', {
        notifications: [initialNotif, newMissedNotif],
        unreadCount: 2,
      })
    })

    await waitFor(() => {
      expect(screen.queryByTestId('notification-toast-21')).toBeNull()
      expect(screen.getByTestId('notification-toast-22')).toBeInTheDocument()
    })
  })

  it('aborts active stream and immediately clears toasts on logout or account switch', async () => {
    const sse = createMockSSEStream()

    globalThis.fetch = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.includes('/notifications/stream')) {
        return Promise.resolve(
          new Response(sse.stream, {
            status: 200,
            headers: { 'Content-Type': 'text/event-stream' },
          }),
        )
      }
      return Promise.resolve(new Response('not found', { status: 404 }))
    })

    const queryClient = createTestQueryClient()
    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <AuthContext.Provider value={makeAuthValue(mockUserOne)}>
          <MemoryRouter>
            <NotificationLiveProvider>
              <div>Dashboard Content</div>
            </NotificationLiveProvider>
          </MemoryRouter>
        </AuthContext.Provider>
      </QueryClientProvider>,
    )

    await act(async () => {
      sse.emitEvent('snapshot', { notifications: [], unreadCount: 0 })
    })

    const toastNotif = createNotification({ id: 33, itemTitle: 'Toasted Task' })
    await act(async () => {
      sse.emitEvent('notifications', {
        notifications: [toastNotif],
        unreadCount: 1,
      })
    })

    await waitFor(() => {
      expect(screen.getByTestId('notification-toast-33')).toBeInTheDocument()
    })

    rerender(
      <QueryClientProvider client={queryClient}>
        <AuthContext.Provider value={makeAuthValue(null, 'anon')}>
          <MemoryRouter>
            <NotificationLiveProvider>
              <div>Dashboard Content</div>
            </NotificationLiveProvider>
          </MemoryRouter>
        </AuthContext.Provider>
      </QueryClientProvider>,
    )

    expect(screen.queryByTestId('notification-toast-33')).toBeNull()
    expect(screen.queryByTestId('notification-toasts-container')).toBeNull()
  })

  it('navigating item link in toast does not trigger mark-as-read mutation', async () => {
    const sse = createMockSSEStream()
    let markReadCalled = false

    globalThis.fetch = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.includes('/notifications/stream')) {
        return Promise.resolve(
          new Response(sse.stream, {
            status: 200,
            headers: { 'Content-Type': 'text/event-stream' },
          }),
        )
      }
      if (url.includes('/read')) {
        markReadCalled = true
        return Promise.resolve(new Response(null, { status: 204 }))
      }
      return Promise.resolve(new Response('not found', { status: 404 }))
    })

    const queryClient = createTestQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <AuthContext.Provider value={makeAuthValue(mockUserOne)}>
          <MemoryRouter>
            <NotificationLiveProvider>
              <div>Dashboard Content</div>
            </NotificationLiveProvider>
          </MemoryRouter>
        </AuthContext.Provider>
      </QueryClientProvider>,
    )

    await act(async () => {
      sse.emitEvent('snapshot', { notifications: [], unreadCount: 0 })
    })

    const notif = createNotification({ id: 44, workItemId: 999, itemTitle: 'Special Item' })
    await act(async () => {
      sse.emitEvent('notifications', {
        notifications: [notif],
        unreadCount: 1,
      })
    })

    await waitFor(() => {
      expect(screen.getByTestId('notification-toast-44')).toBeInTheDocument()
    })

    const link = screen.getByRole('link', { name: 'Special Item' })
    expect(link).toHaveAttribute('href', '/items/999')

    await act(async () => {
      fireEvent.click(link)
    })

    expect(markReadCalled).toBe(false)
  })

  it('dismisses toast via 44px close target', async () => {
    const sse = createMockSSEStream()

    globalThis.fetch = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.includes('/notifications/stream')) {
        return Promise.resolve(
          new Response(sse.stream, {
            status: 200,
            headers: { 'Content-Type': 'text/event-stream' },
          }),
        )
      }
      return Promise.resolve(new Response('not found', { status: 404 }))
    })

    const queryClient = createTestQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <AuthContext.Provider value={makeAuthValue(mockUserOne)}>
          <MemoryRouter>
            <NotificationLiveProvider>
              <div>Dashboard Content</div>
            </NotificationLiveProvider>
          </MemoryRouter>
        </AuthContext.Provider>
      </QueryClientProvider>,
    )

    await act(async () => {
      sse.emitEvent('snapshot', { notifications: [], unreadCount: 0 })
    })

    await act(async () => {
      sse.emitEvent('notifications', {
        notifications: [createNotification({ id: 50, itemTitle: 'Dismiss Me' })],
        unreadCount: 1,
      })
    })

    await waitFor(() => {
      expect(screen.getByTestId('notification-toast-50')).toBeInTheDocument()
    })

    const closeButton = screen.getByRole('button', { name: 'Dismiss notification' })
    expect(closeButton).toBeInTheDocument()

    await act(async () => {
      fireEvent.click(closeButton)
    })

    await waitFor(() => {
      expect(screen.queryByTestId('notification-toast-50')).toBeNull()
    })
  })

  it('pauses auto-dismiss countdown on hover and focus', async () => {
    vi.useFakeTimers()
    const sse = createMockSSEStream()

    globalThis.fetch = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.includes('/notifications/stream')) {
        return Promise.resolve(
          new Response(sse.stream, {
            status: 200,
            headers: { 'Content-Type': 'text/event-stream' },
          }),
        )
      }
      return Promise.resolve(new Response('not found', { status: 404 }))
    })

    const queryClient = createTestQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <AuthContext.Provider value={makeAuthValue(mockUserOne)}>
          <MemoryRouter>
            <NotificationLiveProvider>
              <div>Dashboard Content</div>
            </NotificationLiveProvider>
          </MemoryRouter>
        </AuthContext.Provider>
      </QueryClientProvider>,
    )

    await act(async () => {
      sse.emitEvent('snapshot', { notifications: [], unreadCount: 0 })
      await vi.advanceTimersByTimeAsync(0)
    })

    await act(async () => {
      sse.emitEvent('notifications', {
        notifications: [createNotification({ id: 60, itemTitle: 'Hover Pause Test' })],
        unreadCount: 1,
      })
      await vi.advanceTimersByTimeAsync(0)
    })

    const toast = screen.getByTestId('notification-toast-60')
    expect(toast).toBeInTheDocument()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000)
    })
    expect(screen.getByTestId('notification-toast-60')).toBeInTheDocument()

    await act(async () => {
      fireEvent.mouseEnter(toast)
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(8000)
    })
    expect(screen.getByTestId('notification-toast-60')).toBeInTheDocument()

    await act(async () => {
      fireEvent.mouseLeave(toast)
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4500)
    })

    expect(screen.queryByTestId('notification-toast-60')).toBeNull()
  })

  it('invalidates inbox list query on summary event, updating consumer DOM', async () => {
    const sse = createMockSSEStream()
    let inboxCallCount = 0

    globalThis.fetch = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.includes('/notifications/stream')) {
        return Promise.resolve(
          new Response(sse.stream, {
            status: 200,
            headers: { 'Content-Type': 'text/event-stream' },
          }),
        )
      }
      if (url.includes('/notifications')) {
        inboxCallCount++
        const notifications =
          inboxCallCount === 1
            ? [
                createNotification({ id: 101, itemTitle: 'Task Retained' }),
                createNotification({ id: 102, itemTitle: 'Task Removed ElseWhere' }),
              ]
            : [createNotification({ id: 101, itemTitle: 'Task Retained' })]
        return Promise.resolve(
          new Response(
            JSON.stringify({
              notifications,
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

    function InboxConsumer({ userId }: { userId: number }) {
      const { data } = useInfiniteNotifications(userId)
      const items = data?.pages.flatMap((p) => p.notifications) ?? []
      return (
        <div>
          {items.map((item) => (
            <div key={item.id} data-testid={`inbox-row-${item.id}`}>
              {item.itemTitle}
            </div>
          ))}
        </div>
      )
    }

    const queryClient = createTestQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <AuthContext.Provider value={makeAuthValue(mockUserOne)}>
          <MemoryRouter>
            <NotificationLiveProvider>
              <InboxConsumer userId={1} />
            </NotificationLiveProvider>
          </MemoryRouter>
        </AuthContext.Provider>
      </QueryClientProvider>,
    )

    await act(async () => {
      sse.emitEvent('snapshot', { notifications: [], unreadCount: 2 })
    })

    await waitFor(() => {
      expect(screen.getByTestId('inbox-row-101')).toBeInTheDocument()
      expect(screen.getByTestId('inbox-row-102')).toBeInTheDocument()
    })

    await act(async () => {
      sse.emitEvent('summary', { unreadCount: 1 })
    })

    await waitFor(() => {
      expect(screen.getByTestId('inbox-row-101')).toBeInTheDocument()
      expect(screen.queryByTestId('inbox-row-102')).toBeNull()
    })
  })

  it('combines hover and focus transitions so mouseleave does not resume while keyboard focus stays inside', async () => {
    vi.useFakeTimers()
    const sse = createMockSSEStream()

    globalThis.fetch = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.includes('/notifications/stream')) {
        return Promise.resolve(
          new Response(sse.stream, {
            status: 200,
            headers: { 'Content-Type': 'text/event-stream' },
          }),
        )
      }
      return Promise.resolve(new Response('not found', { status: 404 }))
    })

    const queryClient = createTestQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <AuthContext.Provider value={makeAuthValue(mockUserOne)}>
          <MemoryRouter>
            <NotificationLiveProvider>
              <button data-testid="outside-element">Outside</button>
            </NotificationLiveProvider>
          </MemoryRouter>
        </AuthContext.Provider>
      </QueryClientProvider>,
    )

    await act(async () => {
      sse.emitEvent('snapshot', { notifications: [], unreadCount: 0 })
      await vi.advanceTimersByTimeAsync(0)
    })

    await act(async () => {
      sse.emitEvent('notifications', {
        notifications: [createNotification({ id: 70, itemTitle: 'Dual Focus Hover Test' })],
        unreadCount: 1,
      })
      await vi.advanceTimersByTimeAsync(0)
    })

    const toast = screen.getByTestId('notification-toast-70')
    const dismissBtn = screen.getByRole('button', { name: 'Dismiss notification' })
    const outsideBtn = screen.getByTestId('outside-element')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000)
    })
    expect(screen.getByTestId('notification-toast-70')).toBeInTheDocument()

    await act(async () => {
      fireEvent.focus(dismissBtn)
    })

    await act(async () => {
      fireEvent.mouseEnter(toast)
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000)
    })
    expect(screen.getByTestId('notification-toast-70')).toBeInTheDocument()

    await act(async () => {
      fireEvent.mouseLeave(toast)
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000)
    })
    expect(screen.getByTestId('notification-toast-70')).toBeInTheDocument()

    await act(async () => {
      fireEvent.blur(toast, { relatedTarget: outsideBtn })
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000)
    })
    expect(screen.getByTestId('notification-toast-70')).toBeInTheDocument()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500)
    })
    expect(screen.queryByTestId('notification-toast-70')).toBeNull()
  })

  it('sorts batch notifications ascending by ID before enqueue for FIFO display', async () => {
    const sse = createMockSSEStream()

    globalThis.fetch = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.includes('/notifications/stream')) {
        return Promise.resolve(
          new Response(sse.stream, {
            status: 200,
            headers: { 'Content-Type': 'text/event-stream' },
          }),
        )
      }
      return Promise.resolve(new Response('not found', { status: 404 }))
    })

    const queryClient = createTestQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <AuthContext.Provider value={makeAuthValue(mockUserOne)}>
          <MemoryRouter>
            <NotificationLiveProvider>
              <div>Dashboard Content</div>
            </NotificationLiveProvider>
          </MemoryRouter>
        </AuthContext.Provider>
      </QueryClientProvider>,
    )

    await act(async () => {
      sse.emitEvent('snapshot', { notifications: [], unreadCount: 0 })
    })

    const n82 = createNotification({ id: 82, itemTitle: 'Task 82' })
    const n81 = createNotification({ id: 81, itemTitle: 'Task 81' })

    await act(async () => {
      sse.emitEvent('notifications', {
        notifications: [n82, n81],
        unreadCount: 2,
      })
    })

    await waitFor(() => {
      expect(screen.getByTestId('notification-toast-81')).toBeInTheDocument()
      expect(screen.getByTestId('notification-toast-82')).toBeInTheDocument()
    })

    const container = screen.getByTestId('notification-toasts-container')
    const toasts = container.querySelectorAll('[data-testid^="notification-toast-"]')
    expect(toasts[0]).toHaveAttribute('data-testid', 'notification-toast-81')
    expect(toasts[1]).toHaveAttribute('data-testid', 'notification-toast-82')
  })

  it('prevents pending chunks after account switch from rendering or polluting prior account', async () => {
    const sseUser1 = createMockSSEStream()
    const sseUser2 = createMockSSEStream()
    let fetchCalls = 0

    globalThis.fetch = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.includes('/notifications/stream')) {
        fetchCalls++
        if (fetchCalls === 1) {
          return Promise.resolve(
            new Response(sseUser1.stream, {
              status: 200,
              headers: { 'Content-Type': 'text/event-stream' },
            }),
          )
        }
        return Promise.resolve(
          new Response(sseUser2.stream, {
            status: 200,
            headers: { 'Content-Type': 'text/event-stream' },
          }),
        )
      }
      return Promise.resolve(new Response('not found', { status: 404 }))
    })

    const queryClient = createTestQueryClient()
    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <AuthContext.Provider value={makeAuthValue(mockUserOne)}>
          <MemoryRouter>
            <NotificationLiveProvider>
              <div>Dashboard Content</div>
            </NotificationLiveProvider>
          </MemoryRouter>
        </AuthContext.Provider>
      </QueryClientProvider>,
    )

    await act(async () => {
      sseUser1.emitEvent('snapshot', { notifications: [], unreadCount: 0 })
    })

    const mockUserTwo: User = {
      id: 2,
      email: 'user2@example.com',
      displayName: 'User Two',
      isAdmin: false,
    }

    await act(async () => {
      // Resolve the pending read, then switch accounts before its continuation runs.
      sseUser1.emitEvent('notifications', {
        notifications: [createNotification({ id: 999, itemTitle: 'Secret User 1 Item' })],
        unreadCount: 1,
      })
      rerender(
        <QueryClientProvider client={queryClient}>
          <AuthContext.Provider value={makeAuthValue(mockUserTwo)}>
            <MemoryRouter>
              <NotificationLiveProvider>
                <div>Dashboard Content</div>
              </NotificationLiveProvider>
            </MemoryRouter>
          </AuthContext.Provider>
        </QueryClientProvider>,
      )
    })

    expect(screen.queryByTestId('notification-toast-999')).toBeNull()
    expect(screen.queryByText('Secret User 1 Item')).toBeNull()

  })

  it('does not dispatch incomplete non-blank-line terminated frame on connection close', async () => {
    const sse = createMockSSEStream()

    globalThis.fetch = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.includes('/notifications/stream')) {
        return Promise.resolve(
          new Response(sse.stream, {
            status: 200,
            headers: { 'Content-Type': 'text/event-stream' },
          }),
        )
      }
      return Promise.resolve(new Response('not found', { status: 404 }))
    })

    const queryClient = createTestQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <AuthContext.Provider value={makeAuthValue(mockUserOne)}>
          <MemoryRouter>
            <NotificationLiveProvider>
              <div>Dashboard Content</div>
            </NotificationLiveProvider>
          </MemoryRouter>
        </AuthContext.Provider>
      </QueryClientProvider>,
    )

    await act(async () => {
      sse.emitEvent('snapshot', { notifications: [], unreadCount: 0 })
    })

    await act(async () => {
      sse.emitRaw('event: notifications\ndata: {"notifications":[{"id":888,"itemTitle":"Truncated"}]}')
      sse.close()
    })

    expect(screen.queryByTestId('notification-toast-888')).toBeNull()
    expect(screen.queryByText('Truncated')).toBeNull()
  })

  it('validates Content-Type and only resets backoff on valid event receipt', async () => {
    vi.useFakeTimers()
    let fetchCount = 0

    const mockStream1 = createMockSSEStream()
    const mockStream2 = createMockSSEStream()

    globalThis.fetch = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      fetchCount++
      if (fetchCount === 1) {
        return Promise.resolve(
          new Response('<html><body>Login</body></html>', {
            status: 200,
            headers: { 'Content-Type': 'text/html' },
          }),
        )
      }
      if (fetchCount === 2) {
        mockStream1.close()
        return Promise.resolve(
          new Response(mockStream1.stream, {
            status: 200,
            headers: { 'Content-Type': 'text/event-stream' },
          }),
        )
      }
      return Promise.resolve(
        new Response(mockStream2.stream, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        }),
      )
    })

    const onSnapshot = vi.fn()
    const onError = vi.fn()
    const abortController = new AbortController()

    const cleanup = connectNotificationStream({
      signal: abortController.signal,
      onSnapshot,
      onNotifications: vi.fn(),
      onSummary: vi.fn(),
      onError,
      initialBackoffMs: 1000,
      maxBackoffMs: 10000,
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(onError).toHaveBeenCalled()
    expect(fetchCount).toBe(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(999)
    })
    expect(fetchCount).toBe(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(fetchCount).toBe(2)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1999)
    })
    expect(fetchCount).toBe(2)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(fetchCount).toBe(3)

    await act(async () => {
      mockStream2.emitEvent('snapshot', { notifications: [], unreadCount: 0 })
      await vi.advanceTimersByTimeAsync(10)
    })
    expect(onSnapshot).toHaveBeenCalled()

    cleanup()
    abortController.abort()
  })
})
