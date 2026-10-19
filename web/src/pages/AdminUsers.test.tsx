import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor, within } from '@testing-library/react'
import { Routes, Route, useSearchParams } from 'react-router-dom'
import { renderWithProviders } from '../test/test-utils'
import { AuthContext, AuthProvider, type AuthContextValue, type User } from '../auth/AuthContext'
import { AppRoutes } from '../App'
import { AdminUsers } from './AdminUsers'
import type { PublicUser, ListAdminUsersResponse } from '../api/types'

function authValue(overrides?: Partial<User>): AuthContextValue {
  return {
    user: {
      id: 1,
      email: 'admin@newtonite.test',
      displayName: 'System Admin',
      isAdmin: true,
      ...overrides,
    },
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

describe('AdminUsers Page', () => {
  const fetchMock = vi.fn()

  const user1: PublicUser = {
    id: 10,
    email: 'alice@company.test',
    displayName: 'Alice Engineer',
    isAdmin: false,
    status: 'active',
    createdAt: '2026-10-18T08:00:00.000Z',
    updatedAt: '2026-10-18T08:00:00.000Z',
  }

  const user2: PublicUser = {
    id: 9,
    email: 'bob@company.test',
    displayName: 'Bob Manager',
    isAdmin: true,
    status: 'disabled',
    createdAt: '2026-10-18T07:00:00.000Z',
    updatedAt: '2026-10-18T07:30:00.000Z',
  }

  const user3: PublicUser = {
    id: 8,
    email: 'charlie@company.test',
    displayName: 'Charlie Designer',
    isAdmin: false,
    status: 'active',
    createdAt: '2026-10-18T06:00:00.000Z',
    updatedAt: '2026-10-18T06:00:00.000Z',
  }

  const adminUserCalls = (): string[] =>
    fetchMock.mock.calls
      .map((call) => String(call[0]))
      .filter((url) => url.startsWith('/admin/users'))

  function mockUsersApi(
    users: PublicUser[] = [user1, user2],
    nextCursor: string | null = null,
    userCreationEnabled = true,
  ) {
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : String(input)
      const method = init?.method?.toUpperCase() ?? 'GET'

      if (url.startsWith('/admin/users') && method === 'GET') {
        const responseData: ListAdminUsersResponse = {
          users,
          nextCursor,
          userCreationEnabled,
        }
        return Promise.resolve(jsonResponse(responseData))
      }

      if (/^\/admin\/users\/\d+$/.test(url) && method === 'PATCH') {
        return Promise.resolve(new Response(null, { status: 204 }))
      }

      if (url === '/admin/users' && method === 'POST') {
        const body = JSON.parse((init?.body as string) || '{}')
        if (body.email === 'duplicate@company.test') {
          return Promise.resolve(jsonResponse({ error: 'EMAIL_TAKEN' }, 409))
        }
        return Promise.resolve(
          jsonResponse(
            {
              user: {
                id: 11,
                email: body.email,
                displayName: body.displayName,
                isAdmin: false,
                status: 'active',
                createdAt: '2026-10-18T10:00:00.000Z',
                updatedAt: '2026-10-18T10:00:00.000Z',
              },
            },
            201,
          ),
        )
      }

      if ((url === '/admin/teams' || url.startsWith('/admin/teams?')) && method === 'GET') {
        const parsedUrl = new URL(url, 'http://localhost')
        const q = parsedUrl.searchParams.get('q')?.toLowerCase() ?? ''
        const allTeams = [
          { id: 1, name: 'Core Ops', slug: 'core-ops' },
          { id: 2, name: 'Platform', slug: 'platform' },
        ]
        const filtered = allTeams.filter(
          (t) => t.name.toLowerCase().includes(q) || t.slug.toLowerCase().includes(q),
        )
        return Promise.resolve(
          jsonResponse({
            teams: filtered,
            nextCursor: null,
          }),
        )
      }

      return Promise.resolve(new Response(JSON.stringify({ error: 'not found' }), { status: 404 }))
    })
  }

  async function renderAdminUsers(
    overrides?: Partial<User>,
    status: AuthContextValue['status'] = 'authed',
  ) {
    return renderWithProviders(
      <AuthContext.Provider value={{ ...authValue(overrides), status }}>
        <Routes>
          <Route path="/admin/users" element={<AdminUsers />} />
          <Route path="/login" element={<div>Login Screen</div>} />
        </Routes>
      </AuthContext.Provider>,
      { route: '/admin/users' },
    )
  }

  beforeEach(() => {
    vi.restoreAllMocks()
    fetchMock.mockReset()
    globalThis.fetch = fetchMock
  })

  it('shows not authorised to a non-admin user and never calls /admin/users', async () => {
    mockUsersApi()
    const { queryClient } = await renderAdminUsers({ isAdmin: false })

    expect(screen.getByText(/not authorised/i)).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /^Users$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(adminUserCalls()).toHaveLength(0)
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0)
  })

  it('redirects an anonymous visitor to /login without calling /admin/users', async () => {
    mockUsersApi()
    await renderAdminUsers(undefined, 'anon')

    expect(screen.getByText('Login Screen')).toBeInTheDocument()
    expect(adminUserCalls()).toHaveLength(0)
  })

  it('renders a table of users with roles, statuses, and action toggles for an admin', async () => {
    mockUsersApi([user1, user2])
    await renderAdminUsers()

    await waitFor(() => {
      expect(screen.getByText('Alice Engineer')).toBeInTheDocument()
    })

    expect(screen.getByText('alice@company.test')).toBeInTheDocument()
    expect(screen.getByText('Bob Manager')).toBeInTheDocument()
    expect(screen.getByText('bob@company.test')).toBeInTheDocument()

    // Status badges
    expect(screen.getByText('active')).toBeInTheDocument()
    expect(screen.getByText('disabled')).toBeInTheDocument()

    // Action buttons
    expect(screen.getByRole('button', { name: /Disable user Alice Engineer/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Enable user Bob Manager/i })).toBeInTheDocument()
  })

  it('filters users by search query parameter and removes nonmatching rows from UI', async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : String(input)
      if (url.includes('q=alice')) {
        return Promise.resolve(
          jsonResponse({
            users: [user1],
            nextCursor: null,
            userCreationEnabled: true,
          }),
        )
      }
      return Promise.resolve(
        jsonResponse({
          users: [user1, user2],
          nextCursor: null,
          userCreationEnabled: true,
        }),
      )
    })

    await renderAdminUsers()

    await waitFor(() => {
      expect(screen.getByText('Alice Engineer')).toBeInTheDocument()
      expect(screen.getByText('Bob Manager')).toBeInTheDocument()
    })

    const searchInput = screen.getByLabelText(/search users/i)
    fireEvent.change(searchInput, { target: { value: 'alice' } })

    await waitFor(() => {
      expect(screen.getByText('Alice Engineer')).toBeInTheDocument()
      expect(screen.queryByText('Bob Manager')).not.toBeInTheDocument()
    })
  })

  it('toggles user status with real 204 PATCH response, refetches, and updates row status and action button', async () => {
    let currentUserStatus: 'active' | 'disabled' = 'active'

    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : String(input)
      const method = init?.method?.toUpperCase() ?? 'GET'

      if (url.startsWith('/admin/users') && method === 'GET') {
        return Promise.resolve(
          jsonResponse({
            users: [{ ...user1, status: currentUserStatus }],
            nextCursor: null,
            userCreationEnabled: true,
          }),
        )
      }

      if (/^\/admin\/users\/\d+$/.test(url) && method === 'PATCH') {
        const body = JSON.parse((init?.body as string) || '{}')
        currentUserStatus = body.status
        // Real PATCH 204 No Content response
        return Promise.resolve(new Response(null, { status: 204 }))
      }

      return Promise.resolve(new Response(JSON.stringify({ error: 'not found' }), { status: 404 }))
    })

    await renderAdminUsers()

    await waitFor(() => {
      expect(screen.getByText('Alice Engineer')).toBeInTheDocument()
    })

    // Initially active with disable button
    expect(screen.getByText('active')).toBeInTheDocument()
    const disableBtn = screen.getByRole('button', { name: /Disable user Alice Engineer/i })
    fireEvent.click(disableBtn)

    expect(screen.getByRole('dialog', { name: /Disable User Account/i })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^Confirm Disable$/i }))

    // After mutation settles: status changes to disabled, button changes to enable, success feedback appears
    await waitFor(() => {
      expect(screen.getByText(/User alice@company.test is now disabled/i)).toBeInTheDocument()
      expect(screen.getByText('disabled')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /Enable user Alice Engineer/i })).toBeInTheDocument()
    })
    expect(screen.queryByRole('button', { name: /Disable user Alice Engineer/i })).not.toBeInTheDocument()
  })

  it('paginates users with keyset nextCursor via Load more users', async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : String(input)
      if (url.includes('cursor=cursor_token_1')) {
        return Promise.resolve(
          jsonResponse({
            users: [user3],
            nextCursor: null,
            userCreationEnabled: true,
          }),
        )
      }
      return Promise.resolve(
        jsonResponse({
          users: [user1],
          nextCursor: 'cursor_token_1',
          userCreationEnabled: true,
        }),
      )
    })

    await renderAdminUsers()

    await waitFor(() => {
      expect(screen.getByText('Alice Engineer')).toBeInTheDocument()
    })

    const loadMoreBtn = screen.getByRole('button', { name: /Load more users/i })
    expect(loadMoreBtn).toBeInTheDocument()

    fireEvent.click(loadMoreBtn)

    await waitFor(() => {
      expect(screen.getByText('Charlie Designer')).toBeInTheDocument()
    })
    // Previous users remain visible (appended, not replaced)
    expect(screen.getByText('Alice Engineer')).toBeInTheDocument()
  })

  it('provisions a new user with optional team and role', async () => {
    mockUsersApi([user1])
    await renderAdminUsers()

    await waitFor(() => {
      expect(screen.getByText('Alice Engineer')).toBeInTheDocument()
    })

    const createToggleBtn = screen.getByRole('button', { name: /Create User/i })
    fireEvent.click(createToggleBtn)

    expect(screen.getByText('Provision New User')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(/Email Address/i), {
      target: { value: 'dan@company.test' },
    })
    fireEvent.change(screen.getByLabelText(/Display Name/i), {
      target: { value: 'Dan Operator' },
    })
    fireEvent.change(screen.getByLabelText(/Initial Password/i), {
      target: { value: 'supersecret123' },
    })

    // Select team via searchable picker
    const selectTeamBtn = await screen.findByRole('button', { name: /Select team Core Ops/i })
    fireEvent.click(selectTeamBtn)

    // Role selector appears when team is selected
    expect(screen.getByLabelText(/Team Role/i)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/Team Role/i), {
      target: { value: 'lead' },
    })
    const submitBtn = screen.getByRole('button', { name: /^Create User$/i })
    fireEvent.click(submitBtn)

    await waitFor(() => {
      expect(screen.getByText(/User dan@company.test created successfully/i)).toBeInTheDocument()
    })

    const postCall = fetchMock.mock.calls.find(
      (c) => String(c[0]) === '/admin/users' && c[1]?.method === 'POST',
    )
    expect(postCall).toBeDefined()
    expect(JSON.parse(postCall?.[1]?.body as string)).toEqual({
      email: 'dan@company.test',
      displayName: 'Dan Operator',
      password: 'supersecret123',
      teamId: 1,
      role: 'lead',
    })
  })

  it('rejects passwords exceeding 72 UTF-8 bytes before making network request', async () => {
    mockUsersApi([user1])
    await renderAdminUsers()

    await waitFor(() => {
      expect(screen.getByText('Alice Engineer')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /Create User/i }))

    fireEvent.change(screen.getByLabelText(/Email Address/i), {
      target: { value: 'longpw@company.test' },
    })
    fireEvent.change(screen.getByLabelText(/Display Name/i), {
      target: { value: 'Long Password User' },
    })
    // 73 ASCII characters = 73 UTF-8 bytes > 72 byte bcrypt limit
    fireEvent.change(screen.getByLabelText(/Initial Password/i), {
      target: { value: 'a'.repeat(73) },
    })

    fireEvent.click(screen.getByRole('button', { name: /^Create User$/i }))

    await waitFor(() => {
      expect(screen.getByText(/Password must not exceed 72 UTF-8 bytes/i)).toBeInTheDocument()
    })

    const postCalls = fetchMock.mock.calls.filter(
      (c) => String(c[0]) === '/admin/users' && c[1]?.method === 'POST',
    )
    expect(postCalls).toHaveLength(0)
  })

  it('displays error message when email is already taken (409 EMAIL_TAKEN)', async () => {
    mockUsersApi([user1])
    await renderAdminUsers()

    await waitFor(() => {
      expect(screen.getByText('Alice Engineer')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /Create User/i }))

    fireEvent.change(screen.getByLabelText(/Email Address/i), {
      target: { value: 'duplicate@company.test' },
    })
    fireEvent.change(screen.getByLabelText(/Display Name/i), {
      target: { value: 'Duplicate User' },
    })
    fireEvent.change(screen.getByLabelText(/Initial Password/i), {
      target: { value: 'supersecret123' },
    })

    fireEvent.click(screen.getByRole('button', { name: /^Create User$/i }))

    await waitFor(() => {
      expect(
        screen.getByText(/A user with this email address already exists/i),
      ).toBeInTheDocument()
    })
  })

  it('displays configuration disabled banner when userCreationEnabled is false', async () => {
    mockUsersApi([user1], null, false)
    await renderAdminUsers()

    await waitFor(() => {
      expect(screen.getByText(/ADMIN_USER_CREATION_ENABLED=false/i)).toBeInTheDocument()
    })

    expect(screen.getByText('User Creation Disabled')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Create User/i })).not.toBeInTheDocument()
  })

  it('shows Users nav link in sidebar for admin but not non-admin', async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : String(input)
      if (url.includes('/auth/refresh')) {
        return Promise.resolve(
          jsonResponse({
            accessToken: 'tok',
            user: { ...authValue().user, isAdmin: true },
          }),
        )
      }
      if (url.includes('/auth/me')) {
        return Promise.resolve(
          jsonResponse({
            user: { ...authValue().user, isAdmin: true },
            memberships: [],
          }),
        )
      }
      if (url.includes('/notifications/summary')) {
        return Promise.resolve(jsonResponse({ unreadCount: 0 }))
      }
      return Promise.resolve(new Response(JSON.stringify({ error: 'not found' }), { status: 404 }))
    })

    const adminRender = renderWithProviders(
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>,
      { route: '/' },
    )

    await waitFor(() => {
      expect(screen.getByRole('link', { name: /^Users$/i })).toBeInTheDocument()
      expect(screen.getByRole('link', { name: /^Teams$/i })).toBeInTheDocument()
    })
    adminRender.unmount()

    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : String(input)
      if (url.includes('/auth/refresh')) {
        return Promise.resolve(
          jsonResponse({
            accessToken: 'tok',
            user: { ...authValue().user, isAdmin: false },
          }),
        )
      }
      if (url.includes('/auth/me')) {
        return Promise.resolve(
          jsonResponse({
            user: { ...authValue().user, isAdmin: false },
            memberships: [],
          }),
        )
      }
      if (url.includes('/notifications/summary')) {
        return Promise.resolve(jsonResponse({ unreadCount: 0 }))
      }
      return Promise.resolve(new Response(JSON.stringify({ error: 'not found' }), { status: 404 }))
    })

    renderWithProviders(
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>,
      { route: '/' },
    )

    await waitFor(() => {
      expect(screen.getByText(/Newtonite Operations/)).toBeInTheDocument()
    })
    expect(screen.queryByRole('link', { name: /^Users$/i })).not.toBeInTheDocument()
  })
  it('provisions a new user without team and verifies no teamId/role in payload', async () => {
    mockUsersApi([user1])
    await renderAdminUsers()

    await screen.findByText('Alice Engineer')
    fireEvent.click(screen.getByRole('button', { name: /Create User/i }))

    fireEvent.change(screen.getByLabelText(/Email Address/i), {
      target: { value: 'noteam@company.test' },
    })
    fireEvent.change(screen.getByLabelText(/Display Name/i), {
      target: { value: 'No Team User' },
    })
    fireEvent.change(screen.getByLabelText(/Initial Password/i), {
      target: { value: 'supersecret123' },
    })

    expect(screen.queryByLabelText(/Team Role/i)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /^Create User$/i }))

    await waitFor(() => {
      expect(screen.getByText(/User noteam@company.test created successfully/i)).toBeInTheDocument()
    })

    const postCall = fetchMock.mock.calls.find(
      (c) => String(c[0]) === '/admin/users' && c[1]?.method === 'POST',
    )
    expect(postCall).toBeDefined()
    const body = JSON.parse(postCall?.[1]?.body as string)
    expect(body).toEqual({
      email: 'noteam@company.test',
      displayName: 'No Team User',
      password: 'supersecret123',
    })
    expect(body.teamId).toBeUndefined()
    expect(body.role).toBeUndefined()
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('all=true'))).toBe(false)
  })

  it('searches and paginates teams in the initial-team picker and allows clearing selection', async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://localhost')
      const method = init?.method?.toUpperCase() ?? 'GET'

      if (url.pathname.startsWith('/admin/users') && method === 'GET') {
        return Promise.resolve(jsonResponse({ users: [user1], nextCursor: null, userCreationEnabled: true }))
      }
      if (url.pathname === '/admin/teams' && method === 'GET') {
        const q = url.searchParams.get('q')
        if (q === 'search-term') {
          return Promise.resolve(jsonResponse({
            teams: [{ id: 3, name: 'Search Team', slug: 'search-team' }],
            nextCursor: null,
          }))
        }
        if (url.searchParams.get('cursor') === 'cursor-1') {
          return Promise.resolve(jsonResponse({
            teams: [
              { id: 1, name: 'Core Ops', slug: 'core-ops' },
              { id: 2, name: 'Platform', slug: 'platform' },
            ],
            nextCursor: null,
          }))
        }
        return Promise.resolve(jsonResponse({
          teams: [{ id: 1, name: 'Core Ops', slug: 'core-ops' }],
          nextCursor: 'cursor-1',
        }))
      }
      return Promise.resolve(jsonResponse({}))
    })

    await renderAdminUsers()
    await screen.findByText('Alice Engineer')
    fireEvent.click(screen.getByRole('button', { name: /Create User/i }))

    await screen.findByText('Core Ops')
    expect(screen.queryByText('Platform')).not.toBeInTheDocument()

    // Load more teams
    fireEvent.click(screen.getByRole('button', { name: /Load more teams/i }))
    await screen.findByText('Platform')
    expect(screen.getAllByText(/Core Ops/)).toHaveLength(1)

    // Search teams
    fireEvent.change(screen.getByRole('searchbox', { name: /Search initial team/i }), {
      target: { value: 'search-term' },
    })
    await screen.findByText('Search Team')
    expect(screen.queryByText('Platform')).not.toBeInTheDocument()

    // Select team
    fireEvent.click(screen.getByRole('button', { name: /Select team Search Team/i }))
    expect(screen.getByText('Selected:')).toBeInTheDocument()
    expect(screen.getByLabelText(/Team Role/i)).toBeInTheDocument()

    // Clear selected team
    fireEvent.click(screen.getByRole('button', { name: /Clear selected team/i }))
    expect(screen.queryByLabelText(/Team Role/i)).not.toBeInTheDocument()
    expect(screen.getByRole('searchbox', { name: /Search initial team/i })).toBeInTheDocument()
  })

  it('restores authoritative cached page1 teams when initial-team picker is cancelled and reopened without needing search', async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://localhost')
      const method = init?.method?.toUpperCase() ?? 'GET'

      if (url.pathname.startsWith('/admin/users') && method === 'GET') {
        return Promise.resolve(jsonResponse({ users: [user1], nextCursor: null, userCreationEnabled: true }))
      }
      if (url.pathname === '/admin/teams' && method === 'GET') {
        return Promise.resolve(
          jsonResponse({
            teams: [
              { id: 1, name: 'Core Ops', slug: 'core-ops' },
              { id: 2, name: 'Platform', slug: 'platform' },
            ],
            nextCursor: null,
          }),
        )
      }
      return Promise.resolve(jsonResponse({}))
    })

    await renderAdminUsers()
    await screen.findByText('Alice Engineer')

    // Open create user form
    fireEvent.click(screen.getByRole('button', { name: /Create User/i }))
    await screen.findByText('Core Ops')
    expect(screen.getByText('Platform')).toBeInTheDocument()

    // Cancel create user form
    const formEl = screen.getByRole('button', { name: /^Create User$/i }).closest('form')!
    fireEvent.click(within(formEl).getByRole('button', { name: /^Cancel$/i }))
    await waitFor(() => {
      expect(screen.queryByText('Provision New User')).not.toBeInTheDocument()
    })

    // Reopen create user form
    fireEvent.click(screen.getByRole('button', { name: /Create User/i }))
    await screen.findByText('Provision New User')

    // Results must be restored from cache without needing to search
    expect(screen.getByText('Core Ops')).toBeInTheDocument()
    expect(screen.getByText('Platform')).toBeInTheDocument()
    expect(screen.queryByText('No teams found.')).not.toBeInTheDocument()
  })

  it('restores authoritative cached page1 teams when picker is cancelled after continuation or search', async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://localhost')
      const method = init?.method?.toUpperCase() ?? 'GET'

      if (url.pathname.startsWith('/admin/users') && method === 'GET') {
        return Promise.resolve(jsonResponse({ users: [user1], nextCursor: null, userCreationEnabled: true }))
      }
      if (url.pathname === '/admin/teams' && method === 'GET') {
        const q = url.searchParams.get('q')
        if (q === 'search-team') {
          return Promise.resolve(
            jsonResponse({
              teams: [{ id: 3, name: 'Search Team', slug: 'search-team' }],
              nextCursor: null,
            }),
          )
        }
        if (url.searchParams.get('cursor') === 'cursor-1') {
          return Promise.resolve(
            jsonResponse({
              teams: [{ id: 2, name: 'Platform', slug: 'platform' }],
              nextCursor: null,
            }),
          )
        }
        return Promise.resolve(
          jsonResponse({
            teams: [{ id: 1, name: 'Core Ops', slug: 'core-ops' }],
            nextCursor: 'cursor-1',
          }),
        )
      }
      return Promise.resolve(jsonResponse({}))
    })

    await renderAdminUsers()
    await screen.findByText('Alice Engineer')

    // 1. Continuation then Cancel
    fireEvent.click(screen.getByRole('button', { name: /Create User/i }))
    await screen.findByText('Core Ops')

    // Paginate to load page 2
    fireEvent.click(screen.getByRole('button', { name: /Load more teams/i }))
    await screen.findByText('Platform')

    // Cancel
    const formEl1 = screen.getByRole('button', { name: /^Create User$/i }).closest('form')!
    fireEvent.click(within(formEl1).getByRole('button', { name: /^Cancel$/i }))
    await waitFor(() => {
      expect(screen.queryByText('Provision New User')).not.toBeInTheDocument()
    })
    // Reopen: authoritative cached page1 must be restored, continuation reset
    fireEvent.click(screen.getByRole('button', { name: /Create User/i }))
    await screen.findByText('Provision New User')
    expect(screen.getByText('Core Ops')).toBeInTheDocument()
    expect(screen.queryByText('Platform')).not.toBeInTheDocument()
    expect(screen.queryByText('No teams found.')).not.toBeInTheDocument()

    // 2. Search then Cancel
    fireEvent.change(screen.getByRole('searchbox', { name: /Search initial team/i }), {
      target: { value: 'search-team' },
    })
    await screen.findByText('Search Team')
    expect(screen.queryByText('Core Ops')).not.toBeInTheDocument()

    // Cancel
    const formEl2 = screen.getByRole('button', { name: /^Create User$/i }).closest('form')!
    fireEvent.click(within(formEl2).getByRole('button', { name: /^Cancel$/i }))
    await waitFor(() => {
      expect(screen.queryByText('Provision New User')).not.toBeInTheDocument()
    })

    // Reopen: authoritative cached page1 must be restored, search reset
    fireEvent.click(screen.getByRole('button', { name: /Create User/i }))
    await screen.findByText('Provision New User')
    expect(screen.getByText('Core Ops')).toBeInTheDocument()
    expect(screen.queryByText('Search Team')).not.toBeInTheDocument()
    expect(screen.queryByText('No teams found.')).not.toBeInTheDocument()
  })

  it('preserves team picker matching results when typing leading and trailing search whitespace', async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://localhost')
      const method = init?.method?.toUpperCase() ?? 'GET'

       if (url.pathname.startsWith('/admin/users') && method === 'GET') {
        return Promise.resolve(jsonResponse({ users: [user1], nextCursor: null, userCreationEnabled: true }))
      }
      if (url.pathname === '/admin/teams' && method === 'GET') {
        const q = url.searchParams.get('q')?.toLowerCase() ?? ''
        const allTeams = [
          { id: 1, name: 'Core Ops', slug: 'core-ops' },
          { id: 2, name: 'Platform', slug: 'platform' },
        ]
        const filtered = allTeams.filter(
          (t) => t.name.toLowerCase().includes(q) || t.slug.toLowerCase().includes(q),
        )
        return Promise.resolve(
          jsonResponse({
            teams: filtered,
            nextCursor: null,
          }),
        )
      }
      return Promise.resolve(jsonResponse({}))
    })

    await renderAdminUsers()
    await screen.findByText('Alice Engineer')
    fireEvent.click(screen.getByRole('button', { name: /Create User/i }))
    await screen.findByText('Core Ops')

    const searchBox = screen.getByRole('searchbox', { name: /Search initial team/i })

    // Type query matching Core Ops
    fireEvent.change(searchBox, { target: { value: 'Core' } })
    await screen.findByText('Core Ops')
    expect(screen.queryByText('Platform')).not.toBeInTheDocument()

    // Add trailing whitespace
    fireEvent.change(searchBox, { target: { value: 'Core ' } })
    // The raw input preserves the whitespace
    expect(searchBox).toHaveValue('Core ')
    // Results must NOT be cleared to empty
    expect(screen.getByText('Core Ops')).toBeInTheDocument()
    expect(screen.queryByText('No teams found.')).not.toBeInTheDocument()

    // Add leading whitespace
    fireEvent.change(searchBox, { target: { value: '  Core ' } })
    expect(searchBox).toHaveValue('  Core ')
    expect(screen.getByText('Core Ops')).toBeInTheDocument()
    expect(screen.queryByText('No teams found.')).not.toBeInTheDocument()
  })

  it('synchronously updates search users input state and normalizes whitespace in search query', async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : String(input)
      if (url.includes('q=alice')) {
        return Promise.resolve(
          jsonResponse({
            users: [user1],
            nextCursor: null,
            userCreationEnabled: true,
          }),
        )
      }
      return Promise.resolve(
        jsonResponse({
          users: [user1, user2],
          nextCursor: null,
          userCreationEnabled: true,
        }),
      )
    })

    await renderAdminUsers()
    await waitFor(() => {
      expect(screen.getByText('Alice Engineer')).toBeInTheDocument()
      expect(screen.getByText('Bob Manager')).toBeInTheDocument()
    })

    const searchInput = screen.getByLabelText(/search users/i)

    // Synchronous local state update with trailing whitespace
    fireEvent.change(searchInput, { target: { value: 'alice ' } })
    expect(searchInput).toHaveValue('alice ')

    await waitFor(() => {
      expect(screen.getByText('Alice Engineer')).toBeInTheDocument()
      expect(screen.queryByText('Bob Manager')).not.toBeInTheDocument()
    })
  })

  it('retains complete search text during rapid sequential keystrokes through pending router transitions without dropping trailing characters', async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : String(input)
      if (url.includes('q=Alice+p') || url.includes('q=Alice%20p') || url.includes('q=Alice p')) {
        return Promise.resolve(
          jsonResponse({
            users: [user1],
            nextCursor: null,
            userCreationEnabled: true,
          }),
        )
      }
      return Promise.resolve(
        jsonResponse({
          users: [user1, user2],
          nextCursor: null,
          userCreationEnabled: true,
        }),
      )
    })

    await renderAdminUsers()
    await waitFor(() => {
      expect(screen.getByText('Alice Engineer')).toBeInTheDocument()
    })

    const searchInput = screen.getByLabelText(/search users/i) as HTMLInputElement

    // Rapid sequential keystrokes simulating real typing: "Alice" -> "Alice " -> "Alice p"
    const sequence = ['Alice', 'Alice ', 'Alice p']
    for (const val of sequence) {
      fireEvent.change(searchInput, { target: { value: val } })
    }

    // Must synchronously hold the newest value and not be overwritten by intermediate router transition for "Alice"
    expect(searchInput.value).toBe('Alice p')

    await waitFor(() => {
      expect(searchInput.value).toBe('Alice p')
    })
  })

  it('synchronizes search users input on external navigation and URL search params change', async () => {
    mockUsersApi([user1, user2])

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
          <button
            data-testid="external-clear-btn"
            onClick={() => {
              const next = new URLSearchParams(searchParams)
              next.delete('q')
              setSearchParams(next)
            }}
          >
            External Clear
          </button>
          <AdminUsers />
        </div>
      )
    }

    renderWithProviders(
      <AuthContext.Provider value={authValue()}>
        <Routes>
          <Route path="/admin/users" element={<NavigationHarness />} />
        </Routes>
      </AuthContext.Provider>,
      { route: '/admin/users' },
    )

    await waitFor(() => {
      expect(screen.getByText('Alice Engineer')).toBeInTheDocument()
    })

    const searchInput = screen.getByLabelText(/search users/i) as HTMLInputElement

    // External navigation setting q=external_update
    fireEvent.click(screen.getByTestId('external-nav-btn'))
    await waitFor(() => {
      expect(searchInput.value).toBe('external_update')
    })

    // External navigation clearing q
    fireEvent.click(screen.getByTestId('external-clear-btn'))
    await waitFor(() => {
      expect(searchInput.value).toBe('')
    })
  })

  it('canceling disable confirmation leaves user active without calling PATCH', async () => {
    mockUsersApi([user1, user2])
    await renderAdminUsers()

    await waitFor(() => {
      expect(screen.getByText('Alice Engineer')).toBeInTheDocument()
    })

    const disableBtn = screen.getByRole('button', { name: /Disable user Alice Engineer/i })
    fireEvent.click(disableBtn)

    // Assert dialog appears
    const dialog = screen.getByRole('dialog', { name: /Disable User Account/i })
    expect(dialog).toBeInTheDocument()
    expect(within(dialog).getByText(/Are you sure you want to disable/i)).toBeInTheDocument()

    // Cancel disablement
    const cancelBtn = within(dialog).getByRole('button', { name: /Cancel/i })
    fireEvent.click(cancelBtn)

    // Dialog closes and user remains active
    expect(screen.queryByRole('dialog', { name: /Disable User Account/i })).not.toBeInTheDocument()
    expect(screen.getByText('active')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Disable user Alice Engineer/i })).toBeInTheDocument()

    // No PATCH request was made
    const patchCalls = fetchMock.mock.calls.filter((c) => c[1]?.method === 'PATCH')
    expect(patchCalls).toHaveLength(0)
  })

  it('filters users by quick status and role tabs', async () => {
    mockUsersApi([user1, user2, user3])
    await renderAdminUsers()

    await waitFor(() => {
      expect(screen.getByText('Alice Engineer')).toBeInTheDocument()
      expect(screen.getByText('Bob Manager')).toBeInTheDocument()
      expect(screen.getByText('Charlie Designer')).toBeInTheDocument()
    })

    // Filter by Disabled: only Bob Manager (disabled)
    const disabledTab = screen.getByTestId('filter-tab-disabled')
    fireEvent.click(disabledTab)

    expect(screen.getByText('Bob Manager')).toBeInTheDocument()
    expect(screen.queryByText('Alice Engineer')).not.toBeInTheDocument()
    expect(screen.queryByText('Charlie Designer')).not.toBeInTheDocument()

    // Filter by Admins: only Bob Manager (isAdmin)
    const adminTab = screen.getByTestId('filter-tab-admin')
    fireEvent.click(adminTab)

    expect(screen.getByText('Bob Manager')).toBeInTheDocument()
    expect(screen.queryByText('Alice Engineer')).not.toBeInTheDocument()
    expect(screen.queryByText('Charlie Designer')).not.toBeInTheDocument()

    // Filter by Active: Alice Engineer and Charlie Designer
    const activeTab = screen.getByTestId('filter-tab-active')
    fireEvent.click(activeTab)

    expect(screen.getByText('Alice Engineer')).toBeInTheDocument()
    expect(screen.getByText('Charlie Designer')).toBeInTheDocument()
    expect(screen.queryByText('Bob Manager')).not.toBeInTheDocument()

    // Reset to All: all users visible
    const allTab = screen.getByTestId('filter-tab-all')
    fireEvent.click(allTab)

    expect(screen.getByText('Alice Engineer')).toBeInTheDocument()
    expect(screen.getByText('Bob Manager')).toBeInTheDocument()
    expect(screen.getByText('Charlie Designer')).toBeInTheDocument()
  })

  it('clearing search input with clear button resets query', async () => {
    mockUsersApi([user1, user2])
    await renderAdminUsers()

    await waitFor(() => {
      expect(screen.getByText('Alice Engineer')).toBeInTheDocument()
    })

    const searchInput = screen.getByLabelText(/search users/i)
    fireEvent.change(searchInput, { target: { value: 'alice' } })
    expect(searchInput).toHaveValue('alice')

    // Clear button is rendered
    const clearBtn = screen.getByRole('button', { name: /Clear search/i })
    expect(clearBtn).toBeInTheDocument()

    // Click clear button
    fireEvent.click(clearBtn)

    expect(searchInput).toHaveValue('')
    expect(screen.queryByRole('button', { name: /Clear search/i })).not.toBeInTheDocument()
  })

  it('renders responsive count badge and table without clipping actions', async () => {
    mockUsersApi([user1, user2])
    await renderAdminUsers()

    await waitFor(() => {
      expect(screen.getByText('Alice Engineer')).toBeInTheDocument()
    })

    // User count badge renders count matching loaded users
    const badge = screen.getByTestId('user-count-badge')
    expect(badge).toBeInTheDocument()
    expect(badge).toHaveTextContent('2 users')

    // Action buttons are present for each user row
    expect(screen.getByRole('button', { name: /Disable user Alice Engineer/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Enable user Bob Manager/i })).toBeInTheDocument()
  })

  it('displays scoped empty state when a filter tab has no matching users and resets via show all', async () => {
    mockUsersApi([user1])
    await renderAdminUsers()

    await waitFor(() => {
      expect(screen.getByText('Alice Engineer')).toBeInTheDocument()
    })

    // Filter by disabled -> 0 matching users
    fireEvent.click(screen.getByTestId('filter-tab-disabled'))

    expect(screen.getByTestId('scoped-empty-users-state')).toBeInTheDocument()
    expect(screen.getByText(/No disabled users match your search/i)).toBeInTheDocument()
    expect(screen.queryByText('Alice Engineer')).not.toBeInTheDocument()

    // Click "Show all users" button
    fireEvent.click(screen.getByRole('button', { name: /Show all users/i }))

    expect(screen.queryByTestId('scoped-empty-users-state')).not.toBeInTheDocument()
    expect(screen.getByText('Alice Engineer')).toBeInTheDocument()
  })

  it('closes disable confirmation dialog when Escape key is pressed', async () => {
    mockUsersApi([user1, user2])
    await renderAdminUsers()

    await waitFor(() => {
      expect(screen.getByText('Alice Engineer')).toBeInTheDocument()
    })

    const disableBtn = screen.getByRole('button', { name: /Disable user Alice Engineer/i })
    fireEvent.click(disableBtn)

    expect(screen.getByRole('dialog', { name: /Disable User Account/i })).toBeInTheDocument()

    // Press Escape key
    fireEvent.keyDown(window, { key: 'Escape' })

    expect(screen.queryByRole('dialog', { name: /Disable User Account/i })).not.toBeInTheDocument()
    expect(screen.getByText('active')).toBeInTheDocument()
  })

  it('opens create user modal dialog with role="dialog" and aria-modal="true"', async () => {
    mockUsersApi([user1])
    await renderAdminUsers()

    await waitFor(() => {
      expect(screen.getByText('Alice Engineer')).toBeInTheDocument()
    })

    const triggerBtn = screen.getByRole('button', { name: /Create User/i })
    fireEvent.click(triggerBtn)

    const dialog = screen.getByRole('dialog', { name: /Provision New User/i })
    expect(dialog).toBeInTheDocument()
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAttribute('aria-describedby', 'create-user-modal-description')

    await waitFor(() => {
      expect(screen.getByLabelText(/Email Address/i)).toHaveFocus()
    })
  })

  it('closes create user modal on Escape key press', async () => {
    mockUsersApi([user1])
    await renderAdminUsers()

    await waitFor(() => {
      expect(screen.getByText('Alice Engineer')).toBeInTheDocument()
    })

    const triggerBtn = screen.getByRole('button', { name: /Create User/i })
    fireEvent.click(triggerBtn)

    expect(screen.getByRole('dialog', { name: /Provision New User/i })).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'Escape' })

    expect(screen.queryByRole('dialog', { name: /Provision New User/i })).not.toBeInTheDocument()
    expect(triggerBtn).toHaveFocus()
  })

  it('closes create user modal when clicking close X button', async () => {
    mockUsersApi([user1])
    await renderAdminUsers()

    await waitFor(() => {
      expect(screen.getByText('Alice Engineer')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /Create User/i }))

    const dialog = screen.getByRole('dialog', { name: /Provision New User/i })
    const closeBtn = within(dialog).getByRole('button', { name: /Close dialog/i })
    fireEvent.click(closeBtn)

    expect(screen.queryByRole('dialog', { name: /Provision New User/i })).not.toBeInTheDocument()
  })

  it('closes create user modal when clicking backdrop overlay', async () => {
    mockUsersApi([user1])
    await renderAdminUsers()

    await waitFor(() => {
      expect(screen.getByText('Alice Engineer')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /Create User/i }))

    const backdrop = screen.getByRole('presentation')
    fireEvent.click(backdrop)

    expect(screen.queryByRole('dialog', { name: /Provision New User/i })).not.toBeInTheDocument()
  })

  it('traps Tab focus inside the create user modal dialog', async () => {
    mockUsersApi([user1])
    await renderAdminUsers()

    await waitFor(() => {
      expect(screen.getByText('Alice Engineer')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /Create User/i }))

    const dialog = screen.getByRole('dialog', { name: /Provision New User/i })
    const closeBtn = within(dialog).getByRole('button', { name: /Close dialog/i })
    const submitBtn = within(dialog).getByRole('button', { name: /^Create User$/i })

    // Tab forward from last focusable wraps to first focusable (close button)
    submitBtn.focus()
    expect(document.activeElement).toBe(submitBtn)
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: false })
    expect(document.activeElement).toBe(closeBtn)

    // Shift+Tab backward from first focusable wraps to last focusable (Create User button)
    closeBtn.focus()
    expect(document.activeElement).toBe(closeBtn)
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(submitBtn)
  })
})
