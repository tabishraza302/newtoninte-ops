import React, { useState, useEffect } from 'react'
import { useSearchParams, Navigate } from 'react-router-dom'
import { useAdminUsers, useCreateAdminUser, useSetUserStatus, useTeams } from '../api/hooks'
import { type PublicUser, type Role, type ListAdminUsersQuery, type CreateAdminUserInput } from '../api/types'
import { ApiError } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { commonStyles, theme } from '../theme'

export function AdminUsers(): React.ReactElement {
  const { user, status } = useAuth()

  if (status === 'loading') {
    return (
      <div style={commonStyles.narrowContainer}>
        <div style={{ color: theme.colors.textMuted, padding: '2rem 0' }}>Checking authorization…</div>
      </div>
    )
  }

  if (status === 'anon' || !user) {
    return <Navigate to="/login" replace />
  }

  if (!user.isAdmin) {
    return (
      <div style={commonStyles.narrowContainer}>
        <div
          role="alert"
          style={{
            ...commonStyles.alertError,
            padding: '1.5rem',
            textAlign: 'center',
            display: 'block',
          }}
        >
          <div style={{ fontWeight: 700, fontSize: '1rem', marginBottom: '0.25rem' }}>Access Denied</div>
          <div>Not authorised - user management is admin only.</div>
        </div>
      </div>
    )
  }

  return <AdminUsersTable />
}

