import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor, within } from '@testing-library/react'
import { Routes, Route, useSearchParams } from 'react-router-dom'
import { renderWithProviders } from '../test/test-utils'
import { AuthContext, type AuthContextValue, type User } from '../auth/AuthContext'
import { AdminAuditLog } from './AdminAuditLog'
import type {
  AdminAuditEvent,
  ListAdminAuditResponse,
} from '../api/types'

function authValue(overrides?: Partial<User>): AuthContextValue {
  const baseUser: User = {
    id: 1,
    email: 'admin@company.test',
    displayName: 'Admin User',
    isAdmin: true,
    status: 'active',
    createdAt: '2026-10-18T00:00:00.000Z',
    updatedAt: '2026-10-18T00:00:00.000Z',
    ...overrides,
  }
  return {
    user: baseUser,
    status: 'authed',
    login: vi.fn().mockResolvedValue(undefined),
    logout: vi.fn().mockResolvedValue(undefined),
    setAuthUser: vi.fn(),
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('AdminAuditLog Page', () => {
  const fetchMock = vi.fn()

  const sampleActor = {
    id: 1,
    email: 'admin@company.test',
    displayName: 'System Admin',
  }

  const userCreatedEvent: AdminAuditEvent = {
    id: 1,
    actor: sampleActor,
    action: 'user_created',
    targetType: 'user',
    targetId: 10,
    metadata: {
      email: 'alice@company.test',
      displayName: 'Alice Engineer',
    },
    createdAt: '2026-10-18T10:00:00.000Z',
  }

  const userStatusChangedEvent: AdminAuditEvent = {
    id: 2,
    actor: sampleActor,
    action: 'user_status_changed',
    targetType: 'user',
    targetId: 10,
    metadata: {
      email: 'alice@company.test',
      displayName: 'Alice Engineer',
      fromStatus: 'active',
      toStatus: 'disabled',
    },
    createdAt: '2026-10-18T10:05:00.000Z',
  }

  const teamCreatedEvent: AdminAuditEvent = {
    id: 3,
    actor: sampleActor,
    action: 'team_created',
    targetType: 'team',
    targetId: 5,
    metadata: {
      name: 'Platform Engineering',
      slug: 'platform-eng',
    },
    createdAt: '2026-10-18T10:10:00.000Z',
  }

  const membershipAddedEvent: AdminAuditEvent = {
    id: 4,
    actor: sampleActor,
    action: 'membership_added',
    targetType: 'membership',
    targetId: 101,
    metadata: {
      teamId: 5,
      teamName: 'Platform Engineering',
      userId: 10,
      email: 'alice@company.test',
      displayName: 'Alice Engineer',
      fromRole: null,
      toRole: 'lead',
    },
    createdAt: '2026-10-18T10:15:00.000Z',
  }

  const membershipRoleChangedEvent: AdminAuditEvent = {
    id: 5,
    actor: sampleActor,
    action: 'membership_role_changed',
    targetType: 'membership',
    targetId: 101,
    metadata: {
      teamId: 5,
      teamName: 'Platform Engineering',
      userId: 10,
      email: 'alice@company.test',
      displayName: 'Alice Engineer',
      fromRole: 'member',
      toRole: 'lead',
    },
    createdAt: '2026-10-18T10:20:00.000Z',
  }

  const membershipRemovedEvent: AdminAuditEvent = {
    id: 6,
    actor: sampleActor,
    action: 'membership_removed',
    targetType: 'membership',
    targetId: 101,
    metadata: {
      teamId: 5,
      teamName: 'Platform Engineering',
      userId: 10,
      email: 'alice@company.test',
      displayName: 'Alice Engineer',
      fromRole: 'lead',
    },
    createdAt: '2026-10-18T10:25:00.000Z',
  }

  const jobRetriedEvent: AdminAuditEvent = {
    id: 7,
    actor: sampleActor,
    action: 'job_retried',
    targetType: 'job',
    targetId: 42,
    metadata: {
      type: 'email.invite',
      previousAttempts: 3,
      previousLastError: 'SMTP connection ECONNREFUSED',
    },
    createdAt: '2026-10-18T10:30:00.000Z',
  }

  const allRepresentativeEvents: AdminAuditEvent[] = [
    userCreatedEvent,
    userStatusChangedEvent,
    teamCreatedEvent,
    membershipAddedEvent,
    membershipRoleChangedEvent,
    membershipRemovedEvent,
    jobRetriedEvent,
  ]

  const auditCalls = (): string[] =>
    fetchMock.mock.calls
      .map((call) => String(call[0]))
      .filter((url) => url.startsWith('/admin/audit-log'))

  function mockAuditApi(
    events: AdminAuditEvent[] = allRepresentativeEvents,
    nextCursor: string | null = null,
  ) {
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : String(input)
      if (url === '/admin/audit-log' || url.startsWith('/admin/audit-log?')) {
        const responseData: ListAdminAuditResponse = {
          events,
          nextCursor,
        }
        return Promise.resolve(jsonResponse(responseData))
      }
      return Promise.resolve(new Response(JSON.stringify({ error: 'not found' }), { status: 404 }))
    })
  }

  async function renderAdminAuditLog(
    overrides?: Partial<User>,
    status: AuthContextValue['status'] = 'authed',
    route = '/admin/audit-log',
  ) {
    return renderWithProviders(
      <AuthContext.Provider value={{ ...authValue(overrides), status }}>
        <Routes>
          <Route path="/admin/audit-log" element={<AdminAuditLog />} />
          <Route path="/login" element={<div>Login Screen</div>} />
        </Routes>
      </AuthContext.Provider>,
      { route },
    )
  }

  beforeEach(() => {
    vi.restoreAllMocks()
    fetchMock.mockReset()
    globalThis.fetch = fetchMock
  })

  describe('Access Gates & Authorization', () => {
    it('redirects an anonymous visitor to the login page without fetching', async () => {
      mockAuditApi()

      const { queryClient } = await renderAdminAuditLog(undefined, 'anon')

      expect(screen.getByText('Login Screen')).toBeInTheDocument()
      expect(auditCalls()).toEqual([])
      expect(queryClient.getQueryCache().getAll()).toHaveLength(0)
    })

    it('shows access denied to a non-admin and never calls the audit API', async () => {
      mockAuditApi()

      const { queryClient } = await renderAdminAuditLog({ isAdmin: false, email: 'member@company.test' })

      expect(screen.getByText(/Not authorised - audit log is admin only/i)).toBeInTheDocument()
      expect(screen.getByText('Access Denied')).toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: /^Audit Log$/i })).not.toBeInTheDocument()
      expect(screen.queryByRole('table')).not.toBeInTheDocument()
      expect(auditCalls()).toEqual([])
      expect(queryClient.getQueryCache().getAll()).toHaveLength(0)
    })

    it('shows checking authorization when auth is loading and makes no fetch', async () => {
      mockAuditApi()

      const { queryClient } = await renderAdminAuditLog(undefined, 'loading')

      expect(screen.getByText(/Checking authorization…/i)).toBeInTheDocument()
      expect(auditCalls()).toEqual([])
      expect(queryClient.getQueryCache().getAll()).toHaveLength(0)
    })
  })

  describe('Observable Action Formatting in Table', () => {
    it('renders all representative audit actions, actors, targets, badges, and details', async () => {
      mockAuditApi(allRepresentativeEvents)

      await renderAdminAuditLog()

      const table = await screen.findByTestId('admin-audit-table')
      const tableScope = within(table)

      // Header row
      expect(screen.getByRole('heading', { name: /^Audit Log$/i })).toBeInTheDocument()
      expect(screen.getByText(/Immutable record of administrative actions/i)).toBeInTheDocument()

      // Table columns
      expect(tableScope.getByRole('columnheader', { name: /Timestamp/i })).toBeInTheDocument()
      expect(tableScope.getByRole('columnheader', { name: /Actor/i })).toBeInTheDocument()
      expect(tableScope.getByRole('columnheader', { name: /Action/i })).toBeInTheDocument()
      expect(tableScope.getByRole('columnheader', { name: /Target/i })).toBeInTheDocument()
      expect(tableScope.getByRole('columnheader', { name: /Details/i })).toBeInTheDocument()

      // Actor display (System Admin / admin@company.test)
      const actorNames = tableScope.getAllByText('System Admin')
      expect(actorNames.length).toBeGreaterThan(0)
      const actorEmails = tableScope.getAllByText('admin@company.test')
      expect(actorEmails.length).toBeGreaterThan(0)

      const getRowByAction = (actionText: string): HTMLElement => {
        const badge = tableScope.getByText(actionText)
        const tr = badge.closest('tr')
        if (!tr) throw new Error(`Row for action ${actionText} not found`)
        return tr
      }

      // 1. user_created
      const userCreatedRow = within(getRowByAction('User Created'))
      expect(userCreatedRow.getByText('User Created')).toBeInTheDocument()
      expect(userCreatedRow.getByText('user')).toBeInTheDocument()
      expect(userCreatedRow.getByText('#10')).toBeInTheDocument()
      expect(userCreatedRow.getByText('Alice Engineer (alice@company.test)')).toBeInTheDocument()

      // 2. user_status_changed (from → to)
      const userStatusRow = within(getRowByAction('User Status Changed'))
      expect(userStatusRow.getByText('User Status Changed')).toBeInTheDocument()
      expect(userStatusRow.getByText('user')).toBeInTheDocument()
      expect(userStatusRow.getByText('#10')).toBeInTheDocument()
      expect(
        userStatusRow.getByText('Alice Engineer (alice@company.test): active → disabled'),
      ).toBeInTheDocument()

      // 3. team_created
      const teamCreatedRow = within(getRowByAction('Team Created'))
      expect(teamCreatedRow.getByText('Team Created')).toBeInTheDocument()
      expect(teamCreatedRow.getByText('team')).toBeInTheDocument()
      expect(teamCreatedRow.getByText('#5')).toBeInTheDocument()
      expect(teamCreatedRow.getByText('Platform Engineering (platform-eng)')).toBeInTheDocument()

      // 4. membership_added
      const memberAddedRow = within(getRowByAction('Membership Added'))
      expect(memberAddedRow.getByText('Membership Added')).toBeInTheDocument()
      expect(memberAddedRow.getByText('membership')).toBeInTheDocument()
      expect(memberAddedRow.getByText('#101')).toBeInTheDocument()
      expect(
        memberAddedRow.getByText('Alice Engineer (alice@company.test) added to Platform Engineering (lead)'),
      ).toBeInTheDocument()

      // 5. membership_role_changed (fromRole → toRole)
      const roleChangedRow = within(getRowByAction('Role Changed'))
      expect(roleChangedRow.getByText('Role Changed')).toBeInTheDocument()
      expect(roleChangedRow.getByText('membership')).toBeInTheDocument()
      expect(roleChangedRow.getByText('#101')).toBeInTheDocument()
      expect(
        roleChangedRow.getByText('Alice Engineer (alice@company.test) in Platform Engineering: member → lead'),
      ).toBeInTheDocument()

      // 6. membership_removed
      const memberRemovedRow = within(getRowByAction('Membership Removed'))
      expect(memberRemovedRow.getByText('Membership Removed')).toBeInTheDocument()
      expect(memberRemovedRow.getByText('membership')).toBeInTheDocument()
      expect(memberRemovedRow.getByText('#101')).toBeInTheDocument()
      expect(
        memberRemovedRow.getByText(
          'Alice Engineer (alice@company.test) removed from Platform Engineering (was lead)',
        ),
      ).toBeInTheDocument()

      // 7. job_retried
      const jobRetriedRow = within(getRowByAction('Job Retried'))
      expect(jobRetriedRow.getByText('Job Retried')).toBeInTheDocument()
      expect(jobRetriedRow.getByText('job')).toBeInTheDocument()
      expect(jobRetriedRow.getByText('#42')).toBeInTheDocument()
      expect(
        jobRetriedRow.getByText('email.invite (attempts: 3, error: SMTP connection ECONNREFUSED)'),
      ).toBeInTheDocument()
    })
    it('renders boundary transition metadata and minimal records without failure', async () => {
      const boundaryEvents: AdminAuditEvent[] = [
        {
          id: 20,
          actor: sampleActor,
          action: 'user_status_changed',
          targetType: 'user',
          targetId: 99,
          metadata: {
            fromStatus: 'disabled',
            toStatus: 'active',
          },
          createdAt: '2026-10-18T11:00:00.000Z',
        },
        {
          id: 21,
          actor: sampleActor,
          action: 'membership_added',
          targetType: 'membership',
          targetId: 102,
          metadata: {
            teamName: 'Security Team',
            email: 'bob@company.test',
            fromRole: 'viewer',
            toRole: 'lead',
          },
          createdAt: '2026-10-18T11:05:00.000Z',
        },
        {
          id: 22,
          actor: sampleActor,
          action: 'job_retried',
          targetType: 'job',
          targetId: 43,
          metadata: {
            type: 'email.reset',
            previousAttempts: 0,
          },
          createdAt: '2026-10-18T11:10:00.000Z',
        },
        {
          id: 23,
          actor: sampleActor,
          action: 'team_created',
          targetType: 'team',
          targetId: 6,
          metadata: {},
          createdAt: '2026-10-18T11:15:00.000Z',
        },
      ]

      mockAuditApi(boundaryEvents)

      await renderAdminAuditLog()

      const table = await screen.findByTestId('admin-audit-table')
      const tableScope = within(table)

      const getBoundaryRow = (actionText: string): HTMLElement => {
        const badge = tableScope.getByText(actionText)
        const tr = badge.closest('tr')
        if (!tr) throw new Error(`Row for action ${actionText} not found`)
        return tr
      }

      // Boundary user status: no name/email, only status transition
      const statusRow = within(getBoundaryRow('User Status Changed'))
      expect(statusRow.getByText('disabled → active')).toBeInTheDocument()
      expect(statusRow.getByText('#99')).toBeInTheDocument()

      // Boundary membership add: with fromRole transition (viewer → lead)
      const memberAddRow = within(getBoundaryRow('Membership Added'))
      expect(
        memberAddRow.getByText('bob@company.test added to Security Team (viewer → lead)'),
      ).toBeInTheDocument()
      expect(memberAddRow.getByText('#102')).toBeInTheDocument()

      // Boundary job retry: 0 attempts, no error
      const jobRow = within(getBoundaryRow('Job Retried'))
      expect(jobRow.getByText('email.reset (attempts: 0)')).toBeInTheDocument()
      expect(jobRow.getByText('#43')).toBeInTheDocument()

      // Target identifiers in table
      const teamRow = within(getBoundaryRow('Team Created'))
      expect(teamRow.getByText('#6')).toBeInTheDocument()
    })
  })

  describe('Empty and Error States', () => {
    it('displays empty state when no events have occurred yet', async () => {
      mockAuditApi([], null)

      await renderAdminAuditLog()

      await waitFor(() => {
        expect(screen.getByTestId('empty-audit-state')).toBeInTheDocument()
      })

      expect(screen.getByText('No audit events found')).toBeInTheDocument()
      expect(
        screen.getByText('No administrative actions have been recorded yet.'),
      ).toBeInTheDocument()
      expect(screen.queryByTestId('admin-audit-table')).not.toBeInTheDocument()
    })

    it('displays filtered empty state advice when filters match nothing', async () => {
      mockAuditApi([], null)

      await renderAdminAuditLog(
        undefined,
        'authed',
        '/admin/audit-log?action=job_retried&q=nonexistent',
      )

      await waitFor(() => {
        expect(screen.getByTestId('empty-audit-state')).toBeInTheDocument()
      })

      expect(screen.getByText('No audit events found')).toBeInTheDocument()
      expect(
        screen.getByText('Try clearing or modifying your filter criteria.'),
      ).toBeInTheDocument()
    })

    it('displays error alert when the audit endpoint fails', async () => {
      fetchMock.mockImplementation(() =>
        Promise.resolve(
          new Response(JSON.stringify({ error: 'Database unavailable' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          }),
        ),
      )

      await renderAdminAuditLog()

      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeInTheDocument()
      })

      expect(screen.getByText(/Failed to load audit events/i)).toBeInTheDocument()
      expect(screen.queryByTestId('admin-audit-table')).not.toBeInTheDocument()
    })
  })

  describe('URL-Backed Filters', () => {
    it('initializes filter inputs from URL search params', async () => {
      mockAuditApi([teamCreatedEvent])

      await renderAdminAuditLog(
        undefined,
        'authed',
        '/admin/audit-log?action=team_created&q=Platform',
      )

      await waitFor(() => {
        expect(screen.getByTestId('admin-audit-table')).toBeInTheDocument()
      })

      const actionSelect = screen.getByLabelText(/filter by action/i) as HTMLSelectElement
      expect(actionSelect.value).toBe('team_created')

      const searchInput = screen.getByLabelText(/search audit events/i) as HTMLInputElement
      expect(searchInput.value).toBe('Platform')

      const calls = auditCalls()
      expect(calls.some((c) => c.includes('action=team_created') && c.includes('q=Platform'))).toBe(
        true,
      )
    })

    it('updates action filter and refetches with action parameter', async () => {
      mockAuditApi([userCreatedEvent])

      await renderAdminAuditLog()

      await waitFor(() => {
        expect(screen.getByTestId('admin-audit-table')).toBeInTheDocument()
      })

      const actionSelect = screen.getByLabelText(/filter by action/i)
      fireEvent.change(actionSelect, { target: { value: 'user_created' } })

      await waitFor(() => {
        const calls = auditCalls()
        expect(calls.some((c) => c.includes('action=user_created'))).toBe(true)
      })
    })

    it('updates search query and refetches with q parameter', async () => {
      mockAuditApi([userCreatedEvent])

      await renderAdminAuditLog()

      await waitFor(() => {
        expect(screen.getByTestId('admin-audit-table')).toBeInTheDocument()
      })

      const searchInput = screen.getByLabelText(/search audit events/i)
      fireEvent.change(searchInput, { target: { value: 'alice' } })

      await waitFor(() => {
        const calls = auditCalls()
        expect(calls.some((c) => c.includes('q=alice'))).toBe(true)
      })
    })

    it('clears filter parameters when All Actions or empty query is selected', async () => {
      mockAuditApi([teamCreatedEvent])

      await renderAdminAuditLog(
        undefined,
        'authed',
        '/admin/audit-log?action=team_created&q=Platform',
      )

      await waitFor(() => {
        expect(screen.getByTestId('admin-audit-table')).toBeInTheDocument()
      })

      const actionSelect = screen.getByLabelText(/filter by action/i)
      fireEvent.change(actionSelect, { target: { value: '' } })

      const searchInput = screen.getByLabelText(/search audit events/i)
      fireEvent.change(searchInput, { target: { value: '' } })

      await waitFor(() => {
        const calls = auditCalls()
        const lastCall = calls[calls.length - 1]
        expect(lastCall).toBe('/admin/audit-log')
      })
    })

    it('preserves matching events when trailing or leading whitespace is added to search query', async () => {
      mockAuditApi([teamCreatedEvent])

      await renderAdminAuditLog(
        undefined,
        'authed',
        '/admin/audit-log?q=Platform',
      )

      const table = await screen.findByTestId('admin-audit-table')
      expect(within(table).getByText('Team Created')).toBeInTheDocument()

      const searchInput = screen.getByLabelText(/search audit events/i) as HTMLInputElement
      expect(searchInput.value).toBe('Platform')

      // Append whitespace: "Platform "
      fireEvent.change(searchInput, { target: { value: 'Platform ' } })

      // Search input reflects the untrimmed value synchronously
      expect(searchInput.value).toBe('Platform ')

      // The table must NOT be wiped out; matching events are preserved
      const tableAfterSpace = screen.getByTestId('admin-audit-table')
      expect(within(tableAfterSpace).getByText('Team Created')).toBeInTheDocument()
      expect(screen.queryByTestId('empty-audit-state')).not.toBeInTheDocument()
    })

    it('retains complete search text during rapid keystroke entry without dropping characters', async () => {
      mockAuditApi([teamCreatedEvent])

      await renderAdminAuditLog()

      await waitFor(() => {
        expect(screen.getByTestId('admin-audit-table')).toBeInTheDocument()
      })

      const searchInput = screen.getByLabelText(/search audit events/i) as HTMLInputElement

      const phrase = 'Verification Team'
      let current = ''
      for (const char of phrase) {
        current += char
        fireEvent.change(searchInput, { target: { value: current } })
      }

      // Synchronous local state must hold the entire phrase immediately
      expect(searchInput.value).toBe('Verification Team')

      await waitFor(() => {
        const calls = auditCalls()
        expect(
          calls.some(
            (c) =>
              c.includes('q=Verification+Team') ||
              c.includes('q=Verification%20Team') ||
              c.includes('q=Verification Team'),
          ),
        ).toBe(true)
      })
    })

    it('preserves existing action param when searching, and synchronizes input when URL search params change', async () => {
      mockAuditApi([userCreatedEvent])

      function NavigationHarness() {
        const [searchParams, setSearchParams] = useSearchParams()
        return (
          <div>
            <button
              data-testid="external-nav-btn"
              onClick={() => {
                const next = new URLSearchParams(searchParams)
                next.set('q', 'external_update')
                setSearchParams(next)
              }}
            >
              External Nav
            </button>
            <AdminAuditLog />
          </div>
        )
      }

      await renderWithProviders(
        <AuthContext.Provider value={{ ...authValue(), status: 'authed' }}>
          <Routes>
            <Route path="/admin/audit-log" element={<NavigationHarness />} />
          </Routes>
        </AuthContext.Provider>,
        { route: '/admin/audit-log?action=user_created' },
      )

      await waitFor(() => {
        expect(screen.getByTestId('admin-audit-table')).toBeInTheDocument()
      })

      const actionSelect = screen.getByLabelText(/filter by action/i) as HTMLSelectElement
      const searchInput = screen.getByLabelText(/search audit events/i) as HTMLInputElement

      expect(actionSelect.value).toBe('user_created')
      expect(searchInput.value).toBe('')

      // Type in search filter
      fireEvent.change(searchInput, { target: { value: 'alice' } })
      expect(searchInput.value).toBe('alice')

      // URL search params should preserve action=user_created and include q=alice
      await waitFor(() => {
        const calls = auditCalls()
        expect(calls.some((c) => c.includes('action=user_created') && c.includes('q=alice'))).toBe(
          true,
        )
      })

      // Action select should still be 'user_created'
      expect(actionSelect.value).toBe('user_created')

      // External URL navigation updates input
      fireEvent.click(screen.getByTestId('external-nav-btn'))
      await waitFor(() => {
        expect(searchInput.value).toBe('external_update')
      })
    })

    it('resets pagination accumulation when effective search query changes, but preserves it for whitespace equivalence', async () => {
      const page1Events: AdminAuditEvent[] = [userCreatedEvent]
      const page2Events: AdminAuditEvent[] = [teamCreatedEvent]

      fetchMock.mockImplementation((input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : String(input)
        if (url.includes('cursor=cursor_page_2')) {
          return Promise.resolve(
            jsonResponse({
              events: page2Events,
              nextCursor: null,
            }),
          )
        }
        if (url.includes('q=different')) {
          return Promise.resolve(
            jsonResponse({
              events: [membershipAddedEvent],
              nextCursor: null,
            }),
          )
        }
        return Promise.resolve(
          jsonResponse({
            events: page1Events,
            nextCursor: 'cursor_page_2',
          }),
        )
      })

      await renderAdminAuditLog(undefined, 'authed', '/admin/audit-log?q=test')

      const initialTable = await screen.findByTestId('admin-audit-table')
      expect(within(initialTable).getByText('User Created')).toBeInTheDocument()

      // Click "Load more events" to accumulate page 2
      const loadMoreBtn = screen.getByRole('button', { name: /load more events/i })
      fireEvent.click(loadMoreBtn)

      await waitFor(() => {
        const tableWithMore = screen.getByTestId('admin-audit-table')
        expect(within(tableWithMore).getByText('Team Created')).toBeInTheDocument()
        expect(within(tableWithMore).getByText('User Created')).toBeInTheDocument()
      })

      const searchInput = screen.getByLabelText(/search audit events/i) as HTMLInputElement

      // Add trailing space: "test " (whitespace-equivalent)
      fireEvent.change(searchInput, { target: { value: 'test ' } })

      // Results must NOT be wiped out
      const tableAfterSpace = screen.getByTestId('admin-audit-table')
      expect(within(tableAfterSpace).getByText('User Created')).toBeInTheDocument()
      // Now change query to "different"
      fireEvent.change(searchInput, { target: { value: 'different' } })

      await waitFor(() => {
        const table = screen.getByTestId('admin-audit-table')
        expect(within(table).getByText('Membership Added')).toBeInTheDocument()
        expect(within(table).queryByText('User Created')).not.toBeInTheDocument()
        expect(within(table).queryByText('Team Created')).not.toBeInTheDocument()
      })
    })
  })

  describe('Keyset Pagination & Event Merging', () => {
    it('loads next page, merges and deduplicates events, and hides button when nextCursor is null', async () => {
      const page1Events: AdminAuditEvent[] = [userCreatedEvent, userStatusChangedEvent]
      const page2Events: AdminAuditEvent[] = [userStatusChangedEvent, teamCreatedEvent]

      fetchMock.mockImplementation((input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : String(input)
        if (url.includes('cursor=cursor_page_2')) {
          const res: ListAdminAuditResponse = {
            events: page2Events,
            nextCursor: null,
          }
          return Promise.resolve(jsonResponse(res))
        }
        const res: ListAdminAuditResponse = {
          events: page1Events,
          nextCursor: 'cursor_page_2',
        }
        return Promise.resolve(jsonResponse(res))
      })

      await renderAdminAuditLog()

      const table = await screen.findByTestId('admin-audit-table')
      const tableScope = within(table)

      // Page 1 has 2 events, page 2 has 2 events (with 1 overlapping)
      expect(tableScope.getByText('User Created')).toBeInTheDocument()
      expect(tableScope.getByText('User Status Changed')).toBeInTheDocument()
      expect(tableScope.queryByText('Team Created')).not.toBeInTheDocument()

      const loadMoreButton = screen.getByRole('button', { name: /load more events/i })
      expect(loadMoreButton).toBeInTheDocument()

      fireEvent.click(loadMoreButton)

      await waitFor(() => {
        const currentTable = screen.getByTestId('admin-audit-table')
        expect(within(currentTable).getByText('Team Created')).toBeInTheDocument()
      })

      // User Status Changed should not be duplicated in table rows
      const currentTable = screen.getByTestId('admin-audit-table')
      const userStatusBadges = within(currentTable).getAllByText('User Status Changed')
      expect(userStatusBadges).toHaveLength(1)

      // Next cursor is null, so Load more button should no longer be present
      expect(screen.queryByRole('button', { name: /load more events/i })).not.toBeInTheDocument()
    })

    it('resets accumulated events and pagination cursor when filters change', async () => {
      fetchMock.mockImplementation((input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : String(input)
        if (url.includes('action=team_created')) {
          const res: ListAdminAuditResponse = {
            events: [teamCreatedEvent],
            nextCursor: null,
          }
          return Promise.resolve(jsonResponse(res))
        }
        const res: ListAdminAuditResponse = {
          events: [userCreatedEvent],
          nextCursor: 'cursor_2',
        }
        return Promise.resolve(jsonResponse(res))
      })

      await renderAdminAuditLog()

      const table = await screen.findByTestId('admin-audit-table')
      const tableScope = within(table)

      expect(tableScope.getByText('User Created')).toBeInTheDocument()

      // Change action filter
      const actionSelect = screen.getByLabelText(/filter by action/i)
      fireEvent.change(actionSelect, { target: { value: 'team_created' } })

      // Changing filters unmounts previous table and mounts a new table with filtered result
      await waitFor(() => {
        const currentTable = screen.getByTestId('admin-audit-table')
        expect(within(currentTable).getByText('Team Created')).toBeInTheDocument()
        expect(within(currentTable).queryByText('User Created')).not.toBeInTheDocument()
      })
    })
})
})
