import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { Routes, Route } from 'react-router-dom'
import { renderWithProviders } from '../test/test-utils'
import { ItemDetail } from './ItemDetail'
import type { WorkItem } from '../api/types'

describe('ItemActions & Optimistic Rollback (Task 4.13)', () => {
  const fetchMock = vi.fn()

  const memberUser = {
    id: 10,
    displayName: 'Charlie Member',
    email: 'charlie@example.com',
  }

  const otherUser = {
    id: 20,
    displayName: 'Alice Other',
    email: 'alice@example.com',
  }

  const leadUser = {
    id: 5,
    displayName: 'Dana Lead',
    email: 'dana@example.com',
  }

  const baseItem: WorkItem = {
    id: 42,
    teamId: 1,
    title: 'Outage on payment webhook service',
    description: 'Third-party webhooks failing with 504 timeouts.',
    type: 'payment',
    priority: 'urgent',
    status: 'open',
    assigneeId: null,
    createdBy: 10,
    dueAt: '2026-10-25T15:00:00.000Z',
    version: 1,
    createdAt: '2026-10-18T08:00:00.000Z',
    updatedAt: '2026-10-18T08:00:00.000Z',
    assignee: null,
    creator: { id: 10, displayName: 'Charlie Member', email: 'charlie@example.com' },
  }

  beforeEach(() => {
    vi.restoreAllMocks()
    fetchMock.mockReset()
    globalThis.fetch = fetchMock
  })

  const setupItemFetch = (item: WorkItem) => {
    fetchMock.mockImplementation((urlStr: string | URL | Request) => {
      const url = typeof urlStr === 'string' ? urlStr : urlStr.toString()
      if (url.includes('/items/42/activity')) {
        return Promise.resolve(
          new Response(JSON.stringify({ events: [], nextCursor: null }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }
      if (url.includes('/items/42')) {
        return Promise.resolve(
          new Response(JSON.stringify({ item }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }
      return Promise.resolve(new Response('not found', { status: 404 }))
    })
  }

  it('renders Claim button for open & unassigned items to member and lead, but not to viewer', async () => {
    setupItemFetch(baseItem)

    // Render as member
    const { unmount } = renderWithProviders(
      <Routes>
        <Route
          path="/items/:id"
          element={<ItemDetail currentUser={memberUser} userRole="member" />}
        />
      </Routes>,
      { route: '/items/42' },
    )

    await waitFor(() => {
      expect(screen.getByTestId('claim-button')).toBeInTheDocument()
    })
    unmount()

    // Render as viewer
    renderWithProviders(
      <Routes>
        <Route
          path="/items/:id"
          element={<ItemDetail currentUser={memberUser} userRole="viewer" />}
        />
      </Routes>,
      { route: '/items/42' },
    )

    await waitFor(() => {
      expect(screen.getByTestId('item-title')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('claim-button')).toBeNull()
  })

  it('renders Submit for Approval for in_progress items to assignee and lead, but not other members', async () => {
    const inProgressItem: WorkItem = {
      ...baseItem,
      status: 'in_progress',
      assigneeId: memberUser.id,
      assignee: memberUser,
    }
    setupItemFetch(inProgressItem)

    // Render as assignee
    const { unmount } = renderWithProviders(
      <Routes>
        <Route
          path="/items/:id"
          element={<ItemDetail currentUser={memberUser} userRole="member" />}
        />
      </Routes>,
      { route: '/items/42' },
    )

    await waitFor(() => {
      expect(screen.getByTestId('submit-approval-button')).toBeInTheDocument()
    })
    unmount()

    // Render as another member
    renderWithProviders(
      <Routes>
        <Route
          path="/items/:id"
          element={<ItemDetail currentUser={otherUser} userRole="member" />}
        />
      </Routes>,
      { route: '/items/42' },
    )

    await waitFor(() => {
      expect(screen.getByTestId('item-title')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('submit-approval-button')).toBeNull()
  })

  it('renders Approve and Send Back for awaiting_approval items to lead only', async () => {
    const awaitingItem: WorkItem = {
      ...baseItem,
      status: 'awaiting_approval',
      assigneeId: memberUser.id,
      assignee: memberUser,
    }
    setupItemFetch(awaitingItem)

    // Render as member
    const { unmount } = renderWithProviders(
      <Routes>
        <Route
          path="/items/:id"
          element={<ItemDetail currentUser={memberUser} userRole="member" />}
        />
      </Routes>,
      { route: '/items/42' },
    )

    await waitFor(() => {
      expect(screen.getByTestId('item-title')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('approve-button')).toBeNull()
    expect(screen.queryByTestId('send-back-button')).toBeNull()
    unmount()

    // Render as lead
    renderWithProviders(
      <Routes>
        <Route
          path="/items/:id"
          element={<ItemDetail currentUser={leadUser} userRole="lead" />}
        />
      </Routes>,
      { route: '/items/42' },
    )

    await waitFor(() => {
      expect(screen.getByTestId('approve-button')).toBeInTheDocument()
      expect(screen.getByTestId('send-back-button')).toBeInTheDocument()
    })
  })

  it('renders Close and Reopen for resolved items to lead only', async () => {
    const resolvedItem: WorkItem = {
      ...baseItem,
      status: 'resolved',
      assigneeId: memberUser.id,
      assignee: memberUser,
    }
    setupItemFetch(resolvedItem)

    // Render as lead
    renderWithProviders(
      <Routes>
        <Route
          path="/items/:id"
          element={<ItemDetail currentUser={leadUser} userRole="lead" />}
        />
      </Routes>,
      { route: '/items/42' },
    )

    await waitFor(() => {
      expect(screen.getByTestId('close-button')).toBeInTheDocument()
      expect(screen.getByTestId('reopen-button')).toBeInTheDocument()
    })
  })

  it('renders Cancel for open/in_progress/awaiting items to creator and lead, but not other members', async () => {
    const openItemCreatedByCharlie: WorkItem = {
      ...baseItem,
      status: 'open',
      createdBy: memberUser.id,
    }
    setupItemFetch(openItemCreatedByCharlie)

    // Render as creator
    const { unmount } = renderWithProviders(
      <Routes>
        <Route
          path="/items/:id"
          element={<ItemDetail currentUser={memberUser} userRole="member" />}
        />
      </Routes>,
      { route: '/items/42' },
    )

    await waitFor(() => {
      expect(screen.getByTestId('cancel-button')).toBeInTheDocument()
    })
    unmount()

    // Render as non-creator member
    renderWithProviders(
      <Routes>
        <Route
          path="/items/:id"
          element={<ItemDetail currentUser={otherUser} userRole="member" />}
        />
      </Routes>,
      { route: '/items/42' },
    )

    await waitFor(() => {
      expect(screen.getByTestId('item-title')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('cancel-button')).toBeNull()
  })

  it('applies claim optimistically and reconciles with server response', async () => {
    let resolveClaimPromise: (val: Response) => void
    const claimPromise = new Promise<Response>((resolve) => {
      resolveClaimPromise = resolve
    })

    fetchMock.mockImplementation((urlStr: string | URL | Request) => {
      const url = typeof urlStr === 'string' ? urlStr : urlStr.toString()
      if (url.includes('/items/42/claim')) {
        return claimPromise
      }
      if (url.includes('/items/42/activity')) {
        return Promise.resolve(
          new Response(JSON.stringify({ events: [], nextCursor: null }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }
      if (url.includes('/items/42')) {
        return Promise.resolve(
          new Response(JSON.stringify({ item: baseItem }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }
      return Promise.resolve(new Response('not found', { status: 404 }))
    })

    renderWithProviders(
      <Routes>
        <Route
          path="/items/:id"
          element={<ItemDetail currentUser={memberUser} userRole="member" />}
        />
      </Routes>,
      { route: '/items/42' },
    )

    await waitFor(() => {
      expect(screen.getByTestId('claim-button')).toBeInTheDocument()
    })

    expect(screen.getByTestId('item-status')).toHaveTextContent('open')
    expect(screen.getByTestId('item-assignee')).toHaveTextContent('Unassigned')

    // Click claim
    fireEvent.click(screen.getByTestId('claim-button'))

    // Immediately before promise resolves, UI reflects optimistic update
    await waitFor(() => {
      expect(screen.getByTestId('item-status')).toHaveTextContent('in progress')
      expect(screen.getByTestId('item-assignee')).toHaveTextContent('Charlie Member')
    })

    // Resolve server response
    resolveClaimPromise!(
      new Response(
        JSON.stringify({
          item: {
            ...baseItem,
            status: 'in_progress',
            assigneeId: memberUser.id,
            assignee: memberUser,
            version: 2,
          },
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    )

    await waitFor(() => {
      expect(screen.getByTestId('item-status')).toHaveTextContent('in progress')
    })
  })

  it('rolls back to server state on 409 ALREADY_CLAIMED and shows error message', async () => {
    let resolveClaimPromise: (val: Response) => void
    const claimPromise = new Promise<Response>((resolve) => {
      resolveClaimPromise = resolve
    })

    fetchMock.mockImplementation((urlStr: string | URL | Request) => {
      const url = typeof urlStr === 'string' ? urlStr : urlStr.toString()
      if (url.includes('/items/42/claim')) {
        return claimPromise
      }
      if (url.includes('/items/42/activity')) {
        return Promise.resolve(
          new Response(JSON.stringify({ events: [], nextCursor: null }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }
      if (url.includes('/items/42')) {
        return Promise.resolve(
          new Response(JSON.stringify({ item: baseItem }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }
      return Promise.resolve(new Response('not found', { status: 404 }))
    })

    renderWithProviders(
      <Routes>
        <Route
          path="/items/:id"
          element={<ItemDetail currentUser={memberUser} userRole="member" />}
        />
      </Routes>,
      { route: '/items/42' },
    )

    await waitFor(() => {
      expect(screen.getByTestId('claim-button')).toBeInTheDocument()
    })

    // Click claim
    fireEvent.click(screen.getByTestId('claim-button'))

    // Optimistically updated
    await waitFor(() => {
      expect(screen.getByTestId('item-status')).toHaveTextContent('in progress')
    })

    // Server rejects with 409 ALREADY_CLAIMED
    resolveClaimPromise!(
      new Response(
        JSON.stringify({
          error: {
            code: 'ALREADY_CLAIMED',
            message: 'Item has already been claimed by someone else',
          },
        }),
        {
          status: 409,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    )

    // UI rolls back to open and displays server error message
    await waitFor(() => {
      expect(screen.getByTestId('item-status')).toHaveTextContent('open')
      expect(screen.getByTestId('item-assignee')).toHaveTextContent('Unassigned')
      expect(screen.getByTestId('action-error')).toHaveTextContent(
        'Item has already been claimed by someone else',
      )
    })
  })

  it('rolls back to server state on 409 STALE_STATE and shows error message', async () => {
    const inProgressItem: WorkItem = {
      ...baseItem,
      status: 'in_progress',
      assigneeId: memberUser.id,
      assignee: memberUser,
    }

    let resolveTransitionPromise: (val: Response) => void
    const transitionPromise = new Promise<Response>((resolve) => {
      resolveTransitionPromise = resolve
    })

    fetchMock.mockImplementation((urlStr: string | URL | Request) => {
      const url = typeof urlStr === 'string' ? urlStr : urlStr.toString()
      if (url.includes('/items/42/transition')) {
        return transitionPromise
      }
      if (url.includes('/items/42/activity')) {
        return Promise.resolve(
          new Response(JSON.stringify({ events: [], nextCursor: null }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }
      if (url.includes('/items/42')) {
        return Promise.resolve(
          new Response(JSON.stringify({ item: inProgressItem }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }
      return Promise.resolve(new Response('not found', { status: 404 }))
    })

    renderWithProviders(
      <Routes>
        <Route
          path="/items/:id"
          element={<ItemDetail currentUser={memberUser} userRole="member" />}
        />
      </Routes>,
      { route: '/items/42' },
    )

    await waitFor(() => {
      expect(screen.getByTestId('submit-approval-button')).toBeInTheDocument()
    })

    // Click submit for approval
    fireEvent.click(screen.getByTestId('submit-approval-button'))

    // Optimistically updated
    await waitFor(() => {
      expect(screen.getByTestId('item-status')).toHaveTextContent('awaiting approval')
    })

    // Server rejects with 409 STALE_STATE
    resolveTransitionPromise!(
      new Response(
        JSON.stringify({
          error: {
            code: 'STALE_STATE',
            message: 'Item status changed before transition could complete',
          },
        }),
        {
          status: 409,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    )

    // UI rolls back to in progress and displays server error message
    await waitFor(() => {
      expect(screen.getByTestId('item-status')).toHaveTextContent('in progress')
      expect(screen.getByTestId('action-error')).toHaveTextContent(
        'Item status changed before transition could complete',
      )
    })
  })
})
