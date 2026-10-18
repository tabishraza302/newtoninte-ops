import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor, within } from '@testing-library/react'
import { Routes, Route } from 'react-router-dom'
import { renderWithProviders } from '../test/test-utils'
import { AuthContext, AuthProvider, type AuthContextValue, type User } from '../auth/AuthContext'
import { AppRoutes } from '../App'
import { OutboxJobs } from './OutboxJobs'
import type { JobView, JobsSummary } from '../api/types'

function authValue(overrides?: Partial<User>): AuthContextValue {
  return {
    user: {
      id: 1,
      email: 'admin@newtonite.test',
      displayName: 'Admin',
      isAdmin: true,
      ...overrides,
    },
    status: 'authed',
    login: vi.fn().mockResolvedValue(undefined),
    logout: vi.fn().mockResolvedValue(undefined),
    setAuthUser: vi.fn(),
  }
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('OutboxJobs Page (Task 5.4)', () => {
  const fetchMock = vi.fn()

  const failedJob: JobView = {
    id: 7,
    type: 'email.assigned',
    status: 'failed',
    attempts: 3,
    maxAttempts: 3,
    lastError: 'SMTP connect ECONNREFUSED',
    dedupeKey: 'item:1:assigned:2',
    availableAt: '2026-10-18T09:00:00.000Z',
    lockedAt: null,
    lockedBy: null,
    createdAt: '2026-10-18T08:59:00.000Z',
    updatedAt: '2026-10-18T09:00:05.000Z',
  }

  const pendingJob: JobView = {
    id: 8,
    type: 'email.invite',
    status: 'pending',
    attempts: 0,
    maxAttempts: 5,
    lastError: null,
    dedupeKey: 'invite:42',
    availableAt: '2026-10-18T10:00:00.000Z',
    lockedAt: null,
    lockedBy: null,
    createdAt: '2026-10-18T09:59:00.000Z',
    updatedAt: '2026-10-18T09:59:00.000Z',
  }

  const summary: JobsSummary = {
    byStatus: { pending: 2, processing: 1, done: 9, failed: 3 },
    oldestPendingAgeSec: 480,
  }

  const adminListCalls = (): string[] =>
    fetchMock.mock.calls
      .map((call) => String(call[0]))
      .filter((url) => url.startsWith('/admin/jobs'))

  function mockAdminApi(jobs: JobView[] = [failedJob, pendingJob], nextCursor: string | null = null) {
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : String(input)
      if (url.startsWith('/admin/jobs/summary')) {
        return Promise.resolve(jsonResponse(summary))
      }
      if (/^\/admin\/jobs\/\d+\/retry/.test(url)) {
        return Promise.resolve(new Response(null, { status: 204 }))
      }
      if (url === '/admin/jobs' || url.startsWith('/admin/jobs?')) {
        return Promise.resolve(jsonResponse({ jobs, nextCursor }))
      }
      return Promise.resolve(new Response(JSON.stringify({ error: 'not found' }), { status: 404 }))
    })
  }

  async function renderJobs(overrides?: Partial<User>, status: AuthContextValue['status'] = 'authed') {
    return renderWithProviders(
      <AuthContext.Provider value={{ ...authValue(overrides), status }}>
        <Routes>
          <Route path="/admin/jobs" element={<OutboxJobs />} />
          <Route path="/login" element={<div>Login page</div>} />
        </Routes>
      </AuthContext.Provider>,
      { route: '/admin/jobs' },
    )
  }

  beforeEach(() => {
    vi.restoreAllMocks()
    fetchMock.mockReset()
    globalThis.fetch = fetchMock
  })

  it('shows a not-authorised state to a non-admin member and never calls the admin endpoints', async () => {
    mockAdminApi()

    const { queryClient } = await renderJobs({ isAdmin: false, email: 'member@newtonite.test' })

    expect(screen.getByText(/not authorised/i)).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /Outbox Jobs/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(adminListCalls()).toEqual([])
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0)
  })

  it('shows a not-authorised state to a non-admin viewer', async () => {
    mockAdminApi()

    await renderJobs({ isAdmin: false, email: 'viewer@newtonite.test' })

    expect(screen.getByText(/not authorised/i)).toBeInTheDocument()
    expect(adminListCalls()).toEqual([])
  })

  it('redirects an anonymous visitor to the login page without fetching', async () => {
    mockAdminApi()

    await renderJobs(undefined, 'anon')

    expect(screen.getByText('Login page')).toBeInTheDocument()
    expect(adminListCalls()).toEqual([])
  })

  it('renders a table with type, status, attempts and lastError columns for an admin', async () => {
    mockAdminApi()

    await renderJobs()

    expect(screen.getByRole('heading', { name: /Outbox Jobs/i })).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByText('email.assigned')).toBeInTheDocument()
    })

    const headers = screen.getAllByRole('columnheader').map((th) => th.textContent)
    expect(headers).toEqual(['ID', 'Type', 'Status', 'Attempts', 'Last error', 'Actions'])

    const failedRow = screen.getByRole('row', { name: /email\.assigned/i })
    expect(failedRow).toHaveTextContent('failed')
    expect(failedRow).toHaveTextContent('3/3')
    expect(failedRow).toHaveTextContent('SMTP connect ECONNREFUSED')

    const pendingRow = screen.getByRole('row', { name: /email\.invite/i })
    expect(pendingRow).toHaveTextContent('pending')
    expect(pendingRow).toHaveTextContent('0/5')
  })

  it('shows the summary counts, calling out failed and the oldest pending age', async () => {
    mockAdminApi()

    await renderJobs()

    await waitFor(() => {
      expect(screen.getByTestId('summary-failed')).toHaveTextContent('3')
    })
    expect(screen.getByTestId('summary-pending')).toHaveTextContent('2')
    expect(screen.getByTestId('summary-processing')).toHaveTextContent('1')
    expect(screen.getByTestId('summary-done')).toHaveTextContent('9')
    expect(screen.getByTestId('summary-oldest-pending')).toHaveTextContent('480')
    expect(fetchMock).toHaveBeenCalledWith('/admin/jobs/summary', expect.anything())
  })

  it('changing the status filter re-queries with status in the query string', async () => {
    mockAdminApi()

    await renderJobs()

    await waitFor(() => {
      expect(adminListCalls()).toContain('/admin/jobs')
    })

    fireEvent.change(screen.getByRole('combobox', { name: /Status/i }), {
      target: { value: 'failed' },
    })

    await waitFor(() => {
      expect(adminListCalls()).toContain('/admin/jobs?status=failed')
    })
  })

  it('changing the type filter re-queries with status and type in the query string', async () => {
    mockAdminApi()

    await renderJobs()

    await waitFor(() => {
      expect(adminListCalls()).toContain('/admin/jobs')
    })

    fireEvent.change(screen.getByRole('combobox', { name: /Status/i }), {
      target: { value: 'failed' },
    })
    await waitFor(() => {
      expect(adminListCalls()).toContain('/admin/jobs?status=failed')
    })

    fireEvent.change(screen.getByRole('combobox', { name: /Type/i }), {
      target: { value: 'email.assigned' },
    })

    await waitFor(() => {
      expect(adminListCalls()).toContain('/admin/jobs?status=failed&type=email.assigned')
    })
  })

  it('retries a failed job with POST /admin/jobs/:id/retry and refetches the list and summary', async () => {
    mockAdminApi()

    await renderJobs()

    await waitFor(() => {
      expect(screen.getByText('email.assigned')).toBeInTheDocument()
    })
    const callsBefore = fetchMock.mock.calls.map((call) => String(call[0]))
    const listCallsBefore = callsBefore.filter(
      (url) => url === '/admin/jobs' || url.startsWith('/admin/jobs?'),
    ).length
    const summaryCallsBefore = callsBefore.filter((url) => url === '/admin/jobs/summary').length

    fireEvent.click(
      within(screen.getByRole('row', { name: /email\.assigned/i })).getByRole('button', { name: /Retry/i }),
    )

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/admin/jobs/7/retry',
        expect.objectContaining({ method: 'POST' }),
      )
    })

    await waitFor(() => {
      const callsAfter = fetchMock.mock.calls.map((call) => String(call[0]))
      expect(
        callsAfter.filter((url) => url === '/admin/jobs' || url.startsWith('/admin/jobs?')).length,
      ).toBeGreaterThan(listCallsBefore)
      expect(callsAfter.filter((url) => url === '/admin/jobs/summary').length).toBeGreaterThan(
        summaryCallsBefore,
      )
    })
  })

  it('only enables Retry for failed rows', async () => {
    mockAdminApi()

    await renderJobs()

    await waitFor(() => {
      expect(screen.getByText('email.assigned')).toBeInTheDocument()
    })

    const failedRow = screen.getByRole('row', { name: /email\.assigned/i })
    const pendingRow = screen.getByRole('row', { name: /email\.invite/i })

    expect(within(failedRow).getByRole('button', { name: /Retry/i })).toBeEnabled()
    expect(within(pendingRow).getByRole('button', { name: /Retry/i })).toBeDisabled()
  })

  it('follows nextCursor on Load more and appends results without replacing', async () => {
    const secondJob: JobView = { ...pendingJob, id: 9, type: 'email.reset', dedupeKey: 'invite:43' }
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : String(input)
      if (url.startsWith('/admin/jobs/summary')) {
        return Promise.resolve(jsonResponse(summary))
      }
      if (url.startsWith('/admin/jobs?') && url.includes('cursor=c1')) {
        return Promise.resolve(jsonResponse({ jobs: [secondJob], nextCursor: null }))
      }
      if (url === '/admin/jobs' || url.startsWith('/admin/jobs?')) {
        return Promise.resolve(jsonResponse({ jobs: [failedJob], nextCursor: 'c1' }))
      }
      return Promise.resolve(new Response(JSON.stringify({ error: 'not found' }), { status: 404 }))
    })

    await renderJobs()

    await waitFor(() => {
      expect(screen.getByText('email.assigned')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /Load more/i }))

    await waitFor(() => {
      expect(adminListCalls()).toContain('/admin/jobs?cursor=c1')
    })

    await waitFor(() => {
      expect(screen.getByText('email.reset')).toBeInTheDocument()
    })

    expect(screen.getByRole('row', { name: /email\.assigned/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Load more/i })).not.toBeInTheDocument()
  })

  it('reconciles the retried row from a fresh first page when a cursor page is loaded', async () => {
    const secondJob: JobView = { ...pendingJob, id: 9, type: 'email.reset', dedupeKey: 'invite:43' }
    let firstPageJobs: JobView[] = [failedJob]
    let retried = false

    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : String(input)
      if (url.startsWith('/admin/jobs/summary')) {
        return Promise.resolve(jsonResponse(summary))
      }
      if (/^\/admin\/jobs\/7\/retry/.test(url)) {
        retried = true
        // The server re-queued row 7, so a fresh page 1 no longer reports it as failed.
        firstPageJobs = [{ ...failedJob, status: 'pending', lastError: null }]
        return Promise.resolve(new Response(null, { status: 204 }))
      }
      if (url.startsWith('/admin/jobs?') && url.includes('cursor=c1')) {
        return Promise.resolve(jsonResponse({ jobs: [secondJob], nextCursor: null }))
      }
      if (url === '/admin/jobs' || url.startsWith('/admin/jobs?')) {
        return Promise.resolve(jsonResponse({ jobs: firstPageJobs, nextCursor: 'c1' }))
      }
      return Promise.resolve(new Response(JSON.stringify({ error: 'not found' }), { status: 404 }))
    })

    await renderJobs()

    await waitFor(() => {
      expect(screen.getByText('email.assigned')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /Load more/i }))

    await waitFor(() => {
      expect(adminListCalls()).toContain('/admin/jobs?cursor=c1')
    })

    await waitFor(() => {
      expect(screen.getByText('email.reset')).toBeInTheDocument()
    })

    // A cursor page is loaded, so the table is the merge of page 1 and page 2 and
    // row 7 still renders as failed with an enabled Retry.
    const failedRow = screen.getByRole('row', { name: /email\.assigned/i })
    expect(failedRow).toHaveTextContent('failed')
    expect(within(failedRow).getByRole('button', { name: /Retry/i })).toBeEnabled()

    const firstPageCallsBefore = adminListCalls().filter((url) => url === '/admin/jobs').length

    fireEvent.click(within(failedRow).getByRole('button', { name: /Retry/i }))

    await waitFor(() => {
      expect(retried).toBe(true)
    })

    // The retry succeeded, so the operator must not be left looking at the stale
    // `failed` row: the list has to reconcile from a *fresh page-1 fetch* (never a
    // row invented client-side, since a 204 carries no row and the worker may claim
    // it immediately), which shows row 7 as pending with Retry disabled.
    await waitFor(() => {
      const row = screen.getByRole('row', { name: /email\.assigned/i })
      expect(row).toHaveTextContent('pending')
      expect(within(row).getByRole('button', { name: /Retry/i })).toBeDisabled()
      expect(
        adminListCalls().filter((url) => url === '/admin/jobs').length,
      ).toBeGreaterThan(firstPageCallsBefore)
    })
  })

  it('serves /admin/jobs through AppRoutes to an admin user', async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : String(input)
      if (url.includes('/auth/refresh')) {
        return Promise.resolve(
          jsonResponse({ accessToken: 'tok', user: authValue().user }),
        )
      }
      if (url.includes('/auth/me')) {
        return Promise.resolve(
          jsonResponse({ user: authValue().user, memberships: [] }),
        )
      }
      if (url.startsWith('/admin/jobs/summary')) {
        return Promise.resolve(jsonResponse(summary))
      }
      if (url === '/admin/jobs' || url.startsWith('/admin/jobs?')) {
        return Promise.resolve(jsonResponse({ jobs: [failedJob], nextCursor: null }))
      }
      return Promise.resolve(new Response(JSON.stringify({ error: 'not found' }), { status: 404 }))
    })

    renderWithProviders(
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>,
      { route: '/admin/jobs' },
    )

    await waitFor(() => {
      expect(screen.getByText('SMTP connect ECONNREFUSED')).toBeInTheDocument()
    })
  })

  it('shows the Outbox Jobs nav link only to admins', async () => {
    const refreshUser = (isAdmin: boolean) => {
      fetchMock.mockImplementation((input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : String(input)
        if (url.includes('/auth/refresh')) {
          return Promise.resolve(
            jsonResponse({ accessToken: 'tok', user: { ...authValue().user, isAdmin } }),
          )
        }
        if (url.includes('/auth/me')) {
          return Promise.resolve(
            jsonResponse({ user: { ...authValue().user, isAdmin }, memberships: [] }),
          )
        }
        return Promise.resolve(new Response(JSON.stringify({ error: 'not found' }), { status: 404 }))
      })
    }

    refreshUser(true)
    const adminRender = renderWithProviders(
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>,
      { route: '/' },
    )
    await waitFor(() => {
      expect(screen.getByText(/Newtonite Operations/)).toBeInTheDocument()
    })
    expect(screen.getByRole('link', { name: /Outbox Jobs/i })).toBeInTheDocument()
    adminRender.unmount()

    refreshUser(false)
    renderWithProviders(
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>,
      { route: '/' },
    )
    await waitFor(() => {
      expect(screen.getByText(/Newtonite Operations/)).toBeInTheDocument()
    })
    expect(screen.queryByRole('link', { name: /Outbox Jobs/i })).not.toBeInTheDocument()
  })

  it('clicking Inspect displays job details modal/drawer with deduplication key and error details', async () => {
    mockAdminApi([failedJob])
    await renderJobs()

    await waitFor(() => {
      expect(screen.getByRole('row', { name: /email\.assigned/i })).toBeInTheDocument()
    })

    const inspectBtn = screen.getByLabelText('Inspect job #7')
    fireEvent.click(inspectBtn)
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toBeInTheDocument()

    const withinDialog = within(dialog)
    expect(withinDialog.getByRole('heading', { name: /Job Details #7/i })).toBeInTheDocument()
    expect(withinDialog.getByText('item:1:assigned:2')).toBeInTheDocument()
    expect(withinDialog.getByText('SMTP connect ECONNREFUSED')).toBeInTheDocument()
    expect(withinDialog.getByText(/3 of 3/i)).toBeInTheDocument()
    const closeBtn = screen.getByLabelText('Close inspector')
    fireEvent.click(closeBtn)

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })
})
