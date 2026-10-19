import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { AppLayout } from './AppLayout'
import { AuthContext, type AuthContextValue, type User } from '../auth/AuthContext'
import { createTestQueryClient } from '../test/test-utils'

const mockUser: User = {
  id: 1,
  email: 'very.long.email.address.that.could.overflow@newtonite.operations.example.com',
  displayName: 'Supercalifragilisticexpialidocious Administrator',
  isAdmin: true,
}

const mockLeadUser: User = {
  id: 2,
  email: 'lead@newtonite.test',
  displayName: 'Lead User',
  isAdmin: false,
}

const mockMemberUser: User = {
  id: 3,
  email: 'member@newtonite.test',
  displayName: 'Member User',
  isAdmin: false,
}

function authContext(user: User | null): AuthContextValue {
  return {
    status: user ? 'authed' : 'anon',
    user,
    login: vi.fn(),
    logout: vi.fn(),
    setAuthUser: vi.fn(),
  }
}

describe('AppLayout Sidebar Overflow & Layout Styling', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    globalThis.fetch = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.includes('/notifications/summary')) {
        return Promise.resolve(
          new Response(JSON.stringify({ unreadCount: 0 }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }
      return Promise.resolve(new Response('not found', { status: 404 }))
    })
  })

  it('renders sidebar with sticky/fixed height containment and internal scrollable nav', () => {
    const queryClient = createTestQueryClient()
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <AuthContext.Provider value={authContext(mockUser)}>
          <MemoryRouter initialEntries={['/admin/jobs']}>
            <AppLayout><div>Main Content</div></AppLayout>
          </MemoryRouter>
        </AuthContext.Provider>
      </QueryClientProvider>,
    )

    const sidebar = container.querySelector('#app-sidebar')
    expect(sidebar).toBeInTheDocument()
    expect(sidebar).toHaveClass('app-layout-sidebar')

    // Verify style tag contains sticky desktop positioning, 100vh height, and overflow containment
    const styleTags = container.querySelectorAll('style')
    const combinedStyles = Array.from(styleTags).map((s) => s.textContent).join('\n')
    expect(combinedStyles).toContain('position: sticky')
    expect(combinedStyles).toContain('height: 100vh')
    expect(combinedStyles).toContain('overflow: hidden')

    // Verify nav scroll container has minHeight: 0 and overflow rules
    const navScrollContainer = container.querySelector('.app-sidebar-nav')
    expect(navScrollContainer).toBeInTheDocument()
    const navStyle = (navScrollContainer as HTMLElement).style
    expect(navStyle.overflowY).toBe('auto')
    expect(navStyle.overflowX).toBe('hidden')
    expect(navStyle.minHeight).toBe('0px')

    // Verify root layout container containment
    const root = container.querySelector('.app-layout-root')
    expect(root).toBeInTheDocument()
    const rootStyle = (root as HTMLElement).style
    expect(rootStyle.height).toBe('100vh')
    expect(rootStyle.overflow).toBe('hidden')

    // Verify main column scroll container
    const mainColumn = container.querySelector('.app-main-column')
    expect(mainColumn).toBeInTheDocument()
    const mainStyle = (mainColumn as HTMLElement).style
    expect(mainStyle.overflowY).toBe('auto')
    expect(mainStyle.height).toBe('100%')
   })

  it('protects brand header and user profile footer from shrinking and clamps long text', () => {
    const queryClient = createTestQueryClient()
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <AuthContext.Provider value={authContext(mockUser)}>
          <MemoryRouter initialEntries={['/admin/jobs']}>
            <AppLayout><div>Main Content</div></AppLayout>
          </MemoryRouter>
        </AuthContext.Provider>
      </QueryClientProvider>,
    )

    // Brand header
    const brandLink = screen.getByText('Newtonite Operations').closest('a')
    expect(brandLink).toBeInTheDocument()
    const brandContainer = brandLink?.parentElement
    expect(brandContainer?.style.flexShrink).toBe('0')

    // User profile footer
    const logoutBtn = screen.getByRole('button', { name: /Log out/i })
    expect(logoutBtn).toBeInTheDocument()
    expect(logoutBtn.style.flexShrink).toBe('0')

    const footer = logoutBtn.parentElement
    expect(footer?.style.flexShrink).toBe('0')

    // User text truncation container
    const nameEl = screen.getByText(mockUser.displayName)
    expect(nameEl.style.overflow).toBe('hidden')
    expect(nameEl.style.textOverflow).toBe('ellipsis')
    expect(nameEl.style.whiteSpace).toBe('nowrap')
   })

  it('renders lead-specific navigation with Approvals link, Team Lead branding, and dark primary create button', async () => {
    const queryClient = createTestQueryClient()
    globalThis.fetch = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.includes('/notifications/summary')) {
        return Promise.resolve(
          new Response(JSON.stringify({ unreadCount: 0 }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }
      if (url.includes('/auth/me')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              user: mockLeadUser,
              memberships: [{ teamId: 1, role: 'lead' }],
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            },
          ),
        )
      }
      return Promise.resolve(new Response('not found', { status: 404 }))
    })

    render(
      <QueryClientProvider client={queryClient}>
        <AuthContext.Provider value={authContext(mockLeadUser)}>
          <MemoryRouter initialEntries={['/dashboard']}>
            <AppLayout><div>Dashboard Content</div></AppLayout>
          </MemoryRouter>
        </AuthContext.Provider>
      </QueryClientProvider>,
    )
    // Both Brand subtitle and user footer should show Team Lead
    const teamLeadBadges = await screen.findAllByText('Team Lead')
    expect(teamLeadBadges).toHaveLength(2)
    // Approvals navlink should be present
    const approvalsLink = await screen.findByRole('link', { name: /Approvals/i })
    expect(approvalsLink).toBeInTheDocument()
    expect(approvalsLink).toHaveAttribute('href', '/approvals')

    // Create Item link should have deep teal styling
    const createItemLink = screen.getByRole('link', { name: /\+ Create Item/i })
    expect(createItemLink).toBeInTheDocument()
    expect(createItemLink.style.backgroundColor).toBe('rgb(15, 118, 110)')
    expect(createItemLink.style.color).toBe('rgb(255, 255, 255)')
    expect(createItemLink).toHaveClass('app-sidebar-action-btn')
  })

  it('renders standard team workbench for non-lead member without Approvals link', async () => {
    const queryClient = createTestQueryClient()
    globalThis.fetch = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.includes('/notifications/summary')) {
        return Promise.resolve(
          new Response(JSON.stringify({ unreadCount: 0 }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }
      if (url.includes('/auth/me')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              user: mockMemberUser,
              memberships: [{ teamId: 1, role: 'member' }],
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            },
          ),
        )
      }
      return Promise.resolve(new Response('not found', { status: 404 }))
    })

    render(
      <QueryClientProvider client={queryClient}>
        <AuthContext.Provider value={authContext(mockMemberUser)}>
          <MemoryRouter initialEntries={['/dashboard']}>
            <AppLayout><div>Dashboard Content</div></AppLayout>
          </MemoryRouter>
        </AuthContext.Provider>
      </QueryClientProvider>,
    )

    // Brand subtitle should show Team Workbench
    expect(await screen.findByText('Team Workbench')).toBeInTheDocument()

    // Approvals navlink should NOT be present
    expect(screen.queryByRole('link', { name: /Approvals/i })).not.toBeInTheDocument()

    // Work Items navlink should be present for member
    const workItemsLink = screen.getByRole('link', { name: 'Work Items' })
    expect(workItemsLink).toBeInTheDocument()
    expect(workItemsLink).toHaveAttribute('href', '/items')
  })

  it('does not render Work Items link in the sidebar for admin user', async () => {
    const queryClient = createTestQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <AuthContext.Provider value={authContext(mockUser)}>
          <MemoryRouter initialEntries={['/admin/jobs']}>
            <AppLayout><div>Admin Content</div></AppLayout>
          </MemoryRouter>
        </AuthContext.Provider>
      </QueryClientProvider>,
    )

    expect(screen.queryByRole('link', { name: 'Work Items' })).not.toBeInTheDocument()
  })

  it('renders Create Item action button positioned before Operations Views and active when on /items/new', async () => {
    const queryClient = createTestQueryClient()
    globalThis.fetch = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.includes('/notifications/summary')) {
        return Promise.resolve(
          new Response(JSON.stringify({ unreadCount: 0 }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }
      if (url.includes('/auth/me')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              user: mockMemberUser,
              memberships: [{ teamId: 1, role: 'member' }],
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            },
          ),
        )
      }
      return Promise.resolve(new Response('not found', { status: 404 }))
    })

    render(
      <QueryClientProvider client={queryClient}>
        <AuthContext.Provider value={authContext(mockMemberUser)}>
          <MemoryRouter initialEntries={['/items/new']}>
            <AppLayout><div>Create Item Form</div></AppLayout>
          </MemoryRouter>
        </AuthContext.Provider>
      </QueryClientProvider>,
    )

    const createItemLink = screen.getByRole('link', { name: /\+ Create Item/i })
    expect(createItemLink).toBeInTheDocument()
    expect(createItemLink).toHaveClass('app-sidebar-action-btn')
    expect(createItemLink).toHaveClass('active')
    expect(createItemLink.style.border).toContain('rgb(45, 212, 191)')

    const operationsHeading = screen.getByText('Operations Views')
    expect(createItemLink.compareDocumentPosition(operationsHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})
