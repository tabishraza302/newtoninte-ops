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

export const ADMIN_AUDIT_ACTIONS = [
  'user_created',
  'user_status_changed',
  'team_created',
  'membership_added',
  'membership_role_changed',
  'membership_removed',
  'job_retried',
] as const
export type AdminAuditAction = (typeof ADMIN_AUDIT_ACTIONS)[number]
export interface AdminAuditActor {
  id: number
  email: string
  displayName: string
}

export interface AdminAuditEvent {
  id: number
  actor: AdminAuditActor
  action: AdminAuditAction
  targetType: 'user' | 'team' | 'membership' | 'job'
  targetId: number
  metadata: Record<string, unknown>
  createdAt: Date
}

export const ACTIVITY_TYPES = [
  'created',
  'status_changed',
  'assignee_changed',
  'priority_changed',
  'type_changed',
  'comment_added',
  'due_changed',
  'title_changed',
  'description_changed',
] as const
export type ActivityType = (typeof ACTIVITY_TYPES)[number]


export const NOTIFICATION_TYPES = [
  'assigned',
  'comment_added',
  'approval_requested',
  'workflow_decision',
] as const
export type NotificationType = (typeof NOTIFICATION_TYPES)[number]
/** The authenticated principal an action is attributed to. */
export interface Actor {
  id: number
  isAdmin: boolean
}
