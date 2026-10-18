import React, { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
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
    if (!data) return
    if (!cursor) {
      setItems(data.items)
    } else {
      setItems((prev) => {
        const existingIds = new Set(prev.map((i) => i.id))
        const newItems = data.items.filter((i) => !existingIds.has(i.id))
        return [...prev, ...newItems]
      })
    }
  }, [data, cursor])

  const updateParam = (key: string, value: string): void => {
    const next = new URLSearchParams(searchParams)
    if (value.trim()) {
      next.set(key, value.trim())
    } else {
      next.delete(key)
    }
    setSearchParams(next)
  }

  const nextCursor = data?.nextCursor ?? null

  return (
    <div className="item-list-page" style={{ padding: '1.5rem', maxWidth: '1200px', margin: '0 auto' }}>
      <header style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.75rem', fontWeight: 700 }}>Items</h1>
      </header>

      {/* Filter Controls */}
      <div
        className="filter-bar"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '1rem',
          padding: '1rem',
          backgroundColor: '#f8fafc',
          borderRadius: '8px',
          border: '1px solid #e2e8f0',
          marginBottom: '1.5rem',
          alignItems: 'center',
        }}
      >
        <div style={{ flex: '1 1 200px' }}>
          <label htmlFor="search-input" style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.25rem' }}>
            Search
          </label>
          <input
            id="search-input"
            type="search"
            aria-label="Search"
            placeholder="Search items..."
            value={qParam}
            onChange={(e) => updateParam('q', e.target.value)}
            style={{
              width: '100%',
              padding: '0.5rem 0.75rem',
              borderRadius: '6px',
              border: '1px solid #cbd5e1',
              boxSizing: 'border-box',
            }}
          />
        </div>

        <div style={{ minWidth: '150px' }}>
          <label htmlFor="status-select" style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.25rem' }}>
            Status
          </label>
          <select
            id="status-select"
            aria-label="Status"
            value={statusParam}
            onChange={(e) => updateParam('status', e.target.value)}
            style={{
              width: '100%',
              padding: '0.5rem 0.75rem',
              borderRadius: '6px',
              border: '1px solid #cbd5e1',
              backgroundColor: '#fff',
            }}
          >
            <option value="">All Statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        </div>

        <div style={{ minWidth: '150px' }}>
          <label htmlFor="priority-select" style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.25rem' }}>
            Priority
          </label>
          <select
            id="priority-select"
            aria-label="Priority"
            value={priorityParam}
            onChange={(e) => updateParam('priority', e.target.value)}
            style={{
              width: '100%',
              padding: '0.5rem 0.75rem',
              borderRadius: '6px',
              border: '1px solid #cbd5e1',
              backgroundColor: '#fff',
            }}
          >
            <option value="">All Priorities</option>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>

        <div style={{ minWidth: '150px' }}>
          <label htmlFor="type-select" style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.25rem' }}>
            Type
          </label>
          <select
            id="type-select"
            aria-label="Type"
            value={typeParam}
            onChange={(e) => updateParam('type', e.target.value)}
            style={{
              width: '100%',
              padding: '0.5rem 0.75rem',
              borderRadius: '6px',
              border: '1px solid #cbd5e1',
              backgroundColor: '#fff',
            }}
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
          <div role="status">Loading items...</div>
        )}

        {error && (
          <div role="alert" style={{ color: '#dc2626', padding: '1rem' }}>
            Failed to load items
          </div>
        )}

        {!isLoading && !error && items.length === 0 && (
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
            No items found
          </div>
        )}

        {items.length > 0 && (
          <div
            className="items-container"
            data-testid="item-list"
            style={{
              border: '1px solid #e2e8f0',
              borderRadius: '8px',
              overflow: 'hidden',
              backgroundColor: '#ffffff',
              marginBottom: '1.5rem',
            }}
          >
            {items.map((item) => (
              <ItemRow key={item.id} item={item} />
            ))}
          </div>
        )}

        {nextCursor && (
          <div style={{ textAlign: 'center', marginTop: '1rem' }}>
            <button
              type="button"
              onClick={() => setCursor(nextCursor)}
              disabled={isFetching}
              style={{
                padding: '0.6rem 1.5rem',
                backgroundColor: '#2563eb',
                color: '#ffffff',
                border: 'none',
                borderRadius: '6px',
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
