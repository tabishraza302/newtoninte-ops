import React, { createContext, useContext, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { apiFetch, setAccessToken, setOnUnauthorized } from '../api/client'
export interface User {
  id: number
  email: string
  displayName: string
  isAdmin: boolean
  status?: 'active' | 'disabled'
  createdAt?: string
  updatedAt?: string
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
  const queryClient = useQueryClient()
  const generationRef = useRef(0)
  const restoreAbortControllerRef = useRef<AbortController | null>(null)
  const loginAbortControllerRef = useRef<AbortController | null>(null)
  const logoutPromiseRef = useRef<Promise<void> | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const [status, setStatus] = useState<'loading' | 'authed' | 'anon'>('loading')

  useEffect(() => {
    setOnUnauthorized(() => {
      restoreAbortControllerRef.current?.abort()
      restoreAbortControllerRef.current = null
      loginAbortControllerRef.current?.abort()
      loginAbortControllerRef.current = null

      generationRef.current++
      setAccessToken(null)
      setUser(null)
      setStatus('anon')
      queryClient.clear()
    })
    return () => setOnUnauthorized(null)
  }, [queryClient])

  useEffect(() => {
    const currentGen = ++generationRef.current
    let cancelled = false
    const abortController = new AbortController()
    restoreAbortControllerRef.current = abortController

    async function restoreSession() {
      try {
        const res = await fetch('/auth/refresh', {
          method: 'POST',
          credentials: 'include',
          signal: abortController.signal,
        })

        if (cancelled || abortController.signal.aborted || generationRef.current !== currentGen) return

        if (!res.ok) {
          setAccessToken(null)
          setUser(null)
          setStatus('anon')
          return
        }

        const data = (await res.json()) as { accessToken: string; user: User }
        if (cancelled || abortController.signal.aborted || generationRef.current !== currentGen) return

        setAccessToken(data.accessToken)
        setUser(data.user)
        setStatus('authed')
      } catch {
        if (cancelled || abortController.signal.aborted || generationRef.current !== currentGen) return
        setAccessToken(null)
        setUser(null)
        setStatus('anon')
      }
    }

    void restoreSession()

    return () => {
      cancelled = true
      abortController.abort()
      if (restoreAbortControllerRef.current === abortController) {
        restoreAbortControllerRef.current = null
      }
    }
  }, [])

  const login = async (email: string, pw: string): Promise<void> => {
    restoreAbortControllerRef.current?.abort()
    restoreAbortControllerRef.current = null

    loginAbortControllerRef.current?.abort()
    const abortController = new AbortController()
    loginAbortControllerRef.current = abortController

    if (logoutPromiseRef.current) {
      try {
        await logoutPromiseRef.current
      } catch {
        // Continue to login even if logout request errored
      }
    }

    if (abortController.signal.aborted) {
      return
    }

    const currentGen = ++generationRef.current
    try {
      const data = await apiFetch<{ accessToken: string; user: User }>('/auth/login', {
        method: 'POST',
        json: { email, password: pw },
        signal: abortController.signal,
      })
      if (abortController.signal.aborted || generationRef.current !== currentGen) return
      queryClient.clear()
      setAccessToken(data.accessToken)
      setUser(data.user)
      setStatus('authed')
    } catch (err) {
      if (abortController.signal.aborted || generationRef.current !== currentGen) {
        return
      }
      throw err
    } finally {
      if (loginAbortControllerRef.current === abortController) {
        loginAbortControllerRef.current = null
      }
    }
  }

  const logout = async (): Promise<void> => {
    restoreAbortControllerRef.current?.abort()
    restoreAbortControllerRef.current = null
    loginAbortControllerRef.current?.abort()
    loginAbortControllerRef.current = null

    const currentGen = ++generationRef.current
    setAccessToken(null)
    setUser(null)
    setStatus('anon')
    queryClient.clear()

    const logoutPromise = (async () => {
      try {
        await apiFetch('/auth/logout', { method: 'POST' })
      } finally {
        if (generationRef.current === currentGen) {
          queryClient.clear()
          setAccessToken(null)
          setUser(null)
          setStatus('anon')
        }
      }
    })()

    logoutPromiseRef.current = logoutPromise
    try {
      await logoutPromise
    } finally {
      if (logoutPromiseRef.current === logoutPromise) {
        logoutPromiseRef.current = null
      }
    }
  }

  const setAuthUser = (nextUser: User | null): void => {
    restoreAbortControllerRef.current?.abort()
    restoreAbortControllerRef.current = null
    loginAbortControllerRef.current?.abort()
    loginAbortControllerRef.current = null

    generationRef.current++
    if (user?.id !== nextUser?.id) {
      queryClient.clear()
    }
    setUser(nextUser)
    if (nextUser) {
      setStatus('authed')
    } else {
      setAccessToken(null)
      setStatus('anon')
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
