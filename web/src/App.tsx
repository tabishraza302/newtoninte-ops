import React from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider, useAuth } from './auth/AuthContext'
import { AppLayout } from './components/AppLayout'
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
  const { user, status } = useAuth()

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

  // Admin holds NO team memberships — their operational purview is background Outbox Jobs!
  if (user.isAdmin) {
    return (
      <AppLayout>
        <OutboxJobs />
      </AppLayout>
    )
  }

  // Team roles (lead, member, viewer) have triage queues on the Dashboard:
  return (
    <AppLayout>
      <Dashboard />
    </AppLayout>
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
          <AppLayout>
            <Dashboard />
          </AppLayout>
        }
      />
      <Route
        path="/items"
        element={
          <AppLayout>
            <ItemList />
          </AppLayout>
        }
      />
      <Route
        path="/items/new"
        element={
          <AppLayout>
            <ItemCreate />
          </AppLayout>
        }
      />
      <Route
        path="/items/:id"
        element={
          <AppLayout>
            <ItemDetail />
          </AppLayout>
        }
      />
      <Route
        path="/admin/jobs"
        element={
          <AppLayout>
            <OutboxJobs />
          </AppLayout>
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
