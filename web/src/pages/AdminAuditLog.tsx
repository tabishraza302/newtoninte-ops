import React, { useState, useEffect, useRef } from 'react'
import { useSearchParams, Navigate } from 'react-router-dom'
import { useAdminAuditLog } from '../api/hooks'
import {
  ADMIN_AUDIT_ACTIONS,
  type AdminAuditAction,
  type AdminAuditEvent,
  type ListAdminAuditQuery,
} from '../api/types'
import { useAuth } from '../auth/AuthContext'
import { commonStyles, theme } from '../theme'

function assertNever(value: never): never {
  throw new Error(`Unhandled audit action: ${String(value)}`)
}

function getString(record: Record<string, unknown>, key: string): string | undefined {
  const val = record[key]
  return typeof val === 'string' && val.trim() ? val.trim() : undefined
}

function getNumber(record: Record<string, unknown>, key: string): number | undefined {
  const val = record[key]
  return typeof val === 'number' && Number.isFinite(val) ? val : undefined
}

function formatAuditAction(action: AdminAuditAction): string {
  switch (action) {
    case 'user_created':
      return 'User Created'
    case 'user_status_changed':
      return 'User Status Changed'
    case 'team_created':
      return 'Team Created'
    case 'membership_added':
      return 'Membership Added'
    case 'membership_role_changed':
      return 'Role Changed'
    case 'membership_removed':
      return 'Membership Removed'
    case 'job_retried':
      return 'Job Retried'
    default:
      return assertNever(action)
  }
}

function formatAuditMetadata(
  action: AdminAuditAction,
  metadata: Record<string, unknown> = {},
): string {
  switch (action) {
    case 'user_created': {
      const email = getString(metadata, 'email') ?? ''
      const name = getString(metadata, 'displayName') ?? ''
      const userId = getNumber(metadata, 'userId')
      return name ? `${name} (${email})` : (email || (userId ? `User #${userId}` : 'User'))
    }
    case 'user_status_changed': {
      const email = getString(metadata, 'email') ?? ''
      const name = getString(metadata, 'displayName') ?? ''
      const from = getString(metadata, 'fromStatus') ?? 'unknown'
      const to = getString(metadata, 'toStatus') ?? 'unknown'
      const user = name ? `${name} (${email})` : email
      return user ? `${user}: ${from} → ${to}` : `${from} → ${to}`
    }
    case 'team_created': {
      const teamId = getNumber(metadata, 'teamId')
      const name = getString(metadata, 'name') ?? (teamId ? `Team #${teamId}` : 'Team')
      const slug = getString(metadata, 'slug') ?? ''
      return slug ? `${name} (${slug})` : name
    }
    case 'membership_added': {
      const name = getString(metadata, 'displayName') ?? ''
      const email = getString(metadata, 'email') ?? ''
      const userId = getNumber(metadata, 'userId')
      const teamName = getString(metadata, 'teamName')
      const teamId = getNumber(metadata, 'teamId')
      const team = teamName ?? (teamId ? `Team #${teamId}` : 'team')
      const toRole = getString(metadata, 'toRole') ?? 'member'
      const fromRoleVal = getString(metadata, 'fromRole')
      const fromRole = fromRoleVal ? `${fromRoleVal} → ` : ''
      const user = name ? `${name} (${email})` : (email || (userId ? `User #${userId}` : 'User'))
      return `${user} added to ${team} (${fromRole}${toRole})`
    }
    case 'membership_role_changed': {
      const name = getString(metadata, 'displayName') ?? ''
      const email = getString(metadata, 'email') ?? ''
      const userId = getNumber(metadata, 'userId')
      const teamName = getString(metadata, 'teamName')
      const teamId = getNumber(metadata, 'teamId')
      const team = teamName ?? (teamId ? `Team #${teamId}` : 'team')
      const fromRole = getString(metadata, 'fromRole') ?? 'unknown'
      const toRole = getString(metadata, 'toRole') ?? 'unknown'
      const user = name ? `${name} (${email})` : (email || (userId ? `User #${userId}` : 'User'))
      return `${user} in ${team}: ${fromRole} → ${toRole}`
    }
    case 'membership_removed': {
      const name = getString(metadata, 'displayName') ?? ''
      const email = getString(metadata, 'email') ?? ''
      const userId = getNumber(metadata, 'userId')
      const teamName = getString(metadata, 'teamName')
      const teamId = getNumber(metadata, 'teamId')
      const team = teamName ?? (teamId ? `Team #${teamId}` : 'team')
      const fromRoleVal = getString(metadata, 'fromRole')
      const fromRole = fromRoleVal ? ` (was ${fromRoleVal})` : ''
      const user = name ? `${name} (${email})` : (email || (userId ? `User #${userId}` : 'User'))
      return `${user} removed from ${team}${fromRole}`
    }
    case 'job_retried': {
      const type = getString(metadata, 'type') ?? 'job'
      const attempts = getNumber(metadata, 'previousAttempts')
      const attemptsStr = attempts !== undefined ? `attempts: ${attempts}` : ''
      const error = getString(metadata, 'previousLastError')
      const errorStr = error ? `error: ${error}` : ''
      const details = [attemptsStr, errorStr].filter(Boolean).join(', ')
      return details ? `${type} (${details})` : type
    }
    default:
      return assertNever(action)
  }
}


