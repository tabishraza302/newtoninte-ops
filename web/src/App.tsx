import React from 'react'
import { BrowserRouter, Routes, Route, Navigate, Link } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider, useAuth } from './auth/AuthContext'
import { AppHeader } from './components/AppHeader'
import { Login } from './pages/Login'
import { Redeem } from './pages/Redeem'
import { Dashboard } from './pages/Dashboard'
import { ItemList } from './pages/ItemList'
import { ItemDetail } from './pages/ItemDetail'
import { ItemCreate } from './pages/ItemCreate'
import { OutboxJobs } from './pages/OutboxJobs'
import { commonStyles, theme } from './theme'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
    },
  },
})

export function DashboardOrHome(): React.ReactElement {
  const { user, status, logout } = useAuth()

  if (status === 'loading') {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b' }}>
        Loading Newtonite Operations...
      </div>
    )
  }

  if (status === 'anon' || !user) {
    return <Navigate to="/login" replace />
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f8fafc', padding: '2rem 1.5rem' }}>
      <main style={{ maxWidth: '900px', margin: '2.5rem auto' }}>
        <div
          style={{
            backgroundColor: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: '12px',
            padding: '2rem',
            boxShadow: '0 4px 6px -1px rgba(15, 23, 42, 0.05)',
            marginBottom: '1.5rem',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.5rem' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                <h1 style={{ fontSize: '1.5rem', fontWeight: 800, color: '#0f172a', margin: 0, letterSpacing: '-0.02em' }}>
                  Newtonite Operations
                </h1>
                {user.isAdmin && (
                  <span style={{ fontSize: '0.6875rem', fontWeight: 700, backgroundColor: '#eff6ff', color: '#2563eb', padding: '0.15rem 0.5rem', borderRadius: '9999px', border: '1px solid #bfdbfe', textTransform: 'uppercase' }}>
                    Admin
                  </span>
                )}
              </div>
              <p style={{ color: '#64748b', fontSize: '0.875rem', margin: 0 }}>
                Welcome, <strong>{user.displayName}</strong> ({user.email})
              </p>
            </div>

            <button
              type="button"
              onClick={() => void logout()}
              style={{
                ...commonStyles.buttonSecondary,
                padding: '0.4rem 0.85rem',
                fontSize: '0.8125rem',
              }}
            >
              Log Out
            </button>
          </div>

          <nav style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem', marginTop: '1.5rem' }}>
            <Link
              to="/dashboard"
              style={{
                display: 'block',
                padding: '1.25rem',
                backgroundColor: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: '8px',
                textDecoration: 'none',
                transition: 'all 0.15s ease',
              }}
            >
              <div style={{ fontWeight: 700, color: '#0f172a', fontSize: '1rem', marginBottom: '0.25rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span>Dashboard</span>
                <span style={{ color: theme.colors.accent }}>&rarr;</span>
              </div>
              <p style={{ color: '#64748b', fontSize: '0.8125rem', margin: 0 }}>
                Triage queued items, assigned tickets, approvals, and overdue work.
              </p>
            </Link>

            <Link
              to="/items"
              style={{
                display: 'block',
                padding: '1.25rem',
                backgroundColor: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: '8px',
                textDecoration: 'none',
                transition: 'all 0.15s ease',
              }}
            >
              <div style={{ fontWeight: 700, color: '#0f172a', fontSize: '1rem', marginBottom: '0.25rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span>Items</span>
                <span style={{ color: theme.colors.accent }}>&rarr;</span>
              </div>
              <p style={{ color: '#64748b', fontSize: '0.8125rem', margin: 0 }}>
                Browse, search, and filter team work items with keyset pagination.
              </p>
            </Link>

            {user.isAdmin && (
              <Link
                to="/admin/jobs"
                style={{
                  display: 'block',
                  padding: '1.25rem',
                  backgroundColor: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: '8px',
                  textDecoration: 'none',
                  transition: 'all 0.15s ease',
                }}
              >
                <div style={{ fontWeight: 700, color: '#0f172a', fontSize: '1rem', marginBottom: '0.25rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span>Outbox Jobs</span>
                  <span style={{ color: theme.colors.accent }}>&rarr;</span>
                </div>
                <p style={{ color: '#64748b', fontSize: '0.8125rem', margin: 0 }}>
                  Monitor background email delivery queue, errors, and manual retries.
                </p>
              </Link>
            )}
          </nav>
        </div>
      </main>
    </div>
  )
}

export function AppRoutes(): React.ReactElement {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/redeem" element={<Redeem />} />
      <Route
        path="/dashboard"
        element={
          <div style={{ minHeight: '100vh', backgroundColor: '#f8fafc' }}>
            <AppHeader />
            <Dashboard />
          </div>
        }
      />
      <Route
        path="/items"
        element={
          <div style={{ minHeight: '100vh', backgroundColor: '#f8fafc' }}>
            <AppHeader />
            <ItemList />
          </div>
        }
      />
      <Route
        path="/items/new"
        element={
          <div style={{ minHeight: '100vh', backgroundColor: '#f8fafc' }}>
            <AppHeader />
            <ItemCreate />
          </div>
        }
      />
      <Route
        path="/items/:id"
        element={
          <div style={{ minHeight: '100vh', backgroundColor: '#f8fafc' }}>
            <AppHeader />
            <ItemDetail />
          </div>
        }
      />
      <Route
        path="/admin/jobs"
        element={
          <div style={{ minHeight: '100vh', backgroundColor: '#f8fafc' }}>
            <AppHeader />
            <OutboxJobs />
          </div>
        }
      />
      <Route path="/" element={<DashboardOrHome />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export function App(): React.ReactElement {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  )
}
