import React from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './auth/AuthContext'
import { Login } from './pages/Login'
import { Redeem } from './pages/Redeem'

export function DashboardOrHome(): React.ReactElement {
  const { user, status, logout } = useAuth()

  if (status === 'loading') {
    return <div>Loading...</div>
  }

  if (status === 'anon' || !user) {
    return <Navigate to="/login" replace />
  }

  return (
    <main>
      <h1>Newtonite Operations</h1>
      <p>Welcome, {user.displayName} ({user.email})</p>
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
      <Route path="/" element={<DashboardOrHome />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export function App(): React.ReactElement {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AuthProvider>
  )
}
