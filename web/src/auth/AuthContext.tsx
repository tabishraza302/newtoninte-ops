import React, { createContext, useContext, useEffect, useState, useTransition } from 'react'
import { apiFetch, setAccessToken } from '../api/client'

export interface User {
  id: number
  email: string
  displayName: string
  isAdmin: boolean
}

export interface AuthContextValue {
  user: User | null
  status: 'loading' | 'authed' | 'anon'
  login(email: string, pw: string): Promise<void>
  logout(): Promise<void>
  setAuthUser(user: User | null): void
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [user, setUser] = useState<User | null>(null)
  const [status, setStatus] = useState<'loading' | 'authed' | 'anon'>('loading')
  const [, startTransition] = useTransition()

  useEffect(() => {
    let cancelled = false

    async function restoreSession() {
      try {
        const res = await fetch('/auth/refresh', {
          method: 'POST',
          credentials: 'include',
        })

        if (!res.ok) {
          if (!cancelled) {
            setAccessToken(null)
            setUser(null)
            setStatus('anon')
          }
          return
        }

        const data = (await res.json()) as { accessToken: string; user: User }
        if (!cancelled) {
          setAccessToken(data.accessToken)
          setUser(data.user)
          setStatus('authed')
        }
      } catch {
        if (!cancelled) {
          setAccessToken(null)
          setUser(null)
          setStatus('anon')
        }
      }
    }

    startTransition(() => {
      void restoreSession()
    })

    return () => {
      cancelled = true
    }
  }, [])

  const login = async (email: string, pw: string): Promise<void> => {
    const data = await apiFetch<{ accessToken: string; user: User }>('/auth/login', {
      method: 'POST',
      json: { email, password: pw },
    })
    setAccessToken(data.accessToken)
    setUser(data.user)
    setStatus('authed')
  }

  const logout = async (): Promise<void> => {
    try {
      await apiFetch('/auth/logout', { method: 'POST' })
    } finally {
      setAccessToken(null)
      setUser(null)
      setStatus('anon')
    }
  }

  const setAuthUser = (nextUser: User | null): void => {
    setUser(nextUser)
    if (nextUser) {
      setStatus('authed')
    }
  }

  return (
    <AuthContext.Provider value={{ user, status, login, logout, setAuthUser }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return ctx
}

export function useOptionalAuth(): AuthContextValue | null {
  return useContext(AuthContext)
}
