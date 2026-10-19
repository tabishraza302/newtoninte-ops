import React from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useOptionalAuth } from '../auth/AuthContext'
import { useNotificationsSummary, useMe } from '../api/hooks'
import { theme } from '../theme'
export interface AppLayoutProps {
  children: React.ReactNode
}

export function AppLayout({ children }: AppLayoutProps): React.ReactElement {
  const auth = useOptionalAuth()
  const location = useLocation()
  const user = auth?.user
  const isAdmin = !!user?.isAdmin
  const authedUserId = auth?.status === 'authed' ? auth.user?.id : undefined
  const { data: meData } = useMe({ enabled: !!authedUserId })
  const isLead = !isAdmin && (meData?.memberships?.some((m) => m.role === 'lead') ?? false)
  const { data: summary, isError: isSummaryError } = useNotificationsSummary(authedUserId)
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
    if (path === '/admin/audit-log') return location.pathname === '/admin/audit-log'
    if (path === '/approvals') return location.pathname === '/approvals'
    if (path === '/dashboard') {
      return location.pathname === '/dashboard' || (!isAdmin && location.pathname === '/')
    }
    if (path === '/items') return location.pathname === '/items'
    if (path === '/items/new') return location.pathname === '/items/new'
    if (path === '/teams') return location.pathname === '/teams' || location.pathname.startsWith('/teams/')
    if (path === '/notifications') return location.pathname === '/notifications'
    return false
  }

  const getBreadcrumb = (): string => {
    if (location.pathname === '/notifications' || location.pathname.startsWith('/notifications/')) {
      return 'Notifications'
    }
    if (location.pathname === '/admin/jobs' || (isAdmin && location.pathname === '/')) {
      return 'System Administration / Outbox Jobs'
    }
    if (location.pathname === '/admin/users') {
      return 'System Administration / Users'
    }
    if (location.pathname === '/admin/teams') {
      return 'System Administration / Teams'
    }
    if (location.pathname === '/admin/audit-log') {
      return 'System Administration / Audit Log'
    }
    if (location.pathname === '/approvals') {
      return 'Operations / Approvals Queue'
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
    if (location.pathname.startsWith('/admin/audit-log')) return 'System Administration / Audit Log'
    if (location.pathname.startsWith('/admin')) return 'System Administration'
    return 'Platform'
  }

  return (
    <div className="app-layout-root" style={{ display: 'flex', height: '100vh', width: '100%', overflow: 'hidden', backgroundColor: theme.colors.bgApp, color: theme.colors.textPrimary }}>
      <style>{`
        .app-layout-root {
          display: flex;
          height: 100vh;
          height: 100dvh;
          max-height: 100vh;
          max-height: 100dvh;
          width: 100%;
          overflow: hidden;
        }
        .app-main-column {
          flex: 1;
          display: flex;
          flex-direction: column;
          min-width: 0;
          height: 100%;
          overflow-y: auto;
          overflow-x: hidden;
        }
        .app-layout-sidebar {
          width: 260px;
          height: 100vh;
          height: 100dvh;
          max-height: 100vh;
          max-height: 100dvh;
          position: sticky;
          top: 0;
          background-color: #11161d;
          color: #ffffff;
          display: flex;
          flex-direction: column;
          border-right: 1px solid #1e293b;
          flex-shrink: 0;
          box-sizing: border-box;
          overflow: hidden;
          transition: transform 0.2s ease-in-out;
        }
        .app-sidebar-nav {
          scrollbar-width: thin;
          scrollbar-color: #334155 transparent;
        }
        .app-sidebar-nav::-webkit-scrollbar {
          width: 6px;
        }
        .app-sidebar-nav::-webkit-scrollbar-track {
          background: transparent;
        }
        .app-sidebar-nav::-webkit-scrollbar-thumb {
          background: #334155;
          border-radius: 3px;
        }
        .app-sidebar-nav::-webkit-scrollbar-thumb:hover {
          background: #475569;
        }
        .app-sidebar-action-btn {
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.5rem;
          padding: 0.625rem 0.75rem;
          border-radius: 6px;
          font-size: 0.8125rem;
          font-weight: 600;
          color: #ffffff;
          background-color: #0f766e;
          border: 1px solid #0f766e;
          text-decoration: none;
          box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.25);
          transition: background-color 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease, transform 0.1s ease;
          outline: none;
        }
        .app-sidebar-action-btn:hover {
          background-color: #115e59 !important;
          border-color: #115e59 !important;
          box-shadow: 0 2px 4px 0 rgba(0, 0, 0, 0.35);
        }
        .app-sidebar-action-btn:active {
          background-color: #134e4a !important;
          border-color: #134e4a !important;
          transform: translateY(1px);
        }
        .app-sidebar-action-btn:focus-visible {
          outline: 2px solid #5eead4 !important;
          outline-offset: 2px;
        }
        .app-sidebar-nav-link {
          transition: background-color 0.15s ease, color 0.15s ease;
        }
        .app-sidebar-nav-link:hover {
          color: #ffffff !important;
          background-color: rgba(255, 255, 255, 0.08) !important;
        }
        .app-sidebar-nav-link.active:hover {
          background-color: #0f766e !important;
        }
        .app-sidebar-nav-link:focus-visible {
          outline: 2px solid #5eead4;
          outline-offset: 2px;
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
          flex-shrink: 0;
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
            height: 100vh;
            height: 100dvh;
            max-height: 100vh;
            max-height: 100dvh;
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
            position: sticky;
            top: 0;
            height: 100vh;
            height: 100dvh;
            max-height: 100vh;
            max-height: 100dvh;
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
        <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid #1e293b', flexShrink: 0 }}>
          <Link
            to="/"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
              textDecoration: 'none',
              color: '#ffffff',
              minWidth: 0,
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
                flexShrink: 0,
              }}
            >
              N
            </div>
            <div style={{ minWidth: 0, overflow: 'hidden' }}>
              <div style={{ fontWeight: 800, fontSize: '0.9375rem', letterSpacing: '-0.02em', lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                Newtonite Operations
              </div>
              <div style={{ fontSize: '0.6875rem', color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {isAdmin ? 'System Admin' : isLead ? 'Team Lead' : 'Team Workbench'}
              </div>
            </div>
          </Link>
        </div>

        {/* Navigation Sections */}
        <div
          className="app-sidebar-nav"
          style={{
            flex: 1,
            minHeight: 0,
            padding: '1.25rem 0.875rem',
            overflowY: 'auto',
            overflowX: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            gap: '1.5rem',
          }}
        >
          {isAdmin ? (
              <div>
                <div style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', padding: '0 0.75rem', marginBottom: '0.5rem' }}>
                  Platform Ops
                </div>
                <nav style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                  <Link
                    to="/admin/jobs"
                    className={`app-sidebar-nav-link ${isCurrent('/admin/jobs') ? 'active' : ''}`}
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
                    }}
                  >
                    <span>Outbox Jobs</span>
                  </Link>
                  <Link
                    to="/admin/users"
                    className={`app-sidebar-nav-link ${isCurrent('/admin/users') ? 'active' : ''}`}
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
                    }}
                  >
                    <span>Users</span>
                  </Link>
                  <Link
                    to="/admin/teams"
                    className={`app-sidebar-nav-link ${isCurrent('/admin/teams') ? 'active' : ''}`}
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
                    }}
                  >
                    <span>Teams</span>
                  </Link>
                  <Link
                    to="/admin/audit-log"
                    className={`app-sidebar-nav-link ${isCurrent('/admin/audit-log') ? 'active' : ''}`}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.75rem',
                      padding: '0.55rem 0.75rem',
                      borderRadius: '6px',
                      fontSize: '0.875rem',
                      fontWeight: isCurrent('/admin/audit-log') ? 600 : 500,
                      color: isCurrent('/admin/audit-log') ? '#ffffff' : '#94a3b8',
                      backgroundColor: isCurrent('/admin/audit-log') ? theme.colors.accent : 'transparent',
                      textDecoration: 'none',
                    }}
                  >
                    <span>Audit Log</span>
                  </Link>
                </nav>
              </div>
          ) : (
            <>
              <div>
                <Link
                  to="/items/new"
                  className={`app-sidebar-action-btn ${isCurrent('/items/new') ? 'active' : ''}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.5rem',
                    padding: '0.625rem 0.75rem',
                    borderRadius: '6px',
                    fontSize: '0.8125rem',
                    fontWeight: 600,
                    color: '#ffffff',
                    backgroundColor: theme.colors.accent,
                    border: `1px solid ${isCurrent('/items/new') ? '#2dd4bf' : theme.colors.accent}`,
                    textDecoration: 'none',
                    boxShadow: isCurrent('/items/new')
                      ? '0 0 0 1px #2dd4bf, 0 1px 2px 0 rgba(0, 0, 0, 0.25)'
                      : '0 1px 2px 0 rgba(0, 0, 0, 0.25)',
                  }}
                >
                  <span>+ Create Item</span>
                </Link>
              </div>

              <div>
                <div style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', padding: '0 0.75rem', marginBottom: '0.5rem' }}>
                  Operations Views
                </div>
                <nav style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                  <Link
                    to="/dashboard"
                    className={`app-sidebar-nav-link ${isCurrent('/dashboard') ? 'active' : ''}`}
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
                    }}
                  >
                    <span>Dashboard</span>
                  </Link>

                  {isLead && (
                    <Link
                      to="/approvals"
                      className={`app-sidebar-nav-link ${isCurrent('/approvals') ? 'active' : ''}`}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '0.75rem',
                        padding: '0.55rem 0.75rem',
                        borderRadius: '6px',
                        fontSize: '0.875rem',
                        fontWeight: isCurrent('/approvals') ? 600 : 500,
                        color: isCurrent('/approvals') ? '#ffffff' : '#94a3b8',
                        backgroundColor: isCurrent('/approvals') ? theme.colors.accent : 'transparent',
                        textDecoration: 'none',
                      }}
                    >
                      <span>Approvals</span>
                      <span
                        style={{
                          fontSize: '0.6875rem',
                          fontWeight: 700,
                          padding: '0.1rem 0.45rem',
                          borderRadius: '9999px',
                          backgroundColor: isCurrent('/approvals') ? 'rgba(255, 255, 255, 0.25)' : '#1e293b',
                          color: '#ffffff',
                        }}
                      >
                        Lead
                      </span>
                    </Link>
                  )}

                  <Link
                    to="/items"
                    className={`app-sidebar-nav-link ${isCurrent('/items') ? 'active' : ''}`}
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
                    }}
                  >
                    <span>Work Items</span>
                  </Link>

                  <Link
                    to="/teams"
                    className={`app-sidebar-nav-link ${isCurrent('/teams') ? 'active' : ''}`}
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
                    }}
                  >
                    <span>Teams</span>
                  </Link>
                </nav>
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
              flexShrink: 0,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', minWidth: 0, flex: 1 }}>
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
              <div style={{ minWidth: 0, overflow: 'hidden', flex: 1 }}>
                <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#f8fafc', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {user.displayName}
                </div>
                <div
                  title={isAdmin ? 'System Administrator' : isLead ? `Team Lead (${user.email})` : user.email}
                  style={{ fontSize: '0.6875rem', color: '#94a3b8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                >
                  {isAdmin ? 'System Administrator' : isLead ? 'Team Lead' : user.email}
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
                flexShrink: 0,
              }}
            >
              Log Out
            </button>
          </div>
        )}
      </aside>

      {/* Main Content Area with Topbar */}
      <div
        className="app-main-column"
        inert={isMobile && isMobileMenuOpen ? true : undefined}
        aria-hidden={isMobile && isMobileMenuOpen ? 'true' : undefined}
        style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, height: '100%', overflowY: 'auto', overflowX: 'hidden' }}
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
          {auth?.status === 'authed' && (
            <Link
              to="/notifications"
              title="Notifications"
              aria-label={
                isSummaryError
                  ? 'Notifications (unread count unavailable)'
                  : summary && summary.unreadCount > 0
                    ? `Notifications (${summary.unreadCount} unread)`
                    : 'Notifications'
              }
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                position: 'relative',
                width: '44px',
                height: '44px',
                minWidth: '44px',
                minHeight: '44px',
                boxSizing: 'border-box',
                borderRadius: '6px',
                fontSize: '0.875rem',
                fontWeight: isCurrent('/notifications') ? 600 : 500,
                color: isCurrent('/notifications') ? '#0f172a' : '#475569',
                backgroundColor: isCurrent('/notifications') ? '#f1f5f9' : 'transparent',
                textDecoration: 'none',
                border: '1px solid',
                borderColor: isCurrent('/notifications') ? '#cbd5e1' : '#e2e8f0',
                transition: 'all 0.15s ease',
                flexShrink: 0,
              }}
            >
              <span
                style={{
                  position: 'absolute',
                  width: '1px',
                  height: '1px',
                  padding: 0,
                  margin: '-1px',
                  overflow: 'hidden',
                  clip: 'rect(0, 0, 0, 0)',
                  whiteSpace: 'nowrap',
                  border: 0,
                }}
              >
                Notifications
              </span>
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
              {summary && summary.unreadCount > 0 && (
                <span
                  aria-hidden="true"
                  style={{
                    position: 'absolute',
                    top: '2px',
                    right: '2px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    minWidth: '1.125rem',
                    height: '1.125rem',
                    padding: '0 0.25rem',
                    borderRadius: '9999px',
                    fontSize: '0.625rem',
                    fontWeight: 700,
                    lineHeight: 1,
                    backgroundColor: theme.colors.accent,
                    color: '#ffffff',
                  }}
                >
                  {summary.unreadCount > 99 ? '99+' : summary.unreadCount}
                </span>
              )}
              {isSummaryError && (
                <span
                  aria-hidden="true"
                  title="Unread count unavailable"
                  style={{
                    position: 'absolute',
                    top: '2px',
                    right: '2px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: '1.125rem',
                    height: '1.125rem',
                    borderRadius: '9999px',
                    fontSize: '0.625rem',
                    fontWeight: 700,
                    lineHeight: 1,
                    backgroundColor: '#fef2f2',
                    color: theme.colors.priority.urgent.text,
                    border: `1px solid ${theme.colors.priority.urgent.border}`,
                  }}
                >
                  !
                </span>
              )}
            </Link>
          )}
        </header>

        {/* Page Content */}
        <main className="app-main-content">
          {children}
        </main>
      </div>
    </div>
  )
}
