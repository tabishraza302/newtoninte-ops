import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { renderWithProviders } from '../test/test-utils'
import { ItemForm } from './ItemForm'
import type { WorkItem } from '../api/types'

describe('ItemForm Component (Task 4.12)', () => {
  const fetchMock = vi.fn()

  const mockItem: WorkItem = {
    id: 101,
    teamId: 1,
    title: 'Original Title',
    description: 'Original Description',
    type: 'task',
    priority: 'medium',
    status: 'open',
    assigneeId: null,
    createdBy: 1,
    dueAt: '2026-11-01T00:00:00.000Z',
    version: 4,
    createdAt: '2026-10-18T00:00:00.000Z',
    updatedAt: '2026-10-18T00:00:00.000Z',
  }

  beforeEach(() => {
    vi.restoreAllMocks()
    fetchMock.mockReset()
    globalThis.fetch = fetchMock
  })

  it('create sends POST /items with stable Idempotency-Key header across retries', async () => {
    let callCount = 0
    const capturedHeaders: Headers[] = []
    const capturedBodies: unknown[] = []

    fetchMock.mockImplementation((_url: string, init?: RequestInit) => {
      callCount++
      const headers = new Headers(init?.headers)
      capturedHeaders.push(headers)
      if (init?.body) {
        capturedBodies.push(JSON.parse(String(init.body)))
      }

      // First attempt fails with 500
      if (callCount === 1) {
        return Promise.resolve(
          new Response(JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'DB temporary glitch' } }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }

      // Second attempt succeeds with 201
      return Promise.resolve(
        new Response(
          JSON.stringify({
            item: {
              ...mockItem,
              id: 202,
              title: 'New Service Deployment',
              version: 1,
            },
          }),
          {
            status: 201,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      )
    })

    const onSuccess = vi.fn()

    const { rerender } = renderWithProviders(
      <ItemForm userRole="lead" teamId={1} onSuccess={onSuccess} />,
    )

    // Fill in form fields
    fireEvent.change(screen.getByLabelText(/title/i), { target: { value: 'New Service Deployment' } })
    fireEvent.change(screen.getByLabelText(/description/i), { target: { value: 'Deploy new auth cluster' } })
    fireEvent.change(screen.getByLabelText(/type/i), { target: { value: 'incident' } })
    fireEvent.change(screen.getByLabelText(/priority/i), { target: { value: 'urgent' } })
    fireEvent.change(screen.getByLabelText(/due date/i), { target: { value: '2026-11-15' } })

    // First submission
    fireEvent.click(screen.getByRole('button', { name: /create item/i }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/glitch/i)
    })

    expect(callCount).toBe(1)
    const firstKey = capturedHeaders[0]?.get('Idempotency-Key')
    expect(firstKey).toBeTruthy()

    // Trigger re-render to ensure key stability across re-renders
    rerender(<ItemForm userRole="lead" teamId={1} onSuccess={onSuccess} />)

    // Retry submission of the same attempt
    fireEvent.click(screen.getByRole('button', { name: /create item/i }))

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledTimes(1)
    })

    expect(callCount).toBe(2)
    const secondKey = capturedHeaders[1]?.get('Idempotency-Key')
    expect(secondKey).toBe(firstKey)

    // Verify payload
    const body = capturedBodies[1] as Record<string, unknown>
    expect(body.title).toBe('New Service Deployment')
    expect(body.description).toBe('Deploy new auth cluster')
    expect(body.type).toBe('incident')
    expect(body.priority).toBe('urgent')
  })

  it('member role does not see priority control and priority is absent from payload', async () => {
    const capturedBodies: Array<Record<string, unknown>> = []

    fetchMock.mockImplementation((_url: string, init?: RequestInit) => {
      if (init?.body) {
        capturedBodies.push(JSON.parse(String(init.body)) as Record<string, unknown>)
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            item: { ...mockItem, id: 303, title: 'Member Created Item' },
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } },
        ),
      )
    })

    const onSuccess = vi.fn()

    renderWithProviders(
      <ItemForm userRole="member" teamId={1} onSuccess={onSuccess} />,
    )

    // Member should NOT see the priority field
    expect(screen.queryByLabelText(/priority/i)).toBeNull()

    // Fill title
    fireEvent.change(screen.getByLabelText(/title/i), { target: { value: 'Member Created Item' } })
    fireEvent.click(screen.getByRole('button', { name: /create item/i }))

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalled()
    })

    expect(capturedBodies.length).toBe(1)
    const recordedBody = capturedBodies[0]
    expect(recordedBody).toBeDefined()
    expect(recordedBody).not.toHaveProperty('priority')
    expect(recordedBody?.title).toBe('Member Created Item')
  })

  it('edit sends only changed fields plus version', async () => {
    let patchUrl = ''
    const patchBodies: Array<Record<string, unknown>> = []

    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      patchUrl = url
      if (init?.body) {
        patchBodies.push(JSON.parse(String(init.body)) as Record<string, unknown>)
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            item: { ...mockItem, title: 'Updated Only Title', version: 5 },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )
    })

    const onSuccess = vi.fn()

    renderWithProviders(
      <ItemForm item={mockItem} userRole="lead" onSuccess={onSuccess} />,
    )

    // Only update title
    const titleInput = screen.getByLabelText(/title/i)
    expect(titleInput).toHaveValue('Original Title')
    fireEvent.change(titleInput, { target: { value: 'Updated Only Title' } })

    // Save changes
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalled()
    })

    expect(patchUrl).toContain(`/items/${mockItem.id}`)
    expect(patchBodies.length).toBe(1)
    const recordedPatch = patchBodies[0]
    expect(recordedPatch).toEqual({
      version: 4,
      title: 'Updated Only Title',
    })
    // Unchanged fields are absent
    expect(recordedPatch).not.toHaveProperty('description')
    expect(recordedPatch).not.toHaveProperty('type')
    expect(recordedPatch).not.toHaveProperty('priority')
    expect(recordedPatch).not.toHaveProperty('dueAt')
  })

  it('shows changed — reload affordance on VERSION_CONFLICT (409)', async () => {
    fetchMock.mockImplementation(() => {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            error: {
              code: 'VERSION_CONFLICT',
              message: 'Item has been modified by another user',
              details: { currentVersion: 5 },
            },
          }),
          { status: 409, headers: { 'Content-Type': 'application/json' } },
        ),
      )
    })

    const onReload = vi.fn()

    renderWithProviders(
      <ItemForm item={mockItem} userRole="lead" onReload={onReload} />,
    )

    // Change title
    fireEvent.change(screen.getByLabelText(/title/i), { target: { value: 'Conflicting Change' } })
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() => {
      expect(screen.getByTestId('version-conflict')).toBeInTheDocument()
    })

    expect(screen.getByText(/changed — reload/i)).toBeInTheDocument()

    // Click reload button
    fireEvent.click(screen.getByTestId('reload-button'))
    expect(onReload).toHaveBeenCalledTimes(1)
  })
})
