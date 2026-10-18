import React, { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { apiFetch, setAccessToken } from '../api/client'
import { useAuth, type User } from '../auth/AuthContext'

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
    <div className="redeem-container">
      <h2>Redeem Invitation</h2>
      {error && (
        <div role="alert" className="error-message">
          {error}
        </div>
      )}
      <form onSubmit={handleSubmit}>
        <div>
          <label htmlFor="code">Invitation Code</label>
          <input
            id="code"
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            required
          />
        </div>
        <div>
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
          />
        </div>
        <div>
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="new-password"
          />
        </div>
        <div>
          <label htmlFor="displayName">Display Name</label>
          <input
            id="displayName"
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            required
          />
        </div>
        <button type="submit" disabled={loading}>
          {loading ? 'Redeeming...' : 'Redeem Invitation'}
        </button>
      </form>
      <p>
        Already have an account? <Link to="/login">Log in</Link>
      </p>
    </div>
  )
}
