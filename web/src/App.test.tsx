import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { App } from './App'

describe('App', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    globalThis.fetch = vi.fn().mockImplementation((url: string | URL | Request) => {
      const urlStr = typeof url === 'string' ? url : url.toString()
      if (urlStr.includes('/auth/refresh')) {
        return Promise.resolve(new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 }))
      }
      return Promise.resolve(new Response(JSON.stringify({ error: 'not found' }), { status: 404 }))
    })
  })

  it('renders login page when unauthenticated', async () => {
    render(<App />)
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Log In/i })).toBeInTheDocument()
    })
  })
})
