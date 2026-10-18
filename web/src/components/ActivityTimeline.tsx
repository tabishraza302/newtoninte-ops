import React from 'react'
import type { ActivityEvent } from '../api/types'
import { commonStyles } from '../theme'

export interface ActivityTimelineProps {
  events: ActivityEvent[]
  isLoading?: boolean
}

function formatEventDescription(event: ActivityEvent): string {
  switch (event.type) {
    case 'created':
      if (
        event.metadata &&
        typeof event.metadata === 'object' &&
        ('snapshot' in event.metadata || 'seeded' in event.metadata)
      ) {
        return 'Imported demo baseline'
      }
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

function getEventBadgeColor(type: string): { bg: string; text: string; border: string } {
  switch (type) {
    case 'created':
      return { bg: '#ecfdf5', text: '#047857', border: '#a7f3d0' }
    case 'status_changed':
      return { bg: '#f0fdfa', text: '#0f766e', border: '#ccfbf1' }
    case 'priority_changed':
      return { bg: '#fff7ed', text: '#c2410c', border: '#fed7aa' }
    case 'comment_added':
      return { bg: '#f3e8ff', text: '#6b21a8', border: '#ddd6fe' }
    default:
      return { bg: '#f1f5f9', text: '#475569', border: '#cbd5e1' }
  }
}

export function ActivityTimeline({
  events,
  isLoading = false,
}: ActivityTimelineProps): React.ReactElement {
  if (isLoading) {
    return (
      <div role="status" style={{ padding: '2rem', textAlign: 'center', color: '#64748b' }}>
        Loading activity...
      </div>
    )
  }

  if (events.length === 0) {
    return (
      <div
        role="status"
        data-testid="empty-activity"
        style={{
          padding: '2.5rem 1.5rem',
          textAlign: 'center',
          color: '#64748b',
          backgroundColor: '#ffffff',
          borderRadius: '8px',
          border: '1px dashed #cbd5e1',
          fontSize: '0.875rem',
        }}
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
      style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}
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
        const isSeedBaseline =
          event.type === 'created' &&
          event.metadata &&
          typeof event.metadata === 'object' &&
          ('snapshot' in event.metadata || 'seeded' in event.metadata)
        const actorName =
          event.actor?.displayName ?? (isSeedBaseline ? 'System Baseline' : event.actorId ? `User #${event.actorId}` : 'System')
        const formattedDate = new Date(event.createdAt).toLocaleString()
        const badgeColors = getEventBadgeColor(event.type)

        return (
          <div
            key={event.id}
            data-testid={`activity-event-${event.id}`}
            style={{
              padding: '1rem 1.25rem',
              backgroundColor: '#ffffff',
              border: '1px solid #e2e8f0',
              borderRadius: '8px',
              boxShadow: '0 1px 2px 0 rgba(15, 23, 42, 0.04)',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '0.5rem',
                marginBottom: '0.35rem',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <span
                  style={{
                    display: 'inline-block',
                    padding: '0.15rem 0.5rem',
                    borderRadius: '4px',
                    fontSize: '0.6875rem',
                    fontWeight: 700,
                    backgroundColor: badgeColors.bg,
                    color: badgeColors.text,
                    border: `1px solid ${badgeColors.border}`,
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                  }}
                >
                  {event.type}
                </span>
                <span style={{ fontWeight: 600, color: '#0f172a', fontSize: '0.875rem' }}>{actorName}</span>
              </div>
              <time
                dateTime={event.createdAt}
                style={{ fontSize: '0.75rem', color: '#64748b', fontVariantNumeric: 'tabular-nums' }}
              >
                {formattedDate}
              </time>
            </div>

            <div style={{ fontSize: '0.875rem', color: '#475569', marginTop: '0.25rem', lineHeight: 1.4 }}>
              {formatEventDescription(event)}
            </div>

            {commentBody && (
              <div
                data-testid="comment-body"
                style={{
                  marginTop: '0.65rem',
                  padding: '0.75rem 1rem',
                  backgroundColor: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: '6px',
                  whiteSpace: 'pre-wrap',
                  color: '#0f172a',
                  fontSize: '0.875rem',
                  lineHeight: 1.5,
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
