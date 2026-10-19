import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor, fireEvent, within } from '@testing-library/react'
import { Routes, Route, useNavigate } from 'react-router-dom'
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

  const mockEventCreated: ActivityEvent = {
    id: 101,
    workItemId: 42,
    actorId: 5,
    type: 'created',
    createdAt: '2026-10-18T08:00:00.000Z',
    actor: { id: 5, displayName: 'Dana Lead', email: 'dana@example.com' },
  }

  const mockEventAssignee: ActivityEvent = {
    id: 102,
    workItemId: 42,
    actorId: 5,
    type: 'assignee_changed',
    fromValue: 'unassigned',
    toValue: 'Charlie Engineer',
    createdAt: '2026-10-18T08:30:00.000Z',
    actor: { id: 5, displayName: 'Dana Lead', email: 'dana@example.com' },
  }

  const mockEventComment: ActivityEvent = {
    id: 103,
    workItemId: 42,
    actorId: 10,
    type: 'comment_added',
    metadata: { body: 'Investigating upstream gateway latency.' },
    createdAt: '2026-10-18T09:00:00.000Z',
    actor: { id: 10, displayName: 'Charlie Engineer', email: 'charlie@example.com' },
  }

  const mockEvents: readonly [ActivityEvent, ActivityEvent, ActivityEvent] = [
    mockEventCreated,
    mockEventAssignee,
    mockEventComment,
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

  it('submits a new comment and updates discussion, showing acknowledgement and rendering comment in timeline', async () => {
    let postedComment: unknown = null
    let activityCallCount = 0
    const newCommentEvent: ActivityEvent = {
      id: 200,
      workItemId: 42,
      actorId: 5,
      type: 'comment_added',
      metadata: { body: 'Investigating third-party gateway latency.' },
      createdAt: '2026-10-18T10:00:00.000Z',
      actor: { id: 5, displayName: 'Dana Lead', email: 'dana@example.com' },
    }

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
        activityCallCount++
        const eventsToReturn = activityCallCount > 1 ? [...mockEvents, newCommentEvent] : mockEvents
        return Promise.resolve(
          new Response(JSON.stringify({ events: eventsToReturn, nextCursor: null }), {
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

    // Author sees acknowledgement and draft is cleared
    await waitFor(() => {
      expect(commentInput).toHaveValue('')
      expect(screen.getByText(/Comment posted/i)).toBeInTheDocument()
    })

    // Invalidation causes activity refetch and new comment visibly appears in timeline
    await waitFor(() => {
      expect(screen.getByTestId('activity-event-200')).toBeInTheDocument()
      expect(screen.getByText('Investigating third-party gateway latency.')).toBeInTheDocument()
    })
  })

  it('preserves comment draft and displays error on comment submission failure', async () => {
    fetchMock.mockImplementation((urlStr: string | URL | Request, init?: RequestInit) => {
      const url = typeof urlStr === 'string' ? urlStr : urlStr.toString()
      if (url.includes('/items/42/comments') && init?.method === 'POST') {
        return Promise.resolve(
          new Response(
            JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'Failed to record comment' } }),
            { status: 500, headers: { 'Content-Type': 'application/json' } },
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

    const commentInput = await screen.findByLabelText(/Add a comment/i)
    fireEvent.change(commentInput, {
      target: { value: 'Draft comment text that should remain' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Post Comment/i }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Failed to record comment')
    })
    expect(commentInput).toHaveValue('Draft comment text that should remain')
  })

  it('loads incremental activity pages with accumulated deduplicated events', async () => {
    const page1Events: ActivityEvent[] = [
      mockEventCreated,
      mockEventAssignee,
    ]
    const page2Events: ActivityEvent[] = [
      mockEventAssignee, // Duplicate event from page boundary
      mockEventComment,
    ]

    fetchMock.mockImplementation((urlStr: string | URL | Request) => {
      const url = typeof urlStr === 'string' ? urlStr : urlStr.toString()
      if (url.includes('/items/42/activity')) {
        if (url.includes('cursor=cursor-page-2')) {
          return Promise.resolve(
            new Response(JSON.stringify({ events: page2Events, nextCursor: null }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            }),
          )
        }
        return Promise.resolve(
          new Response(JSON.stringify({ events: page1Events, nextCursor: 'cursor-page-2' }), {
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

    // Initial page rendered
    await waitFor(() => {
      expect(screen.getByTestId('activity-event-101')).toBeInTheDocument()
      expect(screen.getByTestId('activity-event-102')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('activity-event-103')).toBeNull()

    // Load more button is present
    const loadMoreBtn = screen.getByRole('button', { name: /Load more activity/i })
    expect(loadMoreBtn).toBeInTheDocument()
    fireEvent.click(loadMoreBtn)

    // After loading next page: prior events are preserved and deduplicated
    await waitFor(() => {
      expect(screen.getByTestId('activity-event-103')).toBeInTheDocument()
    })
    expect(screen.getByTestId('activity-event-101')).toBeInTheDocument()
    expect(screen.getByTestId('activity-event-102')).toBeInTheDocument()
    // Exactly 3 unique cards rendered (not 4)
    expect(screen.getAllByTestId(/activity-event-\d+/)).toHaveLength(3)

    // Load more button disappears since nextCursor was null
    expect(screen.queryByRole('button', { name: /Load more activity/i })).toBeNull()
  })

  it('renders explicit error and retry control on activity request error rather than empty state', async () => {
    let failActivity = true

    fetchMock.mockImplementation((urlStr: string | URL | Request) => {
      const url = typeof urlStr === 'string' ? urlStr : urlStr.toString()
      if (url.includes('/items/42/activity')) {
        if (failActivity) {
          return Promise.resolve(
            new Response(
              JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'Activity service unavailable' } }),
              { status: 500, headers: { 'Content-Type': 'application/json' } },
            ),
          )
        }
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

    // MUST NOT render empty state "No activity yet"
    await waitFor(() => {
      expect(screen.getByTestId('activity-error')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('empty-activity')).toBeNull()
    expect(screen.queryByText('No activity yet')).toBeNull()

    // Retry button exists and recovers
    failActivity = false
    const retryBtn = screen.getByRole('button', { name: /Retry/i })
    fireEvent.click(retryBtn)

    await waitFor(() => {
      expect(screen.getByTestId('activity-timeline')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('activity-error')).toBeNull()
  })

  it('posting comment when latest events exceed loaded page provides acknowledgement and route to load latest', async () => {
    const page1Events: ActivityEvent[] = [mockEventCreated, mockEventAssignee]
    const newCommentEvent: ActivityEvent = {
      id: 201,
      workItemId: 42,
      actorId: 5,
      type: 'comment_added',
      metadata: { body: 'New comment landing on page 2' },
      createdAt: '2026-10-18T11:00:00.000Z',
      actor: { id: 5, displayName: 'Dana Lead', email: 'dana@example.com' },
    }

    fetchMock.mockImplementation((urlStr: string | URL | Request, init?: RequestInit) => {
      const url = typeof urlStr === 'string' ? urlStr : urlStr.toString()
      if (url.includes('/items/42/comments') && init?.method === 'POST') {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              comment: {
                id: 105,
                workItemId: 42,
                authorId: 5,
                body: 'New comment landing on page 2',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              },
            }),
            { status: 201, headers: { 'Content-Type': 'application/json' } },
          ),
        )
      }
      if (url.includes('/items/42/activity')) {
        if (url.includes('cursor=cursor-page-2')) {
          return Promise.resolve(
            new Response(JSON.stringify({ events: [newCommentEvent], nextCursor: null }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            }),
          )
        }
        // First page has nextCursor pointing to page 2
        return Promise.resolve(
          new Response(JSON.stringify({ events: page1Events, nextCursor: 'cursor-page-2' }), {
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
      expect(screen.getByTestId('activity-event-101')).toBeInTheDocument()
    })

    // Post comment
    const commentInput = screen.getByLabelText(/Add a comment/i)
    fireEvent.change(commentInput, { target: { value: 'New comment landing on page 2' } })
    fireEvent.click(screen.getByRole('button', { name: /Post Comment/i }))

    // Author sees truthful acknowledgement
    await waitFor(() => {
      expect(screen.getByText(/Comment posted/i)).toBeInTheDocument()
    })

    // Actionable route to load latest activity is available in acknowledgement
    const ackRegion = screen.getByRole('status')
    expect(ackRegion).toHaveTextContent(/Comment posted/i)
    const ackLoadMoreBtn = within(ackRegion).getByRole('button', { name: 'Load more activity to see latest comments' })
    expect(ackLoadMoreBtn).toBeInTheDocument()
    fireEvent.click(ackLoadMoreBtn)
    // After loading next page, the new comment appears in the accumulated timeline
    await waitFor(() => {
      expect(screen.getByTestId('activity-event-201')).toBeInTheDocument()
      expect(screen.getByText('New comment landing on page 2')).toBeInTheDocument()
    })
    // Page 1 events still visible
    expect(screen.getByTestId('activity-event-101')).toBeInTheDocument()
  })

  it('renders retry control on next-page failure while preserving existing loaded events', async () => {
    let failPage2 = true
    const page1Events: ActivityEvent[] = [mockEventCreated]
    const page2Events: ActivityEvent[] = [mockEventAssignee]

    fetchMock.mockImplementation((urlStr: string | URL | Request) => {
      const url = typeof urlStr === 'string' ? urlStr : urlStr.toString()
      if (url.includes('/items/42/activity')) {
        if (url.includes('cursor=cursor-2')) {
          if (failPage2) {
            return Promise.resolve(
              new Response(
                JSON.stringify({ error: { code: 'TIMEOUT', message: 'Activity page timeout' } }),
                { status: 504, headers: { 'Content-Type': 'application/json' } },
              ),
            )
          }
          return Promise.resolve(
            new Response(JSON.stringify({ events: page2Events, nextCursor: null }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            }),
          )
        }
        return Promise.resolve(
          new Response(JSON.stringify({ events: page1Events, nextCursor: 'cursor-2' }), {
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
      expect(screen.getByTestId('activity-event-101')).toBeInTheDocument()
    })

    // Click load more, which fails
    fireEvent.click(screen.getByRole('button', { name: /Load more activity/i }))

    await waitFor(() => {
      expect(screen.getByTestId('activity-next-error')).toBeInTheDocument()
    })
    // Page 1 event is still in the document
    expect(screen.getByTestId('activity-event-101')).toBeInTheDocument()

    // Retry page 2
    failPage2 = false
    const retryBtn = within(screen.getByTestId('activity-next-error')).getByRole('button', { name: /Retry/i })
    fireEvent.click(retryBtn)

    await waitFor(() => {
      expect(screen.getByTestId('activity-event-102')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('activity-next-error')).toBeNull()
  })

  it('resets activity pagination when navigating between work items', async () => {
    fetchMock.mockImplementation((urlStr: string | URL | Request) => {
      const url = typeof urlStr === 'string' ? urlStr : urlStr.toString()
      if (url.includes('/items/42/activity')) {
        return Promise.resolve(
          new Response(JSON.stringify({ events: [mockEventCreated], nextCursor: 'cursor-42-2' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }
      if (url.includes('/items/43/activity')) {
        const item43Event: ActivityEvent = {
          id: 501,
          workItemId: 43,
          actorId: 5,
          type: 'created',
          createdAt: '2026-10-19T08:00:00.000Z',
          actor: { id: 5, displayName: 'Dana Lead', email: 'dana@example.com' },
        }
        return Promise.resolve(
          new Response(JSON.stringify({ events: [item43Event], nextCursor: null }), {
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
      if (url.includes('/items/43')) {
        return Promise.resolve(
          new Response(JSON.stringify({ item: { ...mockItem, id: 43, title: 'Second item' } }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }
      return Promise.resolve(new Response('not found', { status: 404 }))
    })

    function NavTestComponent() {
      const navigate = useNavigate()
      return (
        <div>
          <button type="button" onClick={() => navigate('/items/43')}>
            Switch to item 43
          </button>
          <Routes>
            <Route path="/items/:id" element={<ItemDetail />} />
          </Routes>
        </div>
      )
    }

    renderWithProviders(<NavTestComponent />, { route: '/items/42' })

    await waitFor(() => {
      expect(screen.getByTestId('activity-event-101')).toBeInTheDocument()
    })

    // Truly navigate router to item 43
    fireEvent.click(screen.getByRole('button', { name: 'Switch to item 43' }))

    await waitFor(() => {
      expect(screen.getByTestId('activity-event-501')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('activity-event-101')).toBeNull()
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
      expect(transitionPayload).toMatchObject({
        to: 'in_progress',
        reason: 'Beginning triage investigation',
      })
    })
  })

  it('rejects stale transition decision when item version changed on server, preserves reason draft, and succeeds after reload', async () => {
    // The server is already ahead of the snapshot this client loaded: a
    // concurrent edit moved the item to version 4, so the first load returns
    // the stale version-3 view and the reload returns current server state.
    let serverItem: WorkItem = {
      ...mockItem,
      status: 'in_progress',
      version: 4,
      title: 'Updated title from concurrent edit',
    }
    let itemLoadCount = 0

    fetchMock.mockImplementation((urlStr: string | URL | Request, init?: RequestInit) => {
      const url = typeof urlStr === 'string' ? urlStr : urlStr.toString()
      if (url.includes('/items/42/transition') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as { to: WorkItem['status']; expectedVersion: number }
        if (body.expectedVersion !== serverItem.version) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                error: {
                  code: 'VERSION_MISMATCH',
                  message: 'Version mismatch.',
                },
              }),
              { status: 409, headers: { 'Content-Type': 'application/json' } },
            ),
          )
        }
        serverItem = { ...serverItem, status: body.to, version: serverItem.version + 1 }
        return Promise.resolve(
          new Response(JSON.stringify({ item: serverItem }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
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
        itemLoadCount++
        const payload = itemLoadCount === 1 ? { ...mockItem, status: 'in_progress', version: 3 } : serverItem
        return Promise.resolve(
          new Response(JSON.stringify({ item: payload }), {
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
          element={<ItemDetail currentUser={{ id: 5, displayName: 'Dana Lead', email: 'dana@example.com' }} userRole="lead" />}
        />
      </Routes>,
      { route: '/items/42' },
    )

    await waitFor(() => {
      expect(screen.getByTestId('item-status')).toHaveTextContent('in progress')
    })

    const reasonInput = screen.getByPlaceholderText(/Transition reason \(optional\)/i)
    fireEvent.change(reasonInput, { target: { value: 'Implementation ready for lead review.' } })

    const submitApprovalBtn = screen.getByTestId('submit-approval-button')
    fireEvent.click(submitApprovalBtn)

    // Stale decision rejected: rolls back to in progress, shows conflict alert, and preserves reason draft
    await waitFor(() => {
      expect(screen.getByTestId('item-status')).toHaveTextContent('in progress')
      expect(screen.getByRole('alert')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /reload item/i })).toBeInTheDocument()
    })
    expect(reasonInput).toHaveValue('Implementation ready for lead review.')

    // Reload item to receive current server version
    fireEvent.click(screen.getByRole('button', { name: /reload item/i }))

    await waitFor(() => {
      expect(screen.queryByRole('alert')).toBeNull()
      expect(screen.getByTestId('item-title')).toHaveTextContent('Updated title from concurrent edit')
    })
    expect(reasonInput).toHaveValue('Implementation ready for lead review.')

    // Retry decision with refreshed version
    fireEvent.click(screen.getByTestId('submit-approval-button'))

    await waitFor(() => {
      expect(screen.getByTestId('item-status')).toHaveTextContent('awaiting approval')
    })
    expect(screen.queryByRole('alert')).toBeNull()
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
