import React, { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useResetPassword } from '../api/hooks'
import { commonStyles, theme, getApiErrorMessage } from '../theme'

export function ResetPassword(): React.ReactElement {
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token') ?? ''

  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const resetMutation = useResetPassword()

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault()
    setError(null)

    if (!token) {
      setError('Password reset token is missing from the URL. Please request a new link.')
      return
    }

    const utf8Bytes = new TextEncoder().encode(password).length
    if (password.length < 8) {
      setError('Password must be at least 8 characters long.')
      return
    }
    if (utf8Bytes > 72) {
      setError('Password must not exceed 72 bytes.')
      return
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match. Please re-enter both fields.')
      return
    }

    try {
      await resetMutation.mutateAsync({ token, password })
      setSuccess(true)
    } catch (err) {
      setError(getApiErrorMessage(err, 'Failed to reset password. The link may have expired.'))
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
        padding: '1.5rem',
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
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#ffffff',
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
          Choose New Password
        </h1>
        <p style={{ margin: 0, color: theme.colors.textMuted, fontSize: '0.875rem' }}>
          Newtonite Operations Security Credentials
        </p>
      </div>

      <div
        style={{
          ...commonStyles.cardPadded,
          width: '100%',
          maxWidth: '420px',
          boxSizing: 'border-box',
        }}
      >
        {!token ? (
          <div role="alert">
            <div
              style={{
                padding: '1rem',
                backgroundColor: '#fef2f2',
                border: '1px solid #fecaca',
                borderRadius: '8px',
                color: '#991b1b',
                fontSize: '0.875rem',
                marginBottom: '1.25rem',
                lineHeight: 1.5,
              }}
            >
              <strong>Invalid Reset Link</strong>
              <p style={{ margin: '0.5rem 0 0', fontSize: '0.8125rem' }}>
                No reset token was found in the URL. If you received an email, please ensure you copied the full link.
              </p>
            </div>

            <Link
              to="/forgot-password"
              style={{
                ...commonStyles.buttonPrimary,
                width: '100%',
                boxSizing: 'border-box',
                textAlign: 'center',
              }}
            >
              Request a New Link
            </Link>
          </div>
        ) : success ? (
          <div role="status">
            <div
              style={{
                padding: '1rem',
                backgroundColor: '#f0fdf4',
                border: '1px solid #bbf7d0',
                borderRadius: '8px',
                color: '#166534',
                fontSize: '0.875rem',
                lineHeight: 1.5,
                marginBottom: '1.5rem',
              }}
            >
              <strong>Password Reset Successful</strong>
              <p style={{ margin: '0.5rem 0 0', fontSize: '0.8125rem' }}>
                Your password has been updated. In accordance with security policy, all previous active sessions have been revoked.
              </p>
            </div>

            <Link
              to="/login"
              style={{
                ...commonStyles.buttonPrimary,
                width: '100%',
                boxSizing: 'border-box',
                textAlign: 'center',
              }}
            >
              Log In with New Password
            </Link>
          </div>
        ) : (
          <form onSubmit={(e) => void handleSubmit(e)}>
            {error && (
              <div
                role="alert"
                style={{
                  ...commonStyles.alertError,
                  marginBottom: '1.25rem',
                }}
              >
                {error}
              </div>
            )}

            <div style={{ marginBottom: '1.25rem' }}>
              <label htmlFor="new-password" style={commonStyles.label}>
                New Password (minimum 8 characters)
              </label>
              <input
                id="new-password"
                type="password"
                required
                autoComplete="new-password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={commonStyles.input}
              />
            </div>

            <div style={{ marginBottom: '1.5rem' }}>
              <label htmlFor="confirm-password" style={commonStyles.label}>
                Confirm New Password
              </label>
              <input
                id="confirm-password"
                type="password"
                required
                autoComplete="new-password"
                placeholder="••••••••"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                style={commonStyles.input}
              />
            </div>

            <button
              type="submit"
              disabled={resetMutation.isPending}
              style={{
                ...commonStyles.buttonPrimary,
                width: '100%',
                boxSizing: 'border-box',
                opacity: resetMutation.isPending ? 0.7 : 1,
                cursor: resetMutation.isPending ? 'not-allowed' : 'pointer',
              }}
            >
              {resetMutation.isPending ? 'Resetting Password…' : 'Set New Password'}
            </button>

            <div style={{ marginTop: '1.25rem', textAlign: 'center' }}>
              <Link
                to="/login"
                style={{
                  fontSize: '0.8125rem',
                  color: theme.colors.accent,
                  textDecoration: 'none',
                  fontWeight: 600,
                }}
              >
                &larr; Cancel and Log In
              </Link>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
