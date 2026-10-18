import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { apiFetch } from './client'
import type {
  ActivityEvent,
  ListItemsQuery,
  Team,
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
