import React from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useOptionalAuth } from '../auth/AuthContext'

export function AppHeader(): React.ReactElement {
  const auth = useOptionalAuth()
  const location = useLocation()
  const user = auth?.user

  const navLinks = [
    { label: 'Dashboard', path: '/dashboard' },
    { label: 'Work Items', path: '/items' },
    ...(user?.isAdmin ? [{ label: 'Outbox Jobs', path: '/admin/jobs' }] : []),
  ]

  const isActive = (path: string): boolean => {
    if (path === '/dashboard') return location.pathname === '/dashboard' || location.pathname === '/'
    if (path === '/items') return location.pathname.startsWith('/items')
    if (path === '/admin/jobs') return location.pathname.startsWith('/admin')
    return false
  }

  return (
    <header
      style={{
        backgroundColor: '#0f172a',
        borderBottom: '1px solid #1e293b',
        color: '#ffffff',
        position: 'sticky',
        top: 0,
        zIndex: 50,
      }}
    >
      <div
        style={{
          maxWidth: '1200px',
          margin: '0 auto',
          padding: '0 1.5rem',
          height: '60px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '2rem' }}>
          <Link
            to="/"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.6rem',
              textDecoration: 'none',
              color: '#ffffff',
            }}
          >
            <div
              style={{
                width: '28px',
                height: '28px',
                borderRadius: '6px',
                backgroundColor: '#2563eb',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 800,
                fontSize: '0.875rem',
                color: '#ffffff',
                boxShadow: '0 0 12px rgba(37, 99, 235, 0.4)',
              }}
            >
              N
            </div>
            <span style={{ fontWeight: 700, fontSize: '1rem', letterSpacing: '-0.02em' }}>
              Newtonite <span style={{ color: '#94a3b8', fontWeight: 500 }}>Ops</span>
            </span>
          </Link>

          <nav style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
            {navLinks.map((link) => {
              const active = isActive(link.path)
              return (
                <Link
                  key={link.path}
                  to={link.path}
                  style={{
                    padding: '0.4rem 0.75rem',
                    borderRadius: '6px',
                    fontSize: '0.875rem',
                    fontWeight: active ? 600 : 500,
                    color: active ? '#ffffff' : '#94a3b8',
                    backgroundColor: active ? 'rgba(255, 255, 255, 0.1)' : 'transparent',
                    textDecoration: 'none',
                    transition: 'all 0.15s ease',
                  }}
                >
                  {link.label}
                </Link>
              )
            })}
          </nav>
        </div>

        {user && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              <div
                style={{
                  width: '28px',
                  height: '28px',
                  borderRadius: '9999px',
                  backgroundColor: '#334155',
                  color: '#e2e8f0',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                }}
              >
                {user.displayName.charAt(0).toUpperCase()}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#f8fafc', lineHeight: 1.2 }}>
                  {user.displayName}
                </span>
                <span style={{ fontSize: '0.6875rem', color: '#94a3b8', lineHeight: 1.2 }}>
                  {user.isAdmin ? 'Admin' : user.email}
                </span>
              </div>
            </div>

            <button
              type="button"
              onClick={() => void auth?.logout()}
              style={{
                padding: '0.35rem 0.7rem',
                backgroundColor: 'rgba(255, 255, 255, 0.05)',
                color: '#cbd5e1',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                borderRadius: '6px',
                fontSize: '0.75rem',
                fontWeight: 500,
                cursor: 'pointer',
                fontFamily: 'inherit',
                transition: 'all 0.15s ease',
              }}
            >
              Log Out
            </button>
          </div>
        )}
      </div>
    </header>
  )
}
