import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { renderWithProviders } from '../test/test-utils'
import { Approvals } from './Approvals'
import type { WorkItem } from '../api/types'

function deferred<T>() {
  let resolve!: (val: T | PromiseLike<T>) => void
  let reject!: (err?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const mockPendingItem: WorkItem = {
  id: 4960,
  version: 1,
  teamId: 1,
  title: 'Audit access-log retention',
  description: 'Submitted for lead review',
  type: 'task',
  status: 'awaiting_approval',
  priority: 'urgent',
  assigneeId: 10,
  createdBy: 10,
  dueAt: '2035-02-09T00:00:00.000Z',
  createdAt: '2026-10-18T10:00:00.000Z',
  updatedAt: '2026-10-18T11:00:00.000Z',
  assignee: {
    id: 10,
    email: 'member@newtonite.test',
    displayName: 'Member User',
  },
}

const mockPendingItem2: WorkItem = {
  id: 4961,
  version: 3,
  teamId: 2,
  title: 'Rotate production database credentials',
  description: 'Submitted for lead verification',
  type: 'task',
  status: 'awaiting_approval',
  priority: 'high',
  assigneeId: 11,
  createdBy: 10,
  dueAt: '2035-02-10T00:00:00.000Z',
  createdAt: '2026-10-18T10:30:00.000Z',
  updatedAt: '2026-10-18T11:15:00.000Z',
  assignee: {
    id: 11,
    email: 'secops@newtonite.test',
    displayName: 'SecOps User',
  },
}

describe('Approvals Dedicated Inbox Page', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.restoreAllMocks()
    fetchMock.mockReset()
    globalThis.fetch = fetchMock
  })

  const setupApprovalsFetch = (opts: {
    items?: WorkItem[]
    nextCursor?: string | null
    teams?: Array<{ id: number; name: string; slug: string }>
  } = {}) => {
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()

      if (url.includes('/teams')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              teams: opts.teams ?? [
                { id: 1, name: 'Core Team', slug: 'core' },
                { id: 2, name: 'Security Team', slug: 'security' },
              ],
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            },
          ),
        )
      }

      if (url.includes('/items/') && url.includes('/transition') && init?.method === 'POST') {
        const body = init.body ? JSON.parse(init.body as string) : {}
        return Promise.resolve(
          new Response(
            JSON.stringify({
              item: { ...mockPendingItem, status: body.to },
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            },
          ),
        )
      }

      if (url.includes('/items')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              items: opts.items ?? [mockPendingItem],
              nextCursor: opts.nextCursor !== undefined ? opts.nextCursor : null,
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
  }

  // ---------------------------------------------------------------------------
  // Case 1: Existing render / badge / row + empty state + team filter (keep)
  // ---------------------------------------------------------------------------
  it('renders queue header, count badge, and items awaiting approval', async () => {
    setupApprovalsFetch({ items: [mockPendingItem] })

    renderWithProviders(<Approvals />)

    expect(await screen.findByTestId('approvals-count-badge')).toHaveTextContent('1 item pending')
    expect(screen.getByText('Audit access-log retention')).toBeInTheDocument()
    expect(screen.getByText('Member User')).toBeInTheDocument()
  })

  it('displays encouraging empty state when no items are pending approval', async () => {
    setupApprovalsFetch({ items: [] })

    renderWithProviders(<Approvals />)

    expect(await screen.findByText('All caught up!')).toBeInTheDocument()
    expect(screen.getByText(/No work items are currently pending approval/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Go to Dashboard/i })).toHaveAttribute('href', '/dashboard')
  })

  it('filters approvals queue by team selection', async () => {
    setupApprovalsFetch({ items: [mockPendingItem, mockPendingItem2] })

    renderWithProviders(<Approvals />)

    const teamFilter = await screen.findByLabelText(/Filter by team/i)
    expect(teamFilter).toBeInTheDocument()

    fireEvent.change(teamFilter, { target: { value: '2' } })

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('team=2'),
        expect.anything(),
      )
    })
  })

  // ---------------------------------------------------------------------------
  // Case 2: Approve posts expectedVersion and the row disappears
  // ---------------------------------------------------------------------------
  it('executes one-click approval with expectedVersion and removes row from list on success', async () => {
    setupApprovalsFetch({ items: [mockPendingItem, mockPendingItem2] })

    renderWithProviders(<Approvals />)

    const approveBtn = await screen.findByTestId(`approve-${mockPendingItem.id}`)
    expect(approveBtn).toBeInTheDocument()

    fireEvent.click(approveBtn)

    await waitFor(() => {
      const call = fetchMock.mock.calls.find((c) => {
        const url = typeof c[0] === 'string' ? c[0] : c[0].toString()
        return url.includes(`/items/${mockPendingItem.id}/transition`) && c[1]?.method === 'POST'
      })
      expect(call).toBeDefined()
      const parsedBody = JSON.parse(call![1].body as string)
      expect(parsedBody).toEqual({
        to: 'resolved',
        expectedVersion: mockPendingItem.version,
      })
    })

    // The approved item row should disappear from the list
    await waitFor(() => {
      expect(screen.queryByTestId(`approve-${mockPendingItem.id}`)).not.toBeInTheDocument()
    })
    // Other item remains
    expect(screen.getByTestId(`approve-${mockPendingItem2.id}`)).toBeInTheDocument()
  })

  // ---------------------------------------------------------------------------
  // Case 3: Return flow: dialog open -> Escape -> focus restored;
  // reopen -> focus inside; Tab wraps; confirm disabled while in flight; body matches contract
  // ---------------------------------------------------------------------------
  it('handles complete return flow: focus management, Escape restore, keyboard trap, and payload', async () => {
    const returnDeferred = deferred<Response>()

    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()

      if (url.includes('/teams')) {
        return Promise.resolve(
          new Response(JSON.stringify({ teams: [{ id: 1, name: 'Core Team', slug: 'core' }] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }

      if (url.includes(`/items/${mockPendingItem.id}/transition`) && init?.method === 'POST') {
        return returnDeferred.promise
      }

      if (url.includes('/items')) {
        return Promise.resolve(
          new Response(JSON.stringify({ items: [mockPendingItem], nextCursor: null }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }

      return Promise.resolve(new Response('not found', { status: 404 }))
    })

    renderWithProviders(<Approvals />)

    const returnBtn = await screen.findByTestId(`send-back-${mockPendingItem.id}`)
    returnBtn.focus()
    expect(document.activeElement).toBe(returnBtn)

    // Open dialog
    fireEvent.click(returnBtn)

    const dialog = await screen.findByRole('dialog')
    expect(dialog).toBeInTheDocument()
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAttribute('aria-labelledby', 'return-modal-title')
    expect(document.body.style.overflow).toBe('hidden')

    // Escape closes dialog and restores focus to send-back button
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
    expect(document.body.style.overflow).toBe('')
    expect(document.activeElement).toBe(returnBtn)

    // Reopen dialog -> focus starts inside the dialog (textarea)
    fireEvent.click(returnBtn)
    await screen.findByRole('dialog')

    const textarea = screen.getByLabelText(/Feedback \/ Return Reason/i)
    await waitFor(() => {
      expect(document.activeElement).toBe(textarea)
    })

    const cancelBtn = screen.getByRole('button', { name: /Cancel/i })
    const confirmBtn = screen.getByRole('button', { name: /Confirm Return/i })

    // Tab key wrap: from Confirm Return (last element) to textarea (first element)
    confirmBtn.focus()
    expect(document.activeElement).toBe(confirmBtn)
    fireEvent.keyDown(window, { key: 'Tab' })
    expect(document.activeElement).toBe(textarea)

    // Shift+Tab wrap: from textarea (first element) to confirmBtn (last element)
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(confirmBtn)

    // Fill in return feedback
    fireEvent.change(textarea, { target: { value: 'Please add integration tests.' } })

    // Click Confirm Return
    fireEvent.click(confirmBtn)

    // Confirm Return, Cancel, and textarea should be disabled while submit is in flight
    expect(confirmBtn).toBeDisabled()
    expect(cancelBtn).toBeDisabled()
    expect(textarea).toBeDisabled()
    // Verify payload contract
    await waitFor(() => {
      const call = fetchMock.mock.calls.find((c) => {
        const url = typeof c[0] === 'string' ? c[0] : c[0].toString()
        return url.includes(`/items/${mockPendingItem.id}/transition`) && c[1]?.method === 'POST'
      })
      expect(call).toBeDefined()
      const parsed = JSON.parse(call![1].body as string)
      expect(parsed).toEqual({
        to: 'in_progress',
        reason: 'Please add integration tests.',
        expectedVersion: mockPendingItem.version,
      })
    })

    // Resolve transition
    returnDeferred.resolve(
      new Response(
        JSON.stringify({
          item: { ...mockPendingItem, status: 'in_progress' },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    // Modal closes and item is removed
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(screen.queryByTestId(`send-back-${mockPendingItem.id}`)).not.toBeInTheDocument()
    })

    // Focus lands on heading since no items remain in queue
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: /Approvals Queue/i }))
  })

  // ---------------------------------------------------------------------------
  // Case 4: Return failure 500 -> in-dialog error visible, dialog open, textarea text preserved
  // ---------------------------------------------------------------------------
  it('handles return failure 500: displays in-dialog error, keeps dialog open, preserves textarea text', async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()

      if (url.includes('/teams')) {
        return Promise.resolve(
          new Response(JSON.stringify({ teams: [{ id: 1, name: 'Core Team', slug: 'core' }] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }

      if (url.includes('/items/') && url.includes('/transition') && init?.method === 'POST') {
        return Promise.resolve(
          new Response(JSON.stringify({ error: 'Internal server error processing transition' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }

      if (url.includes('/items')) {
        return Promise.resolve(
          new Response(JSON.stringify({ items: [mockPendingItem], nextCursor: null }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }

      return Promise.resolve(new Response('not found', { status: 404 }))
    })

    renderWithProviders(<Approvals />)

    const returnBtn = await screen.findByTestId(`send-back-${mockPendingItem.id}`)
    fireEvent.click(returnBtn)

    const textarea = screen.getByLabelText(/Feedback \/ Return Reason/i) as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'Revision needed for security review' } })

    const confirmBtn = screen.getByRole('button', { name: /Confirm Return/i })
    fireEvent.click(confirmBtn)

    // Wait for in-dialog error
    const dialogError = await screen.findByTestId('return-dialog-error')
    expect(dialogError).toBeInTheDocument()
    expect(dialogError).toHaveAttribute('role', 'alert')
    expect(dialogError.textContent).toMatch(/Internal server error|Failed to return/i)

    // Dialog remains open and textarea contents preserved
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(textarea.value).toBe('Revision needed for security review')
  })

  // ---------------------------------------------------------------------------
  // Case 5: 409 conflict handling
  // Return 409: dialog closes, item removed, exact alert displayed
  // Approve 409: exact alert displayed, item removed
  // ---------------------------------------------------------------------------
  it('handles return 409 conflict: closes dialog, removes item, displays exact page alert text', async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()

      if (url.includes('/teams')) {
        return Promise.resolve(
          new Response(JSON.stringify({ teams: [{ id: 1, name: 'Core Team', slug: 'core' }] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }

      if (url.includes('/items/') && url.includes('/transition') && init?.method === 'POST') {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              error: 'Conflict: version mismatch',
            }),
            {
              status: 409,
              headers: { 'Content-Type': 'application/json' },
            },
          ),
        )
      }

      if (url.includes('/items')) {
        return Promise.resolve(
          new Response(JSON.stringify({ items: [mockPendingItem], nextCursor: null }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }

      return Promise.resolve(new Response('not found', { status: 404 }))
    })

    renderWithProviders(<Approvals />)

    const returnBtn = await screen.findByTestId(`send-back-${mockPendingItem.id}`)
    fireEvent.click(returnBtn)

    const textarea = screen.getByLabelText(/Feedback \/ Return Reason/i)
    fireEvent.change(textarea, { target: { value: 'Needs update' } })

    const confirmBtn = screen.getByRole('button', { name: /Confirm Return/i })
    fireEvent.click(confirmBtn)

    // On 409: dialog closes, item removed from list, exact page alert text displayed
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(screen.queryByTestId(`send-back-${mockPendingItem.id}`)).not.toBeInTheDocument()
      expect(
        screen.getByText('This item changed while you were reviewing it — the queue has been refreshed.'),
      ).toBeInTheDocument()
    })
  })

  it('handles approve 409 conflict: removes item and displays exact page alert text', async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()

      if (url.includes('/teams')) {
        return Promise.resolve(
          new Response(JSON.stringify({ teams: [{ id: 1, name: 'Core Team', slug: 'core' }] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }

      if (url.includes('/items/') && url.includes('/transition') && init?.method === 'POST') {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              error: 'Conflict: version mismatch',
            }),
            {
              status: 409,
              headers: { 'Content-Type': 'application/json' },
            },
          ),
        )
      }

      if (url.includes('/items')) {
        return Promise.resolve(
          new Response(JSON.stringify({ items: [mockPendingItem], nextCursor: null }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }

      return Promise.resolve(new Response('not found', { status: 404 }))
    })

    renderWithProviders(<Approvals />)

    const approveBtn = await screen.findByTestId(`approve-${mockPendingItem.id}`)
    fireEvent.click(approveBtn)

    await waitFor(() => {
      expect(screen.queryByTestId(`approve-${mockPendingItem.id}`)).not.toBeInTheDocument()
      expect(
        screen.getByText('This item changed while you were reviewing it — the queue has been refreshed.'),
      ).toBeInTheDocument()
    })
  })

  // ---------------------------------------------------------------------------
  // Case 6: Pagination
  // page 1 = 20 items + nextCursor -> badge "20+ items pending";
  // click load-more -> request carries cursor; 40 rows; badge "40 items pending" when
  // second page has no nextCursor; button hidden then.
  // ---------------------------------------------------------------------------
  it('supports pagination: badge with nextCursor, load-more requests with cursor, row accumulation, and badge update', async () => {
    const page2Deferred = deferred<Response>()
    const page1Items: WorkItem[] = Array.from({ length: 20 }, (_, idx) => ({
      ...mockPendingItem,
      id: 1000 + idx,
      title: `Pending Item #${1000 + idx}`,
    }))

    const page2Items: WorkItem[] = Array.from({ length: 20 }, (_, idx) => ({
      ...mockPendingItem,
      id: 2000 + idx,
      title: `Pending Item #${2000 + idx}`,
    }))

    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()

      if (url.includes('/teams')) {
        return Promise.resolve(
          new Response(JSON.stringify({ teams: [{ id: 1, name: 'Core Team', slug: 'core' }] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }

      if (url.includes('/items')) {
        if (url.includes('cursor=cursor_page_2')) {
          return page2Deferred.promise
        }

        return Promise.resolve(
          new Response(
            JSON.stringify({
              items: page1Items,
              nextCursor: 'cursor_page_2',
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

    renderWithProviders(<Approvals />)

    // Page 1: Badge should display "20+ items pending"
    const badge = await screen.findByTestId('approvals-count-badge')
    expect(badge).toHaveTextContent('20+ items pending')

    // Load more button should be visible with proper label and testid
    const loadMoreBtn = screen.getByTestId('approvals-load-more')
    expect(loadMoreBtn).toBeInTheDocument()
    expect(loadMoreBtn).toHaveTextContent('Load More Items')

    // Click load more
    fireEvent.click(loadMoreBtn)

    // While page 2 is in-flight:
    // 1. Existing 20 items remain mounted in DOM
    expect(screen.getByTestId('approve-1000')).toBeInTheDocument()
    // 2. Count badge remains mounted in DOM
    expect(screen.getByTestId('approvals-count-badge')).toHaveTextContent('20+ items pending')
    // 3. Full-page loading banner does not render
    expect(screen.queryByText('Loading approvals queue…')).not.toBeInTheDocument()
    // 4. Load more button stays mounted, disabled, with loading text
    expect(screen.getByTestId('approvals-load-more')).toBeInTheDocument()
    expect(screen.getByTestId('approvals-load-more')).toBeDisabled()
    expect(screen.getByTestId('approvals-load-more')).toHaveTextContent('Loading more items…')

    // Request should carry cursor=cursor_page_2
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('cursor=cursor_page_2'),
        expect.anything(),
      )
    })

    // Resolve second page
    page2Deferred.resolve(
      new Response(
        JSON.stringify({
          items: page2Items,
          nextCursor: null,
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    )

    // Now 40 rows accumulated
    await waitFor(() => {
      expect(screen.getByTestId('approve-1000')).toBeInTheDocument()
      expect(screen.getByTestId('approve-2019')).toBeInTheDocument()
    })

    // Badge updates to "40 items pending"
    expect(screen.getByTestId('approvals-count-badge')).toHaveTextContent('40 items pending')

    // Load more button disappears since second page has nextCursor: null
    expect(screen.queryByTestId('approvals-load-more')).not.toBeInTheDocument()
  })

  // ---------------------------------------------------------------------------
  // Case 7: Per-item pending
  // with row A's approve held in flight, row A's buttons are disabled, row B's are not;
  // after A settles only A re-enables (or row A disappears on success)
  // ---------------------------------------------------------------------------
  it('manages per-item pending state: row A buttons disabled in flight while row B remains enabled', async () => {
    const approveDeferred = deferred<Response>()

    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()

      if (url.includes('/teams')) {
        return Promise.resolve(
          new Response(JSON.stringify({ teams: [{ id: 1, name: 'Core Team', slug: 'core' }] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }

      if (url.includes(`/items/${mockPendingItem.id}/transition`) && init?.method === 'POST') {
        return approveDeferred.promise
      }

      if (url.includes('/items')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              items: [mockPendingItem, mockPendingItem2],
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

    renderWithProviders(<Approvals />)

    const approveBtnA = await screen.findByTestId(`approve-${mockPendingItem.id}`)
    const sendBackBtnA = screen.getByTestId(`send-back-${mockPendingItem.id}`)
    const approveBtnB = screen.getByTestId(`approve-${mockPendingItem2.id}`)
    const sendBackBtnB = screen.getByTestId(`send-back-${mockPendingItem2.id}`)

    expect(approveBtnA).toBeEnabled()
    expect(sendBackBtnA).toBeEnabled()
    expect(approveBtnB).toBeEnabled()
    expect(sendBackBtnB).toBeEnabled()

    // Trigger approve for Item A
    fireEvent.click(approveBtnA)

    // While A is in flight, A's buttons are disabled; B's buttons are NOT disabled
    await waitFor(() => {
      expect(approveBtnA).toBeDisabled()
      expect(sendBackBtnA).toBeDisabled()
    })
    expect(approveBtnB).toBeEnabled()
    expect(sendBackBtnB).toBeEnabled()

    // Settle Item A with an error so row A remains and re-enables
    approveDeferred.resolve(
      new Response(JSON.stringify({ error: 'Temporary backend error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    // After A settles, row A buttons re-enable; row B remains enabled
    await waitFor(() => {
      expect(approveBtnA).toBeEnabled()
      expect(sendBackBtnA).toBeEnabled()
    })
    expect(approveBtnB).toBeEnabled()
    expect(sendBackBtnB).toBeEnabled()
  })
  // ---------------------------------------------------------------------------
  // Case 8: Sensible focus restoration across row removals
  // ---------------------------------------------------------------------------
  it('restores focus sensibly on return: next row when middle item returned, previous row when last item returned', async () => {
    const itemA: WorkItem = { ...mockPendingItem, id: 101, title: 'Item 101' }
    const itemB: WorkItem = { ...mockPendingItem, id: 102, title: 'Item 102' }
    const itemC: WorkItem = { ...mockPendingItem, id: 103, title: 'Item 103' }

    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()

      if (url.includes('/teams')) {
        return Promise.resolve(
          new Response(JSON.stringify({ teams: [{ id: 1, name: 'Core Team', slug: 'core' }] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }

      if (url.includes('/transition') && init?.method === 'POST') {
        const body = init.body ? JSON.parse(init.body as string) : {}
        return Promise.resolve(
          new Response(JSON.stringify({ item: { ...mockPendingItem, status: body.to } }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }

      if (url.includes('/items')) {
        return Promise.resolve(
          new Response(JSON.stringify({ items: [itemA, itemB, itemC], nextCursor: null }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }

      return Promise.resolve(new Response('not found', { status: 404 }))
    })

    renderWithProviders(<Approvals />)

    await screen.findByTestId(`send-back-${itemB.id}`)

    // 1. Return middle item (itemB = 102) -> focus lands on itemC (103)
    fireEvent.click(screen.getByTestId(`send-back-${itemB.id}`))
    await screen.findByRole('dialog')
    fireEvent.click(screen.getByRole('button', { name: /Confirm Return/i }))

    await waitFor(() => {
      expect(screen.queryByTestId(`send-back-${itemB.id}`)).not.toBeInTheDocument()
    })
    expect(document.activeElement).toBe(screen.getByTestId(`send-back-${itemC.id}`))

    // 2. Return last item (itemC = 103) -> focus lands on itemA (101)
    fireEvent.click(screen.getByTestId(`send-back-${itemC.id}`))
    await screen.findByRole('dialog')
    fireEvent.click(screen.getByRole('button', { name: /Confirm Return/i }))

    await waitFor(() => {
      expect(screen.queryByTestId(`send-back-${itemC.id}`)).not.toBeInTheDocument()
    })
    expect(document.activeElement).toBe(screen.getByTestId(`send-back-${itemA.id}`))
  })

  it('restores focus sensibly on approve: next row when middle item approved, previous row when last item approved', async () => {
    const itemA: WorkItem = { ...mockPendingItem, id: 201, title: 'Item 201' }
    const itemB: WorkItem = { ...mockPendingItem, id: 202, title: 'Item 202' }
    const itemC: WorkItem = { ...mockPendingItem, id: 203, title: 'Item 203' }

    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()

      if (url.includes('/teams')) {
        return Promise.resolve(
          new Response(JSON.stringify({ teams: [{ id: 1, name: 'Core Team', slug: 'core' }] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }

      if (url.includes('/transition') && init?.method === 'POST') {
        const body = init.body ? JSON.parse(init.body as string) : {}
        return Promise.resolve(
          new Response(JSON.stringify({ item: { ...mockPendingItem, status: body.to } }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }

      if (url.includes('/items')) {
        return Promise.resolve(
          new Response(JSON.stringify({ items: [itemA, itemB, itemC], nextCursor: null }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }

      return Promise.resolve(new Response('not found', { status: 404 }))
    })

    renderWithProviders(<Approvals />)

    const approveB = await screen.findByTestId(`approve-${itemB.id}`)
    approveB.focus()
    fireEvent.click(approveB)

    await waitFor(() => {
      expect(screen.queryByTestId(`approve-${itemB.id}`)).not.toBeInTheDocument()
    })
    expect(document.activeElement).toBe(screen.getByTestId(`send-back-${itemC.id}`))

    const approveC = screen.getByTestId(`approve-${itemC.id}`)
    approveC.focus()
    fireEvent.click(approveC)

    await waitFor(() => {
      expect(screen.queryByTestId(`approve-${itemC.id}`)).not.toBeInTheDocument()
    })
    expect(document.activeElement).toBe(screen.getByTestId(`send-back-${itemA.id}`))
  })

  // ---------------------------------------------------------------------------
  // Case 9: Team filter change during active pagination resets cursor and rows
  // ---------------------------------------------------------------------------
  it('resets cursor and accumulated rows when team filter changes during active pagination', async () => {
    const team1Page1 = [
      { ...mockPendingItem, id: 101, teamId: 1, title: 'Team 1 Item 1' },
      { ...mockPendingItem, id: 102, teamId: 1, title: 'Team 1 Item 2' },
    ]
    const team1Page2 = [
      { ...mockPendingItem, id: 103, teamId: 1, title: 'Team 1 Item 3' },
    ]
    const team2Items = [
      { ...mockPendingItem2, id: 201, teamId: 2, title: 'Team 2 Item 1' },
    ]

    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()

      if (url.includes('/teams')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              teams: [
                { id: 1, name: 'Core Team', slug: 'core' },
                { id: 2, name: 'Security Team', slug: 'security' },
              ],
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            },
          ),
        )
      }

      if (url.includes('/items')) {
        if (url.includes('team=2')) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                items: team2Items,
                nextCursor: null,
              }),
              {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
              },
            ),
          )
        }

        if (url.includes('cursor=team1_cursor_p2')) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                items: team1Page2,
                nextCursor: null,
              }),
              {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
              },
            ),
          )
        }

        return Promise.resolve(
          new Response(
            JSON.stringify({
              items: team1Page1,
              nextCursor: 'team1_cursor_p2',
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

    renderWithProviders(<Approvals />)

    // Initial load: Team 1 Page 1
    await screen.findByTestId('approve-101')
    expect(screen.getByTestId('approve-102')).toBeInTheDocument()

    // Paginate to Page 2
    const loadMoreBtn = screen.getByTestId('approvals-load-more')
    fireEvent.click(loadMoreBtn)

    await screen.findByTestId('approve-103')
    expect(screen.getByTestId('approve-101')).toBeInTheDocument()
    expect(screen.getByTestId('approve-102')).toBeInTheDocument()
    expect(screen.getByTestId('approve-103')).toBeInTheDocument()

    // Change team filter to Team 2
    const teamFilter = screen.getByLabelText(/Filter by team/i)
    fireEvent.change(teamFilter, { target: { value: '2' } })

    // Verify request for team 2 does NOT include the old cursor
    await waitFor(() => {
      const callsForTeam2 = fetchMock.mock.calls.filter((c) => {
        const url = typeof c[0] === 'string' ? c[0] : c[0].toString()
        return url.includes('team=2')
      })
      expect(callsForTeam2.length).toBeGreaterThan(0)
      for (const call of callsForTeam2) {
        const url = typeof call[0] === 'string' ? call[0] : call[0].toString()
        expect(url).not.toContain('cursor=')
      }
    })

    // Old team rows cleared and new team rows loaded
    await waitFor(() => {
      expect(screen.getByTestId('approve-201')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('approve-101')).not.toBeInTheDocument()
    expect(screen.queryByTestId('approve-102')).not.toBeInTheDocument()
    expect(screen.queryByTestId('approve-103')).not.toBeInTheDocument()
    expect(screen.getByTestId('approvals-count-badge')).toHaveTextContent('1 item pending')
  })

  // ---------------------------------------------------------------------------
  // Case 10: 409 conflict reset during active pagination
  // ---------------------------------------------------------------------------
  it('recovers from 409 conflict during active pagination by resetting cursor, clearing accumulated rows, and refetching first page', async () => {
    let conflictOccurred = false

    const page1Items: WorkItem[] = [
      { ...mockPendingItem, id: 301, title: 'Page 1 Item 301', version: 1 },
    ]
    const page2Items: WorkItem[] = [
      { ...mockPendingItem, id: 302, title: 'Page 2 Item 302', version: 1 },
    ]
    const freshPage1Items: WorkItem[] = [
      { ...mockPendingItem, id: 301, title: 'Page 1 Item 301', version: 2 },
    ]

    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()

      if (url.includes('/teams')) {
        return Promise.resolve(
          new Response(JSON.stringify({ teams: [{ id: 1, name: 'Core Team', slug: 'core' }] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }

      if (url.includes('/items/') && url.includes('/transition') && init?.method === 'POST') {
        conflictOccurred = true
        return Promise.resolve(
          new Response(
            JSON.stringify({ error: 'Conflict: item modified' }),
            { status: 409, headers: { 'Content-Type': 'application/json' } },
          ),
        )
      }

      if (url.includes('/items')) {
        if (conflictOccurred) {
          return Promise.resolve(
            new Response(
              JSON.stringify({ items: freshPage1Items, nextCursor: null }),
              { status: 200, headers: { 'Content-Type': 'application/json' } },
            ),
          )
        }

        if (url.includes('cursor=cursor_p2')) {
          return Promise.resolve(
            new Response(
              JSON.stringify({ items: page2Items, nextCursor: null }),
              { status: 200, headers: { 'Content-Type': 'application/json' } },
            ),
          )
        }

        return Promise.resolve(
          new Response(
            JSON.stringify({ items: page1Items, nextCursor: 'cursor_p2' }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        )
      }

      return Promise.resolve(new Response('not found', { status: 404 }))
    })

    renderWithProviders(<Approvals />)

    await screen.findByTestId('approve-301')

    // Paginate to page 2
    fireEvent.click(screen.getByTestId('approvals-load-more'))
    await screen.findByTestId('approve-302')

    // Approve item 302 from page 2 -> triggers 409
    fireEvent.click(screen.getByTestId('approve-302'))

    // Exact alert appears
    await screen.findByText('This item changed while you were reviewing it — the queue has been refreshed.')

    // Old cursor cleared; fresh request made for page 1 without cursor
    await waitFor(() => {
      expect(screen.queryByTestId('approve-302')).not.toBeInTheDocument()
      expect(screen.getByTestId('approve-301')).toBeInTheDocument()
    })

    const transitionIndex = fetchMock.mock.calls.findIndex((c) => {
      const url = typeof c[0] === 'string' ? c[0] : c[0].toString()
      return url.includes('/transition')
    })
    const callsAfterConflict = fetchMock.mock.calls.slice(transitionIndex + 1).filter((c) => {
      const url = typeof c[0] === 'string' ? c[0] : c[0].toString()
      return url.includes('/items')
    })
    expect(callsAfterConflict.length).toBeGreaterThan(0)
    for (const call of callsAfterConflict) {
      const url = typeof call[0] === 'string' ? call[0] : call[0].toString()
      expect(url).not.toContain('cursor=')
    }
  })
})
