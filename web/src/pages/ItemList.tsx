import React, { useState, useEffect, useMemo } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { useItems, useTeams, useMe } from '../api/hooks'
import {
  STATUSES,
  PRIORITIES,
  ITEM_TYPES,
  type Status,
  type Priority,
  type ItemType,
  type WorkItem,
  type ListItemsQuery,
} from '../api/types'
import { ItemRow, ItemTableGrid, ItemTableHeader } from '../components/ItemTable'
import { commonStyles, theme, getApiErrorMessage } from '../theme'

export function ItemList(): React.ReactElement {
  const [searchParams, setSearchParams] = useSearchParams()

  const statusParam = searchParams.get('status') ?? ''
  const priorityParam = searchParams.get('priority') ?? ''
  const typeParam = searchParams.get('type') ?? ''
  const qParam = searchParams.get('q') ?? ''
  const teamParam = searchParams.get('team') ?? ''
  const assigneeParam = searchParams.get('assignee') ?? ''

  const { data: teamsData } = useTeams()
  const { data: meData } = useMe()
  const isAdmin = !!meData?.user?.isAdmin
  const teams = teamsData?.teams ?? []
  const teamMap = useMemo(() => new Map(teams.map((t) => [t.id, t.name])), [teams])

  const filterKey = `${statusParam}|${priorityParam}|${typeParam}|${qParam}|${teamParam}|${assigneeParam}`

  const [cursor, setCursor] = useState<string | undefined>(undefined)
  const [items, setItems] = useState<WorkItem[]>([])
  const [prevFilterKey, setPrevFilterKey] = useState(filterKey)

  if (filterKey !== prevFilterKey) {
    setPrevFilterKey(filterKey)
    setCursor(undefined)
    setItems([])
  }

  const query: ListItemsQuery = {}
  if (statusParam) query.status = statusParam as Status
  if (priorityParam) query.priority = priorityParam as Priority
  if (typeParam) query.type = typeParam as ItemType
  if (qParam) query.q = qParam
  if (teamParam) query.team = parseInt(teamParam, 10)
  if (assigneeParam) {
    if (assigneeParam === 'me' && meData?.user) {
      query.assignee = meData.user.id
    } else if (Number.isInteger(Number(assigneeParam))) {
      query.assignee = parseInt(assigneeParam, 10)
    }
  }
  if (cursor) query.cursor = cursor

  const { data, isLoading, isFetching, error } = useItems(query)

  useEffect(() => {
    if (data?.items) {
      if (!cursor) {
        setItems(data.items)
      } else {
        setItems((prev) => {
          const existingIds = new Set(prev.map((item) => item.id))
          const newItems = data.items.filter((item) => !existingIds.has(item.id))
          return [...prev, ...newItems]
        })
      }
    }
  }, [data, cursor])

  const updateParam = (key: string, value: string): void => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      if (value) {
        next.set(key, value)
      } else {
        next.delete(key)
      }
      return next
    })
  }

  const clearFilters = (): void => {
    setSearchParams(new URLSearchParams())
  }

  const hasActiveFilters = Boolean(
    statusParam || priorityParam || typeParam || qParam || teamParam || assigneeParam,
  )

  const nextCursor = data?.nextCursor ?? null

  return (
    <div className="item-list-page" style={commonStyles.pageContainer}>
      <header
        style={{
          marginBottom: '1.75rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '1rem',
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
            Items
          </h1>
          <p style={{ color: theme.colors.textMuted, fontSize: '0.875rem', margin: 0 }}>
            Browse, filter, and track operational work items across authorized teams
          </p>
        </div>

        {!isAdmin && (
          <Link to="/items/new" style={commonStyles.buttonPrimary}>
            <span style={{ fontSize: '1rem', lineHeight: 1 }}>+</span> New Item
          </Link>
        )}
      </header>

      {/* Filter Controls */}
      <div
        className="filter-bar"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          gap: '0.875rem',
          padding: '1.25rem',
          backgroundColor: '#ffffff',
          borderRadius: '12px',
          border: `1px solid ${theme.colors.border}`,
          boxShadow: theme.shadows.sm,
          marginBottom: '1.5rem',
          alignItems: 'end',
        }}
      >
        {/* Search */}
        <div style={{ gridColumn: 'span 2', minWidth: '220px' }}>
          <label htmlFor="search-input" style={commonStyles.label}>
            Search text
          </label>
          <input
            id="search-input"
            type="search"
            aria-label="Search"
            placeholder="Search titles…"
            value={qParam}
            onChange={(e) => updateParam('q', e.target.value)}
            style={commonStyles.input}
          />
        </div>

        {/* Team filter */}
        {teams.length > 0 && (
          <div>
            <label htmlFor="team-filter" style={commonStyles.label}>
              Team
            </label>
            <select
              id="team-filter"
              aria-label="Team"
              value={teamParam}
              onChange={(e) => updateParam('team', e.target.value)}
              style={commonStyles.select}
            >
              <option value="">All Teams</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Status filter */}
        <div>
          <label htmlFor="status-select" style={commonStyles.label}>
            Status
          </label>
          <select
            id="status-select"
            aria-label="Status"
            value={statusParam}
            onChange={(e) => updateParam('status', e.target.value)}
            style={commonStyles.select}
          >
            <option value="">All Statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        </div>

        {/* Priority filter */}
        <div>
          <label htmlFor="priority-select" style={commonStyles.label}>
            Priority
          </label>
          <select
            id="priority-select"
            aria-label="Priority"
            value={priorityParam}
            onChange={(e) => updateParam('priority', e.target.value)}
            style={commonStyles.select}
          >
            <option value="">All Priorities</option>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p.charAt(0).toUpperCase() + p.slice(1)}
              </option>
            ))}
          </select>
        </div>

        {/* Type filter */}
        <div>
          <label htmlFor="type-select" style={commonStyles.label}>
            Type
          </label>
          <select
            id="type-select"
            aria-label="Type"
            value={typeParam}
            onChange={(e) => updateParam('type', e.target.value)}
            style={commonStyles.select}
          >
            <option value="">All Types</option>
            {ITEM_TYPES.map((t) => (
              <option key={t} value={t}>
                {t.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        </div>

        {/* Assignee filter */}
        <div>
          <label htmlFor="assignee-select" style={commonStyles.label}>
            Assignee
          </label>
          <select
            id="assignee-select"
            aria-label="Assignee"
            value={assigneeParam}
            onChange={(e) => updateParam('assignee', e.target.value)}
            style={commonStyles.select}
          >
            <option value="">All Assignees</option>
            {meData?.user && (
              <option value="me">Assigned to Me ({meData.user.displayName})</option>
            )}
          </select>
        </div>

        {/* Reset button */}
        {hasActiveFilters && (
          <div>
            <button
              type="button"
              onClick={clearFilters}
              style={{
                ...commonStyles.buttonSecondary,
                width: '100%',
                boxSizing: 'border-box',
                padding: '0.55rem',
                fontSize: '0.8125rem',
              }}
            >
              Reset Filters
            </button>
          </div>
        )}
      </div>

      {/* Content */}
      <section aria-label="Items List">
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
              fontSize: '0.875rem',
            }}
          >
            Loading items...
          </div>
        )}

        {error && (
          <div role="alert" style={{ ...commonStyles.alertError, marginBottom: '1.5rem' }}>
            Failed to load items: {getApiErrorMessage(error)}
          </div>
        )}

        {!isLoading && !error && items.length === 0 && (
          <div
            role="status"
            data-testid="empty-state"
            style={{
              padding: '4rem 1.5rem',
              textAlign: 'center',
              color: theme.colors.textMuted,
              background: '#ffffff',
              borderRadius: '12px',
              border: `1px dashed ${theme.colors.borderStrong}`,
            }}
          >
            <p style={{ margin: 0, fontSize: '1rem', fontWeight: 600, color: theme.colors.textPrimary }}>
              No items found
            </p>
            <p style={{ margin: '0.5rem 0 1.25rem', fontSize: '0.875rem' }}>
              {hasActiveFilters
                ? 'Try adjusting or clearing your filter criteria.'
                : isAdmin
                  ? 'No work items exist for your authorized teams.'
                  : 'Create a work item to get started.'}
            </p>
            {hasActiveFilters ? (
              <button
                type="button"
                onClick={clearFilters}
                style={commonStyles.buttonSecondary}
              >
                Clear all filters
              </button>
            ) : !isAdmin ? (
              <Link to="/items/new" style={commonStyles.buttonPrimary}>
                Create an Item
              </Link>
            ) : null}
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
                  data-testid="load-more-btn"
                  disabled={isFetching}
                  onClick={() => setCursor(nextCursor)}
                  style={{
                    ...commonStyles.buttonSecondary,
                    padding: '0.45rem 1.25rem',
                    fontSize: '0.8125rem',
                  }}
                >
                  {isFetching ? 'Loading more items...' : 'Load More Items'}
                </button>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  )
}
