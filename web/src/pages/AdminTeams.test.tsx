import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor, within } from '@testing-library/react'
import { Routes, Route } from 'react-router-dom'
import { renderWithProviders } from '../test/test-utils'
import { AuthContext, type AuthContextValue, type User } from '../auth/AuthContext'
import { AdminTeams } from './AdminTeams'
import type { Team, PublicUser, AdminTeamMember } from '../api/types'

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

describe('AdminTeams Page', () => {
  const fetchMock = vi.fn()

  const team1: Team = {
    id: 1,
    name: 'Platform Engineering',
    slug: 'platform-engineering',
    createdAt: '2026-10-18T05:00:00.000Z',
    updatedAt: '2026-10-18T05:00:00.000Z',
  }

  const team2: Team = {
    id: 2,
    name: 'Customer Operations',
    slug: 'customer-ops',
    createdAt: '2026-10-18T06:00:00.000Z',
    updatedAt: '2026-10-18T06:00:00.000Z',
  }

  const candidateUser1: PublicUser = {
    id: 15,
    email: 'marcus@company.test',
    displayName: 'Marcus Aurelius',
    isAdmin: false,
    status: 'active',
    createdAt: '2026-10-18T08:00:00.000Z',
    updatedAt: '2026-10-18T08:00:00.000Z',
  }

  const candidateUser2: PublicUser = {
    id: 16,
    email: 'zack@company.test',
    displayName: 'Zack Taylor',
    isAdmin: false,
    status: 'active',
    createdAt: '2026-10-18T08:30:00.000Z',
    updatedAt: '2026-10-18T08:30:00.000Z',
  }

  const member1: AdminTeamMember = {
    id: 101,
    userId: 15,
    teamId: 1,
    role: 'lead',
    createdAt: '2026-10-18T08:00:00.000Z',
    user: {
      id: 15,
      email: 'marcus@company.test',
      displayName: 'Marcus Aurelius',
    },
  }

  const member2: AdminTeamMember = {
    id: 102,
    userId: 16,
    teamId: 1,
    role: 'member',
    createdAt: '2026-10-18T08:30:00.000Z',
    user: {
      id: 16,
      email: 'zack@company.test',
      displayName: 'Zack Taylor',
    },
  }

  function mockTeamsApi() {
    let mockTeams = [team1, team2]
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : String(input)
      const method = init?.method?.toUpperCase() ?? 'GET'

      if (url === '/teams?all=true' && method === 'GET') {
        return Promise.resolve(jsonResponse({ teams: mockTeams }))
      }

      if (url === '/teams' && method === 'POST') {
        const body = JSON.parse((init?.body as string) || '{}')
        const newTeam: Team = {
          id: 3,
          name: body.name,
          slug: body.slug,
          createdAt: '2026-10-18T10:00:00.000Z',
          updatedAt: '2026-10-18T10:00:00.000Z',
        }
        mockTeams = [...mockTeams, newTeam]
        return Promise.resolve(
          jsonResponse(
            {
              team: newTeam,
            },
            201,
          ),
        )
      }

      if (/^\/teams\/\d+\/members/.test(url) && method === 'POST') {
        const body = JSON.parse((init?.body as string) || '{}')
        if (body.userId === 999) {
          return Promise.resolve(jsonResponse({ error: 'ALREADY_MEMBER' }, 409))
        }
        return Promise.resolve(jsonResponse({ status: 'created' }, 201))
      }

      if (/^\/admin\/teams\/\d+\/members/.test(url) && method === 'GET') {
        return Promise.resolve(
          jsonResponse({
            members: [member1, member2],
            nextCursor: null,
          }),
        )
      }

      if (/^\/admin\/teams\/\d+\/members\/\d+/.test(url) && method === 'DELETE') {
        return Promise.resolve(new Response(null, { status: 204 }))
      }

      if (url.startsWith('/admin/users') && method === 'GET') {
        return Promise.resolve(
          jsonResponse({
            users: [candidateUser1],
            nextCursor: null,
            userCreationEnabled: true,
          }),
        )
      }

      return Promise.resolve(new Response(JSON.stringify({ error: 'not found' }), { status: 404 }))
    })
  }

  async function renderAdminTeams(
    overrides?: Partial<User>,
    status: AuthContextValue['status'] = 'authed',
  ) {
    return renderWithProviders(
      <AuthContext.Provider value={{ ...authValue(overrides), status }}>
        <Routes>
          <Route path="/admin/teams" element={<AdminTeams />} />
          <Route path="/login" element={<div>Login Screen</div>} />
        </Routes>
      </AuthContext.Provider>,
      { route: '/admin/teams' },
    )
  }

  beforeEach(() => {
    vi.restoreAllMocks()
    fetchMock.mockReset()
    globalThis.fetch = fetchMock
  })

  it('shows not authorised to a non-admin user and never calls /teams', async () => {
    mockTeamsApi()
    const { queryClient } = await renderAdminTeams({ isAdmin: false })

    expect(screen.getByText(/not authorised/i)).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /^Teams$/i })).not.toBeInTheDocument()
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0)
  })

  it('redirects an anonymous visitor to /login without calling /teams', async () => {
    mockTeamsApi()
    await renderAdminTeams(undefined, 'anon')

    expect(screen.getByText('Login Screen')).toBeInTheDocument()
    expect(fetchMock.mock.calls).toHaveLength(0)
  })

  it('renders teams list and displays selected team detail', async () => {
    mockTeamsApi()
    await renderAdminTeams()

    await waitFor(() => {
      expect(screen.getByText('Platform Engineering')).toBeInTheDocument()
    })

    expect(screen.getByText('Customer Operations')).toBeInTheDocument()
    expect(screen.getByText(/slug: platform-engineering/i)).toBeInTheDocument()
    expect(
      screen.getByText('Manage organizational teams, inspect member rosters, and assign roles.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /\+ Add Member/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /Team Roster/i })).toBeInTheDocument()
  })

  it('allows selecting another team from the directory and updates the roster workspace', async () => {
    const team2Member: AdminTeamMember = {
      id: 103,
      userId: 17,
      teamId: 2,
      role: 'lead',
      createdAt: '2026-10-18T10:00:00.000Z',
      user: {
        id: 17,
        email: 'ops.lead@company.test',
        displayName: 'Ops Leader',
      },
    }

    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : String(input)
      const method = init?.method?.toUpperCase() ?? 'GET'

      if (url === '/teams?all=true' && method === 'GET') {
        return Promise.resolve(jsonResponse({ teams: [team1, team2] }))
      }
      if (url === '/admin/teams/1/members' && method === 'GET') {
        return Promise.resolve(jsonResponse({ members: [member1, member2], nextCursor: null }))
      }
      if (url === '/admin/teams/2/members' && method === 'GET') {
        return Promise.resolve(jsonResponse({ members: [team2Member], nextCursor: null }))
      }
      if (url.startsWith('/admin/users') && method === 'GET') {
        return Promise.resolve(jsonResponse({ users: [candidateUser1], nextCursor: null, userCreationEnabled: true }))
      }
      return Promise.resolve(new Response(JSON.stringify({ error: 'not found' }), { status: 404 }))
    })

    await renderAdminTeams()

    await waitFor(() => {
      expect(screen.getByText('Customer Operations')).toBeInTheDocument()
      expect(screen.getByText('Marcus Aurelius')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /Customer Operations/i }))

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Customer Operations' })).toBeInTheDocument()
      expect(screen.getByText('Ops Leader')).toBeInTheDocument()
      expect(screen.queryByText('Marcus Aurelius')).not.toBeInTheDocument()
    })
  })

  it('filters teams directory with search input', async () => {
    mockTeamsApi()
    await renderAdminTeams()

    await waitFor(() => {
      expect(screen.getByText('Platform Engineering')).toBeInTheDocument()
      expect(screen.getByText('Customer Operations')).toBeInTheDocument()
    })

    const searchInput = screen.getByRole('searchbox', { name: /Search teams/i })
    fireEvent.change(searchInput, { target: { value: 'Customer' } })

    expect(screen.getByText('Customer Operations')).toBeInTheDocument()
    expect(screen.queryByText('Platform Engineering')).not.toBeInTheDocument()
  })

  it('opens and cancels the Create Team modal dialog with proper accessibility', async () => {
    mockTeamsApi()
    await renderAdminTeams()

    await waitFor(() => {
      expect(screen.getByText('Platform Engineering')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /\+ Create Team|Create Team/i }))

    const dialog = screen.getByRole('dialog', { name: /Create.*Team/i })
    expect(dialog).toBeInTheDocument()
    expect(dialog).toHaveAttribute('aria-modal', 'true')

    const cancelBtn = within(dialog).getByRole('button', { name: /Cancel/i })
    fireEvent.click(cancelBtn)

    expect(screen.queryByRole('dialog', { name: /Create.*Team/i })).not.toBeInTheDocument()
  })

  it('creates a new team via POST /teams modal and displays it', async () => {
    mockTeamsApi()
    await renderAdminTeams()

    await waitFor(() => {
      expect(screen.getByText('Platform Engineering')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /\+ Create Team|Create Team/i }))

    const dialog = screen.getByRole('dialog', { name: /Create.*Team/i })
    expect(dialog).toBeInTheDocument()

    const nameInput = screen.getByLabelText(/Team Name/i)
    fireEvent.change(nameInput, {
      target: { value: 'Security Architecture' },
    })

    const slugInput = screen.getByLabelText(/Team Slug/i)
    expect((slugInput as HTMLInputElement).value).toBe('security-architecture')

    const submitBtn = within(dialog).getByRole('button', { name: /^Create Team$/i })
    fireEvent.click(submitBtn)

    await waitFor(() => {
      expect(screen.getByText(/Team "Security Architecture" created successfully/i)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /Security Architecture/i })).toBeInTheDocument()
    })

    const postCall = fetchMock.mock.calls.find(
      (c) => String(c[0]) === '/teams' && c[1]?.method === 'POST',
    )
    expect(postCall).toBeDefined()
    expect(JSON.parse(postCall?.[1]?.body as string)).toEqual({
      name: 'Security Architecture',
      slug: 'security-architecture',
    })
  })

  it('opens and cancels the Add Member modal dialog with proper accessibility', async () => {
    mockTeamsApi()
    await renderAdminTeams()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /\+ Add Member/i })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /\+ Add Member/i }))

    const dialog = screen.getByRole('dialog', { name: /Add.*Member/i })
    expect(dialog).toBeInTheDocument()
    expect(dialog).toHaveAttribute('aria-modal', 'true')

    const cancelBtn = within(dialog).getByRole('button', { name: /Cancel/i })
    fireEvent.click(cancelBtn)

    expect(screen.queryByRole('dialog', { name: /Add.*Member/i })).not.toBeInTheDocument()
  })

  it('direct-adds a member via searchable paginated user picker with no silent 100 cap and immediately updates the roster', async () => {
    let currentMembers = [member1]
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : String(input)
      const method = init?.method?.toUpperCase() ?? 'GET'

      if (url === '/teams?all=true') {
        return Promise.resolve(jsonResponse({ teams: [team1] }))
      }

      if (/^\/teams\/\d+\/members/.test(url) && method === 'POST') {
        currentMembers = [member1, member2]
        return Promise.resolve(jsonResponse({ status: 'created' }, 201))
      }

      if (/^\/admin\/teams\/\d+\/members/.test(url) && method === 'GET') {
        return Promise.resolve(jsonResponse({ members: currentMembers, nextCursor: null }))
      }

      // User picker: first page has nextCursor (proving pagination capability beyond 100)
      if (url.startsWith('/admin/users')) {
        if (url.includes('cursor=user_page_2_cursor')) {
          return Promise.resolve(
            jsonResponse({
              users: [candidateUser2],
              nextCursor: null,
              userCreationEnabled: true,
            }),
          )
        }
        return Promise.resolve(
          jsonResponse({
            users: [candidateUser1],
            nextCursor: 'user_page_2_cursor',
            userCreationEnabled: true,
          }),
        )
      }

      return Promise.resolve(new Response(JSON.stringify({ error: 'not found' }), { status: 404 }))
    })

    await renderAdminTeams()

    await waitFor(() => {
      expect(screen.getByText('Platform Engineering')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /\+ Add Member/i }))

    const dialog = screen.getByRole('dialog', { name: /Add.*Member/i })
    expect(dialog).toBeInTheDocument()

    // User picker shows first candidate
    await waitFor(() => {
      expect(within(dialog).getByText('Marcus Aurelius')).toBeInTheDocument()
    })

    // User picker has Load more users button (no silent 100 cap!)
    const loadMoreBtn = within(dialog).getByRole('button', { name: /Load more users/i })
    expect(loadMoreBtn).toBeInTheDocument()

    // Click load more to get page 2 candidate
    fireEvent.click(loadMoreBtn)

    await waitFor(() => {
      expect(within(dialog).getByText('Zack Taylor')).toBeInTheDocument()
    })

    // Both page 1 and page 2 users are available
    expect(within(dialog).getByText('Marcus Aurelius')).toBeInTheDocument()

    // Select candidateUser2 (Zack Taylor)
    const zackRadio = within(dialog).getByLabelText(/Select user Zack Taylor/i)
    fireEvent.click(zackRadio)

    expect(zackRadio).toBeChecked()

    // Change role to member
    fireEvent.change(within(dialog).getByLabelText(/Select Role/i), {
      target: { value: 'member' },
    })

    // Submit add member
    const addMemberBtn = within(dialog).getByRole('button', { name: /Add Zack Taylor to Platform Engineering/i })
    fireEvent.click(addMemberBtn)
    await waitFor(() => {
      expect(
        screen.getByText(/Added Zack Taylor \(zack@company.test\) to "Platform Engineering" as member/i),
      ).toBeInTheDocument()
      expect(within(screen.getByTestId('team-members-table')).getByText('Zack Taylor')).toBeInTheDocument()
    })

    const addMemberCall = fetchMock.mock.calls.find(
      (c) => String(c[0]) === '/teams/1/members' && c[1]?.method === 'POST',
    )
    expect(addMemberCall).toBeDefined()
    expect(JSON.parse(addMemberCall?.[1]?.body as string)).toEqual({
      userId: 16,
      role: 'member',
    })
  })

  it('handles conflict when adding a user who is already a member', async () => {
    mockTeamsApi()
    await renderAdminTeams()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /\+ Add Member/i })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /\+ Add Member/i }))
    const dialog = screen.getByRole('dialog', { name: /Add.*Member/i })

    await waitFor(() => {
      expect(within(dialog).getByText('Marcus Aurelius')).toBeInTheDocument()
    })

    // Select candidateUser1 (id: 15)
    fireEvent.click(within(dialog).getByLabelText(/Select user Marcus Aurelius/i))

    // Mock failure on next post (409 Conflict)
    fetchMock.mockImplementationOnce((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : String(input)
      const method = init?.method?.toUpperCase() ?? 'GET'
      if (/^\/teams\/\d+\/members/.test(url) && method === 'POST') {
        return Promise.resolve(jsonResponse({ error: 'ALREADY_MEMBER' }, 409))
      }
      return Promise.resolve(new Response(JSON.stringify({ error: 'not found' }), { status: 404 }))
    })

    fireEvent.click(within(dialog).getByRole('button', { name: /Add Marcus Aurelius to Platform Engineering/i }))

    await waitFor(() => {
      expect(within(dialog).getByText(/This user is already a member of this team/i)).toBeInTheDocument()
    })
  })

  it('renders current team members in members table for selected team', async () => {
    mockTeamsApi()
    await renderAdminTeams()

    const membersTable = await screen.findByTestId('team-members-table')
    expect(membersTable).toBeInTheDocument()
    const withinTable = within(membersTable)
    expect(withinTable.getByText('Marcus Aurelius')).toBeInTheDocument()
    expect(withinTable.getByText('marcus@company.test')).toBeInTheDocument()
    expect(withinTable.getByText('lead')).toBeInTheDocument()
    expect(withinTable.getByText('Zack Taylor')).toBeInTheDocument()
    expect(withinTable.getByText('zack@company.test')).toBeInTheDocument()
    expect(withinTable.getByText('member')).toBeInTheDocument()
  })

  it('filters roster members client-side via member filter input', async () => {
    mockTeamsApi()
    await renderAdminTeams()

    const membersTable = await screen.findByTestId('team-members-table')
    expect(membersTable).toBeInTheDocument()
    expect(within(membersTable).getByText('Marcus Aurelius')).toBeInTheDocument()
    expect(within(membersTable).getByText('Zack Taylor')).toBeInTheDocument()

    const filterInput = screen.getByRole('searchbox', { name: /Filter members/i })
    fireEvent.change(filterInput, { target: { value: 'Zack' } })

    expect(within(membersTable).getByText('Zack Taylor')).toBeInTheDocument()
    expect(within(membersTable).queryByText('Marcus Aurelius')).not.toBeInTheDocument()
  })

  it('allows admin to remove a team member and updates the list', async () => {
    let currentMembers = [member1, member2]
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : String(input)
      const method = init?.method?.toUpperCase() ?? 'GET'

      if (url === '/teams?all=true' && method === 'GET') {
        return Promise.resolve(jsonResponse({ teams: [team1, team2] }))
      }
      if (url.startsWith('/admin/users') && method === 'GET') {
        return Promise.resolve(
          jsonResponse({
            users: [candidateUser1],
            nextCursor: null,
            userCreationEnabled: true,
          }),
        )
      }
      if (url === '/admin/teams/1/members' && method === 'GET') {
        return Promise.resolve(jsonResponse({ members: currentMembers, nextCursor: null }))
      }
      if (url === '/admin/teams/1/members/16' && method === 'DELETE') {
        currentMembers = currentMembers.filter((m) => m.userId !== 16)
        return Promise.resolve(new Response(null, { status: 204 }))
      }
      return Promise.resolve(new Response(JSON.stringify({ error: 'not found' }), { status: 404 }))
    })

    await renderAdminTeams()

    await waitFor(() => {
      expect(screen.getByText('Zack Taylor')).toBeInTheDocument()
    })

    const removeButton = screen.getByLabelText('Remove Zack Taylor from team')
    fireEvent.click(removeButton)

    await waitFor(() => {
      expect(screen.getByText(/Removed Zack Taylor from the team/i)).toBeInTheDocument()
    })

    await waitFor(() => {
      expect(screen.queryByText('Zack Taylor')).not.toBeInTheDocument()
    })
  })

  it('displays error when trying to remove the last lead', async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : String(input)
      const method = init?.method?.toUpperCase() ?? 'GET'

      if (url === '/teams?all=true' && method === 'GET') {
        return Promise.resolve(jsonResponse({ teams: [team1, team2] }))
      }
      if (url.startsWith('/admin/users') && method === 'GET') {
        return Promise.resolve(
          jsonResponse({
            users: [candidateUser1],
            nextCursor: null,
            userCreationEnabled: true,
          }),
        )
      }
      if (url === '/admin/teams/1/members' && method === 'GET') {
        return Promise.resolve(jsonResponse({ members: [member1], nextCursor: null }))
      }
      if (url === '/admin/teams/1/members/15' && method === 'DELETE') {
        return Promise.resolve(
          jsonResponse(
            { error: { code: 'LAST_LEAD', message: 'Cannot remove or demote the last lead of a team' } },
            422,
          ),
        )
      }
      return Promise.resolve(new Response(JSON.stringify({ error: 'not found' }), { status: 404 }))
    })

    await renderAdminTeams()

    await waitFor(() => {
      expect(screen.getByText('Marcus Aurelius')).toBeInTheDocument()
    })

    const removeButton = screen.getByLabelText('Remove Marcus Aurelius from team')
    fireEvent.click(removeButton)

    await waitFor(() => {
      expect(
        screen.getByText(/Cannot remove or demote the last lead of a team/i),
      ).toBeInTheDocument()
    })
  })
})
