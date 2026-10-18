import { apiFetchResponse } from './client'
import type { CollaborationNotification } from './types'

export interface NotificationSnapshotEvent {
  notifications: CollaborationNotification[]
  unreadCount: number
}

export interface NotificationDeltaEvent {
  notifications: CollaborationNotification[]
  unreadCount: number
}

export interface NotificationSummaryEvent {
  unreadCount: number
}

export interface NotificationStreamHandlers {
  onSnapshot: (data: NotificationSnapshotEvent) => void
  onNotifications: (data: NotificationDeltaEvent) => void
  onSummary: (data: NotificationSummaryEvent) => void
  onError?: (error: unknown) => void
}

export interface NotificationStreamOptions extends NotificationStreamHandlers {
  signal: AbortSignal
  endpoint?: string
  initialBackoffMs?: number
  maxBackoffMs?: number
}

export function formatNotificationLabel(notification: CollaborationNotification): string {
  switch (notification.type) {
    case 'assigned':
      return 'Assigned to you'
    case 'comment_added':
      return 'Added a comment'
    case 'approval_requested':
      return 'Requested approval'
    case 'workflow_decision': {
      const { fromStatus, toStatus } = notification
      if (fromStatus === 'awaiting_approval' && toStatus === 'resolved') {
        return 'Approved'
      }
      if (fromStatus === 'awaiting_approval' && toStatus === 'in_progress') {
        return 'Sent back'
      }
      if (toStatus === 'closed') {
        return 'Closed'
      }
      if (fromStatus === 'resolved' && toStatus === 'in_progress') {
        return 'Reopened'
      }
      if (toStatus === 'cancelled') {
        return 'Cancelled'
      }
      return 'Workflow decision'
    }
    default:
      return (notification.type as string).replace(/_/g, ' ')
  }
}

export async function parseEventStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onEvent: (event: string, data: string) => void,
  signal: AbortSignal,
): Promise<void> {
  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  let currentEvent = 'message'
  let currentData: string[] = []

  const dispatchCurrentEvent = () => {
    if (signal.aborted) {
      return
    }
    if (currentData.length > 0) {
      onEvent(currentEvent, currentData.join('\n'))
    }
    currentEvent = 'message'
    currentData = []
  }

  const processLine = (line: string) => {
    if (signal.aborted) {
      return
    }
    if (line === '') {
      dispatchCurrentEvent()
      return
    }
    if (line.startsWith(':')) {
      return
    }
    const colonIndex = line.indexOf(':')
    if (colonIndex === -1) {
      if (line === 'data') {
        currentData.push('')
      }
      return
    }

    const field = line.slice(0, colonIndex)
    let value = line.slice(colonIndex + 1)
    if (value.startsWith(' ')) {
      value = value.slice(1)
    }

    if (field === 'event') {
      currentEvent = value.trim()
    } else if (field === 'data') {
      currentData.push(value)
    }
  }

  while (!signal.aborted) {
    const { value, done } = await reader.read()
    if (signal.aborted) {
      return
    }
    if (done) {
      break
    }
    if (value) {
      buffer += decoder.decode(value, { stream: true })
      let processable = buffer
      let remainder = ''
      if (processable.endsWith('\r')) {
        processable = processable.slice(0, -1)
        remainder = '\r'
      }

      const lines = processable.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
      buffer = (lines.pop() ?? '') + remainder
      for (const line of lines) {
        if (signal.aborted) {
          return
        }
        processLine(line)
      }
    }
  }
}

export function connectNotificationStream(options: NotificationStreamOptions): () => void {
  const {
    signal,
    onSnapshot,
    onNotifications,
    onSummary,
    onError,
    endpoint = '/notifications/stream',
    initialBackoffMs = 1000,
    maxBackoffMs = 15000,
  } = options

  let reconnectAttempts = 0
  let reconnectTimer: number | null = null
  let activeAbortController: AbortController | null = null
  let activeReader: ReadableStreamDefaultReader<Uint8Array> | null = null
  let isClosed = false

  const cleanup = () => {
    isClosed = true
    if (reconnectTimer !== null) {
      window.clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    if (activeAbortController) {
      activeAbortController.abort()
      activeAbortController = null
    }
    if (activeReader) {
      try {
        void activeReader.cancel()
      } catch {
        // Ignore reader cancellation errors on teardown
      }
      activeReader = null
    }
  }

  signal.addEventListener('abort', cleanup, { once: true })

  const scheduleReconnect = () => {
    if (isClosed || signal.aborted) return
    const delay = Math.min(initialBackoffMs * Math.pow(2, reconnectAttempts), maxBackoffMs)
    reconnectAttempts++
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = null
      void connect()
    }, delay)
  }

  const connect = async () => {
    if (isClosed || signal.aborted) return

    activeAbortController = new AbortController()
    const abortHandler = () => {
      activeAbortController?.abort()
    }
    signal.addEventListener('abort', abortHandler, { once: true })

    try {
      const res = await apiFetchResponse(endpoint, {
        signal: activeAbortController.signal,
        headers: { Accept: 'text/event-stream' },
      })

      if (!res.body) {
        throw new Error('Response body is null')
      }

      const contentType = res.headers.get('content-type') ?? ''
      if (!contentType.includes('text/event-stream')) {
        throw new Error(`Expected text/event-stream content-type, got: ${contentType}`)
      }

      activeReader = res.body.getReader()

      await parseEventStream(
        activeReader,
        (eventType, rawData) => {
          if (isClosed || signal.aborted || activeAbortController?.signal.aborted) {
            return
          }
          try {
            const parsed = JSON.parse(rawData)
            if (isClosed || signal.aborted || activeAbortController?.signal.aborted) {
              return
            }
            if (eventType === 'snapshot') {
              reconnectAttempts = 0
              onSnapshot(parsed as NotificationSnapshotEvent)
            } else if (eventType === 'notifications') {
              reconnectAttempts = 0
              onNotifications(parsed as NotificationDeltaEvent)
            } else if (eventType === 'summary') {
              reconnectAttempts = 0
              onSummary(parsed as NotificationSummaryEvent)
            }
          } catch {
            // Bad event payload, ignore
          }
        },
        activeAbortController.signal,
      )
      if (!isClosed && !signal.aborted) {
        scheduleReconnect()
      }
    } catch (err) {
      if (isClosed || signal.aborted) return
      onError?.(err)
      scheduleReconnect()
    } finally {
      signal.removeEventListener('abort', abortHandler)
      activeReader = null
      activeAbortController = null
    }
  }

  void connect()

  return cleanup
}
