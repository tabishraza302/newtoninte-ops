import {
  useMutation,
  useQuery,
  useInfiniteQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
  type UseInfiniteQueryResult,
  type InfiniteData,
} from '@tanstack/react-query'
import { apiFetch } from './client'
import type {
  ActivityEvent,
  AddCommentInput,
  AddTeamMemberInput,
  AdminTeamMember,
  AssignItemInput,
  Comment,
  CreateAdminUserInput,
  CreateAdminUserResponse,
  CreateInvitationInput,
  CreateItemInput,
  CreateTeamInput,
  CreateTeamResponse,
  ForgotPasswordInput,
  JobView,
  JobsSummary,
  ListAdminTeamMembersResponse,
  ListAdminUsersQuery,
  ListAdminUsersResponse,
  ListInvitationsResponse,
  ListItemsQuery,
  ListJobsQuery,
  ListMembersResponse,
  MeResponse,
  PatchItemInput,
  PublicUser,
  RemoveMemberInput,
  ResetPasswordInput,
  SetMemberRoleInput,
  SetUserStatusInput,
  Status,
  Team,
  TeamInvitation,
  UserSummary,
  WorkItem,
} from './types'
export * from './types'

export interface ItemsResponse {
  items: WorkItem[]
  nextCursor: string | null
}

export interface ItemResponse {
  item: WorkItem
}

export interface ActivityResponse {
  events: ActivityEvent[]
  nextCursor: string | null
}

export interface TeamsResponse {
  teams: Team[]
}

export function buildItemsQueryString(query: ListItemsQuery = {}): string {
  const params = new URLSearchParams()
  if (query.team !== undefined) params.set('team', String(query.team))
  if (query.status) params.set('status', query.status)
  if (query.priority) params.set('priority', query.priority)
  if (query.assignee !== undefined) params.set('assignee', String(query.assignee))
  if (query.type) params.set('type', query.type)
  if (query.q) params.set('q', query.q)
  if (query.view) params.set('view', query.view)
  if (query.cursor) params.set('cursor', query.cursor)
  if (query.limit !== undefined) params.set('limit', String(query.limit))
  const qs = params.toString()
  return qs ? `/items?${qs}` : '/items'
}

export function useItems(
  query: ListItemsQuery = {},
): UseQueryResult<ItemsResponse, Error> {
  const path = buildItemsQueryString(query)
  return useQuery<ItemsResponse, Error>({
    queryKey: ['items', query],
    queryFn: () => apiFetch<ItemsResponse>(path),
  })
}

export function useItem(
  id: number,
): UseQueryResult<ItemResponse, Error> {
  return useQuery<ItemResponse, Error>({
    queryKey: ['item', id],
    queryFn: () => apiFetch<ItemResponse>(`/items/${id}`),
    enabled: Number.isInteger(id) && id > 0,
    retry: false,
  })
}

export function useItemActivity(
  id: number,
  cursor?: string,
): UseQueryResult<ActivityResponse, Error> {
  const qs = cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''
  return useQuery<ActivityResponse, Error>({
    queryKey: ['item-activity', id, cursor],
    queryFn: () => apiFetch<ActivityResponse>(`/items/${id}/activity${qs}`),
    enabled: Number.isInteger(id) && id > 0,
    retry: false,
  })
}

export function useTeams(
  opts?: { all?: boolean },
): UseQueryResult<TeamsResponse, Error> {
  const qs = opts?.all ? '?all=true' : ''
  return useQuery<TeamsResponse, Error>({
    queryKey: ['teams', opts?.all],
    queryFn: () => apiFetch<TeamsResponse>(`/teams${qs}`),
  })
}

export function useMe(): UseQueryResult<MeResponse, Error> {
  return useQuery<MeResponse, Error>({
    queryKey: ['auth-me'],
    queryFn: () => apiFetch<MeResponse>('/auth/me'),
    retry: false,
  })
}

export function useCreateItem(): UseMutationResult<
  ItemResponse,
  Error,
  { data: CreateItemInput; idempotencyKey?: string }
> {
  const queryClient = useQueryClient()
  return useMutation<ItemResponse, Error, { data: CreateItemInput; idempotencyKey?: string }>({
    mutationFn: async ({ data, idempotencyKey }) => {
      const headers: Record<string, string> = {}
      if (idempotencyKey) {
        headers['Idempotency-Key'] = idempotencyKey
      }
      return apiFetch<ItemResponse>('/items', {
        method: 'POST',
        headers,
        json: data,
      })
    },
    onSuccess: (res) => {
      queryClient.setQueryData(['item', res.item.id], res)
      void queryClient.invalidateQueries({ queryKey: ['items'] })
    },
  })
}

