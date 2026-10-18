import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { Routes, Route } from 'react-router-dom'
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

      if (url === '/teams' || url.startsWith('/teams?')) {
        return Promise.resolve(
          jsonResponse({
            teams: [
              { id: 1, name: 'Core Ops', slug: 'core-ops' },
              { id: 2, name: 'Platform', slug: 'platform' },
            ],
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

    // Select team
    fireEvent.change(screen.getByLabelText(/Initial Team/i), {
      target: { value: '1' },
    })

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
})
