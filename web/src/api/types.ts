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

export interface PublicUser {
  id: number
  email: string
  displayName: string
  isAdmin: boolean
  status: 'active' | 'disabled'
  createdAt: string
  updatedAt: string
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
  priority: Priority
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

export interface AssignItemInput {
  id: number
  assigneeId: number | null
  expectedVersion: number
}

export interface MeResponse {
  user: PublicUser
  memberships: Array<{ teamId: number; role: Role }>
}

export const JOB_TYPES = ['email.invite', 'email.reset', 'email.assigned'] as const
export type JobType = (typeof JOB_TYPES)[number]

export const JOB_STATUSES = ['pending', 'processing', 'done', 'failed'] as const
export type JobStatus = (typeof JOB_STATUSES)[number]

export interface JobView {
  id: number
  type: JobType
  status: JobStatus
  attempts: number
  maxAttempts: number
  lastError: string | null
  dedupeKey: string
  availableAt: string
  lockedAt: string | null
  lockedBy: string | null
  createdAt: string
  updatedAt: string
}

export interface ListJobsQuery {
  status?: JobStatus
  type?: JobType
  cursor?: string
  limit?: number
}

export interface JobStatusCounts {
  pending: number
  processing: number
  done: number
  failed: number
}

export interface JobsSummary {
  byStatus: JobStatusCounts
  oldestPendingAgeSec: number | null
}

// --- Admin User Provisioning & Management ---
export interface ListAdminUsersQuery {
  q?: string | undefined
  cursor?: string | undefined
  limit?: number | undefined
}

export interface ListAdminUsersResponse {
  users: PublicUser[]
  nextCursor: string | null
  userCreationEnabled: boolean
}

export interface CreateAdminUserInput {
  email: string
  displayName: string
  password: string
  teamId?: number | undefined
  role?: Role | undefined
}

export interface CreateAdminUserResponse {
  user: PublicUser
}

export interface SetUserStatusInput {
  id: number
  status: 'active' | 'disabled'
}

// --- Team Management & Direct Membership ---

export interface CreateTeamInput {
  name: string
  slug: string
}

export interface CreateTeamResponse {
  team: Team
}

export interface AddTeamMemberInput {
  teamId: number
  userId: number
  role: Role
}

// --- Team Scoped Members & Invitations (§7.4, §10) ---

export interface TeamMember {
  id: number
  userId: number
  teamId: number
  role: Role
  createdAt: string
  updatedAt: string
  user: UserSummary
}

export interface ListMembersResponse {
  members: TeamMember[]
  nextCursor: string | null
}

export interface SetMemberRoleInput {
  teamId: number
  userId: number
  role: Role
}

export interface RemoveMemberInput {
  teamId: number
  userId: number
}

export interface TeamInvitation {
  id: number
  teamId: number
  email: string
  role: Role
  uses: number
  maxUses: number
  expiresAt: string | null
  revokedAt: string | null
  createdAt: string
}

export interface ListInvitationsResponse {
  invitations: TeamInvitation[]
  nextCursor: string | null
}

export interface CreateInvitationInput {
  teamId: number
  email: string
  role: Role
  maxUses?: number
}

export interface AdminTeamMember {
  id: number
  userId: number
  teamId: number
  role: Role
  createdAt: string
  user: {
    id: number
    email: string
    displayName: string
  }
}

export interface ListAdminTeamMembersResponse {
  members: AdminTeamMember[]
  nextCursor: string | null
}

// --- Comments (§9, §10) ---

export interface Comment {
  id: number
  workItemId: number
  authorId: number
  body: string
  createdAt: string
  updatedAt: string
}

export interface AddCommentInput {
  itemId: number
  body: string
}

// --- Password Reset Flow (§11.2) ---

export interface ForgotPasswordInput {
  email: string
}

export interface ResetPasswordInput {
  token: string
  password: string
}
