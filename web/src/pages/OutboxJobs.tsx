import React, { useState, useEffect } from 'react'
import { useSearchParams, Navigate } from 'react-router-dom'
import { useJobs, useJobsSummary, useRetryJob } from '../api/hooks'
import {
  JOB_STATUSES,
  JOB_TYPES,
  type JobStatus,
  type JobType,
  type ListJobsQuery,
  type JobView,
} from '../api/types'
import { useAuth } from '../auth/AuthContext'

const SUMMARY_STATS: JobStatus[] = ['pending', 'processing', 'done', 'failed']

export function OutboxJobs(): React.ReactElement {
  const { user, status } = useAuth()

  if (status === 'loading') {
    return <div role="status">Loading...</div>
  }

  if (status === 'anon' || !user) {
    return <Navigate to="/login" replace />
  }

  if (!user.isAdmin) {
    return (
      <div style={{ padding: '1.5rem', maxWidth: '1200px', margin: '0 auto' }}>
        <div
          role="alert"
          style={{
            padding: '1rem',
            borderRadius: '8px',
            border: '1px solid #fca5a5',
            backgroundColor: '#fef2f2',
            color: '#b91c1c',
            fontWeight: 600,
          }}
        >
          Not authorised — the outbox jobs screen is admin only.
        </div>
      </div>
    )
  }

  return <OutboxJobsTable />
}

