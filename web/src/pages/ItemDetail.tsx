import React from 'react'
import { useParams, Link } from 'react-router-dom'
import { useItem, useItemActivity } from '../api/hooks'
import { ApiError } from '../api/client'
import { ActivityTimeline } from '../components/ActivityTimeline'

export function ItemDetail(): React.ReactElement {
  const { id: idParam } = useParams<{ id: string }>()
  const itemId = idParam ? parseInt(idParam, 10) : NaN
  const isValidId = Number.isInteger(itemId) && itemId > 0

  const itemQuery = useItem(isValidId ? itemId : 0)
  const activityQuery = useItemActivity(isValidId ? itemId : 0)

  if (!isValidId) {
    return (
      <div className="item-detail-page" style={{ padding: '1.5rem', maxWidth: '900px', margin: '0 auto' }}>
        <div role="alert" data-testid="not-found" style={{ textAlign: 'center', padding: '3rem 1rem' }}>
          <h1 style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>Item not found</h1>
          <p style={{ color: '#64748b' }}>The requested item does not exist.</p>
          <Link to="/items" style={{ color: '#2563eb' }}>Back to items</Link>
        </div>
      </div>
    )
  }

  if (itemQuery.isLoading) {
    return (
      <div className="item-detail-page" style={{ padding: '1.5rem', maxWidth: '900px', margin: '0 auto' }}>
        <div role="status">Loading item...</div>
      </div>
    )
  }

  if (itemQuery.isError) {
    const error = itemQuery.error
    const isNotFound = error instanceof ApiError ? error.status === 404 : false

    if (isNotFound) {
      return (
        <div className="item-detail-page" style={{ padding: '1.5rem', maxWidth: '900px', margin: '0 auto' }}>
          <div role="alert" data-testid="not-found" style={{ textAlign: 'center', padding: '3rem 1rem' }}>
            <h1 style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>Item not found</h1>
            <p style={{ color: '#64748b' }}>The requested item could not be found or you do not have permission to view it.</p>
            <Link to="/items" style={{ color: '#2563eb' }}>Back to items</Link>
          </div>
        </div>
      )
    }

    return (
      <div className="item-detail-page" style={{ padding: '1.5rem', maxWidth: '900px', margin: '0 auto' }}>
        <div role="alert" style={{ color: '#dc2626', padding: '1rem' }}>
          Error loading item: {error.message}
        </div>
      </div>
    )
  }

  if (!itemQuery.data || !itemQuery.data.item) {
    return (
      <div className="item-detail-page" style={{ padding: '1.5rem', maxWidth: '900px', margin: '0 auto' }}>
        <div role="alert" data-testid="not-found" style={{ textAlign: 'center', padding: '3rem 1rem' }}>
          <h1 style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>Item not found</h1>
          <p style={{ color: '#64748b' }}>The requested item could not be found.</p>
          <Link to="/items" style={{ color: '#2563eb' }}>Back to items</Link>
        </div>
      </div>
    )
  }
  const { item } = itemQuery.data
  const assigneeName = item.assignee?.displayName ?? 'Unassigned'
  const creatorName = item.creator?.displayName ?? `User #${item.createdBy}`
  const dueDate = item.dueAt ? new Date(item.dueAt).toLocaleDateString() : 'No due date'

  return (
    <div className="item-detail-page" style={{ padding: '1.5rem', maxWidth: '900px', margin: '0 auto' }}>
      <nav style={{ marginBottom: '1rem' }}>
        <Link to="/items" style={{ color: '#2563eb', textDecoration: 'none' }}>
          &larr; Back to items
        </Link>
      </nav>

      <header style={{ marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#64748b', fontSize: '0.875rem' }}>
          <span>#{item.id}</span>
          <span>·</span>
          <span style={{ textTransform: 'capitalize' }}>{item.type.replace(/_/g, ' ')}</span>
        </div>
        <h1 data-testid="item-title" style={{ fontSize: '1.75rem', fontWeight: 700, margin: '0.5rem 0' }}>
          {item.title}
        </h1>
      </header>

      {/* Metadata Panel */}
      <section
        aria-label="Item Attributes"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: '1rem',
          padding: '1rem',
          backgroundColor: '#f8fafc',
          border: '1px solid #e2e8f0',
          borderRadius: '8px',
          marginBottom: '1.5rem',
        }}
      >
        <div>
          <span style={{ display: 'block', fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase' }}>
            Status
          </span>
          <span
            data-testid="item-status"
            style={{ fontWeight: 600, textTransform: 'capitalize', color: '#1e293b' }}
          >
            {item.status.replace(/_/g, ' ')}
          </span>
        </div>

        <div>
          <span style={{ display: 'block', fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase' }}>
            Priority
          </span>
          <span
            data-testid="item-priority"
            style={{ fontWeight: 600, textTransform: 'capitalize', color: '#92400e' }}
          >
            {item.priority}
          </span>
        </div>

        <div>
          <span style={{ display: 'block', fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase' }}>
            Assignee
          </span>
          <span data-testid="item-assignee" style={{ fontWeight: 600, color: '#1e293b' }}>
            {assigneeName}
          </span>
        </div>

        <div>
          <span style={{ display: 'block', fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase' }}>
            Creator
          </span>
          <span data-testid="item-creator" style={{ fontWeight: 600, color: '#1e293b' }}>
            {creatorName}
          </span>
        </div>

        <div>
          <span style={{ display: 'block', fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase' }}>
            Due Date
          </span>
          <span data-testid="item-due" style={{ fontWeight: 600, color: '#1e293b' }}>
            {dueDate}
          </span>
        </div>
      </section>

      {/* Description */}
      <section aria-label="Description" style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '1.2rem', fontWeight: 600, marginBottom: '0.5rem' }}>Description</h2>
        <div
          data-testid="item-description"
          style={{
            padding: '1rem',
            border: '1px solid #e2e8f0',
            borderRadius: '8px',
            backgroundColor: '#ffffff',
            whiteSpace: 'pre-wrap',
            color: item.description ? '#1e293b' : '#64748b',
          }}
        >
          {item.description || 'No description provided.'}
        </div>
      </section>

      {/* Activity Timeline */}
      <section aria-label="Activity History">
        <h2 style={{ fontSize: '1.2rem', fontWeight: 600, marginBottom: '1rem' }}>Activity</h2>
        <ActivityTimeline
          events={activityQuery.data?.events ?? []}
          isLoading={activityQuery.isLoading}
        />
      </section>
    </div>
  )
}
