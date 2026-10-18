import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { App, AppRoutes } from './App'
import { AuthProvider } from './auth/AuthContext'
import { createTestQueryClient } from './test/test-utils'

describe('App', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    globalThis.fetch = vi.fn().mockImplementation((url: string | URL | Request) => {
      const urlStr = typeof url === 'string' ? url : url.toString()
      if (urlStr.includes('/auth/refresh')) {
        return Promise.resolve(new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 }))
      }
      if (urlStr.includes('/items/')) {
        return Promise.resolve(new Response(JSON.stringify({ error: 'not found' }), { status: 404 }))
      }
      if (urlStr.includes('/items')) {
        return Promise.resolve(new Response(JSON.stringify({ items: [], nextCursor: null }), { status: 200 }))
      }
    })
  })

  it('renders login page when unauthenticated', async () => {
    render(<App />)
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Log In/i })).toBeInTheDocument()
    })
  })

  it('routes to /dashboard', async () => {
    const queryClient = createTestQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <MemoryRouter initialEntries={['/dashboard']}>
            <AppRoutes />
          </MemoryRouter>
        </AuthProvider>
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Dashboard/i })).toBeInTheDocument()
    })
  })

  it('routes to /items', async () => {
    const queryClient = createTestQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <MemoryRouter initialEntries={['/items']}>
            <AppRoutes />
          </MemoryRouter>
        </AuthProvider>
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Items/i })).toBeInTheDocument()
    })
  })

  it('routes to /items/:id', async () => {
    const queryClient = createTestQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <MemoryRouter initialEntries={['/items/123']}>
            <AppRoutes />
          </MemoryRouter>
        </AuthProvider>
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Item not found/i })).toBeInTheDocument()
    })
  })
})
