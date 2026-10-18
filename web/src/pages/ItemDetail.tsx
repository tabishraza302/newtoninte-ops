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

  return (
    <div className="item-detail-page" style={commonStyles.narrowContainer}>
      <div
        inert={showAssignModal && isLead ? true : undefined}
        aria-hidden={showAssignModal && isLead ? 'true' : undefined}
      >
        <nav style={{ marginBottom: '1.25rem' }}>
        <Link
          to="/items"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.4rem',
            color: theme.colors.textMuted,
            textDecoration: 'none',
            fontSize: '0.875rem',
            fontWeight: 500,
          }}
        >
          &larr; Back to items
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

      {/* Header card */}
      <header
        style={{
          ...commonStyles.cardPadded,
          padding: '1.75rem',
          marginBottom: '1.5rem',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '1rem',
          }}
        >
          <div style={{ flex: '1 1 300px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: theme.colors.textMuted, fontSize: '0.8125rem', marginBottom: '0.35rem' }}>
              <span style={{ fontFamily: 'monospace', fontWeight: 600, color: theme.colors.textSubtle }}>#{item.id}</span>
              <span>•</span>
              <span style={{ textTransform: 'capitalize', fontWeight: 500 }}>{item.type.replace(/_/g, ' ')}</span>
            </div>
            <h1 data-testid="item-title" style={{ fontSize: '1.625rem', fontWeight: 800, color: theme.colors.textPrimary, margin: '0.25rem 0', letterSpacing: '-0.02em', lineHeight: 1.25 }}>
              {item.title}
            </h1>
          </div>

          {/* Action buttons and Transition Reason */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', alignItems: 'flex-end' }}>
            {(canStart || canSubmitForApproval || canApprove || canSendBack || canClose || canReopen || canCancel) && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <label htmlFor="transition-reason" style={{ fontSize: '0.75rem', fontWeight: 600, color: theme.colors.textMuted }}>
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
                    width: '260px',
                    padding: '0.35rem 0.65rem',
                    fontSize: '0.8125rem',
                  }}
                />
              </div>
            )}

            <div
              data-testid="item-actions"
              style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}
            >
            {canEdit && !isEditing && (
              <button
                type="button"
                data-testid="edit-button"
                onClick={() => setIsEditing(true)}
                style={commonStyles.buttonSecondary}
              >
                Edit
              </button>
            )}

            {canClaim && (
              <button
                type="button"
                data-testid="claim-button"
                disabled={isActionPending}
                onClick={() => void handleClaim()}
                style={{
                  ...commonStyles.buttonPrimary,
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
                  cursor: isActionPending ? 'not-allowed' : 'pointer',
                  opacity: isActionPending ? 0.7 : 1,
                }}
              >
                Start work
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
                style={commonStyles.buttonSecondary}
              >
                Assign
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
                  cursor: isActionPending ? 'not-allowed' : 'pointer',
                  opacity: isActionPending ? 0.7 : 1,
                }}
              >
                Reopen
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
                  cursor: isActionPending ? 'not-allowed' : 'pointer',
                  opacity: isActionPending ? 0.7 : 1,
                }}
              >
                Cancel
              </button>
            )}
            </div>
          </div>
        </div>
      </header>


      {isEditing ? (
        <section
          aria-label="Edit Item"
          style={{
            ...commonStyles.cardPadded,
            marginBottom: '2rem',
          }}
        >
          <h2 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '1.25rem', color: theme.colors.textPrimary }}>Edit Item</h2>
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
          {/* Metadata Panel */}
          <section
            aria-label="Item Attributes"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
              gap: '1rem',
              padding: '1.25rem',
              backgroundColor: '#ffffff',
              border: `1px solid ${theme.colors.border}`,
              borderRadius: '12px',
              boxShadow: theme.shadows.sm,
              marginBottom: '1.5rem',
            }}
          >
            <div>
              <span style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: theme.colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.35rem' }}>
                Status
              </span>
              <span
                data-testid="item-status"
                style={getStatusBadgeStyle(item.status)}
              >
                {item.status.replace(/_/g, ' ')}
              </span>
            </div>

            <div>
              <span style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: theme.colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.35rem' }}>
                Priority
              </span>
              <span
                data-testid="item-priority"
                style={getPriorityBadgeStyle(item.priority)}
              >
                {item.priority}
              </span>
            </div>

            <div>
              <span style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: theme.colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.35rem' }}>
                Assignee
              </span>
              <span data-testid="item-assignee" style={{ fontWeight: 600, color: item.assignee ? theme.colors.textPrimary : theme.colors.textSubtle, fontSize: '0.875rem' }}>
                {assigneeName}
              </span>
            </div>

            <div>
              <span style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: theme.colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.35rem' }}>
                Creator
              </span>
              <span data-testid="item-creator" style={{ fontWeight: 600, color: theme.colors.textPrimary, fontSize: '0.875rem' }}>
                {creatorName}
              </span>
            </div>

            <div>
              <span style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: theme.colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.35rem' }}>
                Due Date
              </span>
              <span data-testid="item-due" style={{ fontWeight: 600, color: item.dueAt ? theme.colors.textPrimary : theme.colors.textSubtle, fontSize: '0.875rem', fontVariantNumeric: 'tabular-nums' }}>
                {dueDate}
              </span>
            </div>
          </section>

          {/* Description */}
          <section aria-label="Description" style={{ marginBottom: '2rem' }}>
            <h2 style={{ fontSize: '1.125rem', fontWeight: 700, color: theme.colors.textPrimary, marginBottom: '0.625rem' }}>
              Description
            </h2>
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
      <section aria-label="Discussion and Comments" style={{ marginTop: '2.5rem', marginBottom: '2.5rem' }}>
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
            <div style={{ marginBottom: '0.75rem' }}>
              <label htmlFor="new-comment" style={commonStyles.label}>
                Add to conversation
              </label>
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
                  minHeight: '80px',
                  resize: 'vertical',
                }}
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
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
