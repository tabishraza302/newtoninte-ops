import React, { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider, useAuth } from './auth/AuthContext'
import { AppLayout } from './components/AppLayout'
import { NotificationLiveProvider } from './components/NotificationLiveProvider'

const Login = lazy(() => import('./pages/Login').then((m) => ({ default: m.Login })))
const ForgotPassword = lazy(() => import('./pages/ForgotPassword').then((m) => ({ default: m.ForgotPassword })))
const ResetPassword = lazy(() => import('./pages/ResetPassword').then((m) => ({ default: m.ResetPassword })))
const Redeem = lazy(() => import('./pages/Redeem').then((m) => ({ default: m.Redeem })))
const Dashboard = lazy(() => import('./pages/Dashboard').then((m) => ({ default: m.Dashboard })))
const ItemList = lazy(() => import('./pages/ItemList').then((m) => ({ default: m.ItemList })))
const ItemDetail = lazy(() => import('./pages/ItemDetail').then((m) => ({ default: m.ItemDetail })))
const ItemCreate = lazy(() => import('./pages/ItemCreate').then((m) => ({ default: m.ItemCreate })))
const Team = lazy(() => import('./pages/Team').then((m) => ({ default: m.Team })))
const OutboxJobs = lazy(() => import('./pages/OutboxJobs').then((m) => ({ default: m.OutboxJobs })))
const AdminUsers = lazy(() => import('./pages/AdminUsers').then((m) => ({ default: m.AdminUsers })))
const AdminTeams = lazy(() => import('./pages/AdminTeams').then((m) => ({ default: m.AdminTeams })))
const AdminAuditLog = lazy(() => import('./pages/AdminAuditLog').then((m) => ({ default: m.AdminAuditLog })))
const Notifications = lazy(() => import('./pages/Notifications').then((m) => ({ default: m.Notifications })))
const Approvals = lazy(() => import('./pages/Approvals').then((m) => ({ default: m.Approvals })))

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
    <Suspense fallback={<div role="status">Loading page…</div>}>
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
    </Suspense>
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
