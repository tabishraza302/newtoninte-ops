import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { renderWithProviders } from '../test/test-utils'
import { ForgotPassword } from './ForgotPassword'

describe('ForgotPassword Page', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('renders request form with email input and login link', () => {
    renderWithProviders(<ForgotPassword />)

    expect(screen.getByRole('heading', { name: /Reset Password/i })).toBeInTheDocument()
    expect(screen.getByLabelText(/Email address/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Send Reset Link/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Back to Log In/i })).toHaveAttribute('href', '/login')
  })

  it('submits email and displays confirmation message on success', async () => {
    let requestedBody: unknown = null
    globalThis.fetch = vi.fn().mockImplementation((url: string | URL | Request, init?: RequestInit) => {
      const urlStr = typeof url === 'string' ? url : url.toString()
      if (urlStr.includes('/auth/password/forgot')) {
        if (init?.body) {
          requestedBody = JSON.parse(init.body as string)
        }
        return Promise.resolve(
          new Response(JSON.stringify({ status: 'accepted' }), {
            status: 202,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }
      return Promise.resolve(new Response('not found', { status: 404 }))
    })

    renderWithProviders(<ForgotPassword />)

    fireEvent.change(screen.getByLabelText(/Email address/i), {
      target: { value: 'lead@newtonite.test' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Send Reset Link/i }))

    await waitFor(() => {
      expect(screen.getByRole('status')).toBeInTheDocument()
    })

    expect(screen.getByText(/Check your inbox/i)).toBeInTheDocument()
    expect(requestedBody).toEqual({ email: 'lead@newtonite.test' })
    expect(screen.getByRole('link', { name: /Return to Log In/i })).toHaveAttribute('href', '/login')
  })
})
