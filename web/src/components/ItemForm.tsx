import React, { useState } from 'react'
import { ApiError } from '../api/client'
import { useCreateItem, usePatchItem, useInfiniteTeamMembers } from '../api/hooks'
import { useOptionalAuth } from '../auth/AuthContext'
import {
  ITEM_TYPES,
  PRIORITIES,
  type CreateItemInput,
  type ItemType,
  type PatchItemInput,
  type Priority,
  type Role,
  type WorkItem,
} from '../api/types'
import { commonStyles, theme, getApiErrorMessage } from '../theme'
export interface ItemFormProps {
  item?: WorkItem
  teamId?: number
  userRole?: Role
  idempotencyKey?: string
  onSuccess?: (item: WorkItem) => void
  onCancel?: () => void
  onReload?: () => void
}

function generateIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `key-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function parseErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (typeof err.data === 'object' && err.data !== null && 'error' in err.data) {
      const dataObj = err.data as { error?: { message?: string } }
      if (dataObj.error?.message) {
        return dataObj.error.message
      }
    }
    return err.message
  }
  if (err instanceof Error) {
    return err.message
  }
  return 'An error occurred while saving the item'
}

function isVersionConflict(err: unknown): boolean {
  if (err instanceof ApiError) {
    if (err.status === 409) return true
    if (typeof err.data === 'object' && err.data !== null && 'error' in err.data) {
      const dataObj = err.data as { error?: { code?: string } }
      if (dataObj.error?.code === 'VERSION_CONFLICT') return true
    }
  }
  return false
}

export function ItemForm({
  item,
  teamId = 1,
  userRole,
  idempotencyKey: propKey,
  onSuccess,
  onCancel,
  onReload,
}: ItemFormProps): React.ReactElement {
  const isEditing = !!item
  const isMember = userRole === 'member'
  const auth = useOptionalAuth()
  const currentUser = auth?.user

  const [stableIdempotencyKey] = useState<string>(() => propKey ?? generateIdempotencyKey())

  const [title, setTitle] = useState(item?.title ?? '')
  const [description, setDescription] = useState(item?.description ?? '')
  const [type, setType] = useState<ItemType>(item?.type ?? 'task')
  const [priority, setPriority] = useState<Priority>(item?.priority ?? 'medium')
  const [dueDate, setDueDate] = useState(item?.dueAt ? item.dueAt.slice(0, 10) : '')
  const [selectedAssigneeId, setSelectedAssigneeId] = useState<number | null>(item?.assigneeId ?? null)

  const teamMembersQuery = useInfiniteTeamMembers(teamId, { limit: 20, enabled: !isEditing && !isMember })
  const teamMembers = teamMembersQuery.data?.pages.flatMap((page) => page.members) ?? []

  const [versionConflict, setVersionConflict] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const createMutation = useCreateItem()
  const patchMutation = usePatchItem()

  const isSubmitting = createMutation.isPending || patchMutation.isPending

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault()
    setErrorMessage(null)
    setVersionConflict(false)

    if (isEditing && item) {
      const patchData: PatchItemInput = {
        version: item.version,
      }

      if (title !== item.title) {
        patchData.title = title
      }
      const initialDesc = item.description ?? ''
      if (description !== initialDesc) {
        patchData.description = description || null
      }
      if (type !== item.type) {
        patchData.type = type
      }
      if (!isMember && priority !== item.priority) {
        patchData.priority = priority
      }
      const initialDue = item.dueAt ? item.dueAt.slice(0, 10) : ''
      if (dueDate !== initialDue) {
        patchData.dueAt = dueDate ? new Date(dueDate).toISOString() : null
      }

      try {
        const res = await patchMutation.mutateAsync({
          id: item.id,
          data: patchData,
        })
        onSuccess?.(res.item)
      } catch (err) {
        if (isVersionConflict(err)) {
          setVersionConflict(true)
        } else {
          setErrorMessage(parseErrorMessage(err))
        }
      }
    } else {
      const createData: CreateItemInput = {
        teamId,
        title,
        description: description || null,
        type,
        priority: isMember ? 'medium' : priority,
        dueAt: dueDate ? new Date(dueDate).toISOString() : null,
        assigneeId: selectedAssigneeId,
      }

      try {
        const res = await createMutation.mutateAsync({
          data: createData,
          idempotencyKey: stableIdempotencyKey,
        })
        onSuccess?.(res.item)
      } catch (err) {
        setErrorMessage(getApiErrorMessage(err, 'Failed to create work item.'))
      }
    }
  }

  return (
    <form
      data-testid="item-form"
      onSubmit={(e) => void handleSubmit(e)}
      style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', maxWidth: '640px' }}
    >
      {versionConflict && (
        <div
          role="alert"
          data-testid="version-conflict"
          style={{
            padding: '1rem 1.25rem',
            backgroundColor: '#fef2f2',
            border: '1px solid #fecaca',
            borderRadius: '8px',
            color: '#991b1b',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '1rem',
            fontSize: '0.875rem',
          }}
        >
          <span>This item has changed — reload to view the latest version.</span>
          <button
            type="button"
            data-testid="reload-button"
            onClick={() => onReload?.()}
            style={{
              padding: '0.4rem 0.8rem',
              backgroundColor: '#dc2626',
              color: '#ffffff',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: '0.8125rem',
              fontFamily: 'inherit',
            }}
          >
            Reload
          </button>
        </div>
      )}

      {errorMessage && !versionConflict && (
        <div
          role="alert"
          data-testid="form-error"
          style={commonStyles.alertError}
        >
          {errorMessage}
        </div>
      )}

      <div>
        <label
          htmlFor="item-title"
          style={commonStyles.label}
        >
          Title
        </label>
        <input
          id="item-title"
          name="title"
          type="text"
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Chase overdue customer invoice"
          style={commonStyles.input}
        />
      </div>

      <div>
        <label
          htmlFor="item-description"
          style={commonStyles.label}
        >
          Description
        </label>
        <textarea
          id="item-description"
          name="description"
          rows={4}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Add context, references, or reproduction steps..."
          style={{
            ...commonStyles.input,
            minHeight: '100px',
            resize: 'vertical',
          }}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem' }}>
        <div>
          <label
            htmlFor="item-type"
            style={commonStyles.label}
          >
            Type *
          </label>
          <select
            id="item-type"
            name="type"
            value={type}
            onChange={(e) => setType(e.target.value as ItemType)}
            style={commonStyles.select}
          >
            {ITEM_TYPES.map((t) => (
              <option key={t} value={t}>
                {t.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label
            htmlFor="item-priority"
            style={commonStyles.label}
          >
            Priority {isMember && <span style={{ fontWeight: 400, color: theme.colors.textMuted }}>(Lead only)</span>}
          </label>
          {isMember ? (
            <div>
              <input
                type="text"
                readOnly
                disabled
                value={isEditing ? item.priority : 'medium (default)'}
                style={{ ...commonStyles.input, backgroundColor: theme.colors.bgCardMuted, cursor: 'not-allowed' }}
              />
              <span style={{ fontSize: '0.75rem', color: theme.colors.textMuted, display: 'block', marginTop: '0.25rem' }}>
                Priority can only be modified by a team lead.
              </span>
            </div>
          ) : (
            <select
              id="item-priority"
              name="priority"
              value={priority}
              onChange={(e) => setPriority(e.target.value as Priority)}
              style={commonStyles.select}
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p.charAt(0).toUpperCase() + p.slice(1)}
                </option>
              ))}
            </select>
          )}
        </div>

        {!isEditing && (
          <div>
            <label htmlFor="item-assignee" style={commonStyles.label}>
              Assignee
            </label>
            {isMember ? (
              <select
                id="item-assignee"
                name="assigneeId"
                value={selectedAssigneeId ?? ''}
                onChange={(e) => setSelectedAssigneeId(e.target.value ? Number(e.target.value) : null)}
                style={commonStyles.select}
              >
                <option value="">Unassigned</option>
                {currentUser && (
                  <option value={currentUser.id}>Assign to myself ({currentUser.displayName})</option>
                )}
              </select>
            ) : (
              <select
                id="item-assignee"
                name="assigneeId"
                value={selectedAssigneeId ?? ''}
                onChange={(e) => setSelectedAssigneeId(e.target.value ? Number(e.target.value) : null)}
                style={commonStyles.select}
              >
                <option value="">Unassigned</option>
                {teamMembers.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.user.displayName} ({m.role})
                  </option>
                ))}
              </select>
            )}
            {!isMember && teamMembersQuery.hasNextPage && (
              <button
                type="button"
                onClick={() => void teamMembersQuery.fetchNextPage()}
                disabled={teamMembersQuery.isFetchingNextPage}
                style={{
                  ...commonStyles.buttonSecondary,
                  marginTop: '0.4rem',
                  padding: '0.25rem 0.5rem',
                  fontSize: '0.75rem',
                  width: '100%',
                }}
              >
                {teamMembersQuery.isFetchingNextPage ? 'Loading more members…' : 'Load more members'}
              </button>
            )}
            {!isMember && teamMembersQuery.isError && (
              <div style={{ marginTop: '0.4rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '0.75rem', color: '#dc2626' }}>Failed to load members.</span>
                <button
                  type="button"
                  onClick={() => void teamMembersQuery.refetch()}
                  style={{ ...commonStyles.buttonSecondary, padding: '0.2rem 0.4rem', fontSize: '0.75rem' }}
                >
                  Retry
                </button>
              </div>
            )}
          </div>
        )}
        <div>
          <label
            htmlFor="item-due-date"
            style={commonStyles.label}
          >
            Due Date
          </label>
          <input
            id="item-due-date"
            name="dueDate"
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            style={commonStyles.input}
          />
        </div>
      </div>

      <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
        <button
          type="submit"
          disabled={isSubmitting}
          style={{
            ...commonStyles.buttonPrimary,
            cursor: isSubmitting ? 'not-allowed' : 'pointer',
            opacity: isSubmitting ? 0.75 : 1,
          }}
        >
          {isSubmitting ? 'Saving...' : isEditing ? 'Save Changes' : 'Create Item'}
        </button>

        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={isSubmitting}
            style={commonStyles.buttonSecondary}
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  )
}
