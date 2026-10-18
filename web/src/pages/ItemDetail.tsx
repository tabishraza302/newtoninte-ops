import React, { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  useItem,
  useItemActivity,
  useClaimItem,
  useTransitionItem,
  useMe,
} from '../api/hooks'
import { ApiError } from '../api/client'
import { useOptionalAuth } from '../auth/AuthContext'
import { ActivityTimeline } from '../components/ActivityTimeline'
import { ItemForm } from '../components/ItemForm'
import type { Role, Status, UserSummary } from '../api/types'
import { commonStyles, theme, getStatusBadgeStyle, getPriorityBadgeStyle } from '../theme'

export interface ItemDetailProps {
  currentUser?: UserSummary | { id: number; displayName: string; email: string }
  userRole?: Role
}

function parseApiErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (typeof err.data === 'object' && err.data !== null && 'error' in err.data) {
      const dataObj = err.data as { error?: { message?: string; code?: string } }
      if (dataObj.error?.message) {
        return dataObj.error.message
      }
      if (dataObj.error?.code === 'ALREADY_CLAIMED') {
        return 'Item already claimed'
      }
      if (dataObj.error?.code === 'STALE_STATE') {
        return 'Item is not in expected state'
      }
    }
    return err.message
  }
  if (err instanceof Error) {
    return err.message
  }
  return 'An error occurred performing the action'
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

  const claimMutation = useClaimItem()
  const transitionMutation = useTransitionItem()

  if (!isValidId) {
    return (
      <div className="item-detail-page" style={commonStyles.narrowContainer}>
        <div role="alert" data-testid="not-found" style={{ textAlign: 'center', padding: '4rem 1rem', backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.5rem', color: '#0f172a' }}>Item not found</h1>
          <p style={{ color: '#64748b', marginBottom: '1.5rem' }}>The requested item does not exist.</p>
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
        <div role="status" style={{ padding: '3rem', textAlign: 'center', color: '#64748b', backgroundColor: '#ffffff', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
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
          <div role="alert" data-testid="not-found" style={{ textAlign: 'center', padding: '4rem 1rem', backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.5rem', color: '#0f172a' }}>Item not found</h1>
            <p style={{ color: '#64748b', marginBottom: '1.5rem' }}>
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
          Error loading item: {error.message}
        </div>
      </div>
    )
  }

  if (!itemQuery.data || !itemQuery.data.item) {
    return (
      <div className="item-detail-page" style={commonStyles.narrowContainer}>
        <div role="alert" data-testid="not-found" style={{ textAlign: 'center', padding: '4rem 1rem', backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.5rem', color: '#0f172a' }}>Item not found</h1>
          <p style={{ color: '#64748b', marginBottom: '1.5rem' }}>The requested item could not be found.</p>
          <Link to="/items" style={commonStyles.buttonSecondary}>
            &larr; Back to items
          </Link>
        </div>
      </div>
    )
  }

  const { item } = itemQuery.data

  const effectiveUser =
    propUser ??
    (meData?.user
      ? { id: meData.user.id, displayName: meData.user.displayName, email: meData.user.email }
      : auth?.user
        ? { id: auth.user.id, displayName: auth.user.displayName, email: auth.user.email }
        : null)

  const membershipRole = meData?.memberships.find((m) => m.teamId === item.teamId)?.role
  const effectiveRole: Role =
    propRole ??
    membershipRole ??
    (auth?.user && 'role' in auth.user && typeof auth.user.role === 'string'
      ? (auth.user.role as Role)
      : 'viewer')

  const assigneeName = item.assignee?.displayName ?? 'Unassigned'
  const creatorName = item.creator?.displayName ?? `User #${item.createdBy}`
  const dueDate = item.dueAt ? new Date(item.dueAt).toLocaleDateString() : 'No due date'

  const isLead = effectiveRole === 'lead'
  const isMember = effectiveRole === 'member'
  const isMemberOrLead = isLead || isMember
  const isAssignee = effectiveUser ? item.assigneeId === effectiveUser.id : false
  const isCreator = effectiveUser ? item.createdBy === effectiveUser.id : false

  const canClaim = item.status === 'open' && item.assigneeId === null && isMemberOrLead
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

  const isActionPending = claimMutation.isPending || transitionMutation.isPending

  const handleClaim = async (): Promise<void> => {
    setActionError(null)
    try {
      await claimMutation.mutateAsync({
        id: item.id,
        actor: effectiveUser,
      })
    } catch (err) {
      setActionError(parseApiErrorMessage(err))
    }
  }

  const handleTransition = async (to: Status, reason?: string): Promise<void> => {
    setActionError(null)
    try {
      await transitionMutation.mutateAsync({
        id: item.id,
        to,
        ...(reason !== undefined ? { reason } : {}),
      })
    } catch (err) {
      setActionError(parseApiErrorMessage(err))
    }
  }

  return (
    <div className="item-detail-page" style={commonStyles.narrowContainer}>
      <nav style={{ marginBottom: '1.25rem' }}>
        <Link
          to="/items"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.4rem',
            color: '#64748b',
            textDecoration: 'none',
            fontSize: '0.875rem',
            fontWeight: 500,
          }}
        >
          &larr; Back to items
        </Link>
      </nav>

      {actionError && (
        <div
          role="alert"
          data-testid="action-error"
          style={{ ...commonStyles.alertError, marginBottom: '1.25rem' }}
        >
          {actionError}
        </div>
      )}

      <header
        style={{
          backgroundColor: '#ffffff',
          border: '1px solid #e2e8f0',
          borderRadius: '8px',
          padding: '1.75rem',
          boxShadow: '0 1px 3px 0 rgba(15, 23, 42, 0.04)',
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
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#64748b', fontSize: '0.8125rem', marginBottom: '0.35rem' }}>
              <span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 600, color: '#94a3b8' }}>#{item.id}</span>
              <span>•</span>
              <span style={{ textTransform: 'capitalize', fontWeight: 500 }}>{item.type.replace(/_/g, ' ')}</span>
            </div>
            <h1 data-testid="item-title" style={{ fontSize: '1.625rem', fontWeight: 800, color: '#0f172a', margin: '0.25rem 0', letterSpacing: '-0.02em', lineHeight: 1.25 }}>
              {item.title}
            </h1>
          </div>

          {/* Action buttons */}
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

            {canSubmitForApproval && (
              <button
                type="button"
                data-testid="submit-approval-button"
                disabled={isActionPending}
                onClick={() => void handleTransition('awaiting_approval')}
                style={{
                  ...commonStyles.buttonPrimary,
                  backgroundColor: '#7c3aed',
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
                  backgroundColor: '#059669',
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
                onClick={() => void handleTransition('open')}
                style={{
                  ...commonStyles.buttonSecondary,
                  color: '#2563eb',
                  borderColor: '#bfdbfe',
                  backgroundColor: '#eff6ff',
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
      </header>

      {isEditing ? (
        <section
          aria-label="Edit Item"
          style={{
            ...commonStyles.cardPadded,
            marginBottom: '2rem',
          }}
        >
          <h2 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '1.25rem', color: '#0f172a' }}>Edit Item</h2>
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
              border: '1px solid #e2e8f0',
              borderRadius: '8px',
              boxShadow: '0 1px 3px 0 rgba(15, 23, 42, 0.04)',
              marginBottom: '1.5rem',
            }}
          >
            <div>
              <span style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.35rem' }}>
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
              <span style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.35rem' }}>
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
              <span style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.35rem' }}>
                Assignee
              </span>
              <span data-testid="item-assignee" style={{ fontWeight: 600, color: item.assignee ? '#0f172a' : '#94a3b8', fontSize: '0.875rem' }}>
                {assigneeName}
              </span>
            </div>

            <div>
              <span style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.35rem' }}>
                Creator
              </span>
              <span data-testid="item-creator" style={{ fontWeight: 600, color: '#0f172a', fontSize: '0.875rem' }}>
                {creatorName}
              </span>
            </div>

            <div>
              <span style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.35rem' }}>
                Due Date
              </span>
              <span data-testid="item-due" style={{ fontWeight: 600, color: item.dueAt ? '#0f172a' : '#94a3b8', fontSize: '0.875rem' }}>
                {dueDate}
              </span>
            </div>
          </section>

          {/* Description */}
          <section aria-label="Description" style={{ marginBottom: '2rem' }}>
            <h2 style={{ fontSize: '1.125rem', fontWeight: 700, color: '#0f172a', marginBottom: '0.625rem' }}>
              Description
            </h2>
            <div
              data-testid="item-description"
              style={{
                padding: '1.25rem',
                border: '1px solid #e2e8f0',
                borderRadius: '8px',
                backgroundColor: '#ffffff',
                boxShadow: '0 1px 3px 0 rgba(15, 23, 42, 0.04)',
                whiteSpace: 'pre-wrap',
                color: item.description ? '#1e293b' : '#94a3b8',
                fontSize: '0.9375rem',
                lineHeight: 1.6,
              }}
            >
              {item.description || 'No description provided.'}
            </div>
          </section>
        </>
      )}

      {/* Activity Timeline */}
      <section aria-label="Activity History" style={{ marginTop: '2rem' }}>
        <h2 style={{ fontSize: '1.125rem', fontWeight: 700, color: '#0f172a', marginBottom: '0.875rem' }}>
          Activity & Audit Log
        </h2>
        <ActivityTimeline
          events={activityQuery.data?.events ?? []}
          isLoading={activityQuery.isLoading}
        />
      </section>
    </div>
  )
}
