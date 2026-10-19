import React, { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useItems, useTeams, useTransitionItem } from '../api/hooks'
import { ApiError } from '../api/client'
import type { WorkItem, Priority } from '../api/types'
import { commonStyles, theme, getApiErrorMessage } from '../theme'

function getPriorityBadgeStyle(priority: Priority): React.CSSProperties {
  switch (priority) {
    case 'urgent':
      return {
        backgroundColor: '#fef2f2',
        color: '#dc2626',
        border: '1px solid #fecaca',
      }
    case 'high':
      return {
        backgroundColor: '#fff7ed',
        color: '#c2410c',
        border: '1px solid #fed7aa',
      }
    case 'medium':
      return {
        backgroundColor: '#f0fdfa',
        color: '#0f766e',
        border: '1px solid #ccfbf1',
      }
    case 'low':
      return {
        backgroundColor: '#f8fafc',
        color: '#64748b',
        border: '1px solid #e2e8f0',
      }
  }
}

function isConflictError(err: unknown): boolean {
  if (err instanceof ApiError && err.status === 409) return true
  if (err && typeof err === 'object' && 'status' in err && err.status === 409) return true
  return false
}
export function Approvals(): React.ReactElement {
  const queryClient = useQueryClient()
  const [selectedTeamId, setSelectedTeamId] = useState<string>('')
  const [cursor, setCursor] = useState<string | undefined>(undefined)
  const [items, setItems] = useState<WorkItem[]>([])
  const [prevFilterKey, setPrevFilterKey] = useState(`${selectedTeamId}`)
  const [pendingItemIds, setPendingItemIds] = useState<ReadonlySet<number>>(new Set<number>())
  const [actionError, setActionError] = useState<string | null>(null)
  const [returnDialogError, setReturnDialogError] = useState<string | null>(null)
  const [sendBackModalItem, setSendBackModalItem] = useState<WorkItem | null>(null)
  const [sendBackReason, setSendBackReason] = useState<string>('')

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const modalRef = useRef<HTMLDivElement>(null)
  const triggerBtnRef = useRef<HTMLButtonElement | null>(null)
  const triggerIdRef = useRef<number | null>(null)
  const nextFocusIdRef = useRef<number | null>(null)
  const prevFocusIdRef = useRef<number | null>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const wasOpenRef = useRef(false)
  const { data: teamsData } = useTeams()
  const teams = teamsData?.teams ?? []

  const currentFilterKey = `${selectedTeamId}`
  if (currentFilterKey !== prevFilterKey) {
    setPrevFilterKey(currentFilterKey)
    setCursor(undefined)
    setItems([])
  }

  const query: Parameters<typeof useItems>[0] = {
    view: 'awaiting_my_approval' as const,
    ...(selectedTeamId ? { team: parseInt(selectedTeamId, 10) } : {}),
    ...(cursor ? { cursor } : {}),
  }

  const { data, isLoading, isFetching, error, refetch } = useItems(query)
  const transitionMutation = useTransitionItem()

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

  const nextCursor = data?.nextCursor ?? null

  const isSubmittingReturn = sendBackModalItem ? pendingItemIds.has(sendBackModalItem.id) : false

  // Focus textarea when modal opens
  useEffect(() => {
    if (sendBackModalItem) {
      textareaRef.current?.focus()
    }
  }, [sendBackModalItem])

  // The app shell scrolls inside .app-main-column, not body, so lock both.
  useEffect(() => {
    if (!sendBackModalItem) return
    const mainColumn = document.querySelector<HTMLElement>('.app-main-column')
    const originalBodyOverflow = document.body.style.overflow
    const originalMainOverflow = mainColumn?.style.overflowY ?? ''
    document.body.style.overflow = 'hidden'
    if (mainColumn) mainColumn.style.overflowY = 'hidden'
    return () => {
      document.body.style.overflow = originalBodyOverflow
      if (mainColumn) mainColumn.style.overflowY = originalMainOverflow
    }
  }, [sendBackModalItem])

  // Restore focus to triggering send-back button or neighbor when modal closes
  useEffect(() => {
    if (!sendBackModalItem && wasOpenRef.current) {
      const originalBtn = triggerIdRef.current
        ? document.querySelector<HTMLButtonElement>(`[data-testid="send-back-${triggerIdRef.current}"]`)
        : null

      if (originalBtn && originalBtn.isConnected) {
        originalBtn.focus()
      } else {
        const nextBtn = nextFocusIdRef.current
          ? document.querySelector<HTMLButtonElement>(`[data-testid="send-back-${nextFocusIdRef.current}"]`)
          : null
        const prevBtn = prevFocusIdRef.current
          ? document.querySelector<HTMLButtonElement>(`[data-testid="send-back-${prevFocusIdRef.current}"]`)
          : null

        if (nextBtn) {
          nextBtn.focus()
        } else if (prevBtn) {
          prevBtn.focus()
        } else {
          headingRef.current?.focus()
        }
      }
    }
    wasOpenRef.current = Boolean(sendBackModalItem)
  }, [sendBackModalItem])

  // Keyboard trap and Escape handler
  useEffect(() => {
    if (!sendBackModalItem) return

    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        if (isSubmittingReturn) return
        e.preventDefault()
        setSendBackModalItem(null)
        setReturnDialogError(null)
        return
      }

      if (e.key === 'Tab') {
        const focusables = Array.from(
          modalRef.current?.querySelectorAll<HTMLElement>(
            'textarea:not([disabled]), button:not([disabled]), select:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
          ) ?? []
        )

        if (focusables.length === 0) {
          e.preventDefault()
          return
        }

        const first = focusables[0]
        const last = focusables[focusables.length - 1]
        if (!first || !last) return

        if (e.shiftKey) {
          if (document.activeElement === first || !modalRef.current?.contains(document.activeElement)) {
            e.preventDefault()
            last.focus()
          }
        } else {
          if (document.activeElement === last || !modalRef.current?.contains(document.activeElement)) {
            e.preventDefault()
            first.focus()
          }
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [sendBackModalItem, isSubmittingReturn])

  const handleApprove = async (item: WorkItem): Promise<void> => {
    const itemId = item.id
    const idx = items.findIndex((i) => i.id === itemId)
    const nextId = idx !== -1 && idx + 1 < items.length ? items[idx + 1]!.id : null
    const prevId = idx > 0 ? items[idx - 1]!.id : null
    setPendingItemIds((prev) => {
      const next = new Set(prev)
      next.add(itemId)
      return next
    })
    setActionError(null)
    try {
      await transitionMutation.mutateAsync({
        id: itemId,
        to: 'resolved',
        expectedVersion: item.version,
      })
      setItems((prev) => prev.filter((i) => i.id !== itemId))
      // The focused Approve button just unmounted; keep keyboard users in the queue.
      if (!modalRef.current) {
        const nextBtn = nextId
          ? document.querySelector<HTMLButtonElement>(`[data-testid="send-back-${nextId}"]`)
          : null
        const prevBtn = prevId
          ? document.querySelector<HTMLButtonElement>(`[data-testid="send-back-${prevId}"]`)
          : null
        if (nextBtn) {
          nextBtn.focus()
        } else if (prevBtn) {
          prevBtn.focus()
        } else {
          headingRef.current?.focus()
        }
      }
    } catch (err) {
      if (isConflictError(err)) {
        setItems([])
        setCursor(undefined)
        queryClient.removeQueries({ queryKey: ['items'] })
        if (sendBackModalItem?.id === itemId) {
          setSendBackModalItem(null)
          setReturnDialogError(null)
        }
        setActionError('This item changed while you were reviewing it — the queue has been refreshed.')
      } else {
        setActionError(getApiErrorMessage(err, 'Failed to approve item'))
      }
    } finally {
      setPendingItemIds((prev) => {
        if (!prev.has(itemId)) return prev
        const next = new Set(prev)
        next.delete(itemId)
        return next
      })
    }
  }

  const handleSendBackConfirm = async (): Promise<void> => {
    if (!sendBackModalItem || isSubmittingReturn) return
    const itemToReturn = sendBackModalItem
    const itemId = itemToReturn.id
    setPendingItemIds((prev) => {
      const next = new Set(prev)
      next.add(itemId)
      return next
    })
    setReturnDialogError(null)
    setActionError(null)

    const idx = items.findIndex((i) => i.id === itemId)
    if (idx !== -1) {
      nextFocusIdRef.current = idx + 1 < items.length ? items[idx + 1]!.id : null
      prevFocusIdRef.current = idx > 0 ? items[idx - 1]!.id : null
    }

    try {
      await transitionMutation.mutateAsync({
        id: itemId,
        to: 'in_progress',
        reason: sendBackReason.trim() || undefined,
        expectedVersion: itemToReturn.version,
      })
      setItems((prev) => prev.filter((i) => i.id !== itemId))
      setSendBackModalItem(null)
      setSendBackReason('')
      setReturnDialogError(null)
    } catch (err) {
      if (isConflictError(err)) {
        setItems([])
        setCursor(undefined)
        queryClient.removeQueries({ queryKey: ['items'] })
        setSendBackModalItem(null)
        setSendBackReason('')
        setReturnDialogError(null)
        setActionError('This item changed while you were reviewing it — the queue has been refreshed.')
      } else {
        setReturnDialogError(getApiErrorMessage(err, 'Failed to return item'))
      }
    } finally {
      setPendingItemIds((prev) => {
        if (!prev.has(itemId)) return prev
        const next = new Set(prev)
        next.delete(itemId)
        return next
      })
    }
  }

  const hasMore = Boolean(nextCursor) || (isFetching && Boolean(cursor))
  const badgeText = hasMore
    ? `${items.length}+ items pending`
    : `${items.length} ${items.length === 1 ? 'item' : 'items'} pending`

  return (
    <div className="approvals-page" style={commonStyles.pageContainer}>
      <div
        style={{ display: 'contents' }}
        inert={sendBackModalItem ? true : undefined}
        aria-hidden={sendBackModalItem ? 'true' : undefined}
      >
        {actionError && (
          <div
            role="alert"
            style={{
              padding: '0.875rem 1.25rem',
              backgroundColor: '#fef2f2',
              border: '1px solid #fecaca',
              color: '#991b1b',
              borderRadius: '8px',
              marginBottom: '1.25rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontSize: '0.875rem',
            }}
          >
            <span>{actionError}</span>
            <button
              type="button"
              onClick={() => setActionError(null)}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#991b1b',
                cursor: 'pointer',
                fontWeight: 700,
              }}
            >
              ✕
            </button>
          </div>
        )}

        {/* Header */}
        <header
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            flexWrap: 'wrap',
            gap: '1rem',
            marginBottom: '2rem',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.35rem' }}>
              <h1
                ref={headingRef}
                tabIndex={-1}
                style={{
                  fontSize: '1.75rem',
                  fontWeight: 800,
                  color: theme.colors.textPrimary,
                  margin: 0,
                  letterSpacing: '-0.02em',
                }}
              >
                Approvals Queue
              </h1>
              {(!isLoading || items.length > 0) && (
                <span
                  data-testid="approvals-count-badge"
                  style={{
                    fontSize: '0.75rem',
                    fontWeight: 700,
                    padding: '0.2rem 0.65rem',
                    borderRadius: '9999px',
                    backgroundColor: items.length > 0 ? '#ecfdf5' : '#f1f5f9',
                    color: items.length > 0 ? '#047857' : '#64748b',
                    border: items.length > 0 ? '1px solid #a7f3d0' : '1px solid #e2e8f0',
                  }}
                >
                  {badgeText}
                </span>
              )}
            </div>
            <p style={{ color: theme.colors.textMuted, fontSize: '0.875rem', margin: 0 }}>
              Submitted work items awaiting your lead review, verification, and resolution.
            </p>
          </div>

          {/* Filters */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            {teams.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <label
                  htmlFor="approvals-team-filter"
                  style={{ fontSize: '0.8125rem', fontWeight: 600, color: theme.colors.textSecondary, whiteSpace: 'nowrap' }}
                >
                  Team:
                </label>
                <select
                  id="approvals-team-filter"
                  aria-label="Filter by team"
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
          </div>
        </header>

        {/* Loading state */}
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
            Loading approvals queue…
          </div>
        )}

        {/* Error state */}
        {error && (
          <div
            role="alert"
            style={{
              padding: '2rem',
              textAlign: 'center',
              backgroundColor: '#ffffff',
              borderRadius: '8px',
              border: '1px solid #fecaca',
              color: '#991b1b',
            }}
          >
            <p style={{ fontWeight: 600, marginBottom: '0.5rem' }}>Failed to load approvals queue</p>
            <p style={{ fontSize: '0.875rem', color: '#64748b', marginBottom: '1rem' }}>{error.message}</p>
            <button
              type="button"
              onClick={() => void refetch()}
              style={{ ...commonStyles.buttonPrimary, padding: '0.4rem 1rem', fontSize: '0.8125rem' }}
            >
              Retry
            </button>
          </div>
        )}

        {/* Empty State */}
        {!isLoading && !error && items.length === 0 && (
          <div
            style={{
              padding: '3.5rem 2rem',
              textAlign: 'center',
              backgroundColor: '#ffffff',
              borderRadius: '12px',
              border: '1px solid #e2e8f0',
              maxWidth: '640px',
              margin: '2rem auto',
            }}
          >
            <div
              style={{
                width: '48px',
                height: '48px',
                borderRadius: '50%',
                backgroundColor: '#ecfdf5',
                color: '#047857',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '1.5rem',
                fontWeight: 800,
                margin: '0 auto 1.25rem',
                border: '1px solid #a7f3d0',
              }}
            >
              ✓
            </div>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: theme.colors.textPrimary, margin: '0 0 0.5rem' }}>
              All caught up!
            </h2>
            <p style={{ color: theme.colors.textMuted, fontSize: '0.875rem', maxWidth: '420px', margin: '0 auto 1.5rem', lineHeight: 1.5 }}>
              No work items are currently pending approval in your teams. New submitted items requiring lead sign-off will appear here automatically.
            </p>
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center' }}>
              <Link
                to="/dashboard"
                style={{
                  ...commonStyles.buttonPrimary,
                  textDecoration: 'none',
                  fontSize: '0.8125rem',
                  padding: '0.5rem 1.1rem',
                }}
              >
                Go to Dashboard
              </Link>
              <Link
                to="/items"
                style={{
                  ...commonStyles.buttonSecondary,
                  textDecoration: 'none',
                  fontSize: '0.8125rem',
                  padding: '0.5rem 1.1rem',
                }}
              >
                Browse Work Items
              </Link>
            </div>
          </div>
        )}

        {/* Approvals Table */}
        {items.length > 0 && (
          <div
            style={{
              backgroundColor: '#ffffff',
              borderRadius: '12px',
              border: '1px solid #e2e8f0',
              overflow: 'hidden',
              boxShadow: '0 1px 3px 0 rgba(15, 23, 42, 0.03)',
            }}
          >
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', minWidth: '800px' }}>
                <thead>
                  <tr
                    style={{
                      backgroundColor: theme.colors.bgCardMuted,
                      borderBottom: '1px solid #e2e8f0',
                      fontSize: '0.6875rem',
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      letterSpacing: '0.06em',
                      color: '#64748b',
                    }}
                  >
                    <th style={{ padding: '0.75rem 1rem', width: '90px' }}>Item ID</th>
                    <th style={{ padding: '0.75rem 1rem' }}>Title</th>
                    <th style={{ padding: '0.75rem 1rem', width: '100px' }}>Priority</th>
                    <th style={{ padding: '0.75rem 1rem', width: '160px' }}>Assignee</th>
                    <th style={{ padding: '0.75rem 1rem', width: '130px', textAlign: 'right' }}>Due Date</th>
                    <th style={{ padding: '0.75rem 1rem', width: '220px', textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => {
                    const isBusy = pendingItemIds.has(item.id)
                    const dueDate = item.dueAt ? new Date(item.dueAt).toLocaleDateString() : 'No due date'
                    const assigneeName = item.assignee?.displayName ?? 'Unassigned'

                    return (
                      <tr
                        key={item.id}
                        data-testid={`approval-row-${item.id}`}
                        style={{
                          borderBottom: '1px solid #f1f5f9',
                          transition: 'background-color 0.15s ease',
                        }}
                      >
                        {/* ID */}
                        <td style={{ padding: '0.875rem 1rem', whiteSpace: 'nowrap' }}>
                          <Link
                            to={`/items/${item.id}`}
                            style={{
                              fontFamily: 'ui-monospace, monospace',
                              fontSize: '0.8125rem',
                              fontWeight: 600,
                              color: theme.colors.textMuted,
                              textDecoration: 'none',
                            }}
                          >
                            #{item.id}
                          </Link>
                        </td>

                        {/* Title */}
                        <td style={{ padding: '0.875rem 1rem', minWidth: '220px' }}>
                          <Link
                            to={`/items/${item.id}`}
                            style={{
                              fontWeight: 600,
                              fontSize: '0.875rem',
                              color: theme.colors.textPrimary,
                              textDecoration: 'none',
                              lineHeight: 1.3,
                              display: 'block',
                            }}
                          >
                            {item.title}
                          </Link>
                          <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.2rem' }}>
                            Type: <span style={{ textTransform: 'capitalize', color: '#475569' }}>{item.type}</span>
                          </div>
                        </td>

                        {/* Priority */}
                        <td style={{ padding: '0.875rem 1rem' }}>
                          <span
                            style={{
                              display: 'inline-block',
                              padding: '0.2rem 0.55rem',
                              borderRadius: '9999px',
                              fontSize: '0.6875rem',
                              fontWeight: 600,
                              textTransform: 'capitalize',
                              letterSpacing: '0.02em',
                              ...getPriorityBadgeStyle(item.priority),
                            }}
                          >
                            {item.priority}
                          </span>
                        </td>

                        {/* Assignee */}
                        <td style={{ padding: '0.875rem 1rem' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <div
                              style={{
                                width: '22px',
                                height: '22px',
                                borderRadius: '50%',
                                backgroundColor: theme.colors.accentSubtle,
                                color: theme.colors.accent,
                                fontSize: '0.6875rem',
                                fontWeight: 700,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                flexShrink: 0,
                              }}
                            >
                              {assigneeName.charAt(0).toUpperCase()}
                            </div>
                            <span style={{ fontSize: '0.8125rem', color: '#334155', fontWeight: 500, whiteSpace: 'nowrap' }}>
                              {assigneeName}
                            </span>
                          </div>
                        </td>

                        {/* Due Date */}
                        <td
                          style={{
                            padding: '0.875rem 1rem',
                            fontSize: '0.8125rem',
                            color: '#64748b',
                            textAlign: 'right',
                            whiteSpace: 'nowrap',
                            fontVariantNumeric: 'tabular-nums',
                          }}
                        >
                          {dueDate}
                        </td>

                        {/* Rapid Decision Actions */}
                        <td style={{ padding: '0.875rem 1rem', textAlign: 'right', whiteSpace: 'nowrap' }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '0.5rem' }}>
                            {/* Approve Button */}
                            <button
                              type="button"
                              data-testid={`approve-${item.id}`}
                              aria-label={`Approve ${item.title}`}
                              disabled={isBusy}
                              onClick={() => void handleApprove(item)}
                              style={{
                                padding: '0.35rem 0.75rem',
                                borderRadius: '6px',
                                border: '1px solid #047857',
                                backgroundColor: '#047857',
                                color: '#ffffff',
                                fontSize: '0.75rem',
                                fontWeight: 600,
                                cursor: isBusy ? 'not-allowed' : 'pointer',
                                opacity: isBusy ? 0.6 : 1,
                                transition: 'all 0.15s ease',
                              }}
                            >
                              {isBusy ? 'Saving…' : '✓ Approve'}
                            </button>

                            {/* Send Back Button */}
                            <button
                              type="button"
                              data-testid={`send-back-${item.id}`}
                              aria-label={`Return ${item.title}`}
                              disabled={isBusy}
                              onClick={(e) => {
                                triggerBtnRef.current = e.currentTarget
                                triggerIdRef.current = item.id
                                const idx = items.findIndex((i) => i.id === item.id)
                                nextFocusIdRef.current = idx !== -1 && idx + 1 < items.length ? items[idx + 1]!.id : null
                                prevFocusIdRef.current = idx > 0 ? items[idx - 1]!.id : null
                                setSendBackModalItem(item)
                                setSendBackReason('')
                                setReturnDialogError(null)
                              }}
                              style={{
                                padding: '0.35rem 0.75rem',
                                borderRadius: '6px',
                                border: '1px solid #fde68a',
                                backgroundColor: '#fef3c7',
                                color: '#92400e',
                                fontSize: '0.75rem',
                                fontWeight: 600,
                                cursor: isBusy ? 'not-allowed' : 'pointer',
                                opacity: isBusy ? 0.6 : 1,
                                transition: 'all 0.15s ease',
                              }}
                            >
                              ↺ Return
                            </button>

                            {/* Inspect Link */}
                            <Link
                              to={`/items/${item.id}`}
                              title="Open item details"
                              style={{
                                padding: '0.35rem 0.65rem',
                                borderRadius: '6px',
                                border: '1px solid #cbd5e1',
                                backgroundColor: '#ffffff',
                                color: '#475569',
                                fontSize: '0.75rem',
                                fontWeight: 600,
                                textDecoration: 'none',
                                display: 'inline-flex',
                                alignItems: 'center',
                              }}
                            >
                              Details →
                            </Link>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination Load More */}
            {hasMore && (
              <div
                style={{
                  padding: '0.875rem 1.25rem',
                  borderTop: '1px solid #e2e8f0',
                  display: 'flex',
                  justifyContent: 'center',
                  backgroundColor: theme.colors.bgCardMuted,
                }}
              >
                <button
                  type="button"
                  data-testid="approvals-load-more"
                  disabled={isFetching}
                  onClick={() => {
                    if (nextCursor) setCursor(nextCursor)
                  }}
                  style={{
                    ...commonStyles.buttonSecondary,
                    padding: '0.45rem 1.25rem',
                    fontSize: '0.8125rem',
                    cursor: isFetching ? 'not-allowed' : 'pointer',
                    opacity: isFetching ? 0.7 : 1,
                  }}
                >
                  {isFetching ? 'Loading more items…' : 'Load More Items'}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Return / Send Back Modal */}
      {sendBackModalItem && (
        <div
          ref={modalRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="return-modal-title"
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
            padding: '1rem',
          }}
          onClick={(e) => {
            if (isSubmittingReturn) return
            if (e.target === e.currentTarget) {
              setSendBackModalItem(null)
              setReturnDialogError(null)
            }
          }}
        >
          <div
            style={{
              backgroundColor: '#ffffff',
              borderRadius: '12px',
              maxWidth: '480px',
              width: '100%',
              padding: '1.5rem',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
            }}
          >
            <h2
              id="return-modal-title"
              style={{
                fontSize: '1.125rem',
                fontWeight: 700,
                color: theme.colors.textPrimary,
                margin: '0 0 0.5rem',
              }}
            >
              Return for Revisions
            </h2>
            <p style={{ fontSize: '0.875rem', color: '#64748b', margin: '0 0 1rem', lineHeight: 1.4 }}>
              Return <strong>#{sendBackModalItem.id} ({sendBackModalItem.title})</strong> back to{' '}
              <strong>{sendBackModalItem.assignee?.displayName ?? 'the assignee'}</strong> for changes.
            </p>

            {returnDialogError && (
              <div
                role="alert"
                data-testid="return-dialog-error"
                style={{
                  padding: '0.65rem 0.875rem',
                  backgroundColor: '#fef2f2',
                  border: '1px solid #fecaca',
                  color: '#991b1b',
                  borderRadius: '6px',
                  marginBottom: '1rem',
                  fontSize: '0.8125rem',
                }}
              >
                {returnDialogError}
              </div>
            )}

            <label
              htmlFor="return-reason"
              style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, color: '#334155', marginBottom: '0.35rem' }}
            >
              Feedback / Return Reason (optional):
            </label>
            <textarea
              ref={textareaRef}
              id="return-reason"
              disabled={isSubmittingReturn}
              value={sendBackReason}
              onChange={(e) => setSendBackReason(e.target.value)}
              placeholder="e.g. Please add automated tests before final sign-off..."
              rows={3}
              style={{
                width: '100%',
                padding: '0.6rem 0.75rem',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                fontSize: '0.875rem',
                fontFamily: 'inherit',
                boxSizing: 'border-box',
                resize: 'vertical',
                marginBottom: '1.25rem',
                backgroundColor: isSubmittingReturn ? '#f8fafc' : '#ffffff',
                cursor: isSubmittingReturn ? 'not-allowed' : 'text',
              }}
            />

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
              <button
                type="button"
                disabled={isSubmittingReturn}
                onClick={() => {
                  if (!isSubmittingReturn) {
                    setSendBackModalItem(null)
                    setReturnDialogError(null)
                  }
                }}
                style={{
                  ...commonStyles.buttonSecondary,
                  padding: '0.5rem 1rem',
                  fontSize: '0.875rem',
                  cursor: isSubmittingReturn ? 'not-allowed' : 'pointer',
                  opacity: isSubmittingReturn ? 0.6 : 1,
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isSubmittingReturn}
                onClick={() => {
                  if (!isSubmittingReturn) void handleSendBackConfirm()
                }}
                style={{
                  ...commonStyles.buttonPrimary,
                  backgroundColor: '#b45309',
                  border: '1px solid #b45309',
                  padding: '0.5rem 1rem',
                  fontSize: '0.875rem',
                  cursor: isSubmittingReturn ? 'not-allowed' : 'pointer',
                  opacity: isSubmittingReturn ? 0.6 : 1,
                }}
              >
                Confirm Return
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
