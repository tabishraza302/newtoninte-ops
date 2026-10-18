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

  it('renders all four tab views and checks overdue tab is present', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ items: [], nextCursor: null }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    renderWithProviders(<Dashboard />)

    expect(screen.getByRole('tab', { name: /Assigned to Me/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Unassigned Urgent/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Awaiting My Approval/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Overdue/i })).toBeInTheDocument()

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/items?view=assigned_to_me'),
        expect.anything(),
      )
    })
  })

  it('switches tabs and issues GET /items?view=<name>', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ items: [], nextCursor: null }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

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
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ items: [], nextCursor: null }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    renderWithProviders(<Dashboard />)

    await waitFor(() => {
      expect(screen.getByTestId('empty-state')).toBeInTheDocument()
    })
    expect(screen.getByText(/No items in this view/i)).toBeInTheDocument()
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

    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ items: [mockItem], nextCursor: null }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    renderWithProviders(<Dashboard />)

    await waitFor(() => {
      expect(screen.getByText('Database connection leak in worker')).toBeInTheDocument()
    })

    expect(screen.getByTestId('item-row-42')).toBeInTheDocument()
    expect(screen.getByText('Alice Engineer')).toBeInTheDocument()
    expect(screen.getByText('urgent')).toBeInTheDocument()
  })
})
