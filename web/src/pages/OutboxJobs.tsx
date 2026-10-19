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
import { commonStyles, theme } from '../theme'

const SUMMARY_STATS: JobStatus[] = ['pending', 'processing', 'done', 'failed']

export function OutboxJobs(): React.ReactElement {
  const { user, status } = useAuth()

  if (status === 'loading') {
    return (
      <div role="status" style={{ padding: '3rem', textAlign: 'center', color: '#64748b' }}>
        Loading Outbox Jobs...
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
          <div>Not authorised - the outbox jobs screen is admin only.</div>
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
  const [inspectedJobId, setInspectedJobId] = useState<number | null>(null)

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
  const inspectedJob = jobs.find((j) => j.id === inspectedJobId) ?? null


  const nextCursor = data?.nextCursor ?? null
  const byStatus = summary.data?.byStatus
  const oldestPendingAgeSec = summary.data?.oldestPendingAgeSec ?? null
  const failedCount = byStatus?.failed ?? 0

  const getJobStatusBadge = (status: JobStatus): React.CSSProperties => {
    switch (status) {
      case 'failed':
        return {
          ...commonStyles.badgePill,
          backgroundColor: '#fef2f2',
          color: '#dc2626',
          borderColor: '#fecaca',
        }
      case 'done':
        return {
          ...commonStyles.badgePill,
          backgroundColor: '#ecfdf5',
          color: '#059669',
          borderColor: '#a7f3d0',
        }
      case 'processing':
        return {
          ...commonStyles.badgePill,
          backgroundColor: '#fffbeb',
          color: '#b45309',
          borderColor: '#fde68a',
        }
      case 'pending':
      default:
        return {
          ...commonStyles.badgePill,
          backgroundColor: '#f0f9ff',
          color: '#0284c7',
          borderColor: '#bae6fd',
        }
    }
  }

  return (
    <div className="outbox-jobs-page" style={commonStyles.pageContainer}>
      <header style={{ marginBottom: '1.75rem' }}>
        <h1 style={{ fontSize: '1.75rem', fontWeight: 800, color: '#0f172a', margin: '0 0 0.35rem', letterSpacing: '-0.02em' }}>
          Outbox Jobs
        </h1>
        <p style={{ margin: 0, color: '#64748b', fontSize: '0.875rem' }}>
          Background job queue and email delivery pipeline. Failed jobs stay visible and can be retried.
        </p>
      </header>

      {/* Summary Cards */}
      <section
        aria-label="Job summary"
        data-testid="job-summary"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: '1rem',
          marginBottom: '1.5rem',
        }}
      >
        {SUMMARY_STATS.map((stat) => {
          const count = byStatus ? byStatus[stat] : null
          const isFailed = stat === 'failed'
          const hasFailures = isFailed && failedCount > 0
          return (
            <div
              key={stat}
              style={{
                padding: '1.125rem 1.25rem',
                borderRadius: '8px',
                border: `1px solid ${hasFailures ? '#fecaca' : '#e2e8f0'}`,
                backgroundColor: hasFailures ? '#fef2f2' : '#ffffff',
                boxShadow: '0 1px 3px 0 rgba(15, 23, 42, 0.04)',
              }}
            >
              <div style={{ fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: hasFailures ? '#dc2626' : '#64748b', marginBottom: '0.25rem' }}>
                {stat}
              </div>
              <div
                data-testid={`summary-${stat}`}
                style={{
                  fontSize: '1.75rem',
                  fontWeight: 800,
                  color: hasFailures ? '#b91c1c' : '#0f172a',
                  lineHeight: 1.1,
                }}
              >
                {count ?? '-'}
              </div>
            </div>
          )
        })}

        <div
          style={{
            padding: '1.125rem 1.25rem',
            borderRadius: '8px',
            border: '1px solid #e2e8f0',
            backgroundColor: '#ffffff',
            boxShadow: '0 1px 3px 0 rgba(15, 23, 42, 0.04)',
          }}
        >
          <div style={{ fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#64748b', marginBottom: '0.25rem' }}>
            Oldest pending
          </div>
          <div data-testid="summary-oldest-pending" style={{ fontSize: '1.75rem', fontWeight: 800, color: '#0f172a', lineHeight: 1.1 }}>
            {oldestPendingAgeSec === null ? '-' : `${oldestPendingAgeSec}s`}
          </div>
        </div>
      </section>

      {summary.error && (
        <div role="alert" style={{ ...commonStyles.alertError, marginBottom: '1.5rem' }}>
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
          padding: '1.25rem',
          backgroundColor: '#ffffff',
          borderRadius: '8px',
          border: '1px solid #e2e8f0',
          boxShadow: '0 1px 3px 0 rgba(15, 23, 42, 0.04)',
          marginBottom: '1.5rem',
          alignItems: 'center',
        }}
      >
        <div style={{ minWidth: '180px', flex: '1 1 160px' }}>
          <label htmlFor="job-status-select" style={commonStyles.label}>
            Status
          </label>
          <select
            id="job-status-select"
            aria-label="Status"
            value={statusParam}
            onChange={(e) => updateParam('status', e.target.value)}
            style={commonStyles.select}
          >
            <option value="">All Statuses</option>
            {JOB_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        <div style={{ minWidth: '180px', flex: '1 1 160px' }}>
          <label htmlFor="job-type-select" style={commonStyles.label}>
            Type
          </label>
          <select
            id="job-type-select"
            aria-label="Type"
            value={typeParam}
            onChange={(e) => updateParam('type', e.target.value)}
            style={commonStyles.select}
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
        {isLoading && jobs.length === 0 && (
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
            Loading jobs...
          </div>
        )}

        {error && (
          <div role="alert" style={{ ...commonStyles.alertError, marginBottom: '1.5rem' }}>
            Failed to load jobs
          </div>
        )}

        {retryJob.error && (
          <div role="alert" style={{ ...commonStyles.alertError, marginBottom: '1.5rem' }}>
            Retry failed: {retryJob.error.message}
          </div>
        )}

        {!isLoading && !error && jobs.length === 0 && (
          <div
            role="status"
            data-testid="empty-state"
            style={{
              padding: '4rem 1.5rem',
              textAlign: 'center',
              color: '#64748b',
              background: '#ffffff',
              borderRadius: '8px',
              border: '1px dashed #cbd5e1',
            }}
          >
            <div style={{ fontWeight: 600, color: '#0f172a', marginBottom: '0.25rem', fontSize: '1rem' }}>
              No jobs found
            </div>
            <div style={{ fontSize: '0.875rem' }}>
              No background outbox jobs match the selected filters
            </div>
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
              boxShadow: '0 1px 3px 0 rgba(15, 23, 42, 0.04)',
              marginBottom: '1.5rem',
            }}
          >
            <table data-testid="jobs-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
              <thead>
                <tr style={{ backgroundColor: '#f8fafc', textAlign: 'left' }}>
                  <th scope="col" style={{ padding: '0.75rem 1rem', borderBottom: '1px solid #e2e8f0', fontSize: '0.75rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>ID</th>
                  <th scope="col" style={{ padding: '0.75rem 1rem', borderBottom: '1px solid #e2e8f0', fontSize: '0.75rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Type</th>
                  <th scope="col" style={{ padding: '0.75rem 1rem', borderBottom: '1px solid #e2e8f0', fontSize: '0.75rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Status</th>
                  <th scope="col" style={{ padding: '0.75rem 1rem', borderBottom: '1px solid #e2e8f0', fontSize: '0.75rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Attempts</th>
                  <th scope="col" style={{ padding: '0.75rem 1rem', borderBottom: '1px solid #e2e8f0', fontSize: '0.75rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Last error</th>
                  <th scope="col" style={{ padding: '0.75rem 1rem', borderBottom: '1px solid #e2e8f0', fontSize: '0.75rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <tr key={job.id} style={{ borderBottom: '1px solid #f1f5f9', verticalAlign: 'middle' }}>
                    <td style={{ padding: '0.875rem 1rem', color: '#64748b', fontFamily: 'ui-monospace, monospace', fontWeight: 600, fontSize: '0.8125rem' }}>
                      #{job.id}
                    </td>
                    <td style={{ padding: '0.875rem 1rem' }}>
                      <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.8125rem', color: '#0f172a', fontWeight: 600 }}>
                        {job.type}
                      </div>
                      <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.75rem', color: '#64748b' }}>
                        {job.dedupeKey}
                      </div>
                    </td>
                    <td style={{ padding: '0.875rem 1rem' }}>
                      <span style={getJobStatusBadge(job.status)}>
                        {job.status}
                      </span>
                    </td>
                    <td style={{ padding: '0.875rem 1rem', fontSize: '0.8125rem', color: '#334155', fontWeight: 500 }}>
                      {job.attempts}/{job.maxAttempts}
                    </td>
                    <td
                      style={{
                        padding: '0.875rem 1rem',
                        fontFamily: 'ui-monospace, monospace',
                        fontSize: '0.75rem',
                        color: job.lastError ? '#b91c1c' : '#94a3b8',
                        maxWidth: '28rem',
                        wordBreak: 'break-word',
                      }}
                    >
                      {job.lastError ?? '-'}
                    </td>
                    <td style={{ padding: '0.875rem 1rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <button
                          type="button"
                          aria-label={`Inspect job #${job.id}`}
                          onClick={() => setInspectedJobId(job.id)}
                          style={{
                            padding: '0.35rem 0.75rem',
                            borderRadius: '6px',
                            border: '1px solid #cbd5e1',
                            backgroundColor: '#ffffff',
                            color: '#334155',
                            fontWeight: 600,
                            fontSize: '0.8125rem',
                            cursor: 'pointer',
                            fontFamily: 'inherit',
                            transition: 'all 0.15s ease',
                          }}
                        >
                          Inspect
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            retryJob.mutate(
                              { id: job.id },
                              {
                                onSuccess: () => {
                                  setCursor(undefined)
                                  setJobs([])
                                },
                              },
                            )
                          }
                          disabled={job.status !== 'failed' || retryJob.isPending}
                          style={{
                            padding: '0.35rem 0.85rem',
                            borderRadius: '6px',
                            border: job.status === 'failed' ? `1px solid ${theme.colors.accent}` : '1px solid #cbd5e1',
                            backgroundColor: job.status === 'failed' ? theme.colors.accent : '#f1f5f9',
                            color: job.status === 'failed' ? '#ffffff' : '#94a3b8',
                            fontWeight: 600,
                            fontSize: '0.8125rem',
                            cursor: job.status === 'failed' ? 'pointer' : 'not-allowed',
                            fontFamily: 'inherit',
                            transition: 'all 0.15s ease',
                            boxShadow: job.status === 'failed' ? '0 1px 2px 0 rgba(15, 118, 110, 0.15)' : 'none',
                          }}
                        >
                          Retry
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

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
              {isFetching ? 'Loading more...' : 'Load more'}
            </button>
          </div>
        )}

        {inspectedJob && (
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="job-inspector-title"
            style={{
              position: 'fixed',
              inset: 0,
              backgroundColor: 'rgba(15, 23, 42, 0.5)',
              backdropFilter: 'blur(2px)',
              zIndex: 100,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '1rem',
            }}
            onClick={(e) => {
              if (e.target === e.currentTarget) setInspectedJobId(null)
            }}
          >
            <div
              style={{
                backgroundColor: '#ffffff',
                borderRadius: '12px',
                padding: '1.75rem',
                maxWidth: '600px',
                width: '100%',
                boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
                border: '1px solid #e2e8f0',
                maxHeight: '90vh',
                overflowY: 'auto',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  borderBottom: '1px solid #e2e8f0',
                  paddingBottom: '1rem',
                  marginBottom: '1.25rem',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <h2
                    id="job-inspector-title"
                    style={{
                      fontSize: '1.25rem',
                      fontWeight: 700,
                      margin: 0,
                      color: '#0f172a',
                    }}
                  >
                    Job Details #{inspectedJob.id}
                  </h2>
                  <span style={getJobStatusBadge(inspectedJob.status)}>
                    {inspectedJob.status}
                  </span>
                </div>
                <button
                  type="button"
                  aria-label="Close inspector"
                  onClick={() => setInspectedJobId(null)}
                  style={{
                    background: 'none',
                    border: 'none',
                    fontSize: '1.25rem',
                    color: '#64748b',
                    cursor: 'pointer',
                    padding: '0.25rem 0.5rem',
                    lineHeight: 1,
                    borderRadius: '4px',
                  }}
                >
                  ✕
                </button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', fontSize: '0.875rem' }}>
                <div>
                  <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', marginBottom: '0.25rem' }}>
                    Job Type
                  </div>
                  <div style={{ fontFamily: 'ui-monospace, monospace', color: '#0f172a', fontWeight: 600 }}>
                    {inspectedJob.type}
                  </div>
                </div>

                <div>
                  <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', marginBottom: '0.25rem' }}>
                    Deduplication Key
                  </div>
                  <div style={{ fontFamily: 'ui-monospace, monospace', color: '#0f172a', wordBreak: 'break-all', backgroundColor: '#f8fafc', padding: '0.5rem 0.75rem', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                    {inspectedJob.dedupeKey}
                  </div>
                </div>

                <div>
                  <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', marginBottom: '0.25rem' }}>
                    Attempts
                  </div>
                  <div style={{ color: '#0f172a', fontWeight: 500 }}>
                    {inspectedJob.attempts} of {inspectedJob.maxAttempts}
                  </div>
                </div>

                <div>
                  <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', marginBottom: '0.25rem' }}>
                    Timeline
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.5rem', backgroundColor: '#f8fafc', padding: '0.75rem', borderRadius: '6px', border: '1px solid #e2e8f0', fontSize: '0.8125rem' }}>
                    <div>
                      <div style={{ color: '#64748b', fontSize: '0.75rem' }}>Created at</div>
                      <div style={{ color: '#0f172a', fontWeight: 500 }}>{new Date(inspectedJob.createdAt).toLocaleString()}</div>
                    </div>
                    <div>
                      <div style={{ color: '#64748b', fontSize: '0.75rem' }}>Available at</div>
                      <div style={{ color: '#0f172a', fontWeight: 500 }}>{new Date(inspectedJob.availableAt).toLocaleString()}</div>
                    </div>
                    <div>
                      <div style={{ color: '#64748b', fontSize: '0.75rem' }}>Updated at</div>
                      <div style={{ color: '#0f172a', fontWeight: 500 }}>{new Date(inspectedJob.updatedAt).toLocaleString()}</div>
                    </div>
                  </div>
                </div>

                <div>
                  <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', marginBottom: '0.25rem' }}>
                    Worker Lock Status
                  </div>
                  <div style={{ color: '#0f172a', fontSize: '0.8125rem' }}>
                    {inspectedJob.lockedBy || inspectedJob.lockedAt ? (
                      <span>
                        Locked by <strong>{inspectedJob.lockedBy ?? 'unknown'}</strong> at {inspectedJob.lockedAt ? new Date(inspectedJob.lockedAt).toLocaleString() : 'N/A'}
                      </span>
                    ) : (
                      <span style={{ color: '#059669', fontWeight: 500 }}>Unlocked / Ready</span>
                    )}
                  </div>
                </div>

                <div>
                  <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', marginBottom: '0.25rem' }}>
                    Error Trace / Message
                  </div>
                  {inspectedJob.lastError ? (
                    <pre
                      style={{
                        margin: 0,
                        padding: '0.75rem',
                        backgroundColor: '#fef2f2',
                        border: '1px solid #fecaca',
                        borderRadius: '6px',
                        color: '#991b1b',
                        fontFamily: 'ui-monospace, monospace',
                        fontSize: '0.75rem',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                      }}
                    >
                      {inspectedJob.lastError}
                    </pre>
                  ) : (
                    <div style={{ color: '#64748b', fontStyle: 'italic', fontSize: '0.8125rem' }}>
                      No error recorded
                    </div>
                  )}
                </div>
              </div>

              <div
                style={{
                  marginTop: '1.5rem',
                  paddingTop: '1rem',
                  borderTop: '1px solid #e2e8f0',
                  display: 'flex',
                  justifyContent: 'flex-end',
                  gap: '0.75rem',
                }}
              >
                {inspectedJob.status === 'failed' && (
                  <button
                    type="button"
                    onClick={() => {
                      retryJob.mutate(
                        { id: inspectedJob.id },
                        {
                          onSuccess: () => {
                            setCursor(undefined)
                            setJobs([])
                            setInspectedJobId(null)
                          },
                        },
                      )
                    }}
                    disabled={retryJob.isPending}
                    style={{
                      padding: '0.5rem 1rem',
                      borderRadius: '6px',
                      border: `1px solid ${theme.colors.accent}`,
                      backgroundColor: theme.colors.accent,
                      color: '#ffffff',
                      fontWeight: 600,
                      fontSize: '0.875rem',
                      cursor: retryJob.isPending ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {retryJob.isPending ? 'Retrying…' : 'Retry Job'}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setInspectedJobId(null)}
                  style={{
                    ...commonStyles.buttonSecondary,
                    padding: '0.5rem 1rem',
                    fontSize: '0.875rem',
                  }}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
