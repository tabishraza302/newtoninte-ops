import { activityEvents } from '../db/schema'
import type { Tx } from '../db/tx'

export interface ActivityInput {
  workItemId: number
  actorId: number | null
  type: string
  fromValue?: string | null
  toValue?: string | null
  metadata?: unknown
}

export async function recordActivity(tx: Tx, e: ActivityInput): Promise<void> {
  await tx.insert(activityEvents).values({
    workItemId: e.workItemId,
    actorId: e.actorId,
    type: e.type,
    fromValue: e.fromValue ?? null,
    toValue: e.toValue ?? null,
    metadata: e.metadata !== undefined ? e.metadata : null,
  })
}

export const FIELD_EVENT = {
  title: 'title_changed',
  description: 'description_changed',
  type: 'type_changed',
  due_at: 'due_changed',
  priority: 'priority_changed',
} as const

export async function recordFieldChanges(
  tx: Tx,
  itemId: number,
  actorId: number,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Promise<void> {
  for (const [key, eventType] of Object.entries(FIELD_EVENT)) {
    const hasBefore = Object.prototype.hasOwnProperty.call(before, key)
    const hasAfter = Object.prototype.hasOwnProperty.call(after, key)

    if (!hasBefore && !hasAfter) {
      continue
    }

    const beforeVal = before[key]
    const afterVal = after[key]

    const fromStr =
      beforeVal === undefined || beforeVal === null
        ? null
        : beforeVal instanceof Date
          ? beforeVal.toISOString()
          : String(beforeVal)

    const toStr =
      afterVal === undefined || afterVal === null
        ? null
        : afterVal instanceof Date
          ? afterVal.toISOString()
          : String(afterVal)

    if (fromStr !== toStr) {
      await recordActivity(tx, {
        workItemId: itemId,
        actorId,
        type: eventType,
        fromValue: fromStr,
        toValue: toStr,
      })
    }
  }
}
