import React, { useState } from 'react'
import { ApiError } from '../api/client'
import { useCreateItem, usePatchItem } from '../api/hooks'
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

  const [stableIdempotencyKey] = useState<string>(() => propKey ?? generateIdempotencyKey())

  const [title, setTitle] = useState(item?.title ?? '')
  const [description, setDescription] = useState(item?.description ?? '')
  const [type, setType] = useState<ItemType>(item?.type ?? 'task')
  const [priority, setPriority] = useState<Priority>(item?.priority ?? 'medium')
  const [dueDate, setDueDate] = useState(item?.dueAt ? item.dueAt.slice(0, 10) : '')

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
        dueAt: dueDate ? new Date(dueDate).toISOString() : null,
      }

      if (!isMember) {
        createData.priority = priority
      }

      try {
        const res = await createMutation.mutateAsync({
          data: createData,
          idempotencyKey: stableIdempotencyKey,
        })
        onSuccess?.(res.item)
      } catch (err) {
        setErrorMessage(parseErrorMessage(err))
      }
    }
  }

  return (
    <form
      data-testid="item-form"
      onSubmit={(e) => void handleSubmit(e)}
      style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', maxWidth: '600px' }}
    >
      {versionConflict && (
        <div
          role="alert"
          data-testid="version-conflict"
          style={{
            padding: '1rem',
            backgroundColor: '#fef2f2',
            border: '1px solid #f87171',
            borderRadius: '6px',
            color: '#991b1b',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '1rem',
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
              borderRadius: '4px',
              cursor: 'pointer',
              fontWeight: 600,
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
          style={{
            padding: '0.75rem 1rem',
            backgroundColor: '#fef2f2',
            border: '1px solid #f87171',
            borderRadius: '6px',
            color: '#991b1b',
          }}
        >
          {errorMessage}
        </div>
      )}

      <div>
        <label
          htmlFor="item-title"
          style={{ display: 'block', fontWeight: 600, marginBottom: '0.35rem', fontSize: '0.875rem' }}
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
          placeholder="Enter item title"
          style={{
            width: '100%',
            padding: '0.5rem 0.75rem',
            border: '1px solid #cbd5e1',
            borderRadius: '6px',
            fontSize: '1rem',
            boxSizing: 'border-box',
          }}
        />
      </div>

      <div>
        <label
          htmlFor="item-description"
          style={{ display: 'block', fontWeight: 600, marginBottom: '0.35rem', fontSize: '0.875rem' }}
        >
          Description
        </label>
        <textarea
          id="item-description"
          name="description"
          rows={4}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Enter item description"
          style={{
            width: '100%',
            padding: '0.5rem 0.75rem',
            border: '1px solid #cbd5e1',
            borderRadius: '6px',
            fontSize: '1rem',
            boxSizing: 'border-box',
            fontFamily: 'inherit',
          }}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: isMember ? '1fr 1fr' : '1fr 1fr 1fr', gap: '1rem' }}>
        <div>
          <label
            htmlFor="item-type"
            style={{ display: 'block', fontWeight: 600, marginBottom: '0.35rem', fontSize: '0.875rem' }}
          >
            Type
          </label>
          <select
            id="item-type"
            name="type"
            value={type}
            onChange={(e) => setType(e.target.value as ItemType)}
            style={{
              width: '100%',
              padding: '0.5rem 0.75rem',
              border: '1px solid #cbd5e1',
              borderRadius: '6px',
              fontSize: '1rem',
              backgroundColor: '#ffffff',
            }}
          >
            {ITEM_TYPES.map((t) => (
              <option key={t} value={t}>
                {t.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        </div>

        {!isMember && (
          <div>
            <label
              htmlFor="item-priority"
              style={{ display: 'block', fontWeight: 600, marginBottom: '0.35rem', fontSize: '0.875rem' }}
            >
              Priority
            </label>
            <select
              id="item-priority"
              name="priority"
              value={priority}
              onChange={(e) => setPriority(e.target.value as Priority)}
              style={{
                width: '100%',
                padding: '0.5rem 0.75rem',
                border: '1px solid #cbd5e1',
                borderRadius: '6px',
                fontSize: '1rem',
                backgroundColor: '#ffffff',
              }}
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label
            htmlFor="item-due-date"
            style={{ display: 'block', fontWeight: 600, marginBottom: '0.35rem', fontSize: '0.875rem' }}
          >
            Due Date
          </label>
          <input
            id="item-due-date"
            name="dueDate"
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            style={{
              width: '100%',
              padding: '0.5rem 0.75rem',
              border: '1px solid #cbd5e1',
              borderRadius: '6px',
              fontSize: '1rem',
              boxSizing: 'border-box',
            }}
          />
        </div>
      </div>

      <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
        <button
          type="submit"
          disabled={isSubmitting}
          style={{
            padding: '0.6rem 1.25rem',
            backgroundColor: '#2563eb',
            color: '#ffffff',
            border: 'none',
            borderRadius: '6px',
            fontSize: '1rem',
            fontWeight: 600,
            cursor: isSubmitting ? 'not-allowed' : 'pointer',
          }}
        >
          {isSubmitting ? 'Saving...' : isEditing ? 'Save Changes' : 'Create Item'}
        </button>

        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={isSubmitting}
            style={{
              padding: '0.6rem 1.25rem',
              backgroundColor: '#f1f5f9',
              color: '#334155',
              border: '1px solid #cbd5e1',
              borderRadius: '6px',
              fontSize: '1rem',
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  )
}
