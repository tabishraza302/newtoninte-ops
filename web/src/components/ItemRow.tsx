import React from 'react'
import { Link } from 'react-router-dom'
import type { WorkItem } from '../api/types'
import { getStatusBadgeStyle, getPriorityBadgeStyle } from '../theme'

export interface ItemRowProps {
  item: WorkItem
}

export function ItemRow({ item }: ItemRowProps): React.ReactElement {
  const assigneeName = item.assignee?.displayName ?? 'Unassigned'
  const dueDate = item.dueAt ? new Date(item.dueAt).toLocaleDateString() : 'No due date'

  return (
    <div
      className="item-row"
      data-testid={`item-row-${item.id}`}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '1rem',
        padding: '0.875rem 1.25rem',
        borderBottom: '1px solid #f1f5f9',
        backgroundColor: '#ffffff',
        transition: 'background-color 0.15s ease',
      }}
    >
      <div style={{ flex: 2.5, minWidth: 0 }}>
        <Link
          to={`/items/${item.id}`}
          style={{
            fontWeight: 600,
            color: '#0f172a',
            textDecoration: 'none',
            fontSize: '0.9375rem',
            lineHeight: 1.3,
            display: 'inline-block',
            transition: 'color 0.15s ease',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = '#2563eb')}
          onMouseLeave={(e) => (e.currentTarget.style.color = '#0f172a')}
        >
          {item.title}
        </Link>
        <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.2rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ fontFamily: 'ui-monospace, monospace', color: '#94a3b8', fontWeight: 600 }}>#{item.id}</span>
          <span style={{ color: '#cbd5e1' }}>•</span>
          <span style={{ textTransform: 'capitalize', color: '#475569' }}>{item.type}</span>
        </div>
      </div>

      <div style={{ flex: 1.2 }}>
        <span
          data-testid="item-status"
          style={getStatusBadgeStyle(item.status)}
        >
          {item.status.replace(/_/g, ' ')}
        </span>
      </div>

      <div style={{ flex: 1 }}>
        <span
          data-testid="item-priority"
          style={getPriorityBadgeStyle(item.priority)}
        >
          {item.priority}
        </span>
      </div>

      <div style={{ flex: 1.2, fontSize: '0.8125rem', color: item.assignee ? '#334155' : '#94a3b8', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {assigneeName}
      </div>

      <div style={{ flex: 1, fontSize: '0.8125rem', color: '#64748b', textAlign: 'right', whiteSpace: 'nowrap' }}>
        {dueDate}
      </div>
    </div>
  )
}
