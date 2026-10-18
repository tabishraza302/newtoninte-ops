import React from 'react'
import { BrowserRouter, Routes, Route, Navigate, Link } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider, useAuth } from './auth/AuthContext'
import { Login } from './pages/Login'
import { Redeem } from './pages/Redeem'
import { Dashboard } from './pages/Dashboard'
import { ItemList } from './pages/ItemList'
import { ItemDetail } from './pages/ItemDetail'
import { ItemCreate } from './pages/ItemCreate'
import { OutboxJobs } from './pages/OutboxJobs'

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
    return <div>Loading...</div>
  }

  if (status === 'anon' || !user) {
    return <Navigate to="/login" replace />
  }

  return (
    <main style={{ padding: '2rem', maxWidth: '800px', margin: '0 auto' }}>
      <h1>Newtonite Operations</h1>
      <p>Welcome, {user.displayName} ({user.email})</p>
      <nav style={{ margin: '1.5rem 0', display: 'flex', gap: '1rem' }}>
        <Link to="/dashboard" style={{ color: '#2563eb' }}>Dashboard</Link>
        <Link to="/items" style={{ color: '#2563eb' }}>Items</Link>
        {user.isAdmin && (
          <Link to="/admin/jobs" style={{ color: '#2563eb' }}>Outbox Jobs</Link>
        )}
      </nav>
      <button type="button" onClick={() => void logout()}>
        Log Out
      </button>
    </main>
  )
}

export function AppRoutes(): React.ReactElement {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/redeem" element={<Redeem />} />
      <Route path="/dashboard" element={<Dashboard />} />
      <Route path="/items" element={<ItemList />} />
      <Route path="/items/new" element={<ItemCreate />} />
      <Route path="/items/:id" element={<ItemDetail />} />
      <Route path="/admin/jobs" element={<OutboxJobs />} />
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