export function usePatchItem(): UseMutationResult<
  ItemResponse,
  Error,
  { id: number; data: PatchItemInput }
> {
  const queryClient = useQueryClient()
  return useMutation<ItemResponse, Error, { id: number; data: PatchItemInput }>({
    mutationFn: async ({ id, data }) => {
      return apiFetch<ItemResponse>(`/items/${id}`, {
        method: 'PATCH',
        json: data,
      })
    },
    onSuccess: (res) => {
      queryClient.setQueryData(['item', res.item.id], res)
      void queryClient.invalidateQueries({ queryKey: ['items'] })
      void queryClient.invalidateQueries({ queryKey: ['item-activity', res.item.id] })
    },
  })
}

export interface ClaimItemContext {
  previousItem?: ItemResponse | undefined
}

export function useClaimItem(): UseMutationResult<
  ItemResponse,
  Error,
  { id: number; actor?: UserSummary | null | undefined },
  ClaimItemContext
> {
  const queryClient = useQueryClient()
  return useMutation<ItemResponse, Error, { id: number; actor?: UserSummary | null | undefined }, ClaimItemContext>({
    mutationFn: async ({ id }) => {
      return apiFetch<ItemResponse>(`/items/${id}/claim`, {
        method: 'POST',
      })
    },
    onMutate: async ({ id, actor }) => {
      await queryClient.cancelQueries({ queryKey: ['item', id] })
      const previousItem = queryClient.getQueryData<ItemResponse>(['item', id])
      if (previousItem) {
        queryClient.setQueryData<ItemResponse>(['item', id], {
          ...previousItem,
          item: {
            ...previousItem.item,
            status: 'in_progress',
            assigneeId: actor?.id ?? previousItem.item.assigneeId,
            assignee: actor ?? previousItem.item.assignee ?? null,
          },
        })
      }
      return { previousItem }
    },
    onError: (_err, { id }, context) => {
      if (context?.previousItem) {
        queryClient.setQueryData(['item', id], context.previousItem)
      }
    },
    onSettled: (_data, _err, { id }) => {
      void queryClient.invalidateQueries({ queryKey: ['item', id] })
      void queryClient.invalidateQueries({ queryKey: ['item-activity', id] })
      void queryClient.invalidateQueries({ queryKey: ['items'] })
    },
  })
}

export function useAssignItem(): UseMutationResult<
  ItemResponse,
  Error,
  AssignItemInput
> {
  const queryClient = useQueryClient()
  return useMutation<ItemResponse, Error, AssignItemInput>({
    mutationFn: async ({ id, assigneeId, expectedVersion }) => {
      return apiFetch<ItemResponse>(`/items/${id}/assign`, {
        method: 'POST',
        json: { assigneeId, expectedVersion },
      })
    },
    onSettled: (_data, _err, { id }) => {
      void queryClient.invalidateQueries({ queryKey: ['item', id] })
      void queryClient.invalidateQueries({ queryKey: ['item-activity', id] })
      void queryClient.invalidateQueries({ queryKey: ['items'] })
    },
  })
}

export interface TransitionItemContext {
  previousItem?: ItemResponse | undefined
}

export function useTransitionItem(): UseMutationResult<
  ItemResponse,
  Error,
  { id: number; to: Status; reason?: string | undefined },
  TransitionItemContext
> {
  const queryClient = useQueryClient()
  return useMutation<ItemResponse, Error, { id: number; to: Status; reason?: string | undefined }, TransitionItemContext>({
    mutationFn: async ({ id, to, reason }) => {
      return apiFetch<ItemResponse>(`/items/${id}/transition`, {
        method: 'POST',
        json: { to, reason },
      })
    },
    onMutate: async ({ id, to }) => {
      await queryClient.cancelQueries({ queryKey: ['item', id] })
      const previousItem = queryClient.getQueryData<ItemResponse>(['item', id])
      if (previousItem) {
        queryClient.setQueryData<ItemResponse>(['item', id], {
          ...previousItem,
          item: {
            ...previousItem.item,
            status: to,
          },
        })
      }
      return { previousItem }
    },
    onError: (_err, { id }, context) => {
      if (context?.previousItem) {
        queryClient.setQueryData(['item', id], context.previousItem)
      }
    },
    onSettled: (_data, _err, { id }) => {
      void queryClient.invalidateQueries({ queryKey: ['item', id] })
      void queryClient.invalidateQueries({ queryKey: ['item-activity', id] })
      void queryClient.invalidateQueries({ queryKey: ['items'] })
    },
  })
}

