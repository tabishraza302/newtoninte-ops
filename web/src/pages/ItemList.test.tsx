import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { renderWithProviders } from '../test/test-utils'
import { ItemList } from './ItemList'
import type { WorkItem } from '../api/types'

describe('ItemList Page (Task 3.8)', () => {
  const fetchMock = vi.fn()

  const mockItem1: WorkItem = {
    id: 1,
    teamId: 1,
    title: 'First issue',
    description: 'First description',
    type: 'incident',
    priority: 'urgent',
    status: 'open',
    assigneeId: 1,
    createdBy: 2,
    dueAt: null,
    version: 1,
    createdAt: '2026-10-18T10:00:00.000Z',
    updatedAt: '2026-10-18T10:00:00.000Z',
    assignee: { id: 1, displayName: 'Alice', email: 'alice@example.com' },
    creator: { id: 2, displayName: 'Bob', email: 'bob@example.com' },
  }

  const mockItem2: WorkItem = {
    id: 2,
    teamId: 1,
    title: 'Second issue',
    description: 'Second description',
    type: 'task',
    priority: 'medium',
    status: 'in_progress',
    assigneeId: 2,
    createdBy: 1,
    dueAt: null,
    version: 1,
    createdAt: '2026-10-18T11:00:00.000Z',
    updatedAt: '2026-10-18T11:00:00.000Z',
    assignee: { id: 2, displayName: 'Bob', email: 'bob@example.com' },
    creator: { id: 1, displayName: 'Alice', email: 'alice@example.com' },
  }

  beforeEach(() => {
    vi.restoreAllMocks()
    fetchMock.mockReset()
    globalThis.fetch = fetchMock
  })

  const mockUser = {
    id: 1,
    email: 'alice@example.com',
    displayName: 'Alice',
    isAdmin: false,
    status: 'active' as const,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
  const mockTeams = [{ id: 1, name: 'Core Team', slug: 'core' }]

  const setupItemListFetch = (opts: {
    items?: WorkItem[]
    nextCursor?: string | null
    customItemsHandler?: (url: string) => { items: WorkItem[]; nextCursor: string | null }
  } = {}) => {
    fetchMock.mockImplementation((urlStr: string | URL | Request) => {
      const url = typeof urlStr === 'string' ? urlStr : urlStr.toString()

      if (url.includes('/auth/me')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              user: mockUser,
              memberships: [{ teamId: 1, role: 'member' }],
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            },
          ),
        )
      }

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

  it('loads and renders initial items', async () => {
    setupItemListFetch({ items: [mockItem1] })

    renderWithProviders(<ItemList />)

    await waitFor(() => {
      expect(screen.getByText('First issue')).toBeInTheDocument()
    })
  })

  it('typing in the search box sends q', async () => {
    setupItemListFetch({ items: [mockItem1] })

    renderWithProviders(<ItemList />)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/items'),
        expect.anything(),
      )
    })

    const searchInput = screen.getByRole('searchbox', { name: /Search/i })
    fireEvent.change(searchInput, { target: { value: 'database' } })

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('q=database'),
        expect.anything(),
      )
    })
  })

  it('changing priority sends priority', async () => {
    setupItemListFetch({ items: [mockItem1] })

    renderWithProviders(<ItemList />)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/items'),
        expect.anything(),
      )
    })

    const prioritySelect = screen.getByRole('combobox', { name: /Priority/i })
    fireEvent.change(prioritySelect, { target: { value: 'urgent' } })

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('priority=urgent'),
        expect.anything(),
      )
    })
  })

  it('initializes filters from URL search params', async () => {
    setupItemListFetch({ items: [mockItem1] })

    renderWithProviders(<ItemList />, {
      route: '/items?status=open&priority=urgent&type=incident&q=crash',
    })

    expect(screen.getByRole('searchbox', { name: /Search/i })).toHaveValue('crash')
    expect(screen.getByRole('combobox', { name: /Status/i })).toHaveValue('open')
    expect(screen.getByRole('combobox', { name: /Priority/i })).toHaveValue('urgent')
    expect(screen.getByRole('combobox', { name: /Type/i })).toHaveValue('incident')

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('status=open'),
        expect.anything(),
      )
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('priority=urgent'),
        expect.anything(),
      )
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('type=incident'),
        expect.anything(),
      )
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('q=crash'),
        expect.anything(),
      )
    })
  })

  it('follows nextCursor on Load more and appends results without replacing', async () => {
    setupItemListFetch({
      customItemsHandler: (url) => {
        if (url.includes('cursor=cursor_token_123')) {
          return { items: [mockItem2], nextCursor: null }
        }
        return { items: [mockItem1], nextCursor: 'cursor_token_123' }
      },
    })

    renderWithProviders(<ItemList />)

    await waitFor(() => {
      expect(screen.getByText('First issue')).toBeInTheDocument()
    })

    const loadMoreBtn = screen.getByRole('button', { name: /Load more/i })
    expect(loadMoreBtn).toBeInTheDocument()

    fireEvent.click(loadMoreBtn)

    await waitFor(() => {
      expect(screen.getByText('Second issue')).toBeInTheDocument()
    })

    // Both first and second items must be present (appended, never replaced)
    expect(screen.getByText('First issue')).toBeInTheDocument()
    expect(screen.getByText('Second issue')).toBeInTheDocument()

    // Once nextCursor is null, Load more is gone
    expect(screen.queryByRole('button', { name: /Load more/i })).not.toBeInTheDocument()
  })

  it('shows empty state when no items are returned', async () => {
    setupItemListFetch({ items: [] })

    renderWithProviders(<ItemList />)

    await waitFor(() => {
      expect(screen.getByText(/No items found/i)).toBeInTheDocument()
    })
  })
})
