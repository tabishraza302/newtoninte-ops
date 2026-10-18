import React from 'react'
import { Link } from 'react-router-dom'
import type { WorkItem } from '../api/types'

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
        padding: '0.75rem 1rem',
        borderBottom: '1px solid #e2e8f0',
      }}
    >
      <div style={{ flex: 2 }}>
        <Link
          to={`/items/${item.id}`}
          style={{ fontWeight: 600, color: '#2563eb', textDecoration: 'none' }}
        >
          {item.title}
        </Link>
        <div style={{ fontSize: '0.875rem', color: '#64748b' }}>
          #{item.id} · {item.type}
        </div>
      </div>

      <div style={{ flex: 1 }}>
        <span
          data-testid="item-status"
          style={{
            display: 'inline-block',
            padding: '0.2rem 0.5rem',
            borderRadius: '4px',
            fontSize: '0.85rem',
            backgroundColor: '#f1f5f9',
            textTransform: 'capitalize',
          }}
        >
          {item.status.replace(/_/g, ' ')}
        </span>
      </div>

      <div style={{ flex: 1 }}>
        <span
          data-testid="item-priority"
          style={{
            display: 'inline-block',
            padding: '0.2rem 0.5rem',
            borderRadius: '4px',
            fontSize: '0.85rem',
            backgroundColor: '#fef3c7',
            color: '#92400e',
            textTransform: 'capitalize',
          }}
        >
          {item.priority}
        </span>
      </div>

      <div style={{ flex: 1, fontSize: '0.875rem', color: '#334155' }}>
        {assigneeName}
      </div>

      <div style={{ flex: 1, fontSize: '0.875rem', color: '#64748b' }}>
        {dueDate}
      </div>
    </div>
  )
}
