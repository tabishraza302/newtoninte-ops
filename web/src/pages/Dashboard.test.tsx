import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { renderWithProviders } from '../test/test-utils'
import { Dashboard } from './Dashboard'
import type { WorkItem } from '../api/types'

describe('Dashboard Page (Task 3.7)', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.restoreAllMocks()
    fetchMock.mockReset()
    globalThis.fetch = fetchMock
  })

  const mockTeams = [{ id: 1, name: 'Core Team', slug: 'core' }]

  const setupDashboardFetch = (opts: {
    items?: WorkItem[]
    nextCursor?: string | null
    customItemsHandler?: (url: string) => { items: WorkItem[]; nextCursor: string | null }
  } = {}) => {
    fetchMock.mockImplementation((urlStr: string | URL | Request) => {
      const url = typeof urlStr === 'string' ? urlStr : urlStr.toString()

      if (url.includes('/teams')) {
        return Promise.resolve(
          new Response(JSON.stringify({ teams: mockTeams }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }

      if (url.includes('/items')) {
        const payload = opts.customItemsHandler
          ? opts.customItemsHandler(url)
          : { items: opts.items ?? [], nextCursor: opts.nextCursor ?? null }
        return Promise.resolve(
          new Response(JSON.stringify(payload), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }

      return Promise.resolve(
        new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Not found' } }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    })
  }

  it('switches tabs and issues GET /items?view=<name>', async () => {
    setupDashboardFetch({ items: [] })

    renderWithProviders(<Dashboard />)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/items?view=assigned_to_me'),
        expect.anything(),
      )
    })

    const overdueTab = screen.getByRole('tab', { name: /Overdue/i })
    fireEvent.click(overdueTab)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/items?view=overdue'),
        expect.anything(),
      )
    })

    const unassignedTab = screen.getByRole('tab', { name: /Unassigned Urgent/i })
    fireEvent.click(unassignedTab)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/items?view=unassigned_urgent'),
        expect.anything(),
      )
    })

    const approvalTab = screen.getByRole('tab', { name: /Awaiting My Approval/i })
    fireEvent.click(approvalTab)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/items?view=awaiting_my_approval'),
        expect.anything(),
      )
    })
  })

  it('shows an empty state when view has no items', async () => {
    setupDashboardFetch({ items: [] })

    renderWithProviders(<Dashboard />)

    await waitFor(() => {
      expect(screen.getByText(/No items in this view/i)).toBeInTheDocument()
    })
  })

  it('renders items in the active view', async () => {
    const mockItem: WorkItem = {
      id: 42,
      teamId: 1,
      title: 'Database connection leak in worker',
      description: 'Workers running out of connections under load',
      type: 'incident',
      priority: 'urgent',
      status: 'open',
      assigneeId: 10,
      createdBy: 5,
      dueAt: '2026-10-20T12:00:00.000Z',
      version: 1,
      createdAt: '2026-10-18T10:00:00.000Z',
      updatedAt: '2026-10-18T10:00:00.000Z',
      assignee: { id: 10, displayName: 'Alice Engineer', email: 'alice@example.com' },
      creator: { id: 5, displayName: 'Bob Reporter', email: 'bob@example.com' },
    }

    setupDashboardFetch({ items: [mockItem] })

    renderWithProviders(<Dashboard />)

    await waitFor(() => {
      expect(screen.getByText('Database connection leak in worker')).toBeInTheDocument()
    })

    expect(screen.getByTestId('item-row-42')).toBeInTheDocument()
    expect(screen.getByText('Alice Engineer')).toBeInTheDocument()
    expect(screen.getByText('urgent')).toBeInTheDocument()
  })

  it('supports cursor pagination via Load More button', async () => {
    const item1 = {
      id: 1,
      teamId: 1,
      title: 'First Dashboard Item',
      description: null,
      type: 'task' as const,
      priority: 'high' as const,
      status: 'open' as const,
      assigneeId: null,
      createdBy: 1,
      dueAt: null,
      version: 1,
      createdAt: '2026-10-18T10:00:00.000Z',
      updatedAt: '2026-10-18T10:00:00.000Z',
    }
    const item2 = {
      id: 2,
      teamId: 1,
      title: 'Second Dashboard Item',
      description: null,
      type: 'task' as const,
      priority: 'medium' as const,
      status: 'open' as const,
      assigneeId: null,
      createdBy: 1,
      dueAt: null,
      version: 1,
      createdAt: '2026-10-18T10:05:00.000Z',
      updatedAt: '2026-10-18T10:05:00.000Z',
    }

    setupDashboardFetch({
      customItemsHandler: (url) => {
        if (url.includes('cursor=page2-token')) {
          return { items: [item2], nextCursor: null }
        }
        return { items: [item1], nextCursor: 'page2-token' }
      },
    })

    renderWithProviders(<Dashboard />)

    await waitFor(() => {
      expect(screen.getByText('First Dashboard Item')).toBeInTheDocument()
    })

    const loadMoreBtn = screen.getByRole('button', { name: /Load More Items/i })
    expect(loadMoreBtn).toBeInTheDocument()

    fireEvent.click(loadMoreBtn)

    await waitFor(() => {
      expect(screen.getByText('Second Dashboard Item')).toBeInTheDocument()
    })

    expect(screen.getByText('First Dashboard Item')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Load More Items/i })).not.toBeInTheDocument()
  })
})
