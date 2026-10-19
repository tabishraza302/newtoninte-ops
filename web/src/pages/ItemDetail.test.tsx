import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor, fireEvent, within } from '@testing-library/react'
import { Routes, Route } from 'react-router-dom'
import { renderWithProviders } from '../test/test-utils'
import { ItemDetail } from './ItemDetail'
import type { ActivityEvent, WorkItem } from '../api/types'

describe('ItemDetail Page (Task 3.9)', () => {
  const fetchMock = vi.fn()

  const mockItem: WorkItem = {
    id: 42,
    teamId: 1,
    title: 'Outage on payment webhook service',
    description: 'Third-party webhooks failing with 504 timeouts.',
    type: 'payment',
    priority: 'urgent',
    status: 'in_progress',
    assigneeId: 10,
    createdBy: 5,
    dueAt: '2026-10-25T15:00:00.000Z',
    version: 3,
    createdAt: '2026-10-18T08:00:00.000Z',
    updatedAt: '2026-10-18T09:30:00.000Z',
    assignee: { id: 10, displayName: 'Charlie Engineer', email: 'charlie@example.com' },
    creator: { id: 5, displayName: 'Dana Lead', email: 'dana@example.com' },
  }

  const mockEvents: ActivityEvent[] = [
    {
      id: 101,
      workItemId: 42,
      actorId: 5,
      type: 'created',
      createdAt: '2026-10-18T08:00:00.000Z',
      actor: { id: 5, displayName: 'Dana Lead', email: 'dana@example.com' },
    },
    {
      id: 102,
      workItemId: 42,
      actorId: 5,
      type: 'assignee_changed',
      fromValue: 'unassigned',
      toValue: 'Charlie Engineer',
      createdAt: '2026-10-18T08:30:00.000Z',
      actor: { id: 5, displayName: 'Dana Lead', email: 'dana@example.com' },
    },
    {
      id: 103,
      workItemId: 42,
      actorId: 10,
      type: 'comment_added',
      metadata: { body: 'Investigating upstream gateway latency.' },
      createdAt: '2026-10-18T09:00:00.000Z',
      actor: { id: 10, displayName: 'Charlie Engineer', email: 'charlie@example.com' },
    },
  ]

  beforeEach(() => {
    vi.restoreAllMocks()
    fetchMock.mockReset()
    globalThis.fetch = fetchMock
  })

  it('renders item title, description, status, priority, assignee, creator, due date', async () => {
    fetchMock.mockImplementation((urlStr: string | URL | Request) => {
      const url = typeof urlStr === 'string' ? urlStr : urlStr.toString()
      if (url.includes('/items/42/activity')) {
        return Promise.resolve(
          new Response(JSON.stringify({ events: mockEvents, nextCursor: null }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }
      if (url.includes('/items/42')) {
        return Promise.resolve(
          new Response(JSON.stringify({ item: mockItem }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }
      return Promise.resolve(new Response('not found', { status: 404 }))
    })

    renderWithProviders(
      <Routes>
        <Route path="/items/:id" element={<ItemDetail />} />
      </Routes>,
      { route: '/items/42' },
    )

    await waitFor(() => {
      expect(screen.getByTestId('item-title')).toHaveTextContent('Outage on payment webhook service')
    })

    expect(screen.getByTestId('item-description')).toHaveTextContent(
      'Third-party webhooks failing with 504 timeouts.',
    )
    expect(screen.getByTestId('item-status')).toHaveTextContent('in progress')
    expect(screen.getByTestId('item-priority')).toHaveTextContent('urgent')
    expect(screen.getByTestId('item-assignee')).toHaveTextContent('Charlie Engineer')
    expect(screen.getByTestId('item-creator')).toHaveTextContent('Dana Lead')
    expect(screen.getByTestId('item-due')).not.toHaveTextContent('No due date')
  })

  it('renders activity timeline ordered oldest-to-newest showing event type, actor, date, and comment_added body', async () => {
    // Deliver events in reverse chronological order to verify the timeline sorts oldest-to-newest
    const reversedEvents = [...mockEvents].reverse()

    fetchMock.mockImplementation((urlStr: string | URL | Request) => {
      const url = typeof urlStr === 'string' ? urlStr : urlStr.toString()
      if (url.includes('/items/42/activity')) {
        return Promise.resolve(
          new Response(JSON.stringify({ events: reversedEvents, nextCursor: null }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }
      if (url.includes('/items/42')) {
        return Promise.resolve(
          new Response(JSON.stringify({ item: mockItem }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }
      return Promise.resolve(new Response('not found', { status: 404 }))
    })

    renderWithProviders(
      <Routes>
        <Route path="/items/:id" element={<ItemDetail />} />
      </Routes>,
      { route: '/items/42' },
    )

    await waitFor(() => {
      expect(screen.getByTestId('activity-timeline')).toBeInTheDocument()
    })

    // Check comment body rendered
    expect(screen.getByTestId('comment-body')).toHaveTextContent(
      'Investigating upstream gateway latency.',
    )

    // Check oldest-to-newest order in DOM
    const eventCards = screen.getAllByTestId(/activity-event-\d+/)
    expect(eventCards).toHaveLength(3)
    expect(eventCards[0]).toHaveAttribute('data-testid', 'activity-event-101')
    expect(eventCards[1]).toHaveAttribute('data-testid', 'activity-event-102')
    expect(eventCards[2]).toHaveAttribute('data-testid', 'activity-event-103')

    // Check event types and actors
    expect(eventCards[0]).toHaveTextContent('created')
    expect(eventCards[0]).toHaveTextContent('Dana Lead')
    expect(eventCards[2]).toHaveTextContent('comment_added')
    expect(eventCards[2]).toHaveTextContent('Charlie Engineer')
  })

  it('handles 404 showing friendly Item not found state', async () => {
    fetchMock.mockImplementation((urlStr: string | URL | Request) => {
      const url = typeof urlStr === 'string' ? urlStr : urlStr.toString()
      if (url.includes('/auth/refresh')) {
        return Promise.resolve(new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 }))
      }
      return Promise.resolve(
        new Response(JSON.stringify({ error: 'Not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    })

    renderWithProviders(
      <Routes>
        <Route path="/items/:id" element={<ItemDetail />} />
      </Routes>,
      { route: '/items/999' },
    )

    await waitFor(() => {
      expect(screen.getByTestId('not-found')).toBeInTheDocument()
    })

    expect(screen.getByRole('heading', { name: /Item not found/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Back to items/i })).toHaveAttribute('href', '/items')
  })

  it('handles non-numeric id showing Item not found state', async () => {
    renderWithProviders(
      <Routes>
        <Route path="/items/:id" element={<ItemDetail />} />
      </Routes>,
      { route: '/items/invalid-id' },
    )

    expect(screen.getByTestId('not-found')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /Item not found/i })).toBeInTheDocument()
  })

  it('submits a new comment and updates discussion', async () => {
    let postedComment: unknown = null
    fetchMock.mockImplementation((urlStr: string | URL | Request, init?: RequestInit) => {
      const url = typeof urlStr === 'string' ? urlStr : urlStr.toString()
      if (url.includes('/items/42/comments') && init?.method === 'POST') {
        if (init?.body) {
          postedComment = JSON.parse(init.body as string)
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({
              comment: {
                id: 99,
                workItemId: 42,
                authorId: 5,
                body: 'Investigating third-party gateway latency.',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              },
            }),
            { status: 201, headers: { 'Content-Type': 'application/json' } },
          ),
        )
      }
      if (url.includes('/items/42/activity')) {
        return Promise.resolve(
          new Response(JSON.stringify({ events: mockEvents, nextCursor: null }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }
      if (url.includes('/items/42')) {
        return Promise.resolve(
          new Response(JSON.stringify({ item: mockItem }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }
      return Promise.resolve(new Response('not found', { status: 404 }))
    })

    renderWithProviders(
      <Routes>
        <Route path="/items/:id" element={<ItemDetail userRole="member" />} />
      </Routes>,
      { route: '/items/42' },
    )

    await waitFor(() => {
      expect(screen.getByLabelText(/Add a comment/i)).toBeInTheDocument()
    })

    const commentInput = screen.getByLabelText(/Add a comment/i)
    fireEvent.change(commentInput, {
      target: { value: 'Investigating third-party gateway latency.' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Post Comment/i }))

    await waitFor(() => {
      expect(postedComment).toEqual({ body: 'Investigating third-party gateway latency.' })
    })
  })

  it('lets the current member assignee start an assigned open item', async () => {
    const assignedOpenItem: WorkItem = { ...mockItem, status: 'open' }
    fetchMock.mockImplementation((input: string | URL | Request) => {
      const url = String(input)
      if (url.includes('/items/42/activity')) {
        return Promise.resolve(new Response(JSON.stringify({ events: [], nextCursor: null }), { status: 200 }))
      }
      if (url.includes('/teams/1/members')) {
        return Promise.resolve(new Response(JSON.stringify({ members: [], nextCursor: null }), { status: 200 }))
      }
      if (url.includes('/items/42')) {
        return Promise.resolve(new Response(JSON.stringify({ item: assignedOpenItem }), { status: 200 }))
      }
      return Promise.resolve(new Response('not found', { status: 404 }))
    })
    renderWithProviders(
      <Routes>
        <Route path="/items/:id" element={
          <ItemDetail
            userRole="member"
            currentUser={{ id: 10, displayName: 'Charlie Engineer', email: 'charlie@example.com' }}
          />
        } />
      </Routes>,
      { route: '/items/42' },
    )
    expect(await screen.findByRole('button', { name: 'Start work' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Claim' })).not.toBeInTheDocument()
  })

  it('hides Start work and Claim for viewers on assigned open items', async () => {
    const assignedOpenItem: WorkItem = { ...mockItem, status: 'open' }
    fetchMock.mockImplementation((input: string | URL | Request) => {
      const url = String(input)
      if (url.includes('/items/42/activity')) {
        return Promise.resolve(new Response(JSON.stringify({ events: [], nextCursor: null }), { status: 200 }))
      }
      if (url.includes('/teams/1/members')) {
        return Promise.resolve(new Response(JSON.stringify({ members: [], nextCursor: null }), { status: 200 }))
      }
      if (url.includes('/items/42')) {
        return Promise.resolve(new Response(JSON.stringify({ item: assignedOpenItem }), { status: 200 }))
      }
      return Promise.resolve(new Response('not found', { status: 404 }))
    })
    renderWithProviders(
      <Routes>
        <Route path="/items/:id" element={
          <ItemDetail
            userRole="viewer"
            currentUser={{ id: 10, displayName: 'Charlie Engineer', email: 'charlie@example.com' }}
          />
        } />
      </Routes>,
      { route: '/items/42' },
    )
    await screen.findByRole('heading', { name: mockItem.title })
    expect(screen.queryByRole('button', { name: 'Start work' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Claim' })).not.toBeInTheDocument()
  })

  it('hides Start work for other team members who are not the assignee', async () => {
    const assignedOpenItem: WorkItem = { ...mockItem, status: 'open', assigneeId: 10 }
    fetchMock.mockImplementation((input: string | URL | Request) => {
      const url = String(input)
      if (url.includes('/items/42/activity')) {
        return Promise.resolve(new Response(JSON.stringify({ events: [], nextCursor: null }), { status: 200 }))
      }
      if (url.includes('/teams/1/members')) {
        return Promise.resolve(new Response(JSON.stringify({ members: [], nextCursor: null }), { status: 200 }))
      }
      if (url.includes('/items/42')) {
        return Promise.resolve(new Response(JSON.stringify({ item: assignedOpenItem }), { status: 200 }))
      }
      return Promise.resolve(new Response('not found', { status: 404 }))
    })
    renderWithProviders(
      <Routes>
        <Route path="/items/:id" element={
          <ItemDetail
            userRole="member"
            currentUser={{ id: 99, displayName: 'Other Member', email: 'other@example.com' }}
          />
        } />
      </Routes>,
      { route: '/items/42' },
    )
    await screen.findByRole('heading', { name: mockItem.title })
    expect(screen.queryByRole('button', { name: 'Start work' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Claim' })).not.toBeInTheDocument()
  })

  it('allows lead to start an assigned open item and dispatches transition with optional reason', async () => {
    const assignedOpenItem: WorkItem = { ...mockItem, status: 'open', assigneeId: 10 }
    let transitionPayload: unknown = null
    fetchMock.mockImplementation((input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/items/42/transition') && init?.method === 'POST') {
        transitionPayload = JSON.parse(String(init.body))
        return Promise.resolve(
          new Response(
            JSON.stringify({ item: { ...assignedOpenItem, status: 'in_progress' } }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        )
      }
      if (url.includes('/items/42/activity')) {
        return Promise.resolve(new Response(JSON.stringify({ events: [], nextCursor: null }), { status: 200 }))
      }
      if (url.includes('/teams/1/members')) {
        return Promise.resolve(new Response(JSON.stringify({ members: [], nextCursor: null }), { status: 200 }))
      }
      if (url.includes('/items/42')) {
        return Promise.resolve(new Response(JSON.stringify({ item: assignedOpenItem }), { status: 200 }))
      }
      return Promise.resolve(new Response('not found', { status: 404 }))
    })
    renderWithProviders(
      <Routes>
        <Route path="/items/:id" element={
          <ItemDetail
            userRole="lead"
            currentUser={{ id: 5, displayName: 'Dana Lead', email: 'dana@example.com' }}
          />
        } />
      </Routes>,
      { route: '/items/42' },
    )
    const startBtn = await screen.findByRole('button', { name: 'Start work' })
    expect(startBtn).toBeEnabled()

    const reasonInput = screen.getByPlaceholderText(/Transition reason \(optional\)/i)
    fireEvent.change(reasonInput, { target: { value: 'Beginning triage investigation' } })
    fireEvent.click(startBtn)

    await waitFor(() => {
      expect(transitionPayload).toEqual({
        to: 'in_progress',
        reason: 'Beginning triage investigation',
      })
    })
  })

  it('forbids terminal lifecycle changes on closed items while keeping lead assignment and edit available', async () => {
    const closedItem: WorkItem = { ...mockItem, status: 'closed' }
    fetchMock.mockImplementation((input: string | URL | Request) => {
      const url = String(input)
      if (url.includes('/items/42/activity')) {
        return Promise.resolve(new Response(JSON.stringify({ events: [], nextCursor: null }), { status: 200 }))
      }
      if (url.includes('/teams/1/members')) {
        return Promise.resolve(new Response(JSON.stringify({ members: [], nextCursor: null }), { status: 200 }))
      }
      if (url.includes('/items/42')) {
        return Promise.resolve(new Response(JSON.stringify({ item: closedItem }), { status: 200 }))
      }
      return Promise.resolve(new Response('not found', { status: 404 }))
    })
    renderWithProviders(
      <Routes>
        <Route path="/items/:id" element={
          <ItemDetail
            userRole="lead"
            currentUser={{ id: 5, displayName: 'Dana Lead', email: 'dana@example.com' }}
          />
        } />
      </Routes>,
      { route: '/items/42' },
    )
    await screen.findByRole('heading', { name: mockItem.title })
    // Terminal lifecycle changes are forbidden
    expect(screen.queryByRole('button', { name: 'Start work' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Claim' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Submit for Approval' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Send Back' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reopen' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument()

    // Assignment and edit remain available for lead
    expect(screen.getByRole('button', { name: 'Assign' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Edit' })).toBeEnabled()
  })

  it('toggles inline edit mode cleanly, preserving sidebar attributes and restoring title on cancel', async () => {
    fetchMock.mockImplementation((input: string | URL | Request) => {
      const url = String(input)
      if (url.includes('/items/42/activity')) {
        return Promise.resolve(new Response(JSON.stringify({ events: [], nextCursor: null }), { status: 200 }))
      }
      if (url.includes('/teams/1/members')) {
        return Promise.resolve(new Response(JSON.stringify({ members: [], nextCursor: null }), { status: 200 }))
      }
      if (url.includes('/items/42')) {
        return Promise.resolve(new Response(JSON.stringify({ item: mockItem }), { status: 200 }))
      }
      return Promise.resolve(new Response('not found', { status: 404 }))
    })

    renderWithProviders(
      <Routes>
        <Route path="/items/:id" element={<ItemDetail userRole="lead" currentUser={{ id: 5, displayName: 'Dana Lead', email: 'dana@example.com' }} />} />
      </Routes>,
      { route: '/items/42' },
    )

    const editBtn = await screen.findByRole('button', { name: 'Edit' })
    fireEvent.click(editBtn)

    // Edit section should now be present
    expect(screen.getByRole('region', { name: 'Edit Item' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Edit Item #42' })).toBeInTheDocument()

    // Sidebar attributes should still be visible
    expect(screen.getByTestId('item-status')).toHaveTextContent('in progress')
    expect(screen.getByTestId('item-priority')).toHaveTextContent('urgent')

    // Cancel edit using the form cancel button
    const form = screen.getByTestId('item-form')
    const cancelBtn = within(form).getByRole('button', { name: 'Cancel' })
    fireEvent.click(cancelBtn)

    // Title and description should be restored
    expect(screen.getByTestId('item-title')).toHaveTextContent(mockItem.title)
    expect(screen.getByTestId('item-description')).toHaveTextContent(mockItem.description!)
  })

  it('opens assign dialog on trigger click, enforces modal accessibility, and dismisses on Escape', async () => {
    fetchMock.mockImplementation((input: string | URL | Request) => {
      const url = String(input)
      if (url.includes('/items/42/activity')) {
        return Promise.resolve(new Response(JSON.stringify({ events: [], nextCursor: null }), { status: 200 }))
      }
      if (url.includes('/teams/1/members')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              members: [
                { userId: 10, role: 'member', user: { id: 10, displayName: 'Charlie Engineer', email: 'charlie@example.com' } },
                { userId: 5, role: 'lead', user: { id: 5, displayName: 'Dana Lead', email: 'dana@example.com' } },
              ],
              nextCursor: null,
            }),
            { status: 200 },
          ),
        )
      }
      if (url.includes('/items/42')) {
        return Promise.resolve(new Response(JSON.stringify({ item: mockItem }), { status: 200 }))
      }
      return Promise.resolve(new Response('not found', { status: 404 }))
    })

    renderWithProviders(
      <Routes>
        <Route path="/items/:id" element={<ItemDetail userRole="lead" currentUser={{ id: 5, displayName: 'Dana Lead', email: 'dana@example.com' }} />} />
      </Routes>,
      { route: '/items/42' },
    )

    const assignBtn = await screen.findByRole('button', { name: 'Assign' })
    fireEvent.click(assignBtn)

    // Modal dialog should be rendered
    const dialog = screen.getByRole('dialog', { name: 'Assign Item #42' })
    expect(dialog).toBeInTheDocument()
    expect(screen.getByLabelText('Assignee')).toBeInTheDocument()

    // Dismiss with Escape key
    fireEvent.keyDown(window, { key: 'Escape' })

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })
})
