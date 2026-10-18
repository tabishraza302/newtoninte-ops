import React from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useOptionalAuth } from '../auth/AuthContext'

export interface AppLayoutProps {
  children: React.ReactNode
}

export function AppLayout({ children }: AppLayoutProps): React.ReactElement {
  const auth = useOptionalAuth()
  const location = useLocation()
  const user = auth?.user
  const isAdmin = !!user?.isAdmin

  const isCurrent = (path: string): boolean => {
    if (path === '/admin/jobs') {
      return location.pathname === '/admin/jobs' || (isAdmin && location.pathname === '/')
    }
    if (path === '/dashboard') {
      return location.pathname === '/dashboard' || (!isAdmin && location.pathname === '/')
    }
    if (path === '/items') return location.pathname === '/items'
    if (path === '/items/new') return location.pathname === '/items/new'
    return false
  }

  const getBreadcrumb = (): string => {
    if (location.pathname === '/admin/jobs' || (isAdmin && location.pathname === '/')) {
      return 'System Administration / Outbox Jobs'
    }
    if (location.pathname === '/' || location.pathname === '/dashboard') {
      return 'Triage / Dashboard'
    }
    if (location.pathname === '/items') return 'Operations / Work Items'
    if (location.pathname === '/items/new') return 'Work Items / Create'
    if (location.pathname.startsWith('/items/')) return 'Work Items / Detail'
    if (location.pathname.startsWith('/admin')) return 'Administration / Outbox Jobs'
    return 'Platform'
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh', backgroundColor: '#f8fafc', color: '#0f172a' }}>
      {/* Sidebar */}
      <aside
        style={{
          width: '260px',
          backgroundColor: '#0f172a',
          color: '#ffffff',
          display: 'flex',
          flexDirection: 'column',
          borderRight: '1px solid #1e293b',
          flexShrink: 0,
        }}
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
                backgroundColor: '#2563eb',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 800,
                fontSize: '1rem',
                color: '#ffffff',
                boxShadow: '0 0 14px rgba(37, 99, 235, 0.45)',
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
            <>
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
                      backgroundColor: isCurrent('/admin/jobs') ? '#2563eb' : 'transparent',
                      textDecoration: 'none',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <span>Outbox Jobs</span>
                  </Link>
                </nav>
              </div>

              <div>
                <div style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', padding: '0 0.75rem', marginBottom: '0.5rem' }}>
                  Work Item Oversight
                </div>
                <nav style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
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
                      backgroundColor: isCurrent('/items') ? '#2563eb' : 'transparent',
                      textDecoration: 'none',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <span>All Items</span>
                  </Link>
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
                      backgroundColor: isCurrent('/dashboard') ? '#2563eb' : 'transparent',
                      textDecoration: 'none',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <span>Triage Dashboard</span>
                  </Link>
                </nav>
              </div>
            </>
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
                      backgroundColor: isCurrent('/dashboard') ? '#2563eb' : 'transparent',
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
                      backgroundColor: isCurrent('/items') ? '#2563eb' : 'transparent',
                      textDecoration: 'none',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <span>Work Items</span>
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
                    color: '#93c5fd',
                    backgroundColor: 'rgba(37, 99, 235, 0.15)',
                    border: '1px solid rgba(59, 130, 246, 0.25)',
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
                  backgroundColor: isAdmin ? '#2563eb' : '#334155',
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
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: '100vh' }}>
        {/* Topbar */}
        <header
          style={{
            height: '56px',
            backgroundColor: '#ffffff',
            borderBottom: '1px solid #e2e8f0',
            padding: '0 2rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            position: 'sticky',
            top: 0,
            zIndex: 40,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '0.875rem', fontWeight: 600, color: '#64748b' }}>
            <span style={{ color: '#0f172a' }}>{getBreadcrumb()}</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            {isAdmin ? (
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  color: '#2563eb',
                  backgroundColor: '#eff6ff',
                  padding: '0.2rem 0.65rem',
                  borderRadius: '9999px',
                  border: '1px solid #bfdbfe',
                }}
              >
                <span style={{ width: '6px', height: '6px', borderRadius: '9999px', backgroundColor: '#2563eb' }}></span>
                Ops Admin Scope
              </div>
            ) : (
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  color: '#059669',
                  backgroundColor: '#ecfdf5',
                  padding: '0.2rem 0.6rem',
                  borderRadius: '9999px',
                  border: '1px solid #a7f3d0',
                }}
              >
                <span style={{ width: '6px', height: '6px', borderRadius: '9999px', backgroundColor: '#059669' }}></span>
                Live Pipeline
              </div>
            )}
          </div>
        </header>

        {/* Page Content */}
        <main style={{ flex: 1, padding: '2rem' }}>
          {children}
        </main>
      </div>
    </div>
  )
}
