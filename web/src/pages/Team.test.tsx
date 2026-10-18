import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'
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
        return Promise.resolve(
          new Response(
            JSON.stringify({
              invitation: {
                id: 202,
                teamId: 1,
                email: 'invited@test.local',
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

  it('allows lead to send an invitation', async () => {
    setupFetch({ userRole: 'lead' })

    renderWithProviders(
      <AuthContext.Provider value={createAuthContextValue()}>
        <Team />
      </AuthContext.Provider>,
    )

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /\+ Invite Member/i })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /\+ Invite Member/i }))

    expect(screen.getByLabelText(/Invitee Email Address/i)).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(/Invitee Email Address/i), {
      target: { value: 'invited@test.local' },
    })

    fireEvent.click(screen.getByRole('button', { name: /Send Invitation/i }))

    await waitFor(() => {
      expect(screen.getByRole('status')).toBeInTheDocument()
    })

    expect(screen.getByText(/Invitation sent to invited@test.local/i)).toBeInTheDocument()
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
