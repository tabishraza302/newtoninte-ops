import type { ActivityEventRow } from '../../src/services/items'
import type { ItemType, Priority, Status } from '../../src/domain/types'

export interface ReconstructedItemState {
  status: Status
  assigneeId: number | null
  priority: Priority
  title: string
  type: ItemType
  dueAt: string | null
  description: string | null
}

/**
 * Reconstructs the state of a work item by starting from its creation metadata
 * and replaying all activity events in chronological order.
 */
export function replay(
  createdMetadata: Record<string, unknown>,
  events: ActivityEventRow[],
): ReconstructedItemState {
  const state: ReconstructedItemState = {
    status: (createdMetadata.status ?? 'open') as Status,
    assigneeId:
      createdMetadata.assigneeId !== undefined && createdMetadata.assigneeId !== null
        ? Number(createdMetadata.assigneeId)
        : null,
    priority: (createdMetadata.priority ?? 'medium') as Priority,
    title: String(createdMetadata.title ?? ''),
    type: (createdMetadata.type ?? 'task') as ItemType,
    dueAt:
      createdMetadata.dueAt !== undefined && createdMetadata.dueAt !== null
        ? String(createdMetadata.dueAt)
        : null,
    description:
      createdMetadata.description !== undefined && createdMetadata.description !== null
        ? String(createdMetadata.description)
        : null,
  }

  const sortedEvents = [...events].sort((a, b) => {
    const timeA = a.createdAt instanceof Date ? a.createdAt.getTime() : new Date(a.createdAt).getTime()
    const timeB = b.createdAt instanceof Date ? b.createdAt.getTime() : new Date(b.createdAt).getTime()
    if (timeA !== timeB) {
      return timeA - timeB
    }
    return a.id - b.id
  })

  for (const event of sortedEvents) {
    switch (event.type) {
      case 'status_changed':
        if (event.toValue !== null && event.toValue !== undefined) {
          state.status = event.toValue as Status
        }
        break
      case 'assignee_changed':
        state.assigneeId =
          event.toValue !== null && event.toValue !== undefined && event.toValue !== ''
            ? Number(event.toValue)
            : null
        break
      case 'priority_changed':
        if (event.toValue !== null && event.toValue !== undefined) {
          state.priority = event.toValue as Priority
        }
        break
      case 'type_changed':
        if (event.toValue !== null && event.toValue !== undefined) {
          state.type = event.toValue as ItemType
        }
        break
      case 'title_changed':
        if (event.toValue !== null && event.toValue !== undefined) {
          state.title = event.toValue
        }
        break
      case 'description_changed':
        state.description = event.toValue ?? null
        break
      case 'due_changed':
        state.dueAt = event.toValue ?? null
        break
      case 'comment_added':
      case 'created':
      default:
        // Ignore comments and non-field-mutation events
        break
    }
  }

  return state
}