export function OutboxJobsTable(): React.ReactElement {
  const [searchParams, setSearchParams] = useSearchParams()

  const statusParam = searchParams.get('status') ?? ''
  const typeParam = searchParams.get('type') ?? ''

  const filterKey = `${statusParam}|${typeParam}`

  const [cursor, setCursor] = useState<string | undefined>(undefined)
  const [jobs, setJobs] = useState<JobView[]>([])
  const [prevFilterKey, setPrevFilterKey] = useState(filterKey)

  if (filterKey !== prevFilterKey) {
    setPrevFilterKey(filterKey)
    setCursor(undefined)
    setJobs([])
  }

  const query: ListJobsQuery = {}
  if (statusParam) query.status = statusParam as JobStatus
  if (typeParam) query.type = typeParam as JobType
  if (cursor) query.cursor = cursor

  const { data, isLoading, isFetching, error } = useJobs(query)
  const summary = useJobsSummary()
  const retryJob = useRetryJob()

  useEffect(() => {
    if (!data) return
    if (!cursor) {
      setJobs(data.jobs)
    } else {
      setJobs((prev) => {
        const existingIds = new Set(prev.map((j) => j.id))
        const newJobs = data.jobs.filter((j) => !existingIds.has(j.id))
        return [...prev, ...newJobs]
      })
    }
  }, [data, cursor])

  const updateParam = (key: string, value: string): void => {
    const next = new URLSearchParams(searchParams)
    if (value.trim()) {
      next.set(key, value.trim())
    } else {
      next.delete(key)
    }
    setSearchParams(next)
  }

  const nextCursor = data?.nextCursor ?? null
  const byStatus = summary.data?.byStatus
  const oldestPendingAgeSec = summary.data?.oldestPendingAgeSec ?? null
  const failedCount = byStatus?.failed ?? 0

  return (
    <div className="outbox-jobs-page" style={{ padding: '1.5rem', maxWidth: '1200px', margin: '0 auto' }}>
      <header style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.75rem', fontWeight: 700, margin: 0 }}>Outbox Jobs</h1>
        <p style={{ margin: '0.35rem 0 0', color: '#64748b', fontSize: '0.875rem' }}>
          Background job queue — failed jobs stay visible and can be retried.
        </p>
      </header>

      <section
        aria-label="Job summary"
        data-testid="job-summary"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '1rem',
          marginBottom: '1.5rem',
        }}
      >
        {SUMMARY_STATS.map((stat) => {
          const count = byStatus ? byStatus[stat] : null
          const isFailed = stat === 'failed'
          return (
            <div
              key={stat}
              style={{
                flex: '1 1 120px',
                padding: '0.75rem 1rem',
                borderRadius: '8px',
                border: `1px solid ${isFailed && failedCount > 0 ? '#fca5a5' : '#e2e8f0'}`,
                backgroundColor: isFailed && failedCount > 0 ? '#fef2f2' : '#f8fafc',
              }}
            >
              <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#64748b' }}>
                {stat}
              </div>
              <div
                data-testid={`summary-${stat}`}
                style={{
                  fontSize: '1.5rem',
                  fontWeight: 700,
                  color: isFailed && failedCount > 0 ? '#b91c1c' : '#0f172a',
                }}
              >
                {count ?? '—'}
              </div>
            </div>
          )
        })}

        <div
          style={{
            flex: '1 1 120px',
            padding: '0.75rem 1rem',
            borderRadius: '8px',
            border: '1px solid #e2e8f0',
            backgroundColor: '#f8fafc',
          }}
        >
          <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#64748b' }}>
            Oldest pending
          </div>
          <div data-testid="summary-oldest-pending" style={{ fontSize: '1.5rem', fontWeight: 700, color: '#0f172a' }}>
            {oldestPendingAgeSec === null ? '—' : `${oldestPendingAgeSec}s`}
          </div>
        </div>
      </section>

      {summary.error && (
        <div role="alert" style={{ color: '#dc2626', padding: '0 0 1rem' }}>
          Failed to load job summary
        </div>
      )}

      {/* Filter Controls */}
      <div
        className="filter-bar"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '1rem',
          padding: '1rem',
          backgroundColor: '#f8fafc',
          borderRadius: '8px',
          border: '1px solid #e2e8f0',
          marginBottom: '1.5rem',
          alignItems: 'center',
        }}
      >
        <div style={{ minWidth: '150px' }}>
          <label htmlFor="job-status-select" style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.25rem' }}>
            Status
          </label>
          <select
            id="job-status-select"
            aria-label="Status"
            value={statusParam}
            onChange={(e) => updateParam('status', e.target.value)}
            style={{
              width: '100%',
              padding: '0.5rem 0.75rem',
              borderRadius: '6px',
              border: '1px solid #cbd5e1',
              backgroundColor: '#fff',
            }}
          >
            <option value="">All Statuses</option>
            {JOB_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        <div style={{ minWidth: '150px' }}>
          <label htmlFor="job-type-select" style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.25rem' }}>
            Type
          </label>
          <select
            id="job-type-select"
            aria-label="Type"
            value={typeParam}
            onChange={(e) => updateParam('type', e.target.value)}
            style={{
              width: '100%',
              padding: '0.5rem 0.75rem',
              borderRadius: '6px',
              border: '1px solid #cbd5e1',
              backgroundColor: '#fff',
            }}
          >
            <option value="">All Types</option>
            {JOB_TYPES.map((t) => (
              <option key={t} value={t}>
                {t.replace(/\./g, ' ')}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Content */}
      <section aria-label="Outbox Jobs List">
        {isLoading && jobs.length === 0 && <div role="status">Loading jobs...</div>}

        {error && (
          <div role="alert" style={{ color: '#dc2626', padding: '1rem' }}>
            Failed to load jobs
          </div>
        )}

        {retryJob.error && (
          <div role="alert" style={{ color: '#dc2626', padding: '0 0 1rem' }}>
            Retry failed: {retryJob.error.message}
          </div>
        )}

        {!isLoading && !error && jobs.length === 0 && (
          <div
            role="status"
            data-testid="empty-state"
            style={{
              padding: '3rem 1rem',
              textAlign: 'center',
              color: '#64748b',
              background: '#f8fafc',
              borderRadius: '8px',
            }}
          >
            No jobs found
          </div>
        )}

        {jobs.length > 0 && (
          <div
            data-testid="jobs-table-wrapper"
            style={{
              border: '1px solid #e2e8f0',
              borderRadius: '8px',
              overflowX: 'auto',
              backgroundColor: '#ffffff',
              marginBottom: '1.5rem',
            }}
          >
            <table data-testid="jobs-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
              <thead>
                <tr style={{ backgroundColor: '#f1f5f9', textAlign: 'left' }}>
                  <th scope="col" style={{ padding: '0.625rem 0.75rem', borderBottom: '1px solid #e2e8f0' }}>ID</th>
                  <th scope="col" style={{ padding: '0.625rem 0.75rem', borderBottom: '1px solid #e2e8f0' }}>Type</th>
                  <th scope="col" style={{ padding: '0.625rem 0.75rem', borderBottom: '1px solid #e2e8f0' }}>Status</th>
                  <th scope="col" style={{ padding: '0.625rem 0.75rem', borderBottom: '1px solid #e2e8f0' }}>Attempts</th>
                  <th scope="col" style={{ padding: '0.625rem 0.75rem', borderBottom: '1px solid #e2e8f0' }}>Last error</th>
                  <th scope="col" style={{ padding: '0.625rem 0.75rem', borderBottom: '1px solid #e2e8f0' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <tr key={job.id} style={{ borderBottom: '1px solid #f1f5f9', verticalAlign: 'top' }}>
                    <td style={{ padding: '0.625rem 0.75rem', color: '#64748b' }}>{job.id}</td>
                    <td style={{ padding: '0.625rem 0.75rem', fontFamily: 'monospace' }}>{job.type}</td>
                    <td style={{ padding: '0.625rem 0.75rem' }}>
                      <span
                        style={{
                          padding: '0.125rem 0.5rem',
                          borderRadius: '999px',
                          fontSize: '0.75rem',
                          fontWeight: 600,
                          backgroundColor: job.status === 'failed' ? '#fee2e2' : '#e2e8f0',
                          color: job.status === 'failed' ? '#b91c1c' : '#334155',
                        }}
                      >
                        {job.status}
                      </span>
                    </td>
                    <td style={{ padding: '0.625rem 0.75rem' }}>
                      {job.attempts}/{job.maxAttempts}
                    </td>
                    <td
                      style={{
                        padding: '0.625rem 0.75rem',
                        fontFamily: 'monospace',
                        color: job.lastError ? '#b91c1c' : '#94a3b8',
                        maxWidth: '28rem',
                        wordBreak: 'break-word',
                      }}
                    >
                      {job.lastError ?? '—'}
                    </td>
                    <td style={{ padding: '0.625rem 0.75rem' }}>
                      <button
                        type="button"
                        onClick={() => retryJob.mutate({ id: job.id })}
                        disabled={job.status !== 'failed' || retryJob.isPending}
                        style={{
                          padding: '0.35rem 0.85rem',
                          borderRadius: '6px',
                          border: '1px solid #cbd5e1',
                          backgroundColor: job.status === 'failed' ? '#2563eb' : '#f1f5f9',
                          color: job.status === 'failed' ? '#ffffff' : '#94a3b8',
                          fontWeight: 600,
                          fontSize: '0.8125rem',
                          cursor: job.status === 'failed' ? 'pointer' : 'not-allowed',
                        }}
                      >
                        Retry
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {nextCursor && (
          <div style={{ textAlign: 'center', marginTop: '1rem' }}>
            <button
              type="button"
              onClick={() => setCursor(nextCursor)}
              disabled={isFetching}
              style={{
                padding: '0.6rem 1.5rem',
                backgroundColor: '#2563eb',
                color: '#ffffff',
                border: 'none',
                borderRadius: '6px',
                fontWeight: 600,
                cursor: isFetching ? 'not-allowed' : 'pointer',
                opacity: isFetching ? 0.7 : 1,
              }}
            >
              {isFetching ? 'Loading more...' : 'Load more'}
            </button>
          </div>
        )}
      </section>
    </div>
  )
}
