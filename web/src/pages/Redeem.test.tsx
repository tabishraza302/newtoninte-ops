import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { renderWithProviders } from '../test/test-utils'
import { AuthProvider } from '../auth/AuthContext'
import { Redeem } from './Redeem'

const mockUser = {
  id: 42,
  email: 'redeemer@newtonite.test',
  displayName: 'Redeemed User',
  isAdmin: false,
}

const mockNestedMeResponse = {
  user: mockUser,
  memberships: [{ teamId: 1, role: 'member' as const }],
}

describe('Redeem Page', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('handles unauthenticated redemption, unpacking nested me.user and navigating to root', async () => {
    let redeemPayload: unknown = null
    globalThis.fetch = vi.fn().mockImplementation((url: string | URL | Request, init?: RequestInit) => {
      const urlStr = typeof url === 'string' ? url : url.toString()

      if (urlStr.includes('/auth/refresh')) {
        return Promise.resolve(new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 }))
      }

      if (urlStr.includes('/invitations/redeem') && init?.method === 'POST') {
        if (init?.body) {
          redeemPayload = JSON.parse(init.body as string)
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({
              accessToken: 'mock-access-token',
              user: mockUser,
              teamId: 1,
              role: 'member',
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        )
      }

      if (urlStr.includes('/auth/me')) {
        return Promise.resolve(
          new Response(JSON.stringify(mockNestedMeResponse), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }

      return Promise.resolve(new Response('not found', { status: 404 }))
    })

    renderWithProviders(
      <AuthProvider>
        <Redeem />
      </AuthProvider>,
      { route: '/redeem?code=INVITE-ABC-123' },
    )

    expect(screen.getByLabelText(/Invitation Code/i)).toHaveValue('INVITE-ABC-123')
    fireEvent.change(screen.getByLabelText(/Work Email/i), {
      target: { value: 'redeemer@newtonite.test' },
    })
    fireEvent.change(screen.getByLabelText(/Display Name/i), {
      target: { value: 'Redeemed User' },
    })
    fireEvent.change(screen.getByLabelText(/Password/i), {
      target: { value: 'SecurePass123!' },
    })

    fireEvent.click(screen.getByRole('button', { name: /Redeem Invitation/i }))

    await waitFor(() => {
      expect(redeemPayload).toEqual({
        code: 'INVITE-ABC-123',
        email: 'redeemer@newtonite.test',
        displayName: 'Redeemed User',
        password: 'SecurePass123!',
      })
    })
  })

  it('rejects passwords exceeding 72 UTF-8 bytes', async () => {
    globalThis.fetch = vi.fn().mockImplementation((url: string | URL | Request) => {
      const urlStr = typeof url === 'string' ? url : url.toString()
      if (urlStr.includes('/auth/refresh')) {
        return Promise.resolve(new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 }))
      }
      return Promise.resolve(new Response('not found', { status: 404 }))
    })

    renderWithProviders(
      <AuthProvider>
        <Redeem />
      </AuthProvider>,
    )

    fireEvent.change(screen.getByLabelText(/Invitation Code/i), { target: { value: 'CODE-123' } })
    fireEvent.change(screen.getByLabelText(/Work Email/i), { target: { value: 'user@test.local' } })
    fireEvent.change(screen.getByLabelText(/Display Name/i), { target: { value: 'Test User' } })
    // 73 ASCII characters = 73 bytes
    fireEvent.change(screen.getByLabelText(/Password/i), {
      target: { value: 'a'.repeat(73) },
    })

    fireEvent.click(screen.getByRole('button', { name: /Redeem Invitation/i }))

    expect(screen.getByRole('alert')).toHaveTextContent(/not exceed 72 bytes/i)
  })

  it('handles authenticated redemption with single click joining team', async () => {
    let authRedeemPayload: unknown = null
    globalThis.fetch = vi.fn().mockImplementation((url: string | URL | Request, init?: RequestInit) => {
      const urlStr = typeof url === 'string' ? url : url.toString()

      if (urlStr.includes('/auth/refresh')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              accessToken: 'mock-initial-token',
              user: mockUser,
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        )
      }

      if (urlStr.includes('/invitations/redeem') && init?.method === 'POST') {
        if (init?.body) {
          authRedeemPayload = JSON.parse(init.body as string)
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({
              accessToken: 'mock-updated-token',
              user: mockUser,
              teamId: 2,
              role: 'member',
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
              memberships: [
                { teamId: 1, role: 'member' },
                { teamId: 2, role: 'member' },
              ],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        )
      }

      return Promise.resolve(new Response('not found', { status: 404 }))
    })

    renderWithProviders(
      <AuthProvider>
        <Redeem />
      </AuthProvider>,
      { route: '/redeem?code=TEAM2-INVITE' },
    )

    await waitFor(() => {
      expect(screen.getByText(/Signed in as/i)).toBeInTheDocument()
    })

    expect(screen.getByText(/Redeemed User/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Join Team with Current Account/i })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Join Team with Current Account/i }))

    await waitFor(() => {
      expect(authRedeemPayload).toEqual({
        code: 'TEAM2-INVITE',
      })
    })
  })
})