// --- Ops: outbox jobs (§12.2, admin only) ---

export interface JobsResponse {
  jobs: JobView[]
  nextCursor: string | null
}

export function buildJobsQueryString(query: ListJobsQuery = {}): string {
  const params = new URLSearchParams()
  if (query.status) params.set('status', query.status)
  if (query.type) params.set('type', query.type)
  if (query.cursor) params.set('cursor', query.cursor)
  if (query.limit !== undefined) params.set('limit', String(query.limit))
  const qs = params.toString()
  return qs ? `/admin/jobs?${qs}` : '/admin/jobs'
}

export function useJobs(query: ListJobsQuery = {}): UseQueryResult<JobsResponse, Error> {
  const path = buildJobsQueryString(query)
  return useQuery<JobsResponse, Error>({
    queryKey: ['jobs', query],
    queryFn: () => apiFetch<JobsResponse>(path),
  })
}

export function useJobsSummary(): UseQueryResult<JobsSummary, Error> {
  return useQuery<JobsSummary, Error>({
    queryKey: ['jobs-summary'],
    queryFn: () => apiFetch<JobsSummary>('/admin/jobs/summary'),
  })
}

export function useRetryJob(): UseMutationResult<void, Error, { id: number }> {
  const queryClient = useQueryClient()
  return useMutation<void, Error, { id: number }>({
    mutationFn: ({ id }) => apiFetch<void>(`/admin/jobs/${id}/retry`, { method: 'POST' }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['jobs'] })
      void queryClient.invalidateQueries({ queryKey: ['jobs-summary'] })
    },
  })
}

// --- Ops: admin users (§7.1, §9) ---

export function buildAdminUsersQueryString(query: ListAdminUsersQuery = {}): string {
  const params = new URLSearchParams()
  if (query.q) params.set('q', query.q)
  if (query.cursor) params.set('cursor', query.cursor)
  if (query.limit !== undefined) params.set('limit', String(query.limit))
  const qs = params.toString()
  return qs ? `/admin/users?${qs}` : '/admin/users'
}

export function useAdminUsers(
  query: ListAdminUsersQuery = {},
  options?: { enabled?: boolean },
): UseQueryResult<ListAdminUsersResponse, Error> {
  const path = buildAdminUsersQueryString(query)
  return useQuery<ListAdminUsersResponse, Error>({
    queryKey: ['admin-users', query],
    queryFn: () => apiFetch<ListAdminUsersResponse>(path),
    enabled: options?.enabled ?? true,
  })
}

export function useCreateAdminUser(): UseMutationResult<
  CreateAdminUserResponse,
  Error,
  CreateAdminUserInput
> {
  const queryClient = useQueryClient()
  return useMutation<CreateAdminUserResponse, Error, CreateAdminUserInput>({
    mutationFn: (input) =>
      apiFetch<CreateAdminUserResponse>('/admin/users', {
        method: 'POST',
        json: input,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-users'] })
    },
  })
}

export function useSetUserStatus(): UseMutationResult<
  void,
  Error,
  SetUserStatusInput
> {
  const queryClient = useQueryClient()
  return useMutation<void, Error, SetUserStatusInput>({
    mutationFn: ({ id, status }) =>
      apiFetch<void>(`/admin/users/${id}`, {
        method: 'PATCH',
        json: { status },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-users'] })
    },
  })
}

// --- Admin Team Roster Inspection & Member Removal ---

export function useAdminTeamMembers(
  teamId: number,
  query?: { cursor?: string; limit?: number },
): UseQueryResult<ListAdminTeamMembersResponse, Error> {
  const params = new URLSearchParams()
  if (query?.cursor) params.set('cursor', query.cursor)
  if (query?.limit) params.set('limit', String(query.limit))
  const qs = params.toString() ? `?${params.toString()}` : ''

  return useQuery<ListAdminTeamMembersResponse, Error>({
    queryKey: ['admin', 'teams', teamId, 'members', query],
    queryFn: () => apiFetch<ListAdminTeamMembersResponse>(`/admin/teams/${teamId}/members${qs}`),
    enabled: teamId > 0,
  })
}

export function useAdminRemoveTeamMember(): UseMutationResult<
  void,
  Error,
  { teamId: number; userId: number }
> {
  const queryClient = useQueryClient()
  return useMutation<void, Error, { teamId: number; userId: number }>({
    mutationFn: ({ teamId, userId }) =>
      apiFetch<void>(`/admin/teams/${teamId}/members/${userId}`, {
        method: 'DELETE',
      }),
    onSuccess: (_data, vars) => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'teams', vars.teamId, 'members'] })
      void queryClient.invalidateQueries({ queryKey: ['teams', vars.teamId, 'members'] })
      void queryClient.invalidateQueries({ queryKey: ['teams'] })
    },
  })
}

