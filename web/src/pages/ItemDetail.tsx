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
  const { id: idParam } = useParams<{ id: string }>()
  const itemId = idParam ? parseInt(idParam, 10) : NaN
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
      <div className="item-detail-page" style={{ padding: '1.5rem', maxWidth: '900px', margin: '0 auto' }}>
        <div role="alert" data-testid="not-found" style={{ textAlign: 'center', padding: '3rem 1rem' }}>
          <h1 style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>Item not found</h1>
          <p style={{ color: '#64748b' }}>The requested item does not exist.</p>
          <Link to="/items" style={{ color: '#2563eb' }}>
            Back to items
          </Link>
        </div>
      </div>
    )
  }

  if (itemQuery.isLoading) {
    return (
      <div className="item-detail-page" style={{ padding: '1.5rem', maxWidth: '900px', margin: '0 auto' }}>
        <div role="status">Loading item...</div>
      </div>
    )
  }

  if (itemQuery.isError) {
    const error = itemQuery.error
    const isNotFound = error instanceof ApiError ? error.status === 404 : false

    if (isNotFound) {
      return (
        <div className="item-detail-page" style={{ padding: '1.5rem', maxWidth: '900px', margin: '0 auto' }}>
          <div role="alert" data-testid="not-found" style={{ textAlign: 'center', padding: '3rem 1rem' }}>
            <h1 style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>Item not found</h1>
            <p style={{ color: '#64748b' }}>
              The requested item could not be found or you do not have permission to view it.
            </p>
            <Link to="/items" style={{ color: '#2563eb' }}>
              Back to items
            </Link>
          </div>
        </div>
      )
    }

    return (
      <div className="item-detail-page" style={{ padding: '1.5rem', maxWidth: '900px', margin: '0 auto' }}>
        <div role="alert" style={{ color: '#dc2626', padding: '1rem' }}>
          Error loading item: {error.message}
        </div>
      </div>
    )
  }

  if (!itemQuery.data || !itemQuery.data.item) {
    return (
      <div className="item-detail-page" style={{ padding: '1.5rem', maxWidth: '900px', margin: '0 auto' }}>
        <div role="alert" data-testid="not-found" style={{ textAlign: 'center', padding: '3rem 1rem' }}>
          <h1 style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>Item not found</h1>
          <p style={{ color: '#64748b' }}>The requested item could not be found.</p>
          <Link to="/items" style={{ color: '#2563eb' }}>
            Back to items
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

  // Action permissions according to spec §6 and policy rules:
  // - Open & unassigned -> Claim button (member/lead)
  // - In progress & assigned -> Submit for Approval button (assignee/lead)
  // - Awaiting approval -> Approve and Send Back buttons (lead only)
  // - Resolved -> Close and Reopen buttons (lead only)
  // - Open/in_progress/awaiting -> Cancel button (creator/lead)
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
    <div className="item-detail-page" style={{ padding: '1.5rem', maxWidth: '900px', margin: '0 auto' }}>
      <nav style={{ marginBottom: '1rem' }}>
        <Link to="/items" style={{ color: '#2563eb', textDecoration: 'none' }}>
          &larr; Back to items
        </Link>
      </nav>

      {actionError && (
        <div
          role="alert"
          data-testid="action-error"
          style={{
            padding: '0.75rem 1rem',
            backgroundColor: '#fef2f2',
            border: '1px solid #f87171',
            borderRadius: '6px',
            color: '#991b1b',
            marginBottom: '1rem',
          }}
        >
          {actionError}
        </div>
      )}

      <header style={{ marginBottom: '1.5rem' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '1rem',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#64748b', fontSize: '0.875rem' }}>
              <span>#{item.id}</span>
              <span>·</span>
              <span style={{ textTransform: 'capitalize' }}>{item.type.replace(/_/g, ' ')}</span>
            </div>
            <h1 data-testid="item-title" style={{ fontSize: '1.75rem', fontWeight: 700, margin: '0.5rem 0' }}>
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
                style={{
                  padding: '0.5rem 1rem',
                  backgroundColor: '#f1f5f9',
                  border: '1px solid #cbd5e1',
                  borderRadius: '6px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
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
                  padding: '0.5rem 1rem',
                  backgroundColor: '#2563eb',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '6px',
                  fontWeight: 600,
                  cursor: isActionPending ? 'not-allowed' : 'pointer',
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
                  padding: '0.5rem 1rem',
                  backgroundColor: '#0284c7',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '6px',
                  fontWeight: 600,
                  cursor: isActionPending ? 'not-allowed' : 'pointer',
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
                  padding: '0.5rem 1rem',
                  backgroundColor: '#16a34a',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '6px',
                  fontWeight: 600,
                  cursor: isActionPending ? 'not-allowed' : 'pointer',
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
                  padding: '0.5rem 1rem',
                  backgroundColor: '#ea580c',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '6px',
                  fontWeight: 600,
                  cursor: isActionPending ? 'not-allowed' : 'pointer',
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
                  padding: '0.5rem 1rem',
                  backgroundColor: '#475569',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '6px',
                  fontWeight: 600,
                  cursor: isActionPending ? 'not-allowed' : 'pointer',
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
                  padding: '0.5rem 1rem',
                  backgroundColor: '#2563eb',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '6px',
                  fontWeight: 600,
                  cursor: isActionPending ? 'not-allowed' : 'pointer',
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
                  padding: '0.5rem 1rem',
                  backgroundColor: '#dc2626',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '6px',
                  fontWeight: 600,
                  cursor: isActionPending ? 'not-allowed' : 'pointer',
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
            marginBottom: '2rem',
            padding: '1.5rem',
            border: '1px solid #e2e8f0',
            borderRadius: '8px',
            backgroundColor: '#ffffff',
          }}
        >
          <h2 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '1rem' }}>Edit Item</h2>
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
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              gap: '1rem',
              padding: '1rem',
              backgroundColor: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: '8px',
              marginBottom: '1.5rem',
            }}
          >
            <div>
              <span style={{ display: 'block', fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase' }}>
                Status
              </span>
              <span
                data-testid="item-status"
                style={{ fontWeight: 600, textTransform: 'capitalize', color: '#1e293b' }}
              >
                {item.status.replace(/_/g, ' ')}
              </span>
            </div>

            <div>
              <span style={{ display: 'block', fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase' }}>
                Priority
              </span>
              <span
                data-testid="item-priority"
                style={{ fontWeight: 600, textTransform: 'capitalize', color: '#92400e' }}
              >
                {item.priority}
              </span>
            </div>

            <div>
              <span style={{ display: 'block', fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase' }}>
                Assignee
              </span>
              <span data-testid="item-assignee" style={{ fontWeight: 600, color: '#1e293b' }}>
                {assigneeName}
              </span>
            </div>

            <div>
              <span style={{ display: 'block', fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase' }}>
                Creator
              </span>
              <span data-testid="item-creator" style={{ fontWeight: 600, color: '#1e293b' }}>
                {creatorName}
              </span>
            </div>

            <div>
              <span style={{ display: 'block', fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase' }}>
                Due Date
              </span>
              <span data-testid="item-due" style={{ fontWeight: 600, color: '#1e293b' }}>
                {dueDate}
              </span>
            </div>
          </section>

          {/* Description */}
          <section aria-label="Description" style={{ marginBottom: '2rem' }}>
            <h2 style={{ fontSize: '1.2rem', fontWeight: 600, marginBottom: '0.5rem' }}>Description</h2>
            <div
              data-testid="item-description"
              style={{
                padding: '1rem',
                border: '1px solid #e2e8f0',
                borderRadius: '8px',
                backgroundColor: '#ffffff',
                whiteSpace: 'pre-wrap',
                color: item.description ? '#1e293b' : '#64748b',
              }}
            >
              {item.description || 'No description provided.'}
            </div>
          </section>
        </>
      )}

      {/* Activity Timeline */}
      <section aria-label="Activity History">
        <h2 style={{ fontSize: '1.2rem', fontWeight: 600, marginBottom: '1rem' }}>Activity</h2>
        <ActivityTimeline
          events={activityQuery.data?.events ?? []}
          isLoading={activityQuery.isLoading}
        />
      </section>
    </div>
  )
}
