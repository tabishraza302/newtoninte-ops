import React, { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { apiFetch, setAccessToken } from '../api/client'
import { useAuth, type User } from '../auth/AuthContext'
import { commonStyles, theme } from '../theme'

interface RedeemResponse {
  accessToken: string
}

export function Redeem(): React.ReactElement {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { setAuthUser } = useAuth()

  const [code, setCode] = useState(searchParams.get('code') ?? '')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      const { accessToken } = await apiFetch<RedeemResponse>('/invitations/redeem', {
        method: 'POST',
        json: { code, email, password, displayName },
      })
      setAccessToken(accessToken)

      const me = await apiFetch<User>('/auth/me')
      setAuthUser(me)

      navigate('/')
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message || 'Failed to redeem invitation')
      } else {
        setError('Failed to redeem invitation')
      }
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
        padding: '2rem 1rem',
        backgroundColor: '#f8fafc',
      }}
    >
      <div style={{ marginBottom: '2rem', textAlign: 'center' }}>
        <div
          style={{
            width: '44px',
            height: '44px',
            borderRadius: '10px',
            backgroundColor: '#2563eb',
            color: '#ffffff',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 800,
            fontSize: '1.25rem',
            boxShadow: '0 4px 14px rgba(37, 99, 235, 0.35)',
            marginBottom: '0.75rem',
          }}
        >
          N
        </div>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 800, color: '#0f172a', margin: 0, letterSpacing: '-0.02em' }}>
          Newtonite Operations
        </h1>
        <p style={{ color: '#64748b', fontSize: '0.875rem', margin: '0.25rem 0 0' }}>
          Invitation onboarding
        </p>
      </div>

      <div
        className="redeem-container"
        style={{
          width: '100%',
          maxWidth: '460px',
          backgroundColor: '#ffffff',
          borderRadius: '12px',
          border: '1px solid #e2e8f0',
          boxShadow: '0 10px 25px -5px rgba(15, 23, 42, 0.06), 0 8px 10px -6px rgba(15, 23, 42, 0.04)',
          padding: '2.25rem',
        }}
      >
        <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#0f172a', margin: '0 0 0.5rem' }}>
          Redeem Invitation
        </h2>
        <p style={{ color: '#64748b', fontSize: '0.875rem', margin: '0 0 1.5rem' }}>
          Set up your credentials to join your team
        </p>

        {error && (
          <div role="alert" className="error-message" style={{ ...commonStyles.alertError, marginBottom: '1.25rem' }}>
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '1rem' }}>
            <label htmlFor="code" style={commonStyles.label}>
              Invitation Code
            </label>
            <input
              id="code"
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
              placeholder="e.g. inv_ab12cd34"
              style={commonStyles.input}
            />
          </div>

          <div style={{ marginBottom: '1rem' }}>
            <label htmlFor="email" style={commonStyles.label}>
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              placeholder="you@company.com"
              style={commonStyles.input}
            />
          </div>

          <div style={{ marginBottom: '1rem' }}>
            <label htmlFor="password" style={commonStyles.label}>
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="new-password"
              placeholder="At least 8 characters"
              style={commonStyles.input}
            />
          </div>

          <div style={{ marginBottom: '1.5rem' }}>
            <label htmlFor="displayName" style={commonStyles.label}>
              Display Name
            </label>
            <input
              id="displayName"
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
              placeholder="Jane Doe"
              style={commonStyles.input}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            style={{
              ...commonStyles.buttonPrimary,
              width: '100%',
              padding: '0.7rem 1.25rem',
              fontSize: '0.9375rem',
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.75 : 1,
            }}
          >
            {loading ? 'Redeeming...' : 'Redeem Invitation'}
          </button>
        </form>

        <p style={{ marginTop: '1.5rem', marginBottom: 0, fontSize: '0.875rem', color: '#64748b', textAlign: 'center' }}>
          Already have an account?{' '}
          <Link to="/login" style={{ color: theme.colors.accent, fontWeight: 600 }}>
            Log in
          </Link>
        </p>
      </div>
    </div>
  )
}
