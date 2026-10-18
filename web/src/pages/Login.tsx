import React, { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { ApiError } from '../api/client'
import { commonStyles, theme } from '../theme'

export function Login(): React.ReactElement {
  const { login } = useAuth()
  const navigate = useNavigate()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      await login(email, password)
      navigate('/')
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setError('Invalid credentials')
      } else if (err instanceof Error) {
        setError(err.message || 'Invalid credentials')
      } else {
        setError('Invalid credentials')
      }
    } finally {
      setLoading(false)
    }
  }

  const fillDemo = (demoEmail: string): void => {
    setEmail(demoEmail)
    setPassword('Passw0rd!')
    setError(null)
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
          Mission-critical operations platform
        </p>
      </div>

      <div
        className="login-container"
        style={{
          width: '100%',
          maxWidth: '420px',
          backgroundColor: '#ffffff',
          borderRadius: '12px',
          border: '1px solid #e2e8f0',
          boxShadow: '0 10px 25px -5px rgba(15, 23, 42, 0.06), 0 8px 10px -6px rgba(15, 23, 42, 0.04)',
          padding: '2.25rem',
        }}
      >
        <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#0f172a', margin: '0 0 0.5rem' }}>
          Log In
        </h2>
        <p style={{ color: '#64748b', fontSize: '0.875rem', margin: '0 0 1.5rem' }}>
          Sign in to access your teams and work items
        </p>

        {error && (
          <div role="alert" className="error-message" style={{ ...commonStyles.alertError, marginBottom: '1.25rem' }}>
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '1.125rem' }}>
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
              placeholder="name@newtonite.test"
              style={commonStyles.input}
            />
          </div>

          <div style={{ marginBottom: '1.5rem' }}>
            <label htmlFor="password" style={commonStyles.label}>
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
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
              padding: '0.7rem 1.25rem',
              fontSize: '0.9375rem',
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.75 : 1,
            }}
          >
            {loading ? 'Logging in...' : 'Log In'}
          </button>
        </form>

        <div style={{ marginTop: '1.5rem', paddingTop: '1.25rem', borderTop: '1px solid #f1f5f9' }}>
          <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.5rem' }}>
            Quick demo credentials
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem' }}>
            {[
              { label: 'Admin', email: 'admin@newtonite.test' },
              { label: 'Lead', email: 'lead@newtonite.test' },
              { label: 'Member', email: 'member@newtonite.test' },
              { label: 'Viewer', email: 'viewer@newtonite.test' },
            ].map((role) => (
              <button
                key={role.label}
                type="button"
                onClick={() => fillDemo(role.email)}
                style={{
                  padding: '0.25rem 0.5rem',
                  fontSize: '0.75rem',
                  backgroundColor: '#f8fafc',
                  color: '#475569',
                  border: '1px solid #e2e8f0',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontWeight: 500,
                  fontFamily: 'inherit',
                }}
              >
                {role.label}
              </button>
            ))}
          </div>
        </div>

        <p style={{ marginTop: '1.5rem', marginBottom: 0, fontSize: '0.875rem', color: '#64748b', textAlign: 'center' }}>
          Have an invitation code?{' '}
          <Link to="/redeem" style={{ color: theme.colors.accent, fontWeight: 600 }}>
            Redeem invitation
          </Link>
        </p>
      </div>
    </div>
  )
}
