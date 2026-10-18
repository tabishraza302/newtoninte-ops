import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import { useForgotPassword } from '../api/hooks'
import { commonStyles, theme, getApiErrorMessage } from '../theme'

export function ForgotPassword(): React.ReactElement {
  const [email, setEmail] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const forgotMutation = useForgotPassword()

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault()
    setError(null)

    const trimmed = email.trim()
    if (!trimmed) {
      setError('Please enter your account email address.')
      return
    }

    try {
      await forgotMutation.mutateAsync({ email: trimmed })
      setSubmitted(true)
    } catch (err) {
      setError(getApiErrorMessage(err, 'Failed to process password reset request.'))
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
          Reset Password
        </h1>
        <p style={{ margin: 0, color: theme.colors.textMuted, fontSize: '0.875rem' }}>
          Newtonite Operations Account Recovery
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
        {submitted ? (
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
              <strong>Check your inbox</strong>
              <p style={{ margin: '0.5rem 0 0', fontSize: '0.8125rem' }}>
                If an active account exists for <strong>{email}</strong>, a single-use password reset
                link has been sent. Follow the instructions in the email to set a new password.
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
              Return to Log In
            </Link>
          </div>
        ) : (
          <form onSubmit={(e) => void handleSubmit(e)}>
            <p style={{ fontSize: '0.875rem', color: theme.colors.textSecondary, marginTop: 0, marginBottom: '1.25rem', lineHeight: 1.5 }}>
              Enter your work email address below. We will send a secure password reset link to your registered inbox.
            </p>

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
              <label htmlFor="reset-email" style={commonStyles.label}>
                Email address
              </label>
              <input
                id="reset-email"
                type="email"
                required
                autoComplete="email"
                placeholder="name@newtonite.test"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                style={commonStyles.input}
              />
            </div>

            <button
              type="submit"
              disabled={forgotMutation.isPending}
              style={{
                ...commonStyles.buttonPrimary,
                width: '100%',
                boxSizing: 'border-box',
                opacity: forgotMutation.isPending ? 0.7 : 1,
                cursor: forgotMutation.isPending ? 'not-allowed' : 'pointer',
              }}
            >
              {forgotMutation.isPending ? 'Sending Link…' : 'Send Reset Link'}
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
                &larr; Back to Log In
              </Link>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
