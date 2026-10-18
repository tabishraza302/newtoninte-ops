import React, { useState } from 'react'
import { useItems } from '../api/hooks'
import type { ViewName } from '../api/types'
import { ItemRow } from '../components/ItemRow'

export const DASHBOARD_TABS: { key: ViewName; label: string }[] = [
  { key: 'assigned_to_me', label: 'Assigned to Me' },
  { key: 'unassigned_urgent', label: 'Unassigned Urgent' },
  { key: 'awaiting_my_approval', label: 'Awaiting My Approval' },
  { key: 'overdue', label: 'Overdue' },
]

export function Dashboard(): React.ReactElement {
  const [activeTab, setActiveTab] = useState<ViewName>('assigned_to_me')
  const { data, isLoading, error } = useItems({ view: activeTab })

  return (
    <div className="dashboard-page" style={{ padding: '1.5rem', maxWidth: '1200px', margin: '0 auto' }}>
      <header style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.75rem', fontWeight: 700 }}>Dashboard</h1>
      </header>

      <nav
        role="tablist"
        aria-label="Dashboard Views"
        style={{
          display: 'flex',
          gap: '0.5rem',
          borderBottom: '2px solid #e2e8f0',
          marginBottom: '1.5rem',
        }}
      >
        {DASHBOARD_TABS.map((tab) => {
          const isSelected = activeTab === tab.key
          return (
            <button
              key={tab.key}
              role="tab"
              aria-selected={isSelected}
              onClick={() => setActiveTab(tab.key)}
              style={{
                padding: '0.6rem 1.2rem',
                border: 'none',
                borderBottom: isSelected ? '2px solid #2563eb' : '2px solid transparent',
                marginBottom: '-2px',
                background: 'none',
                cursor: 'pointer',
                fontWeight: isSelected ? 600 : 400,
                color: isSelected ? '#2563eb' : '#64748b',
              }}
            >
              {tab.label}
            </button>
          )
        })}
      </nav>

      <section aria-label="Dashboard Items">
        {isLoading && <div role="status">Loading...</div>}

        {error && (
          <div role="alert" style={{ color: '#dc2626', padding: '1rem' }}>
            Failed to load items
          </div>
        )}

        {!isLoading && !error && data && data.items.length === 0 && (
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
            No items in this view
          </div>
        )}

        {!isLoading && !error && data && data.items.length > 0 && (
          <div
            className="items-container"
            data-testid="dashboard-items"
            style={{
              border: '1px solid #e2e8f0',
              borderRadius: '8px',
              overflow: 'hidden',
              backgroundColor: '#ffffff',
            }}
          >
            {data.items.map((item) => (
              <ItemRow key={item.id} item={item} />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
