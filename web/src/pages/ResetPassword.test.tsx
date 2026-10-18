import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { renderWithProviders } from '../test/test-utils'
import { ResetPassword } from './ResetPassword'

describe('ResetPassword Page', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('renders invalid link warning when token parameter is missing', () => {
    renderWithProviders(<ResetPassword />, { route: '/reset-password' })

    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByText(/Invalid Reset Link/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Request a New Link/i })).toHaveAttribute(
      'href',
      '/forgot-password',
    )
  })

  it('validates password length and matching confirmation before submitting', async () => {
    renderWithProviders(<ResetPassword />, { route: '/reset-password?token=test-token-123' })

    expect(screen.getByLabelText(/^New Password/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/^Confirm New Password/i)).toBeInTheDocument()

    // Short password
    fireEvent.change(screen.getByLabelText(/^New Password/i), { target: { value: 'short' } })
    fireEvent.change(screen.getByLabelText(/^Confirm New Password/i), { target: { value: 'short' } })
    fireEvent.click(screen.getByRole('button', { name: /Set New Password/i }))

    expect(screen.getByRole('alert')).toHaveTextContent(/at least 8 characters/i)

    // Mismatched confirmation
    fireEvent.change(screen.getByLabelText(/^New Password/i), { target: { value: 'password123' } })
    fireEvent.change(screen.getByLabelText(/^Confirm New Password/i), { target: { value: 'different123' } })
    fireEvent.click(screen.getByRole('button', { name: /Set New Password/i }))

    expect(screen.getByRole('alert')).toHaveTextContent(/Passwords do not match/i)
  })

  it('submits token and new password and displays success message', async () => {
    let resetPayload: unknown = null
    globalThis.fetch = vi.fn().mockImplementation((url: string | URL | Request, init?: RequestInit) => {
      const urlStr = typeof url === 'string' ? url : url.toString()
      if (urlStr.includes('/auth/password/reset')) {
        if (init?.body) {
          resetPayload = JSON.parse(init.body as string)
        }
        return Promise.resolve(
          new Response(JSON.stringify({ status: 'ok' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }
      return Promise.resolve(new Response('not found', { status: 404 }))
    })

    renderWithProviders(<ResetPassword />, { route: '/reset-password?token=valid-secret-token' })

    fireEvent.change(screen.getByLabelText(/^New Password/i), { target: { value: 'brandNewPassword123' } })
    fireEvent.change(screen.getByLabelText(/^Confirm New Password/i), { target: { value: 'brandNewPassword123' } })
    fireEvent.click(screen.getByRole('button', { name: /Set New Password/i }))

    await waitFor(() => {
      expect(screen.getByRole('status')).toBeInTheDocument()
    })

    expect(screen.getByText(/Password Reset Successful/i)).toBeInTheDocument()
    expect(resetPayload).toEqual({
      token: 'valid-secret-token',
      password: 'brandNewPassword123',
    })
    expect(screen.getByRole('link', { name: /Log In with New Password/i })).toHaveAttribute(
      'href',
      '/login',
    )
  })
})
