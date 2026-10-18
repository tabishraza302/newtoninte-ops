import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query'
import { apiFetch } from './client'
import type {
  ActivityEvent,
  CreateItemInput,
  ListItemsQuery,
  MeResponse,
  PatchItemInput,
  Status,
  Team,
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
