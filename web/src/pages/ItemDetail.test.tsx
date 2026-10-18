import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
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
})
