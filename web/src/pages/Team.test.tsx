import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor, within } from '@testing-library/react'
import { Routes, Route } from 'react-router-dom'
import { renderWithProviders } from '../test/test-utils'
import { AuthContext, type AuthContextValue, type User } from '../auth/AuthContext'
import { Team } from './Team'

function createAuthContextValue(overrides?: Partial<User>): AuthContextValue {
  return {
    user: {
      ...mockUser,
      ...overrides,
    },
    status: 'authed',
    login: vi.fn().mockResolvedValue(undefined),
    logout: vi.fn().mockResolvedValue(undefined),
    setAuthUser: vi.fn(),
  }
}

const mockUser = {
  id: 1,
  email: 'lead@newtonite.test',
  displayName: 'Lead User',
  isAdmin: false,
}

const mockTeams = [
  { id: 1, name: 'Core Infrastructure', slug: 'core-infrastructure', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
]

const mockMemberships = [
  { teamId: 1, role: 'lead' as const },
]

const mockMembers = [
  {
    id: 101,
    userId: 1,
    teamId: 1,
    role: 'lead' as const,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    user: {
      id: 1,
      displayName: 'Lead User',
      email: 'lead@newtonite.test',
    },
  },
  {
    id: 102,
    userId: 2,
    teamId: 1,
    role: 'member' as const,
    createdAt: '2026-01-02T00:00:00Z',
    updatedAt: '2026-01-02T00:00:00Z',
    user: {
      id: 2,
      displayName: 'Member User',
      email: 'member@newtonite.test',
    },
  },
]

const mockInvitations = [
  {
    id: 201,
    teamId: 1,
    email: 'newbie@newtonite.test',
    role: 'member' as const,
    uses: 0,
    maxUses: 1,
    expiresAt: '2027-01-01T00:00:00Z',
    revokedAt: null,
    createdAt: '2026-01-10T00:00:00Z',
  },
]

describe('Team Page', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(window, 'confirm').mockImplementation(() => true)
  })

  const setupFetch = (opts?: {
    userRole?: 'lead' | 'member' | 'viewer'
    roleChangeError?: string
    inviteError?: { code: string; message: string; status?: number }
    deferInvite?: () => Promise<Response>
  }) => {
    const role = opts?.userRole ?? 'lead'
    globalThis.fetch = vi.fn().mockImplementation((url: string | URL | Request, init?: RequestInit) => {
      const urlStr = typeof url === 'string' ? url : url.toString()

      if (urlStr.includes('/auth/refresh')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              accessToken: 'mock-access-token',
              user: mockUser,
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        )
      }

      if (urlStr.includes('/auth/me')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              user: mockUser,
              memberships: [{ teamId: 1, role }],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        )
      }

      if (urlStr.includes('/teams/1/members') && init?.method === 'PATCH') {
        if (opts?.roleChangeError) {
          return Promise.resolve(
            new Response(
              JSON.stringify({ error: { code: 'LAST_LEAD', message: opts.roleChangeError } }),
              { status: 422, headers: { 'Content-Type': 'application/json' } },
            ),
          )
        }
        return Promise.resolve(
          new Response(JSON.stringify({ status: 'ok' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }

      if (urlStr.includes('/teams/1/members') && init?.method === 'DELETE') {
        return Promise.resolve(new Response(null, { status: 204 }))
      }

      if (urlStr.includes('/teams/1/members')) {
        return Promise.resolve(
          new Response(JSON.stringify({ members: mockMembers, nextCursor: null }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }

      if (urlStr.includes('/teams/1/invitations') && init?.method === 'POST') {
        if (opts?.deferInvite) {
          return opts.deferInvite()
        }
        if (opts?.inviteError) {
          return Promise.resolve(
            new Response(
              JSON.stringify({ error: opts.inviteError }),
              { status: opts.inviteError.status ?? 422, headers: { 'Content-Type': 'application/json' } },
            ),
          )
        }
        const body = init?.body ? JSON.parse(init.body as string) : {}
        return Promise.resolve(
          new Response(
            JSON.stringify({
              invitation: {
                id: 202,
                teamId: 1,
                email: body.email || 'invited@test.local',
                role: body.role || 'member',
                uses: 0,
                maxUses: 1,
                expiresAt: null,
                revokedAt: null,
                createdAt: new Date().toISOString(),
              },
            }),
            { status: 201, headers: { 'Content-Type': 'application/json' } },
          ),
        )
      }

      if (urlStr.includes('/teams/1/invitations')) {
        return Promise.resolve(
          new Response(JSON.stringify({ invitations: mockInvitations, nextCursor: null }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }

      if (urlStr.includes('/invitations/') && init?.method === 'DELETE') {
        return Promise.resolve(new Response(null, { status: 204 }))
      }

      if (urlStr.includes('/teams')) {
        return Promise.resolve(
          new Response(JSON.stringify({ teams: mockTeams }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }

      return Promise.resolve(new Response('not found', { status: 404 }))
    })
  }

  it('renders team header, current role, and members table', async () => {
    setupFetch({ userRole: 'lead' })

    renderWithProviders(
      <AuthContext.Provider value={createAuthContextValue()}>
        <Team />
      </AuthContext.Provider>,
    )

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Core Infrastructure/i })).toBeInTheDocument()
      expect(screen.getByText('Lead User')).toBeInTheDocument()
    })

    expect(screen.getByText(/Your Role: lead/i)).toBeInTheDocument()
    expect(screen.getByText('Member User')).toBeInTheDocument()
    expect(screen.getByText('member@newtonite.test')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /\+ Invite Member/i })).toBeInTheDocument()
  })

  it('allows lead to send an invitation in an accessible modal with initial email focus and success feedback', async () => {
    setupFetch({ userRole: 'lead' })

    renderWithProviders(
      <AuthContext.Provider value={createAuthContextValue()}>
        <Team />
      </AuthContext.Provider>,
    )

    const triggerBtn = await screen.findByRole('button', { name: /\+ Invite Member/i })
    fireEvent.click(triggerBtn)

    const dialog = screen.getByRole('dialog', { name: /Invite Member to Core Infrastructure/i })
    expect(dialog).toBeInTheDocument()
    expect(document.body.style.overflow).toBe('hidden')
    expect(
      within(dialog).getByText(/A single-use invitation link will be emailed to this address/i),
    ).toBeInTheDocument()

    const emailInput = within(dialog).getByLabelText(/Invitee Email Address/i)
    expect(document.activeElement).toBe(emailInput)

    fireEvent.change(emailInput, {
      target: { value: 'invited@test.local' },
    })
    const roleSelect = within(dialog).getByLabelText(/Initial Team Role/i)
    fireEvent.change(roleSelect, { target: { value: 'lead' } })

    fireEvent.click(within(dialog).getByRole('button', { name: /Send Invitation/i }))

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
    expect(document.body.style.overflow).toBe('')

    expect(screen.getByText(/Invitation sent to invited@test.local \(lead\)/i)).toBeInTheDocument()
    expect(document.activeElement).toBe(triggerBtn)
  })

  it('supports modal dismissal via Cancel, Escape, Close button, and backdrop with focus restoration and draft reset', async () => {
    setupFetch({ userRole: 'lead' })

    renderWithProviders(
      <AuthContext.Provider value={createAuthContextValue()}>
        <Team />
      </AuthContext.Provider>,
    )

    const triggerBtn = await screen.findByRole('button', { name: /\+ Invite Member/i })

    // 1. Dismiss via Cancel button
    fireEvent.click(triggerBtn)
    let dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText(/Invitee Email Address/i), {
      target: { value: 'draft-cancel@test.local' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: /Cancel/i }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(document.activeElement).toBe(triggerBtn)

    // Verify draft reset
    fireEvent.click(triggerBtn)
    dialog = screen.getByRole('dialog')
    expect(within(dialog).getByLabelText(/Invitee Email Address/i)).toHaveValue('')

    // 2. Dismiss via Escape key
    fireEvent.change(within(dialog).getByLabelText(/Invitee Email Address/i), {
      target: { value: 'draft-escape@test.local' },
    })
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(document.activeElement).toBe(triggerBtn)

    // Verify draft reset
    fireEvent.click(triggerBtn)
    dialog = screen.getByRole('dialog')
    expect(within(dialog).getByLabelText(/Invitee Email Address/i)).toHaveValue('')

    // 3. Dismiss via Close icon button
    fireEvent.click(within(dialog).getByRole('button', { name: /Close dialog/i }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(document.activeElement).toBe(triggerBtn)

    // 4. Dismiss via backdrop click
    fireEvent.click(triggerBtn)
    dialog = screen.getByRole('dialog')
    fireEvent.click(dialog.parentElement!)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(document.activeElement).toBe(triggerBtn)
  })

  it('traps focus within the modal with Tab and Shift+Tab wrap', async () => {
    setupFetch({ userRole: 'lead' })

    renderWithProviders(
      <AuthContext.Provider value={createAuthContextValue()}>
        <Team />
      </AuthContext.Provider>,
    )

    const triggerBtn = await screen.findByRole('button', { name: /\+ Invite Member/i })
    fireEvent.click(triggerBtn)

    const dialog = screen.getByRole('dialog')
    const closeBtn = within(dialog).getByRole('button', { name: /Close dialog/i })
    const sendBtn = within(dialog).getByRole('button', { name: /Send Invitation/i })

    // Tab from last focusable wraps to first
    sendBtn.focus()
    expect(document.activeElement).toBe(sendBtn)
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: false })
    expect(document.activeElement).toBe(closeBtn)

    // Shift+Tab from first focusable wraps to last
    closeBtn.focus()
    expect(document.activeElement).toBe(closeBtn)
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(sendBtn)
  })

  it('keeps modal and draft open when submission fails and displays error alert inside dialog', async () => {
    setupFetch({
      userRole: 'lead',
      inviteError: { code: 'VALIDATION_ERROR', message: 'Invalid email address' },
    })

    renderWithProviders(
      <AuthContext.Provider value={createAuthContextValue()}>
        <Team />
      </AuthContext.Provider>,
    )

    const triggerBtn = await screen.findByRole('button', { name: /\+ Invite Member/i })
    fireEvent.click(triggerBtn)

    const dialog = screen.getByRole('dialog')
    const emailInput = within(dialog).getByLabelText(/Invitee Email Address/i)
    fireEvent.change(emailInput, { target: { value: 'invalid@example.com' } })

    fireEvent.click(within(dialog).getByRole('button', { name: /Send Invitation/i }))

    await waitFor(() => {
      const alert = within(dialog).getByRole('alert')
      expect(alert).toHaveTextContent(/Invalid email address/i)
    })

    expect(dialog).toBeInTheDocument()
    expect(emailInput).toHaveValue('invalid@example.com')
  })

  it('disables controls and ignores dismissal during pending invitation submission', async () => {
    let resolveInvite!: (res: Response) => void
    const deferPromise = new Promise<Response>((resolve) => {
      resolveInvite = resolve
    })

    setupFetch({
      userRole: 'lead',
      deferInvite: () => deferPromise,
    })

    renderWithProviders(
      <AuthContext.Provider value={createAuthContextValue()}>
        <Team />
      </AuthContext.Provider>,
    )

    const triggerBtn = await screen.findByRole('button', { name: /\+ Invite Member/i })
    fireEvent.click(triggerBtn)

    const dialog = screen.getByRole('dialog')
    const emailInput = within(dialog).getByLabelText(/Invitee Email Address/i)
    const roleSelect = within(dialog).getByLabelText(/Initial Team Role/i)
    const sendBtn = within(dialog).getByRole('button', { name: /Send Invitation/i })
    const cancelBtn = within(dialog).getByRole('button', { name: /Cancel/i })
    const closeBtn = within(dialog).getByRole('button', { name: /Close dialog/i })

    fireEvent.change(emailInput, { target: { value: 'in-flight@test.local' } })
    fireEvent.click(sendBtn)

    // While pending
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Queuing Invitation…/i })).toBeDisabled()
    })
    expect(emailInput).toBeDisabled()
    expect(roleSelect).toBeDisabled()
    expect(cancelBtn).toBeDisabled()
    expect(closeBtn).toBeDisabled()

    // Escape should not close dialog
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    // Backdrop click should not close dialog
    fireEvent.click(dialog.parentElement!)
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    // Tab key keeps focus trapped on the dialog container
    fireEvent.keyDown(window, { key: 'Tab' })
    expect(document.activeElement).toBe(dialog)

    // Resolve deferred promise
    resolveInvite(
      new Response(
        JSON.stringify({
          invitation: {
            id: 205,
            teamId: 1,
            email: 'in-flight@test.local',
            role: 'member',
            uses: 0,
            maxUses: 1,
            expiresAt: null,
            revokedAt: null,
            createdAt: new Date().toISOString(),
          },
        }),
        { status: 201, headers: { 'Content-Type': 'application/json' } },
      ),
    )

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
    expect(screen.getByText(/Invitation sent to in-flight@test.local/i)).toBeInTheDocument()
  })

  it('renders Status column header and dash for non-active invitation actions', async () => {
    setupFetch({ userRole: 'lead' })

    renderWithProviders(
      <AuthContext.Provider value={createAuthContextValue()}>
        <Team />
      </AuthContext.Provider>,
    )

    await waitFor(() => {
      expect(screen.getByRole('columnheader', { name: 'Status' })).toBeInTheDocument()
    })
    expect(screen.getByText('Active')).toBeInTheDocument()
  })

  it('handles LAST_LEAD error when demoting the only lead', async () => {
    setupFetch({
      userRole: 'lead',
      roleChangeError: 'Cannot remove or demote the last lead of a team',
    })

    renderWithProviders(
      <AuthContext.Provider value={createAuthContextValue()}>
        <Team />
      </AuthContext.Provider>,
    )

    await waitFor(() => {
      expect(screen.getByLabelText(/Change role for Lead User/i)).toBeInTheDocument()
    })

    const roleSelect = screen.getByLabelText(/Change role for Lead User/i)
    fireEvent.change(roleSelect, { target: { value: 'member' } })

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument()
    })

    expect(screen.getByText(/Cannot remove or demote the last lead/i)).toBeInTheDocument()
  })

  it('renders read-only members view for non-lead members', async () => {
    setupFetch({ userRole: 'viewer' })

    renderWithProviders(
      <AuthContext.Provider value={createAuthContextValue()}>
        <Team />
      </AuthContext.Provider>,
    )

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Core Infrastructure/i })).toBeInTheDocument()
    })

    expect(screen.getByText(/Your Role: viewer/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /\+ Invite Member/i })).not.toBeInTheDocument()
    expect(screen.getByText(/Read-only view • Team lead role required/i)).toBeInTheDocument()
  })

  it('shows explicit error for malformed team route like /teams/1abc', async () => {
    setupFetch({ userRole: 'lead' })

    renderWithProviders(
      <AuthContext.Provider value={createAuthContextValue()}>
        <Routes>
          <Route path="/teams/:id" element={<Team />} />
        </Routes>
      </AuthContext.Provider>,
      { route: '/teams/1abc' },
    )

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Invalid Team Identifier/i })).toBeInTheDocument()
    })
    expect(screen.queryByRole('heading', { name: /Core Infrastructure/i })).not.toBeInTheDocument()
  })

  it('shows explicit error for unavailable team route like /teams/999', async () => {
    setupFetch({ userRole: 'lead' })

    renderWithProviders(
      <AuthContext.Provider value={createAuthContextValue()}>
        <Routes>
          <Route path="/teams/:id" element={<Team />} />
        </Routes>
      </AuthContext.Provider>,
      { route: '/teams/999' },
    )

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Team Not Found/i })).toBeInTheDocument()
    })
    expect(screen.queryByRole('heading', { name: /Core Infrastructure/i })).not.toBeInTheDocument()
  })

  it('shows explicit recoverable error with Retry button on GET /teams failure', async () => {
    globalThis.fetch = vi.fn().mockImplementation((url: string | URL | Request) => {
      const urlStr = typeof url === 'string' ? url : url.toString()
      if (urlStr.includes('/auth/refresh')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              accessToken: 'mock-access-token',
              user: mockUser,
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        )
      }
      if (urlStr.includes('/auth/me')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              user: mockUser,
              memberships: [{ teamId: 1, role: 'lead' }],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        )
      }
      if (urlStr.includes('/teams')) {
        return Promise.resolve(
          new Response(JSON.stringify({ error: 'Server error' }), { status: 500 }),
        )
      }
      return Promise.resolve(new Response('not found', { status: 404 }))
    })

    renderWithProviders(
      <AuthContext.Provider value={createAuthContextValue()}>
        <Team />
      </AuthContext.Provider>,
    )

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument()
    })
    expect(screen.getByText(/Failed to load team data/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Retry/i })).toBeInTheDocument()
    expect(screen.queryByText(/You do not currently belong to any teams/i)).not.toBeInTheDocument()
  })

  it('shows retry button when team members fail to load and allows retry', async () => {
    let membersCallCount = 0
    globalThis.fetch = vi.fn().mockImplementation((url: string | URL | Request) => {
      const urlStr = typeof url === 'string' ? url : url.toString()
      if (urlStr.includes('/auth/refresh')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              accessToken: 'mock-access-token',
              user: mockUser,
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        )
      }
      if (urlStr.includes('/auth/me')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              user: mockUser,
              memberships: [{ teamId: 1, role: 'lead' }],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        )
      }
      if (urlStr.includes('/teams/1/members')) {
        membersCallCount++
        if (membersCallCount === 1) {
          return Promise.resolve(new Response(JSON.stringify({ error: 'Network failure' }), { status: 500 }))
        }
        return Promise.resolve(
          new Response(JSON.stringify({ members: mockMembers, nextCursor: null }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }
      if (urlStr.includes('/teams/1/invitations')) {
        return Promise.resolve(
          new Response(JSON.stringify({ invitations: [], nextCursor: null }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }
      if (urlStr.includes('/teams')) {
        return Promise.resolve(
          new Response(JSON.stringify({ teams: mockTeams }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }
      return Promise.resolve(new Response('not found', { status: 404 }))
    })

    renderWithProviders(
      <AuthContext.Provider value={createAuthContextValue()}>
        <Team />
      </AuthContext.Provider>,
    )

    const retryBtn = await screen.findByRole('button', { name: /Retry/i })
    expect(screen.getByText(/Failed to load members/i)).toBeInTheDocument()

    fireEvent.click(retryBtn)

    await waitFor(() => {
      expect(screen.getByText('Lead User')).toBeInTheDocument()
    })
  })

  it('updates revoked invitation status immediately in table', async () => {
    setupFetch({ userRole: 'lead' })

    renderWithProviders(
      <AuthContext.Provider value={createAuthContextValue()}>
        <Team />
      </AuthContext.Provider>,
    )

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Revoke invitation for newbie@newtonite.test/i })).toBeInTheDocument()
    }, { timeout: 3000 })

    const revokeBtn = screen.getByRole('button', { name: /Revoke invitation for newbie@newtonite.test/i })
    fireEvent.click(revokeBtn)

    await waitFor(() => {
      expect(screen.getByText('Revoked')).toBeInTheDocument()
    })
    expect(screen.queryByRole('button', { name: /Revoke invitation for newbie@newtonite.test/i })).not.toBeInTheDocument()
  })
})