export function AdminAuditLog(): React.ReactElement {
  const { user, status } = useAuth()

  if (status === 'loading') {
    return (
      <div style={commonStyles.narrowContainer}>
        <div role="status" style={{ color: theme.colors.textMuted, padding: '2rem 0' }}>
          Checking authorization…
        </div>
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
          <div>Not authorised - audit log is admin only.</div>
        </div>
      </div>
    )
  }

  return <AdminAuditLogContent />
}

export function AdminAuditLogContent(): React.ReactElement {
  const [searchParams, setSearchParams] = useSearchParams()
  const actionParam = searchParams.get('action') ?? ''
  const qParam = searchParams.get('q') ?? ''

  // Synchronous local state for search input to preserve keystrokes during router transitions
  const [searchInput, setSearchInput] = useState(qParam)
  const [prevQParam, setPrevQParam] = useState(qParam)
  const submittedQueriesRef = useRef<Set<string>>(new Set())

  // Keep local search input synchronized with external navigation (back/forward, external URL changes)
  if (qParam !== prevQParam) {
    setPrevQParam(qParam)
    if (submittedQueriesRef.current.has(qParam)) {
      submittedQueriesRef.current.delete(qParam)
    } else {
      setSearchInput(qParam)
      submittedQueriesRef.current.clear()
    }
  }

  // Normalized effective search: consistent between query key and accumulator reset
  const effectiveSearch = qParam.trim()
  const effectiveFilterKey = `${actionParam}|${effectiveSearch}`

  const [cursor, setCursor] = useState<string | undefined>(undefined)
  const [events, setEvents] = useState<AdminAuditEvent[]>([])
  const [prevFilterKey, setPrevFilterKey] = useState(effectiveFilterKey)

  const effectiveCursor = effectiveFilterKey !== prevFilterKey ? undefined : cursor

  if (effectiveFilterKey !== prevFilterKey) {
    setPrevFilterKey(effectiveFilterKey)
    setCursor(undefined)
    setEvents([])
  }

  const query: ListAdminAuditQuery = {
    ...(actionParam ? { action: actionParam as AdminAuditAction } : {}),
    ...(effectiveSearch ? { q: effectiveSearch } : {}),
    ...(effectiveCursor ? { cursor: effectiveCursor } : {}),
  }

  const { data, isLoading, isFetching, error } = useAdminAuditLog(query)

  useEffect(() => {
    if (data?.events) {
      if (!cursor) {
        setEvents(data.events)
      } else {
        setEvents((prev) => {
          const freshById = new Map(data.events.map((e: AdminAuditEvent) => [e.id, e]))
          const updated = prev.map((e) => freshById.get(e.id) ?? e)
          const prevIds = new Set(prev.map((e) => e.id))
          const additions = data.events.filter((e: AdminAuditEvent) => !prevIds.has(e.id))
          return [...updated, ...additions]
        })
      }
    }
  }, [data, cursor])

  const updateParam = (key: string, value: string): void => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      if (value) {
        next.set(key, value)
      } else {
        next.delete(key)
      }
      return next
    })
  }

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const next = e.target.value
    submittedQueriesRef.current.add(next)
    setSearchInput(next)
    updateParam('q', next)
  }
  const getActionBadgeStyle = (action: AdminAuditAction): React.CSSProperties => {
    switch (action) {
      case 'user_created':
      case 'team_created':
      case 'membership_added':
        return {
          ...commonStyles.badgePill,
          backgroundColor: '#eff6ff',
          color: '#1d4ed8',
          border: '1px solid #bfdbfe',
        }
      case 'user_status_changed':
      case 'membership_role_changed':
        return {
          ...commonStyles.badgePill,
          backgroundColor: '#fefce8',
          color: '#a16207',
          border: '1px solid #fef08a',
        }
      case 'membership_removed':
        return {
          ...commonStyles.badgePill,
          backgroundColor: '#fef2f2',
          color: '#dc2626',
          border: '1px solid #fecaca',
        }
      case 'job_retried':
      default:
        return {
          ...commonStyles.badgePill,
          backgroundColor: '#f8fafc',
          color: '#475569',
          border: '1px solid #e2e8f0',
        }
    }
  }

  return (
    <div
      className="admin-audit-log-page"
      style={{ ...commonStyles.pageContainer, maxWidth: '100%', boxSizing: 'border-box' }}
    >
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
            Audit Log
          </h1>
          <p style={{ color: '#64748b', fontSize: '0.875rem', margin: 0 }}>
            Immutable record of administrative actions
          </p>
        </div>
      </header>

      {/* Filters */}
      <section
        aria-label="Audit log filters"
        style={{
          ...commonStyles.cardPadded,
          marginBottom: '1.5rem',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: '1rem',
          alignItems: 'end',
        }}
      >
        <div>
          <label htmlFor="audit-action-filter" style={commonStyles.label}>
            Filter by Action
          </label>
          <select
            id="audit-action-filter"
            aria-label="Filter by action"
            value={actionParam}
            onChange={(e) => updateParam('action', e.target.value)}
            style={commonStyles.select}
          >
            <option value="">All Actions</option>
            {ADMIN_AUDIT_ACTIONS.map((action) => (
              <option key={action} value={action}>
                {formatAuditAction(action)}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="audit-search-filter" style={commonStyles.label}>
            Search Events
          </label>
          <input
            id="audit-search-filter"
            type="search"
            aria-label="Search audit events"
            placeholder="Search actor, target, or details…"
            value={searchInput}
            onChange={handleSearchChange}
            style={commonStyles.input}
          />
        </div>
      </section>

      {/* Feedback & Loading */}
      {isLoading && events.length === 0 && (
        <div
          role="status"
          style={{
            padding: '3rem 1rem',
            textAlign: 'center',
            color: '#64748b',
            backgroundColor: '#ffffff',
            borderRadius: '8px',
            border: '1px solid #e2e8f0',
            fontSize: '0.875rem',
          }}
        >
          Loading audit log…
        </div>
      )}

      {error && (
        <div role="alert" style={{ ...commonStyles.alertError, marginBottom: '1.5rem' }}>
          Failed to load audit events: {error.message}
        </div>
      )}

      {/* Empty State */}
      {!isLoading && !error && events.length === 0 && (
        <div
          role="status"
          data-testid="empty-audit-state"
          style={{
            padding: '3rem 1rem',
            textAlign: 'center',
            color: '#64748b',
            backgroundColor: '#ffffff',
            borderRadius: '8px',
            border: '1px dashed #cbd5e1',
          }}
        >
          <div style={{ fontWeight: 600, color: '#0f172a', marginBottom: '0.25rem' }}>
            No audit events found
          </div>
          <div style={{ fontSize: '0.8125rem' }}>
            {actionParam || searchInput
              ? 'Try clearing or modifying your filter criteria.'
              : 'No administrative actions have been recorded yet.'}
          </div>
        </div>
      )}

      {/* Table */}
      {events.length > 0 && (
        <div
          className="admin-audit-table-wrap"
          style={{
            backgroundColor: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: '12px',
            overflowX: 'auto',
          }}
        >
          <table
            data-testid="admin-audit-table"
            style={{ width: '100%', minWidth: '760px', borderCollapse: 'collapse', fontSize: '0.875rem' }}
          >
            <thead>
              <tr
                style={{
                  backgroundColor: '#f8fafc',
                  borderBottom: '1px solid #e2e8f0',
                  textAlign: 'left',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  color: '#64748b',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                }}
              >
                <th scope="col" style={{ padding: '0.75rem 1rem' }}>Timestamp</th>
                <th scope="col" style={{ padding: '0.75rem 1rem' }}>Actor</th>
                <th scope="col" style={{ padding: '0.75rem 1rem' }}>Action</th>
                <th scope="col" style={{ padding: '0.75rem 1rem' }}>Target</th>
                <th scope="col" style={{ padding: '0.75rem 1rem' }}>Details</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr
                  key={event.id}
                  style={{ borderBottom: '1px solid #f1f5f9', verticalAlign: 'top' }}
                >
                  <td
                    style={{
                      padding: '0.875rem 1rem',
                      color: '#64748b',
                      fontSize: '0.8125rem',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {new Date(event.createdAt).toLocaleString()}
                  </td>
                  <td style={{ padding: '0.875rem 1rem' }}>
                    <div style={{ fontWeight: 600, color: '#0f172a' }}>
                      {event.actor.displayName}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                      {event.actor.email}
                    </div>
                  </td>
                  <td style={{ padding: '0.875rem 1rem' }}>
                    <span style={getActionBadgeStyle(event.action)}>
                      {formatAuditAction(event.action)}
                    </span>
                  </td>
                  <td
                    style={{
                      padding: '0.875rem 1rem',
                      fontSize: '0.8125rem',
                      color: '#475569',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    <span style={{ textTransform: 'capitalize', fontWeight: 600 }}>
                      {event.targetType}
                    </span>{' '}
                    #{event.targetId}
                  </td>
                  <td
                    style={{
                      padding: '0.875rem 1rem',
                      color: '#0f172a',
                      fontSize: '0.8125rem',
                      lineHeight: 1.45,
                    }}
                  >
                    {formatAuditMetadata(event.action, event.metadata)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination Continuation */}
      {data?.nextCursor && (
        <div style={{ marginTop: '1.25rem', textAlign: 'center' }}>
          <button
            type="button"
            onClick={() => setCursor(data.nextCursor ?? undefined)}
            disabled={isFetching}
            style={commonStyles.buttonSecondary}
            aria-label="Load more events"
          >
            {isFetching ? 'Loading more events…' : 'Load more events'}
          </button>
        </div>
      )}
    </div>
  )
}