export function AdminUsersTable(): React.ReactElement {
  const [searchParams, setSearchParams] = useSearchParams()
  const qParam = searchParams.get('q') ?? ''

  const [cursor, setCursor] = useState<string | undefined>(undefined)
  const [users, setUsers] = useState<PublicUser[]>([])
  const [prevFilterKey, setPrevFilterKey] = useState(qParam)

  // Creation form state
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [email, setEmail] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [selectedTeamId, setSelectedTeamId] = useState<string>('')
  const [selectedRole, setSelectedRole] = useState<Role>('member')
  const [formError, setFormError] = useState<string | null>(null)
  const [actionSuccess, setActionSuccess] = useState<string | null>(null)
  const [mutatingUserId, setMutatingUserId] = useState<number | null>(null)

  if (qParam !== prevFilterKey) {
    setPrevFilterKey(qParam)
    setCursor(undefined)
    setUsers([])
  }

  const adminUsersQuery: ListAdminUsersQuery = {
    ...(qParam ? { q: qParam } : {}),
    ...(cursor ? { cursor } : {}),
  }
  const { data, isLoading, isFetching, error, refetch } = useAdminUsers(adminUsersQuery)

  const { data: teamsData } = useTeams({ all: true })
  const createUserMutation = useCreateAdminUser()
  const setStatusMutation = useSetUserStatus()

  useEffect(() => {
    if (data?.users) {
      if (!cursor) {
        setUsers(data.users)
      } else {
        setUsers((prev) => {
          const freshById = new Map(data.users.map((u: PublicUser) => [u.id, u]))
          const updated = prev.map((u) => freshById.get(u.id) ?? u)
          const prevIds = new Set(prev.map((u) => u.id))
          const additions = data.users.filter((u: PublicUser) => !prevIds.has(u.id))
          return [...updated, ...additions]
        })
      }
    }
  }, [data, cursor])

  const userCreationEnabled = data?.userCreationEnabled ?? false
  const nextCursor = data?.nextCursor ?? null

  const handleSearchChange = (val: string): void => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      if (val) {
        next.set('q', val)
      } else {
        next.delete('q')
      }
      return next
    })
  }

  const handleToggleStatus = async (targetUser: PublicUser): Promise<void> => {
    setFormError(null)
    setActionSuccess(null)
    const nextStatus = targetUser.status === 'active' ? 'disabled' : 'active'
    setMutatingUserId(targetUser.id)
    try {
      await setStatusMutation.mutateAsync({ id: targetUser.id, status: nextStatus })
      setActionSuccess(`User ${targetUser.email} is now ${nextStatus}.`)
      // Refresh list to eliminate stale accumulated rows
      setCursor(undefined)
      setUsers([])
      void refetch()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to update user status'
      setFormError(msg)
    } finally {
      setMutatingUserId(null)
    }
  }

  const handleCreateUser = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    setFormError(null)
    setActionSuccess(null)

    const trimmedName = displayName.trim()
    const trimmedEmail = email.trim().toLowerCase()

    if (!trimmedEmail) {
      setFormError('Email is required.')
      return
    }
    if (!trimmedName) {
      setFormError('Display name is required.')
      return
    }
    if (trimmedName.length > 120) {
      setFormError('Display name must not exceed 120 characters.')
      return
    }
    const utf8Bytes = new TextEncoder().encode(password).length
    if (password.length < 8) {
      setFormError('Password must be at least 8 characters long.')
      return
    }
    if (utf8Bytes > 72) {
      setFormError('Password must not exceed 72 UTF-8 bytes.')
      return
    }

    try {
      const teamIdNum = selectedTeamId ? Number(selectedTeamId) : undefined
      const payload: CreateAdminUserInput = {
        email: trimmedEmail,
        displayName: trimmedName,
        password,
        ...(teamIdNum !== undefined ? { teamId: teamIdNum, role: selectedRole } : {}),
      }
      const created = await createUserMutation.mutateAsync(payload)

      setActionSuccess(`User ${created.user.email} created successfully.`)
      setEmail('')
      setDisplayName('')
      setPassword('')
      setSelectedTeamId('')
      setSelectedRole('member')
      setShowCreateForm(false)
      // Refetch from beginning to see the newly created user and eliminate stale accumulated rows
      setCursor(undefined)
      setUsers([])
      void refetch()
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 409) {
          setFormError('A user with this email address already exists.')
          return
        }
        if (err.status === 403) {
          setFormError('User creation is disabled by system configuration.')
          return
        }
        if (typeof err.data === 'object' && err.data !== null && 'error' in err.data) {
          const dataObj = err.data as { error?: { message?: string; code?: string } | string }
          if (typeof dataObj.error === 'string') {
            setFormError(dataObj.error)
            return
          }
          if (dataObj.error?.message) {
            setFormError(dataObj.error.message)
            return
          }
        }
      }
      if (err instanceof Error) {
        setFormError(err.message)
      } else {
        setFormError('Failed to create user.')
      }
    }
  }

  return (
    <div className="admin-users-page" style={{ ...commonStyles.pageContainer, maxWidth: '100%', boxSizing: 'border-box' }}>
      <style>{`
        .admin-users-form-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 1rem;
          margin-bottom: 1.25rem;
        }
        @media (max-width: 600px) {
          .admin-users-form-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
      {/* Header */}
      <header
        style={{
          marginBottom: '1.75rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '1rem',
        }}
      >
        <div>
          <h1
            style={{
              fontSize: '1.75rem',
              fontWeight: 800,
              color: '#0f172a',
              margin: '0 0 0.35rem',
              letterSpacing: '-0.02em',
            }}
          >
            Users
          </h1>
          <p style={{ color: '#64748b', fontSize: '0.875rem', margin: 0 }}>
            Manage platform user accounts, authentication statuses, and team memberships
          </p>
        </div>

        <div>
          {userCreationEnabled ? (
            <button
              type="button"
              onClick={() => {
                setShowCreateForm((prev) => !prev)
                setFormError(null)
              }}
              style={commonStyles.buttonPrimary}
            >
              <span style={{ fontSize: '1rem', lineHeight: 1 }}>{showCreateForm ? '−' : '+'}</span>
              <span>{showCreateForm ? 'Cancel' : 'Create User'}</span>
            </button>
          ) : (
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.4rem',
                fontSize: '0.8125rem',
                color: '#64748b',
                backgroundColor: '#f1f5f9',
                border: '1px solid #cbd5e1',
                padding: '0.45rem 0.85rem',
                borderRadius: '6px',
                fontWeight: 500,
              }}
              title="User creation disabled by system configuration"
            >
              User Creation Disabled
            </div>
          )}
        </div>
      </header>

      {/* Notice when user creation is disabled by configuration */}
      {!userCreationEnabled && (
        <div
          role="status"
          style={{
            padding: '0.875rem 1.25rem',
            backgroundColor: '#fffbeb',
            border: '1px solid #fde68a',
            borderRadius: '8px',
            color: '#92400e',
            fontSize: '0.875rem',
            marginBottom: '1.5rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
          }}
        >
          <strong>Notice:</strong> User provisioning is currently disabled by system configuration
          (ADMIN_USER_CREATION_ENABLED=false). Existing accounts can still be managed.
        </div>
      )}

      {/* Global Action Messages */}
      {actionSuccess && (
        <div
          role="status"
          style={{
            padding: '0.75rem 1rem',
            backgroundColor: '#ecfdf5',
            border: '1px solid #a7f3d0',
            borderRadius: '6px',
            color: '#065f46',
            fontSize: '0.875rem',
            marginBottom: '1.5rem',
          }}
        >
          {actionSuccess}
        </div>
      )}

      {/* Create User Form Section */}
      {showCreateForm && userCreationEnabled && (
        <div
          style={{
            ...commonStyles.cardPadded,
            marginBottom: '1.75rem',
            backgroundColor: '#ffffff',
            border: '1px solid #cbd5e1',
          }}
        >
          <div style={{ marginBottom: '1.25rem' }}>
            <h2
              style={{
                fontSize: '1.125rem',
                fontWeight: 700,
                color: '#0f172a',
                margin: '0 0 0.25rem',
                letterSpacing: '-0.01em',
              }}
            >
              Provision New User
            </h2>
            <p style={{ fontSize: '0.8125rem', color: '#64748b', margin: 0 }}>
              Create an active platform user and optionally assign them to a team.
            </p>
          </div>

          {formError && (
            <div role="alert" style={{ ...commonStyles.alertError, marginBottom: '1.25rem' }}>
              {formError}
            </div>
          )}

          <form onSubmit={(e) => void handleCreateUser(e)}>
            <div className="admin-users-form-grid">
              <div>
                <label htmlFor="create-user-email" style={commonStyles.label}>
                  Email Address *
                </label>
                <input
                  id="create-user-email"
                  type="email"
                  required
                  placeholder="alex@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  style={commonStyles.input}
                  autoComplete="off"
                />
              </div>

              <div>
                <label htmlFor="create-user-name" style={commonStyles.label}>
                  Display Name *
                </label>
                <input
                  id="create-user-name"
                  type="text"
                  required
                  maxLength={120}
                  placeholder="Alex Rivera"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  style={commonStyles.input}
                />
              </div>

              <div>
                <label htmlFor="create-user-password" style={commonStyles.label}>
                  Initial Password (min 8 chars) *
                </label>
                <input
                  id="create-user-password"
                  type="password"
                  required
                  minLength={8}
                  maxLength={72}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  style={commonStyles.input}
                  autoComplete="new-password"
                />
              </div>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                gap: '1rem',
                marginBottom: '1.5rem',
                paddingTop: '0.75rem',
                borderTop: '1px solid #f1f5f9',
              }}
            >
              <div>
                <label htmlFor="create-user-team" style={commonStyles.label}>
                  Initial Team (Optional)
                </label>
                <select
                  id="create-user-team"
                  value={selectedTeamId}
                  onChange={(e) => setSelectedTeamId(e.target.value)}
                  style={commonStyles.select}
                >
                  <option value="">No Team (Unassigned)</option>
                  {teamsData?.teams.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({t.slug})
                    </option>
                  ))}
                </select>
              </div>

              {selectedTeamId && (
                <div>
                  <label htmlFor="create-user-role" style={commonStyles.label}>
                    Team Role *
                  </label>
                  <select
                    id="create-user-role"
                    value={selectedRole}
                    onChange={(e) => setSelectedRole(e.target.value as Role)}
                    style={commonStyles.select}
                  >
                    <option value="viewer">Viewer</option>
                    <option value="member">Member</option>
                    <option value="lead">Lead</option>
                  </select>
                </div>
              )}
            </div>

            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => {
                  setShowCreateForm(false)
                  setFormError(null)
                }}
                style={commonStyles.buttonSecondary}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={createUserMutation.isPending}
                style={{
                  ...commonStyles.buttonPrimary,
                  opacity: createUserMutation.isPending ? 0.7 : 1,
                  cursor: createUserMutation.isPending ? 'not-allowed' : 'pointer',
                }}
              >
                {createUserMutation.isPending ? 'Creating…' : 'Create User'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Filter / Search Bar */}
      <div
        className="filter-bar"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '1rem',
          padding: '1.25rem',
          backgroundColor: '#ffffff',
          borderRadius: '8px',
          border: '1px solid #e2e8f0',
          boxShadow: '0 1px 3px 0 rgba(15, 23, 42, 0.04)',
          marginBottom: '1.5rem',
          alignItems: 'center',
        }}
      >
        <div style={{ flex: '1 1 300px' }}>
          <label htmlFor="search-users-input" style={commonStyles.label}>
            Search Users
          </label>
          <input
            id="search-users-input"
            type="search"
            aria-label="Search users"
            placeholder="Search by name or email…"
            value={qParam}
            onChange={(e) => handleSearchChange(e.target.value)}
            style={commonStyles.input}
          />
        </div>
      </div>

      {/* Content Section */}
      <section aria-label="Users List">
        {isLoading && users.length === 0 && (
          <div
            role="status"
            style={{
              padding: '3rem',
              textAlign: 'center',
              color: '#64748b',
              backgroundColor: '#ffffff',
              borderRadius: '8px',
              border: '1px solid #e2e8f0',
              fontSize: '0.875rem',
            }}
          >
            Loading users…
          </div>
        )}

        {error && (
          <div role="alert" style={{ ...commonStyles.alertError, marginBottom: '1.5rem' }}>
            Failed to load users: {error.message}
          </div>
        )}

        {!isLoading && !error && users.length === 0 && (
          <div
            role="status"
            data-testid="empty-users-state"
            style={{
              padding: '4rem 1.5rem',
              textAlign: 'center',
              color: '#64748b',
              background: '#ffffff',
              borderRadius: '8px',
              border: '1px dashed #cbd5e1',
            }}
          >
            <div
              style={{
                fontWeight: 600,
                color: '#0f172a',
                marginBottom: '0.25rem',
                fontSize: '1rem',
              }}
            >
              No users found
            </div>
            <div style={{ fontSize: '0.875rem' }}>
              {qParam
                ? 'Try adjusting your search query.'
                : 'No users have been registered in the system.'}
            </div>
          </div>
        )}

        {users.length > 0 && (
          <div
            className="users-table-container"
            data-testid="users-table"
            style={{
              border: '1px solid #e2e8f0',
              borderRadius: '8px',
              overflowX: 'auto',
              backgroundColor: '#ffffff',
              boxShadow: '0 1px 3px 0 rgba(15, 23, 42, 0.04)',
              marginBottom: '1.5rem',
            }}
          >
            <table
              style={{
                width: '100%',
                borderCollapse: 'collapse',
                textAlign: 'left',
                fontSize: '0.875rem',
              }}
            >
              <thead>
                <tr
                  style={{
                    backgroundColor: '#f8fafc',
                    borderBottom: '1px solid #e2e8f0',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    color: '#64748b',
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                  }}
                >
                  <th style={{ padding: '0.75rem 1.25rem' }}>User</th>
                  <th style={{ padding: '0.75rem 1.25rem' }}>Role</th>
                  <th style={{ padding: '0.75rem 1.25rem' }}>Status</th>
                  <th style={{ padding: '0.75rem 1.25rem' }}>Created</th>
                  <th style={{ padding: '0.75rem 1.25rem', textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => {
                  const isMutating = mutatingUserId === u.id
                  const isActive = u.status === 'active'

                  return (
                    <tr
                      key={u.id}
                      style={{
                        borderBottom: '1px solid #f1f5f9',
                        transition: 'background-color 0.15s ease',
                      }}
                    >
                      <td style={{ padding: '0.875rem 1.25rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                          <div
                            style={{
                              width: '32px',
                              height: '32px',
                              borderRadius: '9999px',
                              backgroundColor: u.isAdmin ? theme.colors.accentSubtle : '#f1f5f9',
                              color: u.isAdmin ? theme.colors.accent : '#475569',
                              border: `1px solid ${u.isAdmin ? theme.colors.accentBorder : '#cbd5e1'}`,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontSize: '0.8125rem',
                              fontWeight: 700,
                            }}
                          >
                            {(u.displayName || u.email).charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <div style={{ fontWeight: 600, color: '#0f172a' }}>{u.displayName}</div>
                            <div style={{ fontSize: '0.75rem', color: '#64748b' }}>{u.email}</div>
                          </div>
                        </div>
                      </td>

                      <td style={{ padding: '0.875rem 1.25rem' }}>
                        {u.isAdmin ? (
                          <span
                            style={{
                              ...commonStyles.badgePill,
                              backgroundColor: theme.colors.accentSubtle,
                              color: theme.colors.accent,
                              border: `1px solid ${theme.colors.accentBorder}`,
                            }}
                          >
                            Admin
                          </span>
                        ) : (
                          <span
                            style={{
                              ...commonStyles.badgePill,
                              backgroundColor: '#f8fafc',
                              color: '#475569',
                              border: '1px solid #e2e8f0',
                            }}
                          >
                            User
                          </span>
                        )}
                      </td>

                      <td style={{ padding: '0.875rem 1.25rem' }}>
                        <span
                          style={{
                            ...commonStyles.badgePill,
                            backgroundColor: isActive ? '#ecfdf5' : '#fef2f2',
                            color: isActive ? '#059669' : '#dc2626',
                            border: `1px solid ${isActive ? '#a7f3d0' : '#fecaca'}`,
                          }}
                        >
                          {u.status}
                        </span>
                      </td>

                      <td style={{ padding: '0.875rem 1.25rem', color: '#64748b', whiteSpace: 'nowrap' }}>
                        {u.createdAt ? new Date(u.createdAt).toLocaleDateString() : '—'}
                      </td>

                      <td style={{ padding: '0.875rem 1.25rem', textAlign: 'right' }}>
                        <button
                          type="button"
                          disabled={isMutating}
                          onClick={() => void handleToggleStatus(u)}
                          aria-label={
                            isActive
                              ? `Disable user ${u.displayName}`
                              : `Enable user ${u.displayName}`
                          }
                          style={{
                            ...(isActive ? commonStyles.buttonDanger : commonStyles.buttonSecondary),
                            padding: '0.35rem 0.75rem',
                            fontSize: '0.75rem',
                            opacity: isMutating ? 0.6 : 1,
                            cursor: isMutating ? 'not-allowed' : 'pointer',
                          }}
                        >
                          {isMutating
                            ? 'Updating…'
                            : isActive
                              ? 'Disable'
                              : 'Enable'}
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Keyset Pagination Load More */}
        {nextCursor && (
          <div style={{ textAlign: 'center', marginTop: '1.5rem' }}>
            <button
              type="button"
              onClick={() => setCursor(nextCursor)}
              disabled={isFetching}
              style={{
                ...commonStyles.buttonSecondary,
                padding: '0.65rem 1.75rem',
                fontSize: '0.875rem',
                fontWeight: 600,
                cursor: isFetching ? 'not-allowed' : 'pointer',
                opacity: isFetching ? 0.7 : 1,
              }}
            >
              {isFetching ? 'Loading more users…' : 'Load more users'}
            </button>
          </div>
        )}
      </section>
    </div>
  )
}
