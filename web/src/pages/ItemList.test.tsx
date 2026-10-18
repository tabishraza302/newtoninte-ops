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

  it('renders filter controls and loads initial items', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ items: [mockItem1], nextCursor: null }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    renderWithProviders(<ItemList />)

    expect(screen.getByRole('heading', { name: /Items/i })).toBeInTheDocument()
    expect(screen.getByRole('searchbox', { name: /Search/i })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: /Status/i })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: /Priority/i })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: /Type/i })).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByText('First issue')).toBeInTheDocument()
    })
  })

  it('typing in the search box sends q', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ items: [mockItem1], nextCursor: null }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

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
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ items: [mockItem1], nextCursor: null }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

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
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ items: [mockItem1], nextCursor: null }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

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
    fetchMock.mockImplementation((urlStr: string | URL | Request) => {
      const url = typeof urlStr === 'string' ? urlStr : urlStr.toString()
      if (url.includes('cursor=cursor_token_123')) {
        return Promise.resolve(
          new Response(JSON.stringify({ items: [mockItem2], nextCursor: null }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({ items: [mockItem1], nextCursor: 'cursor_token_123' }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      )
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
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ items: [], nextCursor: null }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    renderWithProviders(<ItemList />)

    await waitFor(() => {
      expect(screen.getByTestId('empty-state')).toBeInTheDocument()
    })
    expect(screen.getByText(/No items found/i)).toBeInTheDocument()
  })
})
