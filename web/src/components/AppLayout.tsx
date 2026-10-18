import React from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useOptionalAuth } from '../auth/AuthContext'
import { theme } from '../theme'
export interface AppLayoutProps {
  children: React.ReactNode
}

export function AppLayout({ children }: AppLayoutProps): React.ReactElement {
  const auth = useOptionalAuth()
  const location = useLocation()
  const user = auth?.user
  const isAdmin = !!user?.isAdmin
  const [isMobileMenuOpen, setIsMobileMenuOpen] = React.useState(false)
  const [isMobile, setIsMobile] = React.useState(() => {
    if (typeof window === 'undefined') return false
    return window.matchMedia('(max-width: 768px)').matches
  })
  const mobileToggleRef = React.useRef<HTMLButtonElement>(null)
  const sidebarRef = React.useRef<HTMLElement>(null)
  const wasOpenRef = React.useRef(false)

  React.useEffect(() => {
    if (typeof window === 'undefined') return
    const mq = window.matchMedia('(max-width: 768px)')
    const handler = (e: MediaQueryListEvent | MediaQueryList): void => {
      const matches = 'matches' in e ? e.matches : (e as MediaQueryList).matches
      setIsMobile(matches)
      if (!matches) {
        setIsMobileMenuOpen(false)
      }
    }
    if (mq.addEventListener) {
      mq.addEventListener('change', handler)
    } else {
      mq.addListener(handler)
    }
    return () => {
      if (mq.removeEventListener) {
        mq.removeEventListener('change', handler)
      } else {
        mq.removeListener(handler)
      }
    }
  }, [])

  React.useEffect(() => {
    setIsMobileMenuOpen(false)
  }, [location.pathname])

  React.useEffect(() => {
    if (!isMobileMenuOpen && wasOpenRef.current) {
      mobileToggleRef.current?.focus()
    }
    wasOpenRef.current = isMobileMenuOpen
  }, [isMobileMenuOpen])

  React.useEffect(() => {
    if (isMobileMenuOpen && isMobile) {
      const focusable = sidebarRef.current?.querySelector<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
      if (focusable) {
        focusable.focus()
      } else {
        sidebarRef.current?.focus()
      }
    }
  }, [isMobileMenuOpen, isMobile])

  React.useEffect(() => {
    if (!isMobileMenuOpen || !isMobile) return

    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        setIsMobileMenuOpen(false)
        return
      }

      if (e.key === 'Tab') {
        const focusables = Array.from(
          sidebarRef.current?.querySelectorAll<HTMLElement>(
            'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
          ) ?? []
        )

        if (focusables.length === 0) {
          e.preventDefault()
          return
        }

        const first = focusables[0]
        const last = focusables[focusables.length - 1]
        if (!first || !last) return
        if (e.shiftKey) {
          if (document.activeElement === first || !sidebarRef.current?.contains(document.activeElement)) {
            e.preventDefault()
            last.focus()
          }
        } else {
          if (document.activeElement === last || !sidebarRef.current?.contains(document.activeElement)) {
            e.preventDefault()
            first.focus()
          }
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isMobileMenuOpen, isMobile])
  const isCurrent = (path: string): boolean => {
    if (path === '/admin/jobs') {
      return location.pathname === '/admin/jobs' || (isAdmin && location.pathname === '/')
    }
    if (path === '/admin/users') return location.pathname === '/admin/users'
    if (path === '/admin/teams') return location.pathname === '/admin/teams'
    if (path === '/dashboard') {
      return location.pathname === '/dashboard' || (!isAdmin && location.pathname === '/')
    }
    if (path === '/items') return location.pathname === '/items'
    if (path === '/items/new') return location.pathname === '/items/new'
    if (path === '/teams') return location.pathname === '/teams' || location.pathname.startsWith('/teams/')
    return false
  }

  const getBreadcrumb = (): string => {
    if (location.pathname === '/admin/jobs' || (isAdmin && location.pathname === '/')) {
      return 'System Administration / Outbox Jobs'
    }
    if (location.pathname === '/admin/users') {
      return 'System Administration / Users'
    }
    if (location.pathname === '/admin/teams') {
      return 'System Administration / Teams'
    }
    if (location.pathname === '/' || location.pathname === '/dashboard') {
      return 'Triage / Dashboard'
    }
    if (location.pathname === '/items') return 'Operations / Work Items'
    if (location.pathname === '/items/new') return 'Work Items / Create'
    if (location.pathname.startsWith('/items/')) return 'Work Items / Detail'
    if (location.pathname.startsWith('/teams')) return 'Team Workspace'
    if (location.pathname.startsWith('/admin/jobs')) return 'System Administration / Outbox Jobs'
    if (location.pathname.startsWith('/admin/users')) return 'System Administration / Users'
    if (location.pathname.startsWith('/admin/teams')) return 'System Administration / Teams'
    if (location.pathname.startsWith('/admin')) return 'System Administration'
    return 'Platform'
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh', backgroundColor: theme.colors.bgApp, color: theme.colors.textPrimary, width: '100%' }}>
      <style>{`
        .app-layout-sidebar {
          width: 260px;
          background-color: #11161d;
          color: #ffffff;
          display: flex;
          flex-direction: column;
          border-right: 1px solid #1e293b;
          flex-shrink: 0;
          transition: transform 0.2s ease-in-out;
        }
        .app-mobile-menu-btn {
          display: none;
          background: transparent;
          border: 1px solid #cbd5e1;
          border-radius: 6px;
          padding: 0.3rem 0.55rem;
          font-size: 1.1rem;
          cursor: pointer;
          color: #0f172a;
          line-height: 1;
        }
        .app-topbar {
          height: 56px;
          background-color: #ffffff;
          border-bottom: 1px solid #e2e8f0;
          padding: 0 1.5rem;
          display: flex;
          align-items: center;
          justify-content: space-between;
          position: sticky;
          top: 0;
          z-index: 40;
          gap: 0.75rem;
        }
        .app-breadcrumb-wrap {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          font-size: 0.875rem;
          font-weight: 600;
          color: #64748b;
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          flex: 1;
        }
        .app-main-content {
          flex: 1;
          padding: 2rem;
          max-width: 100%;
          box-sizing: border-box;
        }
        @media (max-width: 768px) {
          .app-mobile-menu-btn {
            display: inline-flex;
            align-items: center;
            justify-content: center;
          }
          .app-layout-sidebar {
            position: fixed;
            top: 0;
            left: 0;
            bottom: 0;
            z-index: 60;
            transform: translateX(-100%);
            visibility: hidden;
            box-shadow: 0 0 20px rgba(0, 0, 0, 0.4);
          }
          .app-layout-sidebar.open {
            transform: translateX(0);
            visibility: visible;
          }
          .app-sidebar-backdrop {
            position: fixed;
            inset: 0;
            background-color: rgba(15, 23, 42, 0.5);
            z-index: 55;
          }
          .app-topbar {
            padding: 0 0.875rem;
          }
          .app-main-content {
            padding: 1rem 0.875rem;
          }
        }
        @media (min-width: 769px) {
          .app-layout-sidebar {
            visibility: visible !important;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          * {
            animation-duration: 0.01ms !important;
            animation-iteration-count: 1 !important;
            transition-duration: 0.01ms !important;
            scroll-behavior: auto !important;
          }
        }
      `}</style>

      {isMobileMenuOpen && (
        <div
          className="app-sidebar-backdrop"
          onClick={() => setIsMobileMenuOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar */}
      <aside
        id="app-sidebar"
        ref={sidebarRef}
        tabIndex={isMobile && isMobileMenuOpen ? -1 : undefined}
        className={`app-layout-sidebar ${isMobileMenuOpen ? 'open' : ''}`}
        aria-hidden={isMobile && !isMobileMenuOpen ? 'true' : undefined}
      >
        {/* Brand */}
        <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid #1e293b' }}>
          <Link
            to="/"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
              textDecoration: 'none',
              color: '#ffffff',
            }}
          >
            <div
              style={{
                width: '32px',
                height: '32px',
                borderRadius: '8px',
                backgroundColor: theme.colors.accent,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 800,
                fontSize: '1rem',
                color: '#ffffff',
              }}
            >
              N
            </div>
            <div>
              <div style={{ fontWeight: 800, fontSize: '0.9375rem', letterSpacing: '-0.02em', lineHeight: 1.2 }}>
                Newtonite Operations
              </div>
              <div style={{ fontSize: '0.6875rem', color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                {isAdmin ? 'System Admin' : 'Team Workbench'}
              </div>
            </div>
          </Link>
        </div>

        {/* Navigation Sections */}
        <div style={{ flex: 1, padding: '1.25rem 0.875rem', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {isAdmin ? (
              <div>
                <div style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', padding: '0 0.75rem', marginBottom: '0.5rem' }}>
                  Platform Ops
                </div>
                <nav style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                  <Link
                    to="/admin/jobs"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.75rem',
                      padding: '0.55rem 0.75rem',
                      borderRadius: '6px',
                      fontSize: '0.875rem',
                      fontWeight: isCurrent('/admin/jobs') ? 600 : 500,
                      color: isCurrent('/admin/jobs') ? '#ffffff' : '#94a3b8',
                      backgroundColor: isCurrent('/admin/jobs') ? theme.colors.accent : 'transparent',
                      textDecoration: 'none',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <span>Outbox Jobs</span>
                  </Link>
                  <Link
                    to="/admin/users"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.75rem',
                      padding: '0.55rem 0.75rem',
                      borderRadius: '6px',
                      fontSize: '0.875rem',
                      fontWeight: isCurrent('/admin/users') ? 600 : 500,
                      color: isCurrent('/admin/users') ? '#ffffff' : '#94a3b8',
                      backgroundColor: isCurrent('/admin/users') ? theme.colors.accent : 'transparent',
                      textDecoration: 'none',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <span>Users</span>
                  </Link>
                  <Link
                    to="/admin/teams"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.75rem',
                      padding: '0.55rem 0.75rem',
                      borderRadius: '6px',
                      fontSize: '0.875rem',
                      fontWeight: isCurrent('/admin/teams') ? 600 : 500,
                      color: isCurrent('/admin/teams') ? '#ffffff' : '#94a3b8',
                      backgroundColor: isCurrent('/admin/teams') ? theme.colors.accent : 'transparent',
                      textDecoration: 'none',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <span>Teams</span>
                  </Link>
                </nav>
              </div>
          ) : (
            <>
              <div>
                <div style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', padding: '0 0.75rem', marginBottom: '0.5rem' }}>
                  Operations Views
                </div>
                <nav style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                  <Link
                    to="/dashboard"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.75rem',
                      padding: '0.55rem 0.75rem',
                      borderRadius: '6px',
                      fontSize: '0.875rem',
                      fontWeight: isCurrent('/dashboard') ? 600 : 500,
                      color: isCurrent('/dashboard') ? '#ffffff' : '#94a3b8',
                      backgroundColor: isCurrent('/dashboard') ? theme.colors.accent : 'transparent',
                      textDecoration: 'none',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <span>Dashboard</span>
                  </Link>

                  <Link
                    to="/items"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.75rem',
                      padding: '0.55rem 0.75rem',
                      borderRadius: '6px',
                      fontSize: '0.875rem',
                      fontWeight: isCurrent('/items') ? 600 : 500,
                      color: isCurrent('/items') ? '#ffffff' : '#94a3b8',
                      backgroundColor: isCurrent('/items') ? theme.colors.accent : 'transparent',
                      textDecoration: 'none',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <span>Work Items</span>
                  </Link>

                  <Link
                    to="/teams"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.75rem',
                      padding: '0.55rem 0.75rem',
                      borderRadius: '6px',
                      fontSize: '0.875rem',
                      fontWeight: isCurrent('/teams') ? 600 : 500,
                      color: isCurrent('/teams') ? '#ffffff' : '#94a3b8',
                      backgroundColor: isCurrent('/teams') ? theme.colors.accent : 'transparent',
                      textDecoration: 'none',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <span>Teams</span>
                  </Link>
                </nav>
              </div>

              <div>
                <div style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', padding: '0 0.75rem', marginBottom: '0.5rem' }}>
                  Actions
                </div>
                <Link
                  to="/items/new"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    padding: '0.5rem 0.75rem',
                    borderRadius: '6px',
                    fontSize: '0.8125rem',
                    fontWeight: 600,
                    color: theme.colors.accent,
                    backgroundColor: theme.colors.accentSubtle,
                    border: `1px solid ${theme.colors.accentBorder}`,
                    textDecoration: 'none',
                  }}
                >
                  <span>+ Create Item</span>
                </Link>
              </div>
            </>
          )}
        </div>

        {/* Sidebar Footer / User Profile */}
        {user && (
          <div
            style={{
              padding: '1rem',
              borderTop: '1px solid #1e293b',
              backgroundColor: 'rgba(0, 0, 0, 0.15)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '0.75rem',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', minWidth: 0 }}>
              <div
                style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '8px',
                  backgroundColor: isAdmin ? '#1e293b' : theme.colors.accent,
                  color: '#ffffff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '0.8125rem',
                  fontWeight: 700,
                  flexShrink: 0,
                }}
              >
                {user.displayName.charAt(0).toUpperCase()}
              </div>
              <div style={{ minWidth: 0, overflow: 'hidden' }}>
                <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#f8fafc', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {user.displayName}
                </div>
                <div style={{ fontSize: '0.6875rem', color: '#94a3b8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {isAdmin ? 'System Administrator' : user.email}
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => void auth?.logout()}
              title="Log out"
              style={{
                padding: '0.35rem 0.65rem',
                backgroundColor: 'transparent',
                color: '#94a3b8',
                border: '1px solid #334155',
                borderRadius: '6px',
                fontSize: '0.6875rem',
                fontWeight: 600,
                cursor: 'pointer',
                fontFamily: 'inherit',
                whiteSpace: 'nowrap',
                transition: 'all 0.15s ease',
              }}
            >
              Log Out
            </button>
          </div>
        )}
      </aside>

      {/* Main Content Area with Topbar */}
      <div
        inert={isMobile && isMobileMenuOpen ? true : undefined}
        aria-hidden={isMobile && isMobileMenuOpen ? 'true' : undefined}
        style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: '100vh' }}
      >
        {/* Topbar */}
        <header className="app-topbar">
          <div style={{ display: 'flex', alignItems: 'center', minWidth: 0, flex: 1, gap: '0.5rem' }}>
            <button
              ref={mobileToggleRef}
              type="button"
              className="app-mobile-menu-btn"
              onClick={() => setIsMobileMenuOpen((prev) => !prev)}
              aria-label="Toggle navigation menu"
              aria-expanded={isMobileMenuOpen}
              aria-controls="app-sidebar"
            >
              ☰
            </button>
            <div className="app-breadcrumb-wrap">
              <span style={{ color: '#0f172a' }}>{getBreadcrumb()}</span>
            </div>
          </div>

        </header>

        {/* Page Content */}
        <main className="app-main-content">
          {children}
        </main>
      </div>
    </div>
  )
}
