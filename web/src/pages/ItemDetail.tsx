import React, { useState, useRef, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  useItem,
  useItemActivity,
  useClaimItem,
  useTransitionItem,
  useAssignItem,
  useAddComment,
  useTeamMembers,
  useInfiniteTeamMembers,
  useMe,
} from '../api/hooks'
import { ApiError } from '../api/client'
import { useOptionalAuth } from '../auth/AuthContext'
import { ActivityTimeline } from '../components/ActivityTimeline'
import { ItemForm } from '../components/ItemForm'
import type { Role, Status, UserSummary } from '../api/types'
import { commonStyles, theme, getStatusBadgeStyle, getPriorityBadgeStyle, getApiErrorMessage } from '../theme'

export interface ItemDetailProps {
  currentUser?: UserSummary | { id: number; displayName: string; email: string }
  userRole?: Role
}


function getInitials(name?: string | null): string {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const first = parts[0]
  if (!first) return '?'
  if (parts.length === 1) return first.slice(0, 2).toUpperCase()
  const last = parts[parts.length - 1]
  const firstChar = first[0] ?? ''
  const lastChar = last?.[0] ?? ''
  return (firstChar + lastChar).toUpperCase() || '?'
}

function AvatarBubble({ name, isUnassigned = false }: { name?: string | null; isUnassigned?: boolean }): React.ReactElement {
  if (isUnassigned) {
    return (
      <span
        style={{
          width: '24px',
          height: '24px',
          borderRadius: '9999px',
          border: `1px dashed ${theme.colors.borderStrong}`,
          backgroundColor: theme.colors.bgCardMuted,
          color: theme.colors.textSubtle,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '0.6875rem',
          fontWeight: 600,
          flexShrink: 0,
        }}
        aria-hidden="true"
      >
        —
      </span>
    )
  }
  return (
    <span
      style={{
        width: '24px',
        height: '24px',
        borderRadius: '9999px',
        border: `1px solid ${theme.colors.accentBorder}`,
        backgroundColor: theme.colors.accentSubtle,
        color: theme.colors.accent,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '0.6875rem',
        fontWeight: 700,
        letterSpacing: '0.02em',
        flexShrink: 0,
      }}
      aria-hidden="true"
    >
      {getInitials(name)}
    </span>
  )
}

