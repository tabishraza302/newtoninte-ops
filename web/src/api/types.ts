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

export const VIEW_NAMES = [
  'assigned_to_me',
  'unassigned_urgent',
  'awaiting_my_approval',
  'overdue',
] as const
export type ViewName = (typeof VIEW_NAMES)[number]

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

export interface UserSummary {
  id: number
  displayName: string
  email: string
}

export interface WorkItem {
  id: number
  teamId: number
  title: string
  description: string | null
  type: ItemType
  priority: Priority
  status: Status
  assigneeId: number | null
  createdBy: number
  dueAt: string | null
  version: number
  createdAt: string
  updatedAt: string
  creator?: UserSummary
  assignee?: UserSummary | null
}

export interface ActivityEvent {
  id: number
  workItemId: number
  actorId: number | null
  type: ActivityType | string
  fromValue?: string | null
  toValue?: string | null
  metadata?: { body?: string; [key: string]: unknown } | null
  createdAt: string
  actor?: UserSummary | null
}

export interface Team {
  id: number
  name: string
  slug: string
  createdAt?: string
  updatedAt?: string
}

export interface ListItemsQuery {
  team?: number
  status?: Status
  priority?: Priority
  assignee?: number
  type?: ItemType
  q?: string
  view?: ViewName
  cursor?: string
  limit?: number
}

export interface CreateItemInput {
  teamId: number
  title: string
  description?: string | null
  type: ItemType
  priority?: Priority
  dueAt?: string | null
  assigneeId?: number | null
}

export interface PatchItemInput {
  version: number
  title?: string
  description?: string | null
  type?: ItemType
  priority?: Priority
  dueAt?: string | null
}

export interface TransitionItemInput {
  to: Status
  reason?: string
}

export interface MeResponse {
  user: UserSummary
  memberships: Array<{ teamId: number; role: Role }>
}
