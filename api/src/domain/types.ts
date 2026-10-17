// Domain enums shared across the API. Single source of truth — the Drizzle
// schema and every downstream task import these rather than re-declaring them.

export const ROLES = ['viewer', 'member', 'lead'] as const
export type Role = (typeof ROLES)[number]

export const STATUSES = [
  'open',
  'in_progress',
  'awaiting_approval',
  'resolved',
  'closed',
  'cancelled',
] as const
export type Status = (typeof STATUSES)[number]

export const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const
export type Priority = (typeof PRIORITIES)[number]

export const ITEM_TYPES = [
  'incident',
  'customer_issue',
  'payment',
  'compliance',
  'task',
] as const
export type ItemType = (typeof ITEM_TYPES)[number]

export const OUTBOX_TYPES = ['email.reset', 'email.invite', 'email.assigned'] as const
export type OutboxJobType = (typeof OUTBOX_TYPES)[number]

/** The authenticated principal an action is attributed to. */
export interface Actor {
  id: number
  isAdmin: boolean
}
