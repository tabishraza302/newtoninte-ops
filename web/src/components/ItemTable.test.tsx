import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '../test/test-utils'
import { ItemRow, ItemTableGrid, ItemTableHeader } from './ItemTable'
import type { WorkItem } from '../api/types'

describe('ItemTableHeader Component', () => {
  it('renders all 6 expected column headers with appropriate styles', () => {
    renderWithProviders(<ItemTableHeader />)

    const headers = screen.getAllByRole('columnheader')
    expect(headers).toHaveLength(6)

    const headerTexts = headers.map((h) => h.textContent)
    expect(headerTexts).toEqual(['ID', 'Title', 'Status', 'Priority', 'Assignee', 'Due'])

    const dueHeader = screen.getByRole('columnheader', { name: 'Due' })
    expect(dueHeader).toHaveStyle({ textAlign: 'right' })
  })
})

describe('ItemRow Component', () => {
  const baseMockItem: WorkItem = {
    id: 42,
    teamId: 1,
    title: 'Process refund transaction',
    description: 'Detailed description',
    type: 'payment',
    priority: 'urgent',
    status: 'open',
    assigneeId: 10,
    assignee: { id: 10, displayName: 'Alice Engineer', email: 'alice@example.com' },
    createdBy: 1,
    dueAt: '2026-12-31T00:00:00.000Z',
    version: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }

  it('renders all 6 distinct cells in order matching header columns', () => {
    renderWithProviders(<ItemRow item={baseMockItem} />)

    const row = screen.getByTestId('item-row-42')
    expect(row).toBeInTheDocument()

    const cells = row.children
    expect(cells).toHaveLength(6)

    // Cell 1: ID
    const idLink = screen.getByRole('link', { name: '#42' })
    expect(idLink).toBeInTheDocument()
    expect(idLink).toHaveAttribute('href', '/items/42')
    expect(cells[0]).toContainElement(idLink)

    // Cell 2: Title and Type
    const titleLink = screen.getByRole('link', { name: 'Process refund transaction' })
    expect(titleLink).toBeInTheDocument()
    expect(titleLink).toHaveAttribute('href', '/items/42')
    expect(cells[1]).toContainElement(titleLink)
    expect(cells[1]).toHaveTextContent('payment')

    // Cell 3: Status
    const statusBadge = screen.getByTestId('item-status')
    expect(statusBadge).toHaveTextContent('open')
    expect(cells[2]).toContainElement(statusBadge)

    // Cell 4: Priority
    const priorityBadge = screen.getByTestId('item-priority')
    expect(priorityBadge).toHaveTextContent('urgent')
    expect(cells[3]).toContainElement(priorityBadge)

    // Cell 5: Assignee
    expect(cells[4]).toHaveTextContent('Alice Engineer')

    // Cell 6: Due Date
    const expectedDueDate = new Date('2026-12-31T00:00:00.000Z').toLocaleDateString()
    expect(cells[5]).toHaveTextContent(expectedDueDate)
    expect(cells[5]).toHaveStyle({ textAlign: 'right' })
  })

  it('renders fallback values when assignee and dueAt are null', () => {
    const unassignedItem: WorkItem = {
      ...baseMockItem,
      id: 99,
      assigneeId: null,
      assignee: null,
      dueAt: null,
    }

    renderWithProviders(<ItemRow item={unassignedItem} />)

    const row = screen.getByTestId('item-row-99')
    const cells = row.children
    expect(cells).toHaveLength(6)

    // Cell 5: Fallback Assignee
    expect(cells[4]).toHaveTextContent('Unassigned')

    // Cell 6: Fallback Due Date
    expect(cells[5]).toHaveTextContent('No due date')
    expect(cells[5]).toHaveStyle({ textAlign: 'right' })
  })

  it('renders awaiting_approval status badge without text distortion', () => {
    const awaitingApprovalItem: WorkItem = {
      ...baseMockItem,
      id: 77,
      status: 'awaiting_approval',
    }

    renderWithProviders(<ItemRow item={awaitingApprovalItem} />)

    const statusBadge = screen.getByTestId('item-status')
    expect(statusBadge).toHaveTextContent('awaiting approval')
    expect(statusBadge).toHaveStyle({ whiteSpace: 'nowrap' })
  })

  it('keeps long titles inside their column and exposes the full text', () => {
    const longTitle = 'Z'.repeat(140)
    renderWithProviders(<ItemRow item={{ ...baseMockItem, id: 88, title: longTitle }} />)

    const titleCell = screen.getByTestId('item-row-88').children[1]
    const titleLink = screen.getByRole('link', { name: longTitle })

    expect(titleCell).toHaveStyle({ overflow: 'hidden' })
    // The cell's zero min-width is what lets the 3fr track shrink instead of
    // overflowing into the neighbouring columns.
    expect(window.getComputedStyle(titleLink.parentElement!).minWidth).toBe('0px')
    expect(titleLink).toHaveStyle({
      display: 'block',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
    })
    expect(titleLink).toHaveAttribute('title', longTitle)
  })

  it('ties header and rows to the container track list instead of their own', () => {
    renderWithProviders(
      <ItemTableGrid label="Work items">
        <ItemTableHeader />
        <ItemRow item={baseMockItem} />
      </ItemTableGrid>,
    )

    const table = screen.getByRole('table', { name: 'Work items' })
    const headers = screen.getAllByRole('columnheader')
    const rows = screen.getAllByRole('row')

    expect(screen.getAllByRole('cell')).toHaveLength(6)
    expect(rows).toHaveLength(2)

    // `X` collapses each parenthesised track function to one token, so the
    // split yields one entry per top-level track: the container must define
    // exactly one track per column. Header and rows then take those tracks
    // (`subgrid`) rather than resolving a template of their own — that sharing
    // is what keeps every column edge aligned in a real browser.
    expect(table.style.gridTemplateColumns.replace(/\([^)]*\)/g, 'X').trim().split(/\s+/)).toHaveLength(headers.length)
    for (const row of rows) {
      expect(row.style.gridTemplateColumns).toBe('subgrid')
      expect(row.style.gridColumn).toBe('1 / -1')
    }

    // Subgrid-less browsers fall back to the container's custom property: it
    // must describe the same number of tracks and must not use `max-content`,
    // which would size per row and tear the shared column edges apart.
    const fallback = table.style.getPropertyValue('--item-table-columns')
    expect(fallback.replace(/\([^)]*\)/g, 'X').trim().split(/\s+/)).toHaveLength(headers.length)
    expect(fallback).not.toContain('max-content')
  })
})
