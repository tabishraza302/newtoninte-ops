import React, { useState, useEffect, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useItems, useTeams } from '../api/hooks'
import type { ViewName, WorkItem } from '../api/types'
import { ItemRow, ItemTableGrid, ItemTableHeader } from '../components/ItemTable'
import { commonStyles, theme, getApiErrorMessage } from '../theme'

export const DASHBOARD_TABS: { key: ViewName; label: string; description: string }[] = [
  {
    key: 'assigned_to_me',
    label: 'Assigned to Me',
    description: 'Active items owned by your account across all teams',
  },
  {
    key: 'unassigned_urgent',
    label: 'Unassigned Urgent',
    description: 'Open urgent and high-priority items awaiting ownership',
  },
  {
    key: 'awaiting_my_approval',
    label: 'Awaiting My Approval',
    description: 'Submitted items awaiting lead review and resolution',
  },
  {
    key: 'overdue',
    label: 'Overdue',
    description: 'Active items whose due date has passed without closure',
  },
]

export function Dashboard(): React.ReactElement {
  const [searchParams, setSearchParams] = useSearchParams()
  const tabParam = searchParams.get('tab') as ViewName | null
  const activeTab: ViewName =
    tabParam && DASHBOARD_TABS.some((t) => t.key === tabParam)
      ? tabParam
      : 'assigned_to_me'

  const handleTabChange = (key: ViewName) => {
    const nextParams = new URLSearchParams(searchParams)
    if (key === 'assigned_to_me') {
      nextParams.delete('tab')
    } else {
      nextParams.set('tab', key)
    }
    setSearchParams(nextParams, { replace: true })
  }

  const [selectedTeamId, setSelectedTeamId] = useState<string>('')
  const [cursor, setCursor] = useState<string | undefined>(undefined)
  const [items, setItems] = useState<WorkItem[]>([])
  const [prevFilterKey, setPrevFilterKey] = useState(`${activeTab}|${selectedTeamId}`)
  const { data: teamsData } = useTeams()
  const teams = teamsData?.teams ?? []
  const teamMap = useMemo(() => new Map(teams.map((t) => [t.id, t.name])), [teams])

  const currentFilterKey = `${activeTab}|${selectedTeamId}`
  if (currentFilterKey !== prevFilterKey) {
    setPrevFilterKey(currentFilterKey)
    setCursor(undefined)
    setItems([])
  }

  const query: Parameters<typeof useItems>[0] = {
    view: activeTab,
    ...(selectedTeamId ? { team: parseInt(selectedTeamId, 10) } : {}),
    ...(cursor ? { cursor } : {}),
  }

  const { data, isLoading, isFetching, error } = useItems(query)

  useEffect(() => {
    if (data?.items) {
      if (!cursor) {
        setItems(data.items)
      } else {
        setItems((prev) => {
          const freshIds = new Set(data.items.map((i) => i.id))
          const existing = prev.filter((i) => !freshIds.has(i.id))
          return [...existing, ...data.items]
        })
      }
    }
  }, [data, cursor])

  const activeTabMeta = DASHBOARD_TABS.find((t) => t.key === activeTab)
  const nextCursor = data?.nextCursor ?? null

  return (
    <div className="dashboard-page" style={commonStyles.pageContainer}>
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          flexWrap: 'wrap',
          gap: '1rem',
          marginBottom: '1.75rem',
        }}
      >
        <div>
          <h1
            style={{
              fontSize: '1.75rem',
              fontWeight: 800,
              color: theme.colors.textPrimary,
              margin: '0 0 0.35rem',
              letterSpacing: '-0.02em',
            }}
          >
            {activeTab === 'awaiting_my_approval' ? 'Approvals' : 'Dashboard'}
          </h1>
          <p style={{ color: theme.colors.textMuted, fontSize: '0.875rem', margin: 0 }}>
            {activeTabMeta?.description ?? 'Operational triage queues and triage views'}
          </p>
        </div>

        {/* Team scope filter */}
        {teams.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <label htmlFor="dashboard-team-filter" style={{ fontSize: '0.8125rem', fontWeight: 600, color: theme.colors.textSecondary, whiteSpace: 'nowrap' }}>
              Team:
            </label>
            <select
              id="dashboard-team-filter"
              value={selectedTeamId}
              onChange={(e) => setSelectedTeamId(e.target.value)}
              style={{
                ...commonStyles.select,
                padding: '0.4rem 0.75rem',
                fontSize: '0.8125rem',
                minWidth: '160px',
              }}
            >
              <option value="">All My Teams</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </header>

      {/* Tabs */}
      <nav
        role="tablist"
        aria-label="Dashboard Views"
        style={{
          display: 'flex',
          gap: '0.5rem',
          borderBottom: `1px solid ${theme.colors.border}`,
          marginBottom: '1.5rem',
          overflowX: 'auto',
          paddingBottom: '0.25rem',
        }}
      >
        {DASHBOARD_TABS.map((tab) => {
          const isActive = activeTab === tab.key
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => handleTabChange(tab.key)}
              style={{
                padding: '0.6rem 1rem',
                fontSize: '0.875rem',
                fontWeight: isActive ? 600 : 500,
                color: isActive ? theme.colors.accent : theme.colors.textMuted,
                backgroundColor: 'transparent',
                border: 'none',
                borderBottom: isActive ? `2px solid ${theme.colors.accent}` : '2px solid transparent',
                cursor: 'pointer',
                fontFamily: 'inherit',
                whiteSpace: 'nowrap',
                transition: 'all 0.15s ease',
              }}
            >
              {tab.label}
            </button>
          )
        })}
      </nav>

      {/* Items Section */}
      <section aria-label="Dashboard Items">
        {isLoading && items.length === 0 && (
          <div
            role="status"
            style={{
              padding: '3rem',
              textAlign: 'center',
              color: theme.colors.textMuted,
              backgroundColor: '#ffffff',
              borderRadius: '12px',
              border: `1px solid ${theme.colors.border}`,
            }}
          >
            Loading triage queue…
          </div>
        )}

        {error && (
          <div role="alert" style={{ ...commonStyles.alertError, marginBottom: '1.5rem' }}>
            Failed to load queue items: {getApiErrorMessage(error)}
          </div>
        )}

        {!isLoading && !error && items.length === 0 && (
          <div
            role="status"
            data-testid="empty-dashboard-state"
            style={{
              padding: '3rem 1.5rem',
              textAlign: 'center',
              backgroundColor: '#ffffff',
              borderRadius: '12px',
              border: `1px dashed ${theme.colors.borderStrong}`,
            }}
          >
            <div style={{ fontWeight: 600, color: theme.colors.textPrimary, marginBottom: '0.25rem' }}>
              No items in this view
            </div>
            <div style={{ color: theme.colors.textMuted, fontSize: '0.875rem' }}>
              {activeTab === 'assigned_to_me'
                ? 'You have no open work items assigned to your account.'
                : activeTab === 'unassigned_urgent'
                  ? 'All urgent items are currently assigned or in progress.'
                  : activeTab === 'awaiting_my_approval'
                    ? 'No submitted items are pending approval in your teams.'
                    : 'No work items are overdue.'}
            </div>
          </div>
        )}

        {items.length > 0 && (
          <div
            style={{
              backgroundColor: '#ffffff',
              border: `1px solid ${theme.colors.border}`,
              borderRadius: '12px',
              overflow: 'hidden',
              boxShadow: theme.shadows.sm,
            }}
          >
            <div style={{ overflowX: 'auto' }}>
              <ItemTableGrid label="Work items" teams={teams}>
                <ItemTableHeader />
                {items.map((item) => (
                  <ItemRow key={item.id} item={item} teamName={teamMap.get(item.teamId)} />
                ))}
              </ItemTableGrid>
            </div>

            {/* Keyset Cursor Pagination */}
            {nextCursor && (
              <div
                style={{
                  padding: '1rem',
                  borderTop: `1px solid ${theme.colors.border}`,
                  textAlign: 'center',
                  backgroundColor: theme.colors.bgCardMuted,
                }}
              >
                <button
                  type="button"
                  disabled={isFetching}
                  onClick={() => setCursor(nextCursor)}
                  style={{
                    ...commonStyles.buttonSecondary,
                    padding: '0.45rem 1.25rem',
                    fontSize: '0.8125rem',
                  }}
                >
                  {isFetching ? 'Loading more items…' : 'Load More Items'}
                </button>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  )
}
