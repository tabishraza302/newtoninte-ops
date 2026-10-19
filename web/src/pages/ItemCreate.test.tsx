import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '../test/test-utils'
import { ItemCreate } from './ItemCreate'

describe('ItemCreate Page', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.restoreAllMocks()
    fetchMock.mockReset()
    globalThis.fetch = fetchMock
  })

  it('displays specialized copy and Back to Platform Ops link when user is an administrator', async () => {
    fetchMock.mockImplementation((urlStr: string | URL | Request) => {
      const url = typeof urlStr === 'string' ? urlStr : urlStr.toString()

      if (url.includes('/auth/me')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              user: {
                id: 1,
                email: 'admin@newtonite.test',
                displayName: 'Admin User',
                isAdmin: true,
                status: 'active',
              },
              memberships: [{ teamId: 1, role: 'lead' }],
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            },
          ),
        )
      }
      if (url.includes('/teams')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              teams: [{ id: 1, name: 'Core Team', slug: 'core' }],
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            },
          ),
        )
      }
      return Promise.reject(new Error(`Unhandled request: ${url}`))
    })

    renderWithProviders(<ItemCreate />)

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument()
    })

    expect(screen.getByRole('heading', { name: /Cannot Create Work Item/i })).toBeInTheDocument()
    expect(
      screen.getByText(
        'Administrators cannot create work items. Item creation is reserved for operational team members and leads.',
      ),
    ).toBeInTheDocument()
    const link = screen.getByRole('link', { name: /Back to Platform Ops/i })
    expect(link).toBeInTheDocument()
    expect(link).toHaveAttribute('href', '/admin/jobs')
  })

  it('displays viewer copy and link to /items when user is a viewer', async () => {
    fetchMock.mockImplementation((urlStr: string | URL | Request) => {
      const url = typeof urlStr === 'string' ? urlStr : urlStr.toString()

      if (url.includes('/auth/me')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              user: {
                id: 2,
                email: 'viewer@newtonite.test',
                displayName: 'Viewer User',
                isAdmin: false,
                status: 'active',
              },
              memberships: [{ teamId: 1, role: 'viewer' }],
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            },
          ),
        )
      }
      if (url.includes('/teams')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              teams: [{ id: 1, name: 'Core Team', slug: 'core' }],
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            },
          ),
        )
      }
      return Promise.reject(new Error(`Unhandled request: ${url}`))
    })

    renderWithProviders(<ItemCreate />)

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument()
    })

    expect(
      screen.getByText(/Only team members and leads may create new work items/i),
    ).toBeInTheDocument()
    const link = screen.getByRole('link', { name: /View Work Items/i })
    expect(link).toBeInTheDocument()
    expect(link).toHaveAttribute('href', '/items')
  })
})
