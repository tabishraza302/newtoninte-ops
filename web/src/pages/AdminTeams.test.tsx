import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { Routes, Route, BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderWithProviders, createTestQueryClient, type RenderWithProvidersOptions } from '../test/test-utils'
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

      if ((url === '/admin/teams' || url.startsWith('/admin/teams?')) && method === 'GET') {
        const q = new URL(url, 'http://localhost').searchParams.get('q')?.toLowerCase() ?? ''
        return Promise.resolve(jsonResponse({ teams: mockTeams.filter((team) => `${team.name} ${team.slug}`.toLowerCase().includes(q)), nextCursor: null }))
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
    options?: RenderWithProvidersOptions,
  ) {
    return renderWithProviders(
      <AuthContext.Provider value={{ ...authValue(overrides), status }}>
        <Routes>
          <Route path="/admin/teams" element={<AdminTeams />} />
          <Route path="/login" element={<div>Login Screen</div>} />
        </Routes>
      </AuthContext.Provider>,
      { route: '/admin/teams', ...options },
    )
  }
  function renderAdminTeamsWithBrowserRouter(
    initialUrl = '/admin/teams',
    overrides?: Partial<User>,
    status: AuthContextValue['status'] = 'authed',
  ) {
    window.history.pushState(null, '', initialUrl)
    const queryClient = createTestQueryClient()
    const result = render(
      <QueryClientProvider client={queryClient}>
        <AuthContext.Provider value={{ ...authValue(overrides), status }}>
          <BrowserRouter>
            <Routes>
              <Route path="/admin/teams" element={<AdminTeams />} />
              <Route path="/login" element={<div>Login Screen</div>} />
            </Routes>
          </BrowserRouter>
        </AuthContext.Provider>
      </QueryClientProvider>,
    )
    return { ...result, queryClient }
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
      expect(screen.getByRole('heading', { name: 'Platform Engineering' })).toBeInTheDocument()
      expect(screen.getByText('Customer Operations')).toBeInTheDocument()
      expect(
        screen.getByText('Manage organizational teams, inspect member rosters, and assign roles.'),
      ).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /\+ Add Member/i })).toBeInTheDocument()
      expect(screen.getByRole('heading', { name: /Team Roster/i })).toBeInTheDocument()
    })
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

      if (url === '/admin/teams' && method === 'GET') {
        return Promise.resolve(jsonResponse({ teams: [team1, team2], nextCursor: null }))
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

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Customer Operations' })).toBeInTheDocument()
      expect(screen.queryByText('Platform Engineering')).not.toBeInTheDocument()
    })
    expect(fetchMock.mock.calls.some((call) => String(call[0]) === '/admin/teams?q=Customer')).toBe(true)
  })

  it('opens and cancels the Create Team modal dialog with proper accessibility', async () => {
    mockTeamsApi()
    await renderAdminTeams()

    const createBtn = await screen.findByRole('button', { name: /\+ Create Team|Create Team/i })
    fireEvent.click(createBtn)

    const dialog = await screen.findByRole('dialog', { name: /Create.*Team/i })
    expect(dialog).toBeInTheDocument()
    expect(dialog).toHaveAttribute('aria-modal', 'true')

    const cancelBtn = within(dialog).getByRole('button', { name: /Cancel/i })
    fireEvent.click(cancelBtn)

    expect(screen.queryByRole('dialog', { name: /Create.*Team/i })).not.toBeInTheDocument()
  })

  it('creates a new team via POST /teams modal and displays it', async () => {
    mockTeamsApi()
    await renderAdminTeams()

    const createBtn = await screen.findByRole('button', { name: /\+ Create Team|Create Team/i })
    fireEvent.click(createBtn)

    const dialog = await screen.findByRole('dialog', { name: /Create.*Team/i })
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

      if (url === '/admin/teams') {
        return Promise.resolve(jsonResponse({ teams: [team1], nextCursor: null }))
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
      expect(screen.getByRole('button', { name: /\+ Add Member/i })).toBeInTheDocument()
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
    await waitFor(() => {
      expect(withinTable.getByText('Marcus Aurelius')).toBeInTheDocument()
      expect(withinTable.getByText('marcus@company.test')).toBeInTheDocument()
      expect(withinTable.getByRole('combobox', { name: 'Role for Marcus Aurelius' })).toHaveValue('lead')
      expect(withinTable.getByText('Zack Taylor')).toBeInTheDocument()
      expect(withinTable.getByText('zack@company.test')).toBeInTheDocument()
      expect(withinTable.getByRole('combobox', { name: 'Role for Zack Taylor' })).toHaveValue('member')
    })
  })
  it('filters roster members client-side via member filter input', async () => {
    mockTeamsApi()
    await renderAdminTeams()

    const membersTable = await screen.findByTestId('team-members-table')
    expect(membersTable).toBeInTheDocument()
    await waitFor(() => {
      expect(within(membersTable).getByText('Marcus Aurelius')).toBeInTheDocument()
      expect(within(membersTable).getByText('Zack Taylor')).toBeInTheDocument()
    })

    const filterInput = screen.getByRole('searchbox', { name: /Filter loaded members/i })
    fireEvent.change(filterInput, { target: { value: 'Zack' } })

    await waitFor(() => {
      expect(within(membersTable).getByText('Zack Taylor')).toBeInTheDocument()
      expect(within(membersTable).queryByText('Marcus Aurelius')).not.toBeInTheDocument()
    })
  })
  it('allows admin to remove a team member and updates the list', async () => {
    let currentMembers = [member1, member2]
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : String(input)
      const method = init?.method?.toUpperCase() ?? 'GET'

      if (url === '/admin/teams' && method === 'GET') {
        return Promise.resolve(jsonResponse({ teams: [team1, team2], nextCursor: null }))
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

      if (url === '/admin/teams' && method === 'GET') {
        return Promise.resolve(jsonResponse({ teams: [team1, team2], nextCursor: null }))
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
  it('appends team and roster pages without duplicates and resets roster cursors on team and search changes', async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://localhost')
      if (url.pathname === '/admin/teams') {
        if (url.searchParams.get('q') === 'Customer') return Promise.resolve(jsonResponse({ teams: [team2], nextCursor: null }))
        return Promise.resolve(jsonResponse(url.searchParams.has('cursor')
          ? { teams: [team1, team2], nextCursor: null }
          : { teams: [team1], nextCursor: 'teams-next' }))
      }
      if (url.pathname === '/admin/teams/1/members') {
        return Promise.resolve(jsonResponse(url.searchParams.has('cursor')
          ? { members: [member1, member2], nextCursor: null }
          : { members: [member1], nextCursor: 'members-next' }))
      }
      if (url.pathname === '/admin/teams/2/members') return Promise.resolve(jsonResponse({ members: [], nextCursor: null }))
      return Promise.resolve(jsonResponse({ users: [], nextCursor: null, userCreationEnabled: true }))
    })
    await renderAdminTeams()
    await screen.findByText('Marcus Aurelius')
    fireEvent.click(screen.getByRole('button', { name: /Load more members/i }))
    await screen.findByText('Zack Taylor')
    expect(screen.getAllByText('Marcus Aurelius')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: /Load more teams/i }))
    fireEvent.click(await screen.findByRole('button', { name: /Customer Operations/i }))
    await screen.findByTestId('empty-members-state')
    expect(screen.queryByText('Zack Taylor')).not.toBeInTheDocument()
    expect(fetchMock.mock.calls.some((call) => String(call[0]) === '/admin/teams?cursor=teams-next')).toBe(true)
    expect(fetchMock.mock.calls.some((call) => String(call[0]) === '/admin/teams/1/members?cursor=members-next')).toBe(true)
    expect(fetchMock.mock.calls.some((call) => String(call[0]).startsWith('/admin/teams/2/members?cursor='))).toBe(false)
    fireEvent.change(screen.getByRole('searchbox', { name: /Search teams/i }), { target: { value: 'Customer' } })
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Customer Operations' })).toBeInTheDocument()
      expect(screen.queryByText('Platform Engineering')).not.toBeInTheDocument()
    })
    expect(fetchMock.mock.calls.some((call) => String(call[0]) === '/admin/teams?q=Customer')).toBe(true)
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes('all=true'))).toBe(false)
  })

  it('changes an existing role through the admin endpoint and reloads the first roster page', async () => {
    let changed = false
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/admin/teams') return Promise.resolve(jsonResponse({ teams: [team1], nextCursor: null }))
      if (url === '/admin/teams/1/members/16' && init?.method === 'PATCH') {
        expect(JSON.parse(init.body as string)).toEqual({ role: 'viewer' })
        changed = true
        return Promise.resolve(jsonResponse({ status: 'ok' }))
      }
      if (url.startsWith('/admin/teams/1/members')) return Promise.resolve(jsonResponse(
        url.includes('cursor=') && !changed
          ? { members: [member2], nextCursor: null }
          : { members: changed ? [member1, { ...member2, role: 'viewer' }] : [member1], nextCursor: changed ? null : 'next' },
      ))
      return Promise.resolve(jsonResponse({ users: [], nextCursor: null, userCreationEnabled: true }))
    })
    await renderAdminTeams()
    await screen.findByText('Marcus Aurelius')
    fireEvent.click(screen.getByRole('button', { name: /Load more members/i }))
    await screen.findByText('Zack Taylor')
    fireEvent.change(screen.getByRole('combobox', { name: /Role for Zack Taylor/i }), { target: { value: 'viewer' } })
    await waitFor(() => expect(screen.getByRole('combobox', { name: /Role for Zack Taylor/i })).toHaveValue('viewer'))
    expect(screen.getByRole('combobox', { name: /Role for Marcus Aurelius/i })).toHaveValue('lead')
    expect(screen.queryByRole('button', { name: /Load more members/i })).not.toBeInTheDocument()
  })

  it.each([
    [422, 'LAST_LEAD', 'Cannot demote the last lead of a team'],
    [403, 'FORBIDDEN', 'Not authorised to change this role'],
    [400, 'VALIDATION_ERROR', 'Invalid membership role'],
  ])('preserves the authoritative role and shows role update errors (%s)', async (status, code, message) => {
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/admin/teams') return Promise.resolve(jsonResponse({ teams: [team1], nextCursor: null }))
      if (init?.method === 'PATCH') return Promise.resolve(jsonResponse({ error: { code, message } }, status))
      if (url === '/admin/teams/1/members') return Promise.resolve(jsonResponse({ members: [member1], nextCursor: null }))
      return Promise.resolve(jsonResponse({ users: [], nextCursor: null, userCreationEnabled: true }))
    })
    await renderAdminTeams()
    const role = await screen.findByRole('combobox', { name: /Role for Marcus Aurelius/i })
    fireEvent.change(role, { target: { value: 'viewer' } })
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(message))
    expect(role).toHaveValue('lead')
    expect(role).not.toBeDisabled()
  })
  it('mutates role on page 2 and reloads the authoritative first page without sending old page cursor', async () => {
    let changed = false
    const cursorCalls: string[] = []
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://localhost')
      if (url.pathname === '/admin/teams') {
        return Promise.resolve(jsonResponse({ teams: [team1], nextCursor: null }))
      }
      if (url.pathname === '/admin/teams/1/members/16' && init?.method === 'PATCH') {
        expect(JSON.parse(init.body as string)).toEqual({ role: 'viewer' })
        changed = true
        return Promise.resolve(jsonResponse({ status: 'ok' }))
      }
      if (url.pathname.startsWith('/admin/teams/1/members')) {
        const cursor = url.searchParams.get('cursor')
        if (cursor) cursorCalls.push(cursor)
        if (!changed) {
          return Promise.resolve(jsonResponse(cursor
            ? { members: [member2], nextCursor: null }
            : { members: [member1], nextCursor: 'page2-cursor' }))
        }
        return Promise.resolve(jsonResponse({
          members: [member1, { ...member2, role: 'viewer' }],
          nextCursor: null,
        }))
      }
      return Promise.resolve(jsonResponse({ users: [], nextCursor: null, userCreationEnabled: true }))
    })

    await renderAdminTeams()
    await screen.findByText('Marcus Aurelius')
    fireEvent.click(screen.getByRole('button', { name: /Load more members/i }))
    await screen.findByText('Zack Taylor')

    cursorCalls.length = 0
    fireEvent.change(screen.getByRole('combobox', { name: /Role for Zack Taylor/i }), { target: { value: 'viewer' } })

    await waitFor(() => {
      expect(screen.getByRole('combobox', { name: /Role for Zack Taylor/i })).toHaveValue('viewer')
    })
    expect(cursorCalls).toHaveLength(0)
  })

  it('removes member on page 2 and reloads the authoritative first page without sending old page cursor', async () => {
    let removed = false
    const cursorCalls: string[] = []
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://localhost')
      if (url.pathname === '/admin/teams') {
        return Promise.resolve(jsonResponse({ teams: [team1], nextCursor: null }))
      }
      if (url.pathname === '/admin/teams/1/members/16' && init?.method === 'DELETE') {
        removed = true
        return Promise.resolve(new Response(null, { status: 204 }))
      }
      if (url.pathname.startsWith('/admin/teams/1/members')) {
        const cursor = url.searchParams.get('cursor')
        if (cursor) cursorCalls.push(cursor)
        if (!removed) {
          return Promise.resolve(jsonResponse(cursor
            ? { members: [member2], nextCursor: null }
            : { members: [member1], nextCursor: 'page2-cursor' }))
        }
        return Promise.resolve(jsonResponse({
          members: [member1],
          nextCursor: null,
        }))
      }
      return Promise.resolve(jsonResponse({ users: [], nextCursor: null, userCreationEnabled: true }))
    })

    await renderAdminTeams()
    await screen.findByText('Marcus Aurelius')
    fireEvent.click(screen.getByRole('button', { name: /Load more members/i }))
    await screen.findByText('Zack Taylor')

    cursorCalls.length = 0
    fireEvent.click(screen.getByLabelText('Remove Zack Taylor from team'))

    await waitFor(() => {
      expect(screen.queryByText('Zack Taylor')).not.toBeInTheDocument()
      expect(screen.getByText('Marcus Aurelius')).toBeInTheDocument()
    })
    expect(cursorCalls).toHaveLength(0)
  })

  it('auto-generates slug across multi-word team name inputs without stopping at spaces', async () => {
    mockTeamsApi()
    await renderAdminTeams()

    const createBtn = await screen.findByRole('button', { name: /\+ Create Team|Create Team/i })
    fireEvent.click(createBtn)
    const dialog = await screen.findByRole('dialog', { name: /Create.*Team/i })
    const nameInput = within(dialog).getByLabelText(/Team Name/i)
    const slugInput = within(dialog).getByLabelText(/Team Slug/i) as HTMLInputElement

    fireEvent.change(nameInput, { target: { value: 'Smoke' } })
    expect(slugInput.value).toBe('smoke')

    fireEvent.change(nameInput, { target: { value: 'Smoke ' } })
    expect(slugInput.value).toBe('smoke')

    fireEvent.change(nameInput, { target: { value: 'Smoke Operations' } })
    expect(slugInput.value).toBe('smoke-operations')
  })

  it('reliably selects newly created team when unique slug is substring of >page-size older slugs', async () => {
    const olderTeams: Team[] = Array.from({ length: 25 }, (_, i) => {
      const num = String(i + 1).padStart(2, '0')
      return {
        id: i + 1,
        name: `Smoke Directory ${num}`,
        slug: `smoke-directory-${num}`,
        createdAt: '2026-10-18T08:00:00.000Z',
        updatedAt: '2026-10-18T08:00:00.000Z',
      }
    })
    const createdTeam: Team = {
      id: 99,
      name: 'Smoke Operations',
      slug: 'smoke-operations',
      createdAt: '2026-10-18T10:00:00.000Z',
      updatedAt: '2026-10-18T10:00:00.000Z',
    }

    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://localhost')
      const method = init?.method?.toUpperCase() ?? 'GET'

      if (url.pathname === '/admin/teams' && method === 'GET') {
        // Substring search for 'smoke' or unfiltered query returns first 10 older teams; created team is absent
        return Promise.resolve(jsonResponse({
          teams: olderTeams.slice(0, 10),
          nextCursor: 'older-teams-page-2',
        }))
      }
      if (url.pathname === '/teams' && method === 'POST') {
        return Promise.resolve(jsonResponse({ team: createdTeam }, 201))
      }
      if (url.pathname === '/admin/teams/99/members') {
        return Promise.resolve(jsonResponse({ members: [], nextCursor: null }))
      }
      if (url.pathname === '/admin/teams/2/members') {
        return Promise.resolve(jsonResponse({ members: [], nextCursor: null }))
      }
      return Promise.resolve(jsonResponse({ members: [], users: [], userCreationEnabled: true }))
    })

    await renderAdminTeams()
    await screen.findByText('Smoke Directory 01')

    const createBtn = await screen.findByRole('button', { name: /\+ Create Team|Create Team/i })
    fireEvent.click(createBtn)
    const dialog = await screen.findByRole('dialog', { name: /Create.*Team/i })
    fireEvent.change(within(dialog).getByLabelText(/Team Name/i), {
      target: { value: 'Smoke Operations' },
    })
    expect((within(dialog).getByLabelText(/Team Slug/i) as HTMLInputElement).value).toBe('smoke-operations')
    fireEvent.click(within(dialog).getByRole('button', { name: /^Create Team$/i }))

    // Pinned selection retains created team even though absent from first server page
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Smoke Operations' })).toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: /Smoke Operations/i })).toBeInTheDocument()

    // Selecting an older team unpins selection and selects the clicked team
    fireEvent.click(screen.getByRole('button', { name: /Smoke Directory 02/i }))
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Smoke Directory 02' })).toBeInTheDocument()
    })
  })

  it('preserves visible 20 roster and retains pagination when adding a member beyond first page where first page response is unchanged', async () => {
    const initial20Members: AdminTeamMember[] = Array.from({ length: 20 }, (_, i) => {
      const num = String(i + 1).padStart(2, '0')
      return {
        id: 100 + i + 1,
        userId: 200 + i + 1,
        teamId: 1,
        role: 'member',
        createdAt: `2026-10-18T08:${num}:00.000Z`,
        user: {
          id: 200 + i + 1,
          email: `member${num}@company.test`,
          displayName: `Member ${num}`,
        },
      }
    })
    const page2Member: AdminTeamMember = {
      id: 121,
      userId: 221,
      teamId: 1,
      role: 'member',
      createdAt: '2026-10-18T09:00:00.000Z',
      user: {
        id: 221,
        email: 'member21@company.test',
        displayName: 'Member 21',
      },
    }

    let added = false

    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://localhost')
      const method = init?.method?.toUpperCase() ?? 'GET'

      if (url.pathname === '/admin/teams' && method === 'GET') {
        return Promise.resolve(jsonResponse({ teams: [team1], nextCursor: null }))
      }

      if (url.pathname === '/teams/1/members' && method === 'POST') {
        added = true
        return Promise.resolve(jsonResponse({ status: 'created' }, 201))
      }

      if (url.pathname.startsWith('/admin/teams/1/members') && method === 'GET') {
        const cursor = url.searchParams.get('cursor')
        if (cursor === 'roster-page-2') {
          return Promise.resolve(
            jsonResponse({
              members: added
                ? [
                    page2Member,
                    {
                      id: 122,
                      userId: candidateUser1.id,
                      teamId: 1,
                      role: 'member',
                      createdAt: '2026-10-18T09:30:00.000Z',
                      user: candidateUser1,
                    },
                  ]
                : [page2Member],
              nextCursor: null,
            }),
          )
        }
        // First page: returns identical 20 members before and after mutation because new member is on page 2
        return Promise.resolve(
          jsonResponse({
            members: initial20Members,
            nextCursor: 'roster-page-2',
          }),
        )
      }

      if (url.pathname.startsWith('/admin/users') && method === 'GET') {
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

    await renderAdminTeams()
    await screen.findByText('Member 01')
    expect(screen.getByText('Member 20')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Load more members/i })).toBeInTheDocument()

    // Open add member dialog
    fireEvent.click(screen.getByRole('button', { name: /\+ Add Member/i }))
    const dialog = screen.getByRole('dialog', { name: /Add.*Member/i })
    await waitFor(() => {
      expect(within(dialog).getByText('Marcus Aurelius')).toBeInTheDocument()
    })

    const candidateRadio = within(dialog).getByLabelText(/Select user Marcus Aurelius/i)
    fireEvent.click(candidateRadio)
    expect(candidateRadio).toBeChecked()

    const addBtn = within(dialog).getByRole('button', {
      name: /Add Marcus Aurelius to Platform Engineering/i,
    })
    fireEvent.click(addBtn)

    await waitFor(() => {
      expect(screen.getByText(/Added Marcus Aurelius/i)).toBeInTheDocument()
    })

    // After adding member beyond loaded first 20, visible 20 roster must be preserved and not wiped empty
    expect(within(screen.getByTestId('team-members-table')).getByText('Member 01')).toBeInTheDocument()
    expect(within(screen.getByTestId('team-members-table')).getByText('Member 20')).toBeInTheDocument()
    expect(screen.queryByText(/No members found in this team/i)).not.toBeInTheDocument()

    // Pagination still works and includes the new member
    const loadMoreBtn = screen.getByRole('button', { name: /Load more members/i })
    expect(loadMoreBtn).toBeInTheDocument()
    fireEvent.click(loadMoreBtn)

    await waitFor(() => {
      expect(within(screen.getByTestId('team-members-table')).getByText('Member 21')).toBeInTheDocument()
      expect(within(screen.getByTestId('team-members-table')).getByText('Marcus Aurelius')).toBeInTheDocument()
    })
    expect(within(screen.getByTestId('team-members-table')).getByText('Member 01')).toBeInTheDocument()
  })

  it('preserves matching directory results when search input includes whitespace', async () => {
    mockTeamsApi()
    await renderAdminTeams()
    await screen.findByRole('button', { name: /Platform Engineering/i })

    const searchInput = screen.getByLabelText(/Search teams/i)
    fireEvent.change(searchInput, { target: { value: 'Platform' } })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Platform Engineering/i })).toBeInTheDocument()
    })

    // Append trailing space: 'Platform '
    fireEvent.change(searchInput, { target: { value: 'Platform ' } })

    // In unpatched code, comparing raw string clears teams accumulator, while trimmed query key
    // causes TanStack Query to keep identical cached reference, leaving teams accumulator empty
    await waitFor(() => {
      expect(screen.queryByText(/No teams match your search/i)).not.toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: /Platform Engineering/i })).toBeInTheDocument()
  })

  it('updates directory search input synchronously during rapid typing with BrowserRouter without dropping characters', async () => {
    mockTeamsApi()
    renderAdminTeamsWithBrowserRouter()

    await screen.findByRole('button', { name: /Platform Engineering/i })
    const searchInput = screen.getByLabelText(/Search teams/i) as HTMLInputElement

    // Simulate sequential rapid keystrokes as in tab.fill ('Operations' then 'Operations ')
    const sequence = [
      'O',
      'Op',
      'Ope',
      'Oper',
      'Opera',
      'Operat',
      'Operati',
      'Operatio',
      'Operation',
      'Operations',
      'Operations ',
    ]
    for (const text of sequence) {
      fireEvent.change(searchInput, { target: { value: text } })
      expect(searchInput.value).toBe(text)
    }

    // Verify after rapid input and pending transitions resolve, the input remains 'Operations ' (no dropped 'p')
    await waitFor(() => {
      expect(searchInput.value).toBe('Operations ')
      const qParam = new URL(window.location.href).searchParams.get('q')
      expect(qParam).toBe('Operations ')
    })
  })

  it('synchronizes local search input state with URL on browser back and forward navigation', async () => {
    mockTeamsApi()
    renderAdminTeamsWithBrowserRouter('/admin/teams?q=Platform')

    await screen.findByRole('button', { name: /Platform Engineering/i })
    const searchInput = screen.getByLabelText(/Search teams/i) as HTMLInputElement
    expect(searchInput.value).toBe('Platform')

    fireEvent.change(searchInput, { target: { value: 'Customer' } })
    expect(searchInput.value).toBe('Customer')

    await waitFor(() => {
      expect(window.location.search).toContain('q=Customer')
    })

    window.history.pushState(null, '', '/admin/teams?q=Platform')
    window.dispatchEvent(new PopStateEvent('popstate'))

    await waitFor(() => {
      expect(searchInput.value).toBe('Platform')
    })
  })

  it('ensures old async role mutation completion cannot clear or replace selected team B roster or apply team A feedback', async () => {
    let resolvePatch!: (res: Response) => void
    const patchPromise = new Promise<Response>((resolve) => {
      resolvePatch = resolve
    })

    const team2Member: AdminTeamMember = {
      id: 201,
      userId: 50,
      teamId: 2,
      role: 'lead',
      createdAt: '2026-10-18T08:00:00.000Z',
      user: {
        id: 50,
        email: 'ops@company.test',
        displayName: 'Ops Leader',
      },
    }

    let team1Changed = false

    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : String(input)
      const method = init?.method?.toUpperCase() ?? 'GET'

      if (url === '/admin/teams' || url.startsWith('/admin/teams?')) {
        return Promise.resolve(jsonResponse({ teams: [team1, team2], nextCursor: null }))
      }

      if (url === '/admin/teams/1/members/16' && method === 'PATCH') {
        team1Changed = true
        return patchPromise
      }

      if (url.startsWith('/admin/teams/1/members') && method === 'GET') {
        return Promise.resolve(
          jsonResponse({
            members: team1Changed
              ? [member1, { ...member2, role: 'viewer' }]
              : [member1, member2],
            nextCursor: null,
          }),
        )
      }

      if (url.startsWith('/admin/teams/2/members') && method === 'GET') {
        return Promise.resolve(
          jsonResponse({
            members: [team2Member],
            nextCursor: null,
          }),
        )
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

    const testQueryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          gcTime: Infinity,
        },
      },
    })
    const { queryClient } = await renderAdminTeams(undefined, 'authed', {
      queryClient: testQueryClient,
    })

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Platform Engineering' })).toBeInTheDocument()
      expect(screen.getByRole('combobox', { name: /Role for Zack Taylor/i })).toHaveValue('member')
      expect(screen.getByRole('button', { name: /Customer Operations/i })).toBeInTheDocument()
    })

    // Initiate role update on Team A with deferred response
    fireEvent.change(screen.getByRole('combobox', { name: /Role for Zack Taylor/i }), {
      target: { value: 'viewer' },
    })

    // Switch to Team B before Team A's mutation finishes
    fireEvent.click(screen.getByRole('button', { name: /Customer Operations/i }))

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Customer Operations' })).toBeInTheDocument()
      expect(screen.getByRole('combobox', { name: /Role for Ops Leader/i })).toBeInTheDocument()
      expect(screen.queryByRole('combobox', { name: /Role for Zack Taylor/i })).not.toBeInTheDocument()
      expect(screen.queryByText('Zack Taylor')).not.toBeInTheDocument()
    })

    // Resolve deferred mutation response for Team A
    resolvePatch(jsonResponse({ status: 'ok' }))

    await waitFor(() => {
      const cached = queryClient.getQueryData<{ members: AdminTeamMember[] }>(['admin', 'teams', 1, 'members', {}])
      expect(cached?.members.find((member) => member.userId === member2.userId)?.role).toBe('viewer')
    })

    // Assert that Team B heading and member controls remain Team B's, and Team A feedback is not shown
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Customer Operations' })).toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: 'Platform Engineering' })).not.toBeInTheDocument()
      expect(screen.getByRole('combobox', { name: /Role for Ops Leader/i })).toBeInTheDocument()
      expect(screen.queryByRole('combobox', { name: /Role for Zack Taylor/i })).not.toBeInTheDocument()
      expect(screen.queryByText('Zack Taylor')).not.toBeInTheDocument()
      expect(screen.queryByText('Marcus Aurelius')).not.toBeInTheDocument()
      expect(screen.queryByText(/Role for Zack Taylor updated to viewer/i)).not.toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /Platform Engineering/i }))
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Platform Engineering' })).toBeInTheDocument()
      expect(screen.getByRole('combobox', { name: /Role for Zack Taylor/i })).toHaveValue('viewer')
    })
  })

  it('ensures old async member removal completion cannot clear or replace selected team B roster or apply team A feedback', async () => {
    let resolveDelete!: (res: Response) => void
    const deletePromise = new Promise<Response>((resolve) => {
      resolveDelete = resolve
    })

    const team2Member: AdminTeamMember = {
      id: 201,
      userId: 50,
      teamId: 2,
      role: 'lead',
      createdAt: '2026-10-18T08:00:00.000Z',
      user: {
        id: 50,
        email: 'ops@company.test',
        displayName: 'Ops Leader',
      },
    }

    let team1Removed = false

    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : String(input)
      const method = init?.method?.toUpperCase() ?? 'GET'

      if (url === '/admin/teams' || url.startsWith('/admin/teams?')) {
        return Promise.resolve(jsonResponse({ teams: [team1, team2], nextCursor: null }))
      }

      if (url === '/admin/teams/1/members/16' && method === 'DELETE') {
        team1Removed = true
        return deletePromise
      }

      if (url.startsWith('/admin/teams/1/members') && method === 'GET') {
        return Promise.resolve(
          jsonResponse({
            members: team1Removed ? [member1] : [member1, member2],
            nextCursor: null,
          }),
        )
      }

      if (url.startsWith('/admin/teams/2/members') && method === 'GET') {
        return Promise.resolve(
          jsonResponse({
            members: [team2Member],
            nextCursor: null,
          }),
        )
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

    const testQueryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          gcTime: Infinity,
        },
      },
    })
    const { queryClient } = await renderAdminTeams(undefined, 'authed', {
      queryClient: testQueryClient,
    })

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Platform Engineering' })).toBeInTheDocument()
      expect(screen.getByLabelText('Remove Zack Taylor from team')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /Customer Operations/i })).toBeInTheDocument()
    })

    // Initiate member removal on Team A with deferred response
    fireEvent.click(screen.getByLabelText('Remove Zack Taylor from team'))

    // Switch to Team B before Team A's mutation finishes
    fireEvent.click(screen.getByRole('button', { name: /Customer Operations/i }))

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Customer Operations' })).toBeInTheDocument()
      expect(screen.getByRole('combobox', { name: /Role for Ops Leader/i })).toBeInTheDocument()
      expect(screen.queryByLabelText('Remove Zack Taylor from team')).not.toBeInTheDocument()
      expect(screen.queryByText('Zack Taylor')).not.toBeInTheDocument()
    })

    // Resolve deferred removal response for Team A
    resolveDelete(new Response(null, { status: 204 }))

    await waitFor(() => {
      const cached = queryClient.getQueryData<{ members: AdminTeamMember[] }>(['admin', 'teams', 1, 'members', {}])
      expect(cached?.members.map((member) => member.userId)).toEqual([member1.userId])
    })

    // Assert that Team B heading and member controls remain Team B's, and Team A feedback is not shown
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Customer Operations' })).toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: 'Platform Engineering' })).not.toBeInTheDocument()
      expect(screen.getByRole('combobox', { name: /Role for Ops Leader/i })).toBeInTheDocument()
      expect(screen.queryByLabelText('Remove Zack Taylor from team')).not.toBeInTheDocument()
      expect(screen.queryByText('Zack Taylor')).not.toBeInTheDocument()
      expect(screen.queryByText('Marcus Aurelius')).not.toBeInTheDocument()
      expect(screen.queryByText(/Removed Zack Taylor from the team/i)).not.toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /Platform Engineering/i }))
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Platform Engineering' })).toBeInTheDocument()
      expect(screen.getByText('Marcus Aurelius')).toBeInTheDocument()
      expect(screen.queryByLabelText('Remove Zack Taylor from team')).not.toBeInTheDocument()
      expect(screen.queryByText('Zack Taylor')).not.toBeInTheDocument()
    })
  })

  it('drills into a team detail with URL state on single-column layouts and returns via All teams', async () => {
    mockTeamsApi()
    window.resizeTo(390, 844)
    renderAdminTeamsWithBrowserRouter()

    fireEvent.click(await screen.findByRole('button', { name: /Customer Operations/i }))

    await waitFor(() => {
      expect(document.querySelector('.admin-teams-page')?.getAttribute('data-mobile-view')).toBe('detail')
      expect(window.location.search).toContain('team=2')
    })

    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Customer Operations' }))
    })

    fireEvent.click(screen.getByRole('button', { name: /All teams/i }))

    await waitFor(() => {
      expect(document.querySelector('.admin-teams-page')?.getAttribute('data-mobile-view')).toBe('list')
    })
    expect(window.location.search).not.toContain('team=')
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('button', { name: /Customer Operations/i }))
    })
  })

  it('resolves a ?team= deep link straight into the detail view', async () => {
    mockTeamsApi()
    window.resizeTo(390, 844)
    renderAdminTeamsWithBrowserRouter('/admin/teams?team=2')

    await waitFor(() => {
      expect(document.querySelector('.admin-teams-page')?.getAttribute('data-mobile-view')).toBe('detail')
      expect(screen.getByRole('heading', { name: 'Customer Operations' })).toBeInTheDocument()
    })
    expect(window.location.search).toContain('team=2')
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Customer Operations' }))
    })
  })

  it('drops a ?team= id the loaded directory cannot resolve', async () => {
    mockTeamsApi()
    window.resizeTo(390, 844)
    renderAdminTeamsWithBrowserRouter('/admin/teams?team=999')

    await waitFor(() => {
      expect(document.querySelector('.admin-teams-page')?.getAttribute('data-mobile-view')).toBe('list')
    })
    await waitFor(() => {
      expect(window.location.search).not.toContain('team=')
    })
  })
})
