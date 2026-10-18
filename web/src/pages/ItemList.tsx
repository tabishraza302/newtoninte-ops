import React, { useState, useEffect } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { useItems } from '../api/hooks'
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
import { ItemRow } from '../components/ItemRow'
import { commonStyles, theme } from '../theme'

export function ItemList(): React.ReactElement {
  const [searchParams, setSearchParams] = useSearchParams()

  const statusParam = searchParams.get('status') ?? ''
  const priorityParam = searchParams.get('priority') ?? ''
  const typeParam = searchParams.get('type') ?? ''
  const qParam = searchParams.get('q') ?? ''

  const filterKey = `${statusParam}|${priorityParam}|${typeParam}|${qParam}`

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

  const nextCursor = data?.nextCursor ?? null

  return (
    <div className="item-list-page" style={commonStyles.pageContainer}>
      <header style={{ marginBottom: '1.75rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 800, color: '#0f172a', margin: '0 0 0.35rem', letterSpacing: '-0.02em' }}>
            Items
          </h1>
          <p style={{ color: '#64748b', fontSize: '0.875rem', margin: 0 }}>
            Browse, filter, and track all team operations work items
          </p>
        </div>

        <Link
          to="/items/new"
          style={commonStyles.buttonPrimary}
        >
          <span style={{ fontSize: '1rem', lineHeight: 1 }}>+</span> New Item
        </Link>
      </header>

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
        <div style={{ flex: '1 1 220px' }}>
          <label htmlFor="search-input" style={commonStyles.label}>
            Search
          </label>
          <input
            id="search-input"
            type="search"
            aria-label="Search"
            placeholder="Search items..."
            value={qParam}
            onChange={(e) => updateParam('q', e.target.value)}
            style={commonStyles.input}
          />
        </div>

        <div style={{ minWidth: '160px', flex: '1 1 140px' }}>
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

        <div style={{ minWidth: '160px', flex: '1 1 140px' }}>
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
                {p}
              </option>
            ))}
          </select>
        </div>

        <div style={{ minWidth: '160px', flex: '1 1 140px' }}>
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
      </div>

      {/* Content */}
      <section aria-label="Items List">
        {isLoading && items.length === 0 && (
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
            Loading items...
          </div>
        )}

        {error && (
          <div role="alert" style={{ ...commonStyles.alertError, marginBottom: '1.5rem' }}>
            Failed to load items
          </div>
        )}

        {!isLoading && !error && items.length === 0 && (
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
              No items found
            </div>
            <div style={{ fontSize: '0.875rem' }}>
              Try adjusting your search filters or create a new work item
            </div>
          </div>
        )}

        {items.length > 0 && (
          <div
            className="items-container"
            data-testid="item-list"
            style={{
              border: '1px solid #e2e8f0',
              borderRadius: '8px',
              overflowX: 'auto',
              backgroundColor: '#ffffff',
              boxShadow: '0 1px 3px 0 rgba(15, 23, 42, 0.04)',
              marginBottom: '1.5rem',
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

              {items.map((item) => (
                <ItemRow key={item.id} item={item} />
              ))}
            </div>
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
      </section>
    </div>
  )
}