// --- Teams & Team Members ---

export function useCreateTeam(): UseMutationResult<
  CreateTeamResponse,
  Error,
  CreateTeamInput
> {
  const queryClient = useQueryClient()
  return useMutation<CreateTeamResponse, Error, CreateTeamInput>({
    mutationFn: (input) =>
      apiFetch<CreateTeamResponse>('/teams', {
        method: 'POST',
        json: input,
      }),
    onSuccess: (data) => {
      queryClient.setQueryData<TeamsResponse>(['teams', true], (old) => {
        if (!old) return { teams: [data.team] }
        if (old.teams.some((t) => t.id === data.team.id)) return old
        return { ...old, teams: [...old.teams, data.team] }
      })
      queryClient.setQueryData<TeamsResponse>(['teams', undefined], (old) => {
        if (!old) return { teams: [data.team] }
        if (old.teams.some((t) => t.id === data.team.id)) return old
        return { ...old, teams: [...old.teams, data.team] }
      })
      void queryClient.invalidateQueries({ queryKey: ['teams'] })
    },
  })
}

export function useAddTeamMember(): UseMutationResult<
  { status: string },
  Error,
  AddTeamMemberInput
> {
  const queryClient = useQueryClient()
  return useMutation<{ status: string }, Error, AddTeamMemberInput>({
    mutationFn: ({ teamId, userId, role }) =>
      apiFetch<{ status: string }>(`/teams/${teamId}/members`, {
        method: 'POST',
        json: { userId, role },
      }),
    onSuccess: (_data, vars) => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'teams', vars.teamId, 'members'] })
      void queryClient.invalidateQueries({ queryKey: ['teams', vars.teamId, 'members'] })
      void queryClient.invalidateQueries({ queryKey: ['teams'] })
      void queryClient.invalidateQueries({ queryKey: ['admin-users'] })
    },
  })
}

// --- Team Scoped Members & Invitations (§7.4, §10) ---

export function useTeamMembers(
  teamId: number,
  query?: { cursor?: string; limit?: number },
  options?: { enabled?: boolean },
): UseQueryResult<ListMembersResponse, Error> {
  const params = new URLSearchParams()
  if (query?.cursor) params.set('cursor', query.cursor)
  if (query?.limit) params.set('limit', String(query.limit))
  const qs = params.toString() ? `?${params.toString()}` : ''

  return useQuery<ListMembersResponse, Error>({
    queryKey: ['teams', teamId, 'members', query],
    queryFn: () => apiFetch<ListMembersResponse>(`/teams/${teamId}/members${qs}`),
    enabled: options?.enabled !== undefined ? options.enabled : teamId > 0,
  })
}

export function useInfiniteTeamMembers(
  teamId: number,
  opts?: { limit?: number; enabled?: boolean },
): UseInfiniteQueryResult<InfiniteData<ListMembersResponse, string | undefined>, Error> {
  const limit = opts?.limit ?? 20
  return useInfiniteQuery({
    queryKey: ['teams', teamId, 'members', 'infinite', limit],
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams()
      if (pageParam) params.set('cursor', pageParam)
      params.set('limit', String(limit))
      return apiFetch<ListMembersResponse>(`/teams/${teamId}/members?${params.toString()}`)
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: opts?.enabled !== undefined ? opts.enabled : teamId > 0,
  })
}

export function useSetMemberRole(): UseMutationResult<
  { status: string },
  Error,
  SetMemberRoleInput
