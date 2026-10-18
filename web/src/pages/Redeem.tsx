import React, { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { apiFetch, setAccessToken } from '../api/client'
import { useAuth, type User } from '../auth/AuthContext'
import type { MeResponse } from '../api/types'
import { commonStyles, theme, getApiErrorMessage } from '../theme'

interface RedeemResponse {
  accessToken: string
  user: User
  teamId: number
  role: string
}

export function Redeem(): React.ReactElement {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { user, status, setAuthUser, logout } = useAuth()
  const [code, setCode] = useState(searchParams.get('code') ?? '')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const isAuthenticated = status === 'authed' && !!user

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const trimmedCode = code.trim()
    if (!trimmedCode) {
      setError('Please provide a valid invitation code.')
      setLoading(false)
      return
    }

    try {
      if (isAuthenticated) {
        // Authenticated redemption: caller joins team with existing account
        const res = await apiFetch<RedeemResponse>('/invitations/redeem', {
          method: 'POST',
          json: { code: trimmedCode },
        })
        if (res.accessToken) {
          setAccessToken(res.accessToken)
        }
        queryClient.clear()
        const me = await apiFetch<MeResponse>('/auth/me')
        setAuthUser(me.user)
        navigate('/')
      } else {
        // Unauthenticated redemption: creates user account and joins team atomically
        const trimmedEmail = email.trim()
        const trimmedName = displayName.trim()
        if (!trimmedEmail) {
          setError('Email address is required.')
          setLoading(false)
          return
        }
        const utf8Bytes = new TextEncoder().encode(password).length
        if (password.length < 8) {
          setError('Password must be at least 8 characters.')
          setLoading(false)
          return
        }
        if (utf8Bytes > 72) {
          setError('Password must not exceed 72 bytes.')
          setLoading(false)
          return
        }
        if (!trimmedName) {
          setError('Display name is required.')
          setLoading(false)
          return
        }

        const res = await apiFetch<RedeemResponse>('/invitations/redeem', {
          method: 'POST',
          json: {
            code: trimmedCode,
            email: trimmedEmail,
            password,
            displayName: trimmedName,
          },
        })
        setAccessToken(res.accessToken)
        queryClient.clear()
        const me = await apiFetch<MeResponse>('/auth/me')
        setAuthUser(me.user)
        navigate('/')
      }
    } catch (err) {
      setError(getApiErrorMessage(err, 'Failed to redeem invitation code.'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: theme.colors.bgApp,
        padding: '2rem 1.5rem',
        boxSizing: 'border-box',
        fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}
    >
      <div style={{ marginBottom: '2rem', textAlign: 'center' }}>
        <div
          style={{
            width: '42px',
            height: '42px',
            borderRadius: '10px',
            backgroundColor: theme.colors.accent,
            color: '#ffffff',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 800,
            fontSize: '1.25rem',
            marginBottom: '0.75rem',
          }}
        >
          N
        </div>
        <h1
          style={{
            fontSize: '1.5rem',
            fontWeight: 800,
            color: theme.colors.textPrimary,
            margin: '0 0 0.35rem',
            letterSpacing: '-0.02em',
          }}
        >
          Redeem Invitation
        </h1>
        <p style={{ margin: 0, color: theme.colors.textMuted, fontSize: '0.875rem' }}>
          Join an operations team workspace
        </p>
      </div>

      <div
        style={{
          ...commonStyles.cardPadded,
          width: '100%',
          maxWidth: '460px',
          boxSizing: 'border-box',
        }}
      >
        {isAuthenticated ? (
          <div>
            <div
              style={{
                padding: '0.875rem 1rem',
                backgroundColor: theme.colors.accentSubtle,
                border: `1px solid ${theme.colors.accentBorder}`,
                borderRadius: '8px',
                marginBottom: '1.25rem',
                fontSize: '0.875rem',
                color: theme.colors.textSecondary,
              }}
            >
              Signed in as <strong>{user.displayName}</strong> ({user.email}).
              <div style={{ marginTop: '0.35rem', fontSize: '0.8125rem', color: theme.colors.textMuted }}>
                Redeeming this invitation will add this team membership directly to your current account.
              </div>
            </div>

            {error && (
              <div role="alert" style={{ ...commonStyles.alertError, marginBottom: '1.25rem' }}>
                {error}
              </div>
            )}

            <form onSubmit={(e) => void handleSubmit(e)}>
              <div style={{ marginBottom: '1.25rem' }}>
                <label htmlFor="code-auth" style={commonStyles.label}>
                  Invitation Code *
                </label>
                <input
                  id="code-auth"
                  type="text"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  required
                  placeholder="Paste invitation code here"
                  style={{ ...commonStyles.input, fontFamily: 'monospace' }}
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                style={{
                  ...commonStyles.buttonPrimary,
                  width: '100%',
                  boxSizing: 'border-box',
                  opacity: loading ? 0.7 : 1,
                  cursor: loading ? 'not-allowed' : 'pointer',
                }}
              >
                {loading ? 'Joining Team…' : 'Join Team with Current Account'}
              </button>
            </form>

            <div style={{ marginTop: '1.25rem', textAlign: 'center', fontSize: '0.8125rem' }}>
              <span style={{ color: theme.colors.textMuted }}>Not you? </span>
              <button
                type="button"
                onClick={() => void logout()}
                style={{
                  background: 'none',
                  border: 'none',
                  color: theme.colors.accent,
                  cursor: 'pointer',
                  fontWeight: 600,
                  fontSize: 'inherit',
                  padding: 0,
                  fontFamily: 'inherit',
                }}
              >
                Log out
              </button>
              <span style={{ color: theme.colors.textMuted }}> to redeem with another account.</span>
            </div>
          </div>
        ) : (
          <div>
            <h2 style={{ fontSize: '1.125rem', fontWeight: 700, color: theme.colors.textPrimary, margin: '0 0 0.5rem' }}>
              Create Account & Join Team
            </h2>
            <p style={{ color: theme.colors.textMuted, fontSize: '0.8125rem', margin: '0 0 1.25rem', lineHeight: 1.4 }}>
              Enter the invitation code received via email and set up your login credentials.
            </p>

            {error && (
              <div role="alert" style={{ ...commonStyles.alertError, marginBottom: '1.25rem' }}>
                {error}
              </div>
            )}

            <form onSubmit={(e) => void handleSubmit(e)}>
              <div style={{ marginBottom: '1rem' }}>
                <label htmlFor="code" style={commonStyles.label}>
                  Invitation Code *
                </label>
                <input
                  id="code"
                  type="text"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  required
                  placeholder="Paste code from email"
                  style={{ ...commonStyles.input, fontFamily: 'monospace' }}
                />
              </div>

              <div style={{ marginBottom: '1rem' }}>
                <label htmlFor="email" style={commonStyles.label}>
                  Work Email (must match invited address) *
                </label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  placeholder="name@newtonite.test"
                  style={commonStyles.input}
                />
              </div>

              <div style={{ marginBottom: '1rem' }}>
                <label htmlFor="displayName" style={commonStyles.label}>
                  Display Name *
                </label>
                <input
                  id="displayName"
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  required
                  placeholder="Full Name"
                  style={commonStyles.input}
                />
              </div>

              <div style={{ marginBottom: '1.5rem' }}>
                <label htmlFor="password" style={commonStyles.label}>
                  Password (minimum 8 characters) *
                </label>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="new-password"
                  placeholder="••••••••"
                  style={commonStyles.input}
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                style={{
                  ...commonStyles.buttonPrimary,
                  width: '100%',
                  boxSizing: 'border-box',
                  opacity: loading ? 0.7 : 1,
                  cursor: loading ? 'not-allowed' : 'pointer',
                }}
              >
                {loading ? 'Creating Account & Joining…' : 'Redeem Invitation'}
              </button>
            </form>

            <div style={{ marginTop: '1.5rem', textAlign: 'center', borderTop: '1px solid #f1f5f9', paddingTop: '1rem' }}>
              <span style={{ fontSize: '0.8125rem', color: theme.colors.textMuted }}>
                Already have an active account?{' '}
                <Link to="/login" style={{ color: theme.colors.accent, fontWeight: 600, textDecoration: 'none' }}>
                  Log in first
                </Link>
                {' '}to join seamlessly.
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
