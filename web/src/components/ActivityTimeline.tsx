import React from 'react'
import type { ActivityEvent } from '../api/types'

export interface ActivityTimelineProps {
  events: ActivityEvent[]
  isLoading?: boolean
}


function formatEventDescription(event: ActivityEvent): string {
  switch (event.type) {
    case 'created':
      return 'Created this item'
    case 'status_changed':
      return `Status changed from ${event.fromValue ?? 'none'} to ${event.toValue ?? 'none'}`
    case 'priority_changed':
      return `Priority changed from ${event.fromValue ?? 'none'} to ${event.toValue ?? 'none'}`
    case 'type_changed':
      return `Type changed from ${event.fromValue ?? 'none'} to ${event.toValue ?? 'none'}`
    case 'assignee_changed':
      return `Assignee changed from ${event.fromValue ?? 'unassigned'} to ${event.toValue ?? 'unassigned'}`
    case 'title_changed':
      return `Title changed from "${event.fromValue ?? ''}" to "${event.toValue ?? ''}"`
    case 'description_changed':
      return 'Description updated'
    case 'due_changed':
      return `Due date changed from ${event.fromValue ?? 'none'} to ${event.toValue ?? 'none'}`
    case 'comment_added':
      return 'Comment added'
    default:
      return event.type.replace(/_/g, ' ')
  }
}

export function ActivityTimeline({
  events,
  isLoading = false,
}: ActivityTimelineProps): React.ReactElement {
  if (isLoading) {
    return <div role="status">Loading activity...</div>
  }

  if (events.length === 0) {
    return (
      <div
        role="status"
        data-testid="empty-activity"
        style={{ padding: '1.5rem', textAlign: 'center', color: '#64748b' }}
      >
        No activity yet
      </div>
    )
  }

  // Ensure strict oldest-to-newest ordering
  const sortedEvents = [...events].sort((a, b) => {
    const timeA = new Date(a.createdAt).getTime()
    const timeB = new Date(b.createdAt).getTime()
    if (timeA !== timeB) return timeA - timeB
    return a.id - b.id
  })

  return (
    <div
      className="activity-timeline"
      data-testid="activity-timeline"
      style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}
    >
      {sortedEvents.map((event) => {
        let commentBody: string | null = null
        if (
          event.type === 'comment_added' &&
          event.metadata &&
          typeof event.metadata === 'object' &&
          'body' in event.metadata &&
          typeof event.metadata.body === 'string'
        ) {
          commentBody = event.metadata.body
        }
        const actorName =
          event.actor?.displayName ?? (event.actorId ? `User #${event.actorId}` : 'System')
        const formattedDate = new Date(event.createdAt).toLocaleString()

        return (
          <div
            key={event.id}
            data-testid={`activity-event-${event.id}`}
            style={{
              padding: '1rem',
              backgroundColor: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: '8px',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'baseline',
                marginBottom: '0.25rem',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span
                  style={{
                    display: 'inline-block',
                    padding: '0.15rem 0.4rem',
                    borderRadius: '4px',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    backgroundColor: '#e2e8f0',
                    color: '#334155',
                    textTransform: 'uppercase',
                  }}
                >
                  {event.type}
                </span>
                <span style={{ fontWeight: 600, color: '#1e293b' }}>{actorName}</span>
              </div>
              <time
                dateTime={event.createdAt}
                style={{ fontSize: '0.8rem', color: '#64748b' }}
              >
                {formattedDate}
              </time>
            </div>

            <div style={{ fontSize: '0.9rem', color: '#475569', marginTop: '0.25rem' }}>
              {formatEventDescription(event)}
            </div>

            {commentBody && (
              <div
                data-testid="comment-body"
                style={{
                  marginTop: '0.5rem',
                  padding: '0.75rem',
                  backgroundColor: '#ffffff',
                  border: '1px solid #cbd5e1',
                  borderRadius: '6px',
                  whiteSpace: 'pre-wrap',
                  color: '#1e293b',
                  fontSize: '0.9rem',
                }}
              >
                {commentBody}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