> {
  const queryClient = useQueryClient()
  return useMutation<{ status: string }, Error, SetMemberRoleInput>({
    mutationFn: ({ teamId, userId, role }) =>
      apiFetch<{ status: string }>(`/teams/${teamId}/members/${userId}`, {
        method: 'PATCH',
        json: { role },
      }),
    onSuccess: (_data, vars) => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'teams', vars.teamId, 'members'] })
      void queryClient.invalidateQueries({ queryKey: ['auth-me'] })
      void queryClient.invalidateQueries({ queryKey: ['teams'] })
      void queryClient.invalidateQueries({ queryKey: ['teams', vars.teamId, 'members'] })
    },
  })
}

export function useRemoveMember(): UseMutationResult<
  void,
  Error,
  RemoveMemberInput
> {
  const queryClient = useQueryClient()
  return useMutation<void, Error, RemoveMemberInput>({
    mutationFn: ({ teamId, userId }) =>
      apiFetch<void>(`/teams/${teamId}/members/${userId}`, {
        method: 'DELETE',
      }),
    onSuccess: (_data, vars) => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'teams', vars.teamId, 'members'] })
      void queryClient.invalidateQueries({ queryKey: ['auth-me'] })
      void queryClient.invalidateQueries({ queryKey: ['teams'] })
      void queryClient.invalidateQueries({ queryKey: ['teams', vars.teamId, 'members'] })
    },
  })
}

export function useTeamInvitations(
  teamId: number,
  query?: { cursor?: string; limit?: number },
  options?: { enabled?: boolean },
): UseQueryResult<ListInvitationsResponse, Error> {
  const params = new URLSearchParams()
  if (query?.cursor) params.set('cursor', query.cursor)
  if (query?.limit) params.set('limit', String(query.limit))
  const qs = params.toString() ? `?${params.toString()}` : ''

  return useQuery<ListInvitationsResponse, Error>({
    queryKey: ['teams', teamId, 'invitations', query],
    queryFn: () => apiFetch<ListInvitationsResponse>(`/teams/${teamId}/invitations${qs}`),
    enabled: options?.enabled !== undefined ? options.enabled : teamId > 0,
  })
}

export function useCreateInvitation(): UseMutationResult<
  { invitation: TeamInvitation },
  Error,
  CreateInvitationInput
> {
  const queryClient = useQueryClient()
  return useMutation<
    { invitation: TeamInvitation },
    Error,
    CreateInvitationInput
  >({
    mutationFn: ({ teamId, email, role, maxUses }) =>
      apiFetch<{ invitation: TeamInvitation }>(`/teams/${teamId}/invitations`, {
        method: 'POST',
        json: { email, role, ...(maxUses !== undefined ? { maxUses } : {}) },
      }),
    onSuccess: (_data, vars) => {
      void queryClient.invalidateQueries({ queryKey: ['teams', vars.teamId, 'invitations'] })
    },
  })
}

export function useRevokeInvitation(): UseMutationResult<
  void,
  Error,
  number
> {
  const queryClient = useQueryClient()
  return useMutation<void, Error, number>({
    mutationFn: (invitationId: number) =>
      apiFetch<void>(`/invitations/${invitationId}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['teams'] })
    },
  })
}

// --- Comments (§9, §10) ---

export function useAddComment(): UseMutationResult<
  { comment: Comment },
  Error,
  AddCommentInput
> {
  const queryClient = useQueryClient()
  return useMutation<{ comment: Comment }, Error, AddCommentInput>({
    mutationFn: ({ itemId, body }) =>
      apiFetch<{ comment: Comment }>(`/items/${itemId}/comments`, {
        method: 'POST',
        json: { body },
      }),
    onSuccess: (_data, vars) => {
      void queryClient.invalidateQueries({ queryKey: ['items', vars.itemId, 'activity'] })
    },
  })
}

// --- Password Reset Flow (§11.2) ---

export function useForgotPassword(): UseMutationResult<
  { status: string },
  Error,
  ForgotPasswordInput
> {
  return useMutation<{ status: string }, Error, ForgotPasswordInput>({
    mutationFn: ({ email }) =>
      apiFetch<{ status: string }>('/auth/password/forgot', {
        method: 'POST',
        json: { email },
      }),
  })
}

export function useResetPassword(): UseMutationResult<
  { status: string },
  Error,
  ResetPasswordInput
> {
  return useMutation<{ status: string }, Error, ResetPasswordInput>({
    mutationFn: ({ token, password }) =>
      apiFetch<{ status: string }>('/auth/password/reset', {
        method: 'POST',
        json: { token, password },
      }),
  })
}
