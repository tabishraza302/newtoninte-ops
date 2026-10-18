import React, { useState } from 'react'
import { useItems } from '../api/hooks'
import type { ViewName } from '../api/types'
import { ItemRow } from '../components/ItemRow'
import { commonStyles, theme } from '../theme'

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
    <div className="dashboard-page" style={commonStyles.pageContainer}>
      <header style={{ marginBottom: '1.75rem' }}>
        <h1 style={{ fontSize: '1.75rem', fontWeight: 800, color: '#0f172a', margin: '0 0 0.35rem', letterSpacing: '-0.02em' }}>
          Dashboard
        </h1>
        <p style={{ color: '#64748b', fontSize: '0.875rem', margin: 0 }}>
          Operational triage views: urgent requests, assignments, and approvals
        </p>
      </header>

      <nav
        role="tablist"
        aria-label="Dashboard Views"
        style={{
          display: 'flex',
          gap: '0.25rem',
          borderBottom: '1px solid #e2e8f0',
          marginBottom: '1.5rem',
          overflowX: 'auto',
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
                padding: '0.65rem 1rem',
                border: 'none',
                borderBottom: isSelected ? '2px solid #2563eb' : '2px solid transparent',
                marginBottom: '-1px',
                background: 'none',
                cursor: 'pointer',
                fontWeight: isSelected ? 600 : 500,
                fontSize: '0.875rem',
                color: isSelected ? '#2563eb' : '#64748b',
                transition: 'all 0.15s ease',
                whiteSpace: 'nowrap',
                fontFamily: 'inherit',
              }}
            >
              {tab.label}
            </button>
          )
        })}
      </nav>

      <section aria-label="Dashboard Items">
        {isLoading && (
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
            Loading triage queue...
          </div>
        )}

        {error && (
          <div role="alert" style={{ ...commonStyles.alertError, marginBottom: '1.5rem' }}>
            Failed to load items
          </div>
        )}

        {!isLoading && !error && data && data.items.length === 0 && (
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
            <div style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>✓</div>
            <div style={{ fontWeight: 600, color: '#0f172a', marginBottom: '0.25rem' }}>All clear</div>
            <div style={{ fontSize: '0.875rem' }}>No items in this view</div>
          </div>
        )}

        {!isLoading && !error && data && data.items.length > 0 && (
          <div
            className="items-container"
            data-testid="dashboard-items"
            style={{
              border: '1px solid #e2e8f0',
              borderRadius: '8px',
              overflowX: 'auto',
              backgroundColor: '#ffffff',
              boxShadow: '0 1px 3px 0 rgba(15, 23, 42, 0.04)',
            }}
          >
            <div style={{ minWidth: '640px' }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '1rem',
                  padding: '0.625rem 1.25rem',
                  backgroundColor: '#f8fafc',
                  borderBottom: '1px solid #e2e8f0',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  color: '#64748b',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                }}
              >
                <div style={{ flex: 2.5 }}>Work Item</div>
                <div style={{ flex: 1.2 }}>Status</div>
                <div style={{ flex: 1 }}>Priority</div>
                <div style={{ flex: 1.2 }}>Assignee</div>
                <div style={{ flex: 1, textAlign: 'right' }}>Due Date</div>
              </div>

              {data.items.map((item) => (
                <ItemRow key={item.id} item={item} />
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
