import React from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider, useAuth } from './auth/AuthContext'
import { AppLayout } from './components/AppLayout'
import { Login } from './pages/Login'
import { ForgotPassword } from './pages/ForgotPassword'
import { ResetPassword } from './pages/ResetPassword'
import { Redeem } from './pages/Redeem'
import { Dashboard } from './pages/Dashboard'
import { ItemList } from './pages/ItemList'
import { ItemDetail } from './pages/ItemDetail'
import { ItemCreate } from './pages/ItemCreate'
import { Team } from './pages/Team'
import { OutboxJobs } from './pages/OutboxJobs'
import { AdminUsers } from './pages/AdminUsers'
import { AdminTeams } from './pages/AdminTeams'
import { AdminAuditLog } from './pages/AdminAuditLog'
import { Notifications } from './pages/Notifications'
import { NotificationLiveProvider } from './components/NotificationLiveProvider'
import { Approvals } from './pages/Approvals'
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
    },
  },
})

export function RequireAuth({ children }: { children: React.ReactNode }): React.ReactElement {
  const { user, status } = useAuth()
  const location = useLocation()

  if (status === 'loading') {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b' }}>
        <div role="status">Restoring session…</div>
      </div>
    )
  }

  if (status === 'anon' || !user) {
    return <Navigate to="/login" replace state={{ from: location }} />
  }

  return <>{children}</>
}

export function DashboardOrHome(): React.ReactElement {
  const { user } = useAuth()

  // Admin holds NO team memberships — their operational purview is background Outbox Jobs!
  if (user?.isAdmin) {
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
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/redeem" element={<Redeem />} />
      <Route
        path="/dashboard"
        element={
          <RequireAuth>
            <AppLayout>
              <Dashboard />
            </AppLayout>
          </RequireAuth>
        }
      />
      <Route
        path="/approvals"
        element={
          <RequireAuth>
            <AppLayout>
              <Approvals />
            </AppLayout>
          </RequireAuth>
        }
      />
      <Route
        path="/items"
        element={
          <RequireAuth>
            <AppLayout>
              <ItemList />
            </AppLayout>
          </RequireAuth>
        }
      />
      <Route
        path="/items/new"
        element={
          <RequireAuth>
            <AppLayout>
              <ItemCreate />
            </AppLayout>
          </RequireAuth>
        }
      />
      <Route
        path="/items/:id"
        element={
          <RequireAuth>
            <AppLayout>
              <ItemDetail />
            </AppLayout>
          </RequireAuth>
        }
      />
      <Route
        path="/teams"
        element={
          <RequireAuth>
            <AppLayout>
              <Team />
            </AppLayout>
          </RequireAuth>
        }
      />
      <Route
        path="/teams/:id"
        element={
          <RequireAuth>
            <AppLayout>
              <Team />
            </AppLayout>
          </RequireAuth>
        }
      />
      <Route
        path="/notifications"
        element={
          <RequireAuth>
            <AppLayout>
              <Notifications />
            </AppLayout>
          </RequireAuth>
        }
      />
      <Route
        path="/admin/jobs"
        element={
          <RequireAuth>
            <AppLayout>
              <OutboxJobs />
            </AppLayout>
          </RequireAuth>
        }
      />
      <Route
        path="/admin/users"
        element={
          <RequireAuth>
            <AppLayout>
              <AdminUsers />
            </AppLayout>
          </RequireAuth>
        }
      />
      <Route
        path="/admin/teams"
        element={
          <RequireAuth>
            <AppLayout>
              <AdminTeams />
            </AppLayout>
          </RequireAuth>
        }
      />
      <Route
        path="/admin/audit-log"
        element={
          <RequireAuth>
            <AppLayout>
              <AdminAuditLog />
            </AppLayout>
          </RequireAuth>
        }
      />
      <Route
        path="/"
        element={
          <RequireAuth>
            <DashboardOrHome />
          </RequireAuth>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export function App(): React.ReactElement {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <NotificationLiveProvider>
            <AppRoutes />
          </NotificationLiveProvider>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  )
}