export function ItemDetail({
  currentUser: propUser,
  userRole: propRole,
}: ItemDetailProps = {}): React.ReactElement {
  const { id } = useParams<{ id: string }>()
  const itemId = Number(id)
  const isValidId = Number.isInteger(itemId) && itemId > 0

  const itemQuery = useItem(isValidId ? itemId : 0)
  const activityQuery = useItemActivity(isValidId ? itemId : 0)
  const { data: meData } = useMe()
  const auth = useOptionalAuth()

  const [isEditing, setIsEditing] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [isConflict, setIsConflict] = useState(false)

  // Comments state
  const [commentText, setCommentText] = useState('')
  const [commentError, setCommentError] = useState<string | null>(null)

  const [transitionReason, setTransitionReason] = useState('')

  const claimMutation = useClaimItem()
  const transitionMutation = useTransitionItem()
  const assignMutation = useAssignItem()
  const addCommentMutation = useAddComment()

  // Lead Assign state
  const [showAssignModal, setShowAssignModal] = useState(false)
  const [selectedAssigneeId, setSelectedAssigneeId] = useState<number | null>(null)
  const assignTriggerRef = useRef<HTMLButtonElement>(null)
  const assignModalRef = useRef<HTMLDivElement>(null)
  const wasAssignOpenRef = useRef(false)

  useEffect(() => {
    if (!showAssignModal && wasAssignOpenRef.current) {
      assignTriggerRef.current?.focus()
    }
    wasAssignOpenRef.current = showAssignModal
  }, [showAssignModal])

  const item = itemQuery.data?.item

  const effectiveUser =
    propUser ??
    (meData?.user
      ? { id: meData.user.id, displayName: meData.user.displayName, email: meData.user.email }
      : auth?.user
        ? { id: auth.user.id, displayName: auth.user.displayName, email: auth.user.email }
        : null)

  const membershipRole = item ? meData?.memberships.find((m) => m.teamId === item.teamId)?.role : undefined
  const effectiveRole: Role =
    propRole ??
    membershipRole ??
    (auth?.user && 'role' in auth.user && typeof auth.user.role === 'string'
      ? (auth.user.role as Role)
      : 'viewer')

  const isLead = effectiveRole === 'lead'

  useEffect(() => {
    if (showAssignModal && isLead) {
      const focusable = assignModalRef.current?.querySelector<HTMLElement>(
        'select, button, input, [tabindex]:not([tabindex="-1"])'
      )
      focusable?.focus()
    }
  }, [showAssignModal, isLead])

  useEffect(() => {
    if (!showAssignModal || !isLead) return

    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        setShowAssignModal(false)
        return
      }

      if (e.key === 'Tab') {
        const focusables = Array.from(
          assignModalRef.current?.querySelectorAll<HTMLElement>(
            'select:not([disabled]), button:not([disabled]), input:not([disabled]), [href], textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
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
          if (document.activeElement === first || !assignModalRef.current?.contains(document.activeElement)) {
            e.preventDefault()
            last.focus()
          }
        } else {
          if (document.activeElement === last || !assignModalRef.current?.contains(document.activeElement)) {
            e.preventDefault()
            first.focus()
          }
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [showAssignModal, isLead])

  const teamMembersQuery = useInfiniteTeamMembers(item?.teamId ?? 0, {
    limit: 20,
    enabled: isLead && showAssignModal,
  })
  const teamMembers = teamMembersQuery.data?.pages.flatMap((page) => page.members) ?? []
  if (!isValidId) {
    return (
      <div className="item-detail-page" style={commonStyles.narrowContainer}>
        <div role="alert" data-testid="not-found" style={{ ...commonStyles.cardPadded, textAlign: 'center', padding: '4rem 1rem' }}>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.5rem', color: theme.colors.textPrimary }}>Item not found</h1>
          <p style={{ color: theme.colors.textMuted, marginBottom: '1.5rem' }}>The requested item does not exist.</p>
          <Link to="/items" style={commonStyles.buttonSecondary}>
            &larr; Back to items
          </Link>
        </div>
      </div>
    )
  }

  if (itemQuery.isLoading) {
    return (
      <div className="item-detail-page" style={commonStyles.narrowContainer}>
        <div role="status" style={{ ...commonStyles.cardPadded, padding: '3rem', textAlign: 'center', color: theme.colors.textMuted }}>
          Loading item details...
        </div>
      </div>
    )
  }

  if (itemQuery.isError) {
    const error = itemQuery.error
    const isNotFound = error instanceof ApiError ? error.status === 404 : false

    if (isNotFound) {
      return (
        <div className="item-detail-page" style={commonStyles.narrowContainer}>
          <div role="alert" data-testid="not-found" style={{ ...commonStyles.cardPadded, textAlign: 'center', padding: '4rem 1rem' }}>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.5rem', color: theme.colors.textPrimary }}>Item not found</h1>
            <p style={{ color: theme.colors.textMuted, marginBottom: '1.5rem' }}>
              The requested item could not be found or you do not have permission to view it.
            </p>
            <Link to="/items" style={commonStyles.buttonSecondary}>
              &larr; Back to items
            </Link>
          </div>
        </div>
      )
    }

    return (
      <div className="item-detail-page" style={commonStyles.narrowContainer}>
        <div role="alert" style={{ ...commonStyles.alertError, padding: '1.25rem' }}>
          Error loading item: {getApiErrorMessage(error)}
        </div>
      </div>
    )
  }

  if (!item) {
    return (
      <div className="item-detail-page" style={commonStyles.narrowContainer}>
        <div role="alert" data-testid="not-found" style={{ ...commonStyles.cardPadded, textAlign: 'center', padding: '4rem 1rem' }}>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.5rem', color: theme.colors.textPrimary }}>Item not found</h1>
          <p style={{ color: theme.colors.textMuted, marginBottom: '1.5rem' }}>The requested item could not be found.</p>
          <Link to="/items" style={commonStyles.buttonSecondary}>
            &larr; Back to items
          </Link>
        </div>
      </div>
    )
  }

  const assigneeName = item.assignee?.displayName ?? 'Unassigned'
  const creatorName = item.creator?.displayName ?? `User #${item.createdBy}`
  const dueDate = item.dueAt ? new Date(item.dueAt).toLocaleDateString() : 'No due date'

  const isMember = effectiveRole === 'member'
  const isMemberOrLead = isLead || isMember
  const isAssignee = effectiveUser ? item.assigneeId === effectiveUser.id : false
  const isCreator = effectiveUser ? item.createdBy === effectiveUser.id : false

  const canClaim = item.status === 'open' && item.assigneeId === null && isMemberOrLead
  const canStart =
    item.status === 'open' &&
    item.assigneeId !== null &&
    (isLead || (isMember && isAssignee))
  const canAssign = isLead
  const canSubmitForApproval =
    item.status === 'in_progress' &&
    item.assigneeId !== null &&
    (isLead || (isMember && isAssignee))
  const canApprove = item.status === 'awaiting_approval' && isLead
  const canSendBack = item.status === 'awaiting_approval' && isLead
  const canClose = item.status === 'resolved' && isLead
  const canReopen = item.status === 'resolved' && isLead
  const canCancel =
    (item.status === 'open' || item.status === 'in_progress' || item.status === 'awaiting_approval') &&
    (isLead || (isMember && isCreator))
  const canEdit = isMemberOrLead
  const canComment = isMemberOrLead
  const isActionPending =
    claimMutation.isPending ||
    transitionMutation.isPending ||
    assignMutation.isPending ||
    addCommentMutation.isPending

  const handleReload = (): void => {
    setActionError(null)
    setIsConflict(false)
    void itemQuery.refetch()
    void activityQuery.refetch()
  }

  const handleClaim = async (): Promise<void> => {
    setActionError(null)
    setIsConflict(false)
    try {
      await claimMutation.mutateAsync({
        id: item.id,
        actor: effectiveUser,
      })
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setIsConflict(true)
      }
      setActionError(getApiErrorMessage(err, 'Failed to claim item.'))
    }
  }

  const handleTransition = async (to: Status, overrideReason?: string): Promise<void> => {
    setActionError(null)
    setIsConflict(false)
    const effectiveReason = overrideReason ?? transitionReason.trim()
    try {
      await transitionMutation.mutateAsync({
        id: item.id,
        to,
        ...(effectiveReason ? { reason: effectiveReason } : {}),
      })
      setTransitionReason('')
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setIsConflict(true)
      }
      setActionError(getApiErrorMessage(err, 'Failed to transition item.'))
    }
  }

  const handleExecuteAssign = async (): Promise<void> => {
    setActionError(null)
    setIsConflict(false)

    try {
      await assignMutation.mutateAsync({
        id: item.id,
        assigneeId: selectedAssigneeId,
        expectedVersion: item.version,
      })
      setShowAssignModal(false)
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setIsConflict(true)
      }
      setActionError(getApiErrorMessage(err, 'Failed to assign item.'))
      setShowAssignModal(false)
    }
  }

  const handleAddCommentSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    setCommentError(null)
    const trimmed = commentText.trim()
    if (!trimmed) return

    try {
      await addCommentMutation.mutateAsync({
        itemId: item.id,
        body: trimmed,
      })
      setCommentText('')
    } catch (err) {
      setCommentError(getApiErrorMessage(err, 'Failed to post comment.'))
    }
  }

  const hasTransitions = Boolean(
    canStart || canSubmitForApproval || canApprove || canSendBack || canClose || canReopen || canCancel
  )
  const hasActions = Boolean(
    canStart || canClaim || canSubmitForApproval || canApprove || canSendBack || canReopen || canClose || canAssign || canCancel
  )

  const propertyRowStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0.65rem 0',
    borderBottom: `1px solid ${theme.colors.border}`,
    fontSize: '0.875rem',
    gap: '0.75rem',
  }

  return (
    <div className="item-detail-page" style={commonStyles.pageContainer}>
      <style>{`
        .item-detail-layout {
          display: grid;
          grid-template-columns: minmax(0, 1fr) 320px;
          gap: 1.5rem;
          align-items: start;
        }
        .item-detail-sidebar {
          display: flex;
          flex-direction: column;
          gap: 1.25rem;
          position: sticky;
          top: 1.5rem;
        }
        .item-breadcrumb-link {
          display: inline-flex;
          align-items: center;
          gap: 0.4rem;
          color: ${theme.colors.textMuted};
          text-decoration: none;
          font-size: 0.875rem;
          font-weight: 500;
          transition: color 0.15s ease;
        }
        .item-breadcrumb-link:hover {
          color: ${theme.colors.accent};
          text-decoration: none;
        }
        @media (max-width: 860px) {
          .item-detail-layout {
            grid-template-columns: 1fr;
            gap: 1.25rem;
          }
          .item-detail-sidebar {
            position: static;
          }
        }
      `}</style>
      <div
        inert={showAssignModal && isLead ? true : undefined}
        aria-hidden={showAssignModal && isLead ? 'true' : undefined}
      >
        <nav style={{ marginBottom: '1.25rem' }}>
          <Link
            to="/items"
            className="item-breadcrumb-link"
          >
            <span aria-hidden="true">&larr;</span> Back to items
          </Link>
        </nav>

        {/* Conflict / Reload Banner */}
        {isConflict && (
          <div
            role="alert"
            style={{
              padding: '1rem 1.25rem',
              backgroundColor: '#fef2f2',
              border: '1px solid #fecaca',
              borderRadius: '12px',
              color: '#991b1b',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '1rem',
              fontSize: '0.875rem',
              marginBottom: '1.25rem',
            }}
          >
            <div>
              <strong>State Conflict Detected</strong>
              <div style={{ marginTop: '0.2rem', fontSize: '0.8125rem' }}>
                This item has been modified on the server. Reload to view the latest version and retry your action.
              </div>
            </div>
            <button
              type="button"
              onClick={handleReload}
              style={{
                padding: '0.45rem 0.9rem',
                backgroundColor: '#dc2626',
                color: '#ffffff',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontWeight: 600,
                fontSize: '0.8125rem',
                whiteSpace: 'nowrap',
              }}
            >
              Reload Item
            </button>
          </div>
        )}

        {actionError && !isConflict && (
          <div
            role="alert"
            data-testid="action-error"
            style={{ ...commonStyles.alertError, marginBottom: '1.25rem' }}
          >
            {actionError}
          </div>
        )}

        <div className="item-detail-layout">
          {/* Main Content Column */}
          <main className="item-detail-main" style={{ minWidth: 0 }}>
            {isEditing ? (
              <section
                aria-label="Edit Item"
                style={{
                  ...commonStyles.cardPadded,
                  padding: '1.75rem',
                  marginBottom: '1.5rem',
                }}
              >
                <h2 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '1.25rem', color: theme.colors.textPrimary }}>
                  Edit Item #{item.id}
                </h2>
                <ItemForm
                  item={item}
                  userRole={effectiveRole}
                  onSuccess={() => setIsEditing(false)}
                  onCancel={() => setIsEditing(false)}
                  onReload={() => {
                    setIsEditing(false)
                    void itemQuery.refetch()
                  }}
                />
              </section>
            ) : (
              <>
                {/* Header card */}
                <header
                  style={{
                    ...commonStyles.cardPadded,
                    padding: '1.75rem',
                    marginBottom: '1.5rem',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', marginBottom: '0.625rem' }}>
                    <div
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.45rem',
                        backgroundColor: theme.colors.bgHover,
                        border: `1px solid ${theme.colors.border}`,
                        borderRadius: theme.radius.sm,
                        padding: '0.2rem 0.55rem',
                        fontSize: '0.8125rem',
                        color: theme.colors.textMuted,
                      }}
                    >
                      <span style={{ fontFamily: 'monospace', fontWeight: 600, color: theme.colors.textPrimary }}>#{item.id}</span>
                      <span style={{ color: theme.colors.textSubtle }}>•</span>
                      <span style={{ textTransform: 'capitalize', fontWeight: 500, color: theme.colors.textSecondary }}>{item.type.replace(/_/g, ' ')}</span>
                    </div>

                    {canEdit && !isEditing && (
                      <button
                        type="button"
                        data-testid="edit-button"
                        onClick={() => setIsEditing(true)}
                        style={{
                          ...commonStyles.buttonSecondary,
                          padding: '0.35rem 0.75rem',
                          fontSize: '0.8125rem',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.35rem',
                        }}
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                        </svg>
                        <span>Edit</span>
                      </button>
                    )}
                  </div>

                  <h1
                    data-testid="item-title"
                    style={{
                      fontSize: '1.625rem',
                      fontWeight: 800,
                      color: theme.colors.textPrimary,
                      margin: 0,
                      letterSpacing: '-0.02em',
                      lineHeight: 1.25,
                    }}
                  >
                    {item.title}
                  </h1>
                </header>

                {/* Description Panel */}
                <section aria-label="Description" style={{ marginBottom: '1.75rem' }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      marginBottom: '0.5rem',
                    }}
                  >
                    <h2
                      style={{
                        fontSize: '0.75rem',
                        fontWeight: 700,
                        color: theme.colors.textMuted,
                        textTransform: 'uppercase',
                        letterSpacing: '0.04em',
                        margin: 0,
                      }}
                    >
                      Description
                    </h2>
                  </div>
                  <div
                    data-testid="item-description"
                    style={{
                      ...commonStyles.cardPadded,
                      padding: '1.25rem',
                      whiteSpace: 'pre-wrap',
                      color: item.description ? theme.colors.textSecondary : theme.colors.textSubtle,
                      fontSize: '0.9375rem',
                      lineHeight: 1.6,
                    }}
                  >
                    {item.description || 'No description provided.'}
                  </div>
                </section>
              </>
            )}

            {/* Discussion & Comments */}
            <section aria-label="Discussion and Comments" style={{ marginTop: '2rem', marginBottom: '2rem' }}>
              <h2 style={{ fontSize: '1.125rem', fontWeight: 700, color: theme.colors.textPrimary, marginBottom: '0.875rem' }}>
                Discussion & Comments
              </h2>

              {canComment ? (
                <form onSubmit={(e) => void handleAddCommentSubmit(e)} style={{ marginBottom: '1.5rem' }}>
                  {commentError && (
                    <div role="alert" style={{ ...commonStyles.alertError, marginBottom: '0.75rem' }}>
                      {commentError}
                    </div>
                  )}
                  <div
                    style={{
                      ...commonStyles.cardPadded,
                      padding: '1.25rem',
                      backgroundColor: theme.colors.bgCard,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                      <AvatarBubble name={effectiveUser?.displayName ?? 'User'} />
                      <label htmlFor="new-comment" style={{ ...commonStyles.label, margin: 0 }}>
                        Add to conversation
                      </label>
                    </div>
                    <textarea
                      id="new-comment"
                      aria-label="Add a comment"
                      rows={3}
                      required
                      maxLength={10000}
                      placeholder="Share operational updates, questions, or handoff notes…"
                      value={commentText}
                      onChange={(e) => setCommentText(e.target.value)}
                      style={{
                        ...commonStyles.input,
                        minHeight: '90px',
                        resize: 'vertical',
                      }}
                    />
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.75rem' }}>
                      <span style={{ fontSize: '0.75rem', color: theme.colors.textMuted }}>
                        {commentText.length} / 10,000 characters
                      </span>
                      <button
                        type="submit"
                        disabled={addCommentMutation.isPending || !commentText.trim()}
                        style={{
                          ...commonStyles.buttonPrimary,
                          opacity: addCommentMutation.isPending || !commentText.trim() ? 0.6 : 1,
                          cursor: addCommentMutation.isPending || !commentText.trim() ? 'not-allowed' : 'pointer',
                        }}
                      >
                        {addCommentMutation.isPending ? 'Posting…' : 'Post Comment'}
                      </button>
                    </div>
                  </div>
                </form>
              ) : (
                <div
                  style={{
                    padding: '0.85rem 1rem',
                    backgroundColor: theme.colors.bgCardMuted,
                    border: `1px solid ${theme.colors.border}`,
                    borderRadius: '8px',
                    fontSize: '0.8125rem',
                    color: theme.colors.textMuted,
                    marginBottom: '1.5rem',
                  }}
                >
                  Viewer access is read-only. Members and leads may post comments on work items.
                </div>
              )}
            </section>

            {/* Activity Timeline */}
            <section aria-label="Activity History" style={{ marginTop: '2rem' }}>
              <h2 style={{ fontSize: '1.125rem', fontWeight: 700, color: theme.colors.textPrimary, marginBottom: '0.875rem' }}>
                Activity & Audit Log
              </h2>
              <ActivityTimeline
                events={activityQuery.data?.events ?? []}
                isLoading={activityQuery.isLoading}
              />
            </section>
          </main>

          {/* Sidebar Column */}
          <aside className="item-detail-sidebar">
            {/* Workflow & Lifecycle Actions Card */}
            <div
              style={{
                ...commonStyles.cardPadded,
                padding: '1.25rem',
                backgroundColor: theme.colors.bgCard,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: '1rem',
                  paddingBottom: '0.5rem',
                  borderBottom: `1px solid ${theme.colors.border}`,
                }}
              >
                <h2
                  style={{
                    fontSize: '0.75rem',
                    fontWeight: 700,
                    color: theme.colors.textPrimary,
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                    margin: 0,
                  }}
                >
                  Workflow & Actions
                </h2>
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.35rem',
                    fontSize: '0.6875rem',
                    fontWeight: 600,
                    color: theme.colors.textMuted,
                  }}
                >
                  <span
                    style={{
                      width: '7px',
                      height: '7px',
                      borderRadius: '9999px',
                      backgroundColor: theme.colors.accent,
                    }}
                    aria-hidden="true"
                  />
                  Live
                </span>
              </div>

              {/* Transition reason input */}
              {hasTransitions && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', marginBottom: '0.875rem' }}>
                  <label
                    htmlFor="transition-reason"
                    style={{
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      color: theme.colors.textMuted,
                    }}
                  >
                    Reason:
                  </label>
                  <input
                    id="transition-reason"
                    type="text"
                    placeholder="Transition reason (optional)…"
                    value={transitionReason}
                    onChange={(e) => setTransitionReason(e.target.value)}
                    style={{
                      ...commonStyles.input,
                      width: '100%',
                      boxSizing: 'border-box',
                      padding: '0.45rem 0.65rem',
                      fontSize: '0.8125rem',
                    }}
                  />
                </div>
              )}

              {/* Action buttons */}
              <div
                data-testid="item-actions"
                style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}
              >
                {canClaim && (
                  <button
                    type="button"
                    data-testid="claim-button"
                    disabled={isActionPending}
                    onClick={() => void handleClaim()}
                    style={{
                      ...commonStyles.buttonPrimary,
                      width: '100%',
                      cursor: isActionPending ? 'not-allowed' : 'pointer',
                      opacity: isActionPending ? 0.7 : 1,
                    }}
                  >
                    {claimMutation.isPending ? 'Claiming...' : 'Claim'}
                  </button>
                )}

                {canStart && (
                  <button
                    type="button"
                    data-testid="start-work-button"
                    disabled={isActionPending}
                    onClick={() => void handleTransition('in_progress')}
                    style={{
                      ...commonStyles.buttonPrimary,
                      width: '100%',
                      cursor: isActionPending ? 'not-allowed' : 'pointer',
                      opacity: isActionPending ? 0.7 : 1,
                    }}
                  >
                    Start work
                  </button>
                )}

                {canSubmitForApproval && (
                  <button
                    type="button"
                    data-testid="submit-approval-button"
                    disabled={isActionPending}
                    onClick={() => void handleTransition('awaiting_approval')}
                    style={{
                      ...commonStyles.buttonPrimary,
                      backgroundColor: '#7c3aed',
                      borderColor: '#7c3aed',
                      width: '100%',
                      cursor: isActionPending ? 'not-allowed' : 'pointer',
                      opacity: isActionPending ? 0.7 : 1,
                    }}
                  >
                    Submit for Approval
                  </button>
                )}

                {canApprove && (
                  <button
                    type="button"
                    data-testid="approve-button"
                    disabled={isActionPending}
                    onClick={() => void handleTransition('resolved')}
                    style={{
                      ...commonStyles.buttonPrimary,
                      backgroundColor: '#047857',
                      borderColor: '#047857',
                      width: '100%',
                      cursor: isActionPending ? 'not-allowed' : 'pointer',
                      opacity: isActionPending ? 0.7 : 1,
                    }}
                  >
                    Approve
                  </button>
                )}

                {canSendBack && (
                  <button
                    type="button"
                    data-testid="send-back-button"
                    disabled={isActionPending}
                    onClick={() => void handleTransition('in_progress')}
                    style={{
                      ...commonStyles.buttonSecondary,
                      color: '#b45309',
                      borderColor: '#fde68a',
                      backgroundColor: '#fffbeb',
                      width: '100%',
                      cursor: isActionPending ? 'not-allowed' : 'pointer',
                      opacity: isActionPending ? 0.7 : 1,
                    }}
                  >
                    Send Back
                  </button>
                )}

                {canClose && (
                  <button
                    type="button"
                    data-testid="close-button"
                    disabled={isActionPending}
                    onClick={() => void handleTransition('closed')}
                    style={{
                      ...commonStyles.buttonSecondary,
                      width: '100%',
                      cursor: isActionPending ? 'not-allowed' : 'pointer',
                      opacity: isActionPending ? 0.7 : 1,
                    }}
                  >
                    Close
                  </button>
                )}

                {canReopen && (
                  <button
                    type="button"
                    data-testid="reopen-button"
                    disabled={isActionPending}
                    onClick={() => void handleTransition('in_progress')}
                    style={{
                      ...commonStyles.buttonSecondary,
                      color: theme.colors.accent,
                      borderColor: theme.colors.accentBorder,
                      backgroundColor: theme.colors.accentSubtle,
                      width: '100%',
                      cursor: isActionPending ? 'not-allowed' : 'pointer',
                      opacity: isActionPending ? 0.7 : 1,
                    }}
                  >
                    Reopen
                  </button>
                )}

                {canAssign && (
                  <button
                    ref={assignTriggerRef}
                    type="button"
                    data-testid="assign-button"
                    disabled={isActionPending}
                    onClick={() => {
                      setSelectedAssigneeId(item.assigneeId)
                      setShowAssignModal(true)
                    }}
                    style={{
                      ...commonStyles.buttonSecondary,
                      width: '100%',
                    }}
                  >
                    Assign
                  </button>
                )}

                {canCancel && (
                  <button
                    type="button"
                    data-testid="cancel-button"
                    disabled={isActionPending}
                    onClick={() => void handleTransition('cancelled')}
                    style={{
                      ...commonStyles.buttonDanger,
                      width: '100%',
                      cursor: isActionPending ? 'not-allowed' : 'pointer',
                      opacity: isActionPending ? 0.7 : 1,
                    }}
                  >
                    Cancel
                  </button>
                )}

                {!hasActions && (
                  <div style={{ fontSize: '0.8125rem', color: theme.colors.textMuted, fontStyle: 'italic', textAlign: 'center', padding: '0.5rem 0' }}>
                    No actions available
                  </div>
                )}
              </div>
            </div>

            {/* Properties & Attributes Card */}
            <section
              aria-label="Item Attributes"
              style={{
                ...commonStyles.cardPadded,
                padding: '1.25rem',
                backgroundColor: theme.colors.bgCard,
              }}
            >
              <h2
                style={{
                  fontSize: '0.75rem',
                  fontWeight: 700,
                  color: theme.colors.textPrimary,
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  margin: '0 0 0.5rem 0',
                  paddingBottom: '0.5rem',
                  borderBottom: `1px solid ${theme.colors.border}`,
                }}
              >
                Attributes
              </h2>

              <div style={propertyRowStyle}>
                <span
                  style={{
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    color: theme.colors.textMuted,
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                  }}
                >
                  Status
                </span>
                <span
                  data-testid="item-status"
                  style={getStatusBadgeStyle(item.status)}
                >
                  {item.status.replace(/_/g, ' ')}
                </span>
              </div>

              <div style={propertyRowStyle}>
                <span
                  style={{
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    color: theme.colors.textMuted,
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                  }}
                >
                  Priority
                </span>
                <span
                  data-testid="item-priority"
                  style={getPriorityBadgeStyle(item.priority)}
                >
                  {item.priority}
                </span>
              </div>

              <div style={propertyRowStyle}>
                <span
                  style={{
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    color: theme.colors.textMuted,
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                  }}
                >
                  Assignee
                </span>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', minWidth: 0, justifyContent: 'flex-end' }}>
                  <AvatarBubble name={assigneeName} isUnassigned={!item.assignee} />
                  <span
                    data-testid="item-assignee"
                    style={{
                      fontWeight: 600,
                      color: item.assignee ? theme.colors.textPrimary : theme.colors.textSubtle,
                      fontSize: '0.875rem',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      maxWidth: '150px',
                    }}
                  >
                    {assigneeName}
                  </span>
                </div>
              </div>

              <div style={propertyRowStyle}>
                <span
                  style={{
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    color: theme.colors.textMuted,
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                  }}
                >
                  Creator
                </span>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', minWidth: 0, justifyContent: 'flex-end' }}>
                  <AvatarBubble name={creatorName} />
                  <span
                    data-testid="item-creator"
                    style={{
                      fontWeight: 600,
                      color: theme.colors.textPrimary,
                      fontSize: '0.875rem',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      maxWidth: '150px',
                    }}
                  >
                    {creatorName}
                  </span>
                </div>
              </div>

              <div style={{ ...propertyRowStyle, borderBottom: 'none' }}>
                <span
                  style={{
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    color: theme.colors.textMuted,
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                  }}
                >
                  Due Date
                </span>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem' }}>
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                    style={{ color: theme.colors.textMuted, flexShrink: 0 }}
                  >
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                    <line x1="16" y1="2" x2="16" y2="6" />
                    <line x1="8" y1="2" x2="8" y2="6" />
                    <line x1="3" y1="10" x2="21" y2="10" />
                  </svg>
                  <span
                    data-testid="item-due"
                    style={{
                      fontWeight: 600,
                      color: item.dueAt ? theme.colors.textPrimary : theme.colors.textSubtle,
                      fontSize: '0.875rem',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {dueDate}
                  </span>
                </div>
              </div>
            </section>
          </aside>
        </div>
      </div>

      {/* Lead Assign Dialog */}
      {showAssignModal && isLead && (
        <div
          ref={assignModalRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="assign-modal-title"
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.45)',
            backdropFilter: 'blur(2px)',
            zIndex: 100,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '1rem',
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowAssignModal(false)
          }}
        >
          <div
            style={{
              backgroundColor: '#ffffff',
              borderRadius: '12px',
              padding: '1.75rem',
              maxWidth: '440px',
              width: '100%',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
              border: `1px solid ${theme.colors.border}`,
            }}
          >
            <h2 id="assign-modal-title" style={{ fontSize: '1.125rem', fontWeight: 700, margin: '0 0 0.5rem', color: theme.colors.textPrimary }}>
              Assign Item #{item.id}
            </h2>
            <p style={{ fontSize: '0.8125rem', color: theme.colors.textMuted, margin: '0 0 1.25rem' }}>
              Assign responsibility to any member or lead of this team, or set as unassigned.
            </p>

            <div style={{ marginBottom: '1.5rem' }}>
              <label htmlFor="assignee-select" style={commonStyles.label}>
                Assignee
              </label>
              <select
                id="assignee-select"
                value={selectedAssigneeId ?? ''}
                onChange={(e) => setSelectedAssigneeId(e.target.value ? Number(e.target.value) : null)}
                style={commonStyles.select}
              >
                <option value="">Unassigned</option>
                {teamMembers.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.user.displayName} ({m.role}) - {m.user.email}
                  </option>
                ))}
              </select>
              {teamMembersQuery.hasNextPage && (
                <button
                  type="button"
                  onClick={() => void teamMembersQuery.fetchNextPage()}
                  disabled={teamMembersQuery.isFetchingNextPage}
                  style={{
                    ...commonStyles.buttonSecondary,
                    marginTop: '0.5rem',
                    padding: '0.3rem 0.6rem',
                    fontSize: '0.75rem',
                    width: '100%',
                  }}
                >
                  {teamMembersQuery.isFetchingNextPage ? 'Loading more members…' : 'Load more members'}
                </button>
              )}
              {teamMembersQuery.isError && (
                <div style={{ marginTop: '0.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '0.75rem', color: '#dc2626' }}>Failed to load members.</span>
                  <button
                    type="button"
                    onClick={() => void teamMembersQuery.refetch()}
                    style={{ ...commonStyles.buttonSecondary, padding: '0.2rem 0.5rem', fontSize: '0.75rem' }}
                  >
                    Retry
                  </button>
                </div>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
              <button
                type="button"
                onClick={() => setShowAssignModal(false)}
                style={commonStyles.buttonSecondary}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={assignMutation.isPending}
                onClick={() => void handleExecuteAssign()}
                style={{
                  ...commonStyles.buttonPrimary,
                  opacity: assignMutation.isPending ? 0.7 : 1,
                  cursor: assignMutation.isPending ? 'not-allowed' : 'pointer',
                }}
              >
                {assignMutation.isPending ? 'Assigning…' : 'Save Assignment'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
