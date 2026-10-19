import React, { useEffect, useRef, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useOptionalAuth } from '../auth/AuthContext'
import {
  connectNotificationStream,
  formatNotificationLabel,
} from '../api/notificationStream'
import type { CollaborationNotification } from '../api/types'
import { commonStyles, theme } from '../theme'

export interface ToastItem {
  id: number
  notification: CollaborationNotification
}

export const MAX_VISIBLE_TOASTS = 3
export const MAX_PENDING_TOASTS = 10
export const MAX_SEEN_CACHE_SIZE = 200

export interface NotificationLiveProviderProps {
  children: React.ReactNode
}

interface ToastCardProps {
  toast: ToastItem
  onDismiss: (id: number) => void
}

function ToastCard({ toast, onDismiss }: ToastCardProps): React.ReactElement {
  const [isHovered, setIsHovered] = useState(false)
  const [isFocused, setIsFocused] = useState(false)
  const isPaused = isHovered || isFocused
  const remainingTimeRef = useRef(8000)
  const startTimeRef = useRef(Date.now())
  const timerRef = useRef<number | null>(null)

  useEffect(() => {
    if (isPaused) {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current)
        timerRef.current = null
      }
      const elapsed = Date.now() - startTimeRef.current
      remainingTimeRef.current = Math.max(0, remainingTimeRef.current - elapsed)
      return
    }

    startTimeRef.current = Date.now()
    timerRef.current = window.setTimeout(() => {
      onDismiss(toast.id)
    }, remainingTimeRef.current)

    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }
  }, [isPaused, toast.id, onDismiss])

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid={`notification-toast-${toast.id}`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onFocus={() => setIsFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setIsFocused(false)
        }
      }}
      style={{
        pointerEvents: 'auto',
        backgroundColor: theme.colors.bgCard,
        border: `1px solid ${theme.colors.borderStrong}`,
        borderRadius: theme.radius.md,
        boxShadow: theme.shadows.lg,
        padding: '12px 14px',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: '12px',
        boxSizing: 'border-box',
        width: '100%',
        transition: 'all 0.15s ease',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: 0, flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', fontSize: '0.8125rem' }}>
          <span style={{ fontWeight: 600, color: theme.colors.textPrimary }}>
            {toast.notification.actor?.displayName ?? 'Someone'}
          </span>
          <span
            style={{
              ...commonStyles.badgePill,
              fontSize: '0.6875rem',
              backgroundColor: theme.colors.bgHover,
              color: theme.colors.textSecondary,
              border: `1px solid ${theme.colors.borderStrong}`,
              padding: '1px 6px',
            }}
          >
            {formatNotificationLabel(toast.notification)}
          </span>
        </div>
        <div style={{ fontSize: '0.875rem', wordBreak: 'break-word' }}>
          <Link
            to={`/items/${toast.notification.workItemId}`}
            style={{
              color: theme.colors.accent,
              fontWeight: 600,
              textDecoration: 'none',
            }}
          >
            {toast.notification.itemTitle}
          </Link>
        </div>
      </div>
      <button
        type="button"
        aria-label="Dismiss notification"
        onClick={() => onDismiss(toast.id)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '44px',
          height: '44px',
          minWidth: '44px',
          minHeight: '44px',
          padding: 0,
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          color: theme.colors.textMuted,
          borderRadius: theme.radius.sm,
          flexShrink: 0,
          margin: '-8px -8px -8px 0',
        }}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  )
}

function NotificationLiveSession({ userId }: { userId: number }): React.ReactElement | null {
  const queryClient = useQueryClient()

  const [toasts, setToasts] = useState<ToastItem[]>([])
  const seenNotificationIdsRef = useRef<Set<number>>(new Set())
  const isBaselineEstablishedRef = useRef(false)

  const recordSeenId = (id: number) => {
    const set = seenNotificationIdsRef.current
    set.add(id)
    while (set.size > MAX_SEEN_CACHE_SIZE) {
      const oldest = set.values().next().value
      if (oldest !== undefined) {
        set.delete(oldest)
      } else {
        break
      }
    }
  }

  const enqueueToasts = (newItems: ToastItem[]) => {
    setToasts((prev) => {
      const combined = [...prev, ...newItems]
      if (combined.length <= MAX_PENDING_TOASTS) {
        return combined
      }
      const visible = combined.slice(0, MAX_VISIBLE_TOASTS)
      const pending = combined.slice(MAX_VISIBLE_TOASTS)
      const keptPending = pending.slice(-(MAX_PENDING_TOASTS - visible.length))
      return [...visible, ...keptPending]
    })
  }
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.matchMedia('(max-width: 768px)').matches
  })

  useEffect(() => {
    if (typeof window === 'undefined') return
    const media = window.matchMedia('(max-width: 768px)')
    const listener = (e: MediaQueryListEvent) => {
      setIsMobile(e.matches)
    }
    media.addEventListener('change', listener)
    return () => media.removeEventListener('change', listener)
  }, [])

  useEffect(() => {
    let isDisposed = false
    const abortController = new AbortController()

    const cleanup = connectNotificationStream({
      signal: abortController.signal,
      onSnapshot: (data) => {
        if (isDisposed || abortController.signal.aborted) return
        queryClient.setQueryData(['notifications', userId, 'summary'], {
          unreadCount: data.unreadCount,
        })
        void queryClient.invalidateQueries({ queryKey: ['notifications', userId, 'list'] })

        if (!isBaselineEstablishedRef.current) {
          isBaselineEstablishedRef.current = true
          for (const item of data.notifications) {
            recordSeenId(item.id)
          }
        } else {
          const sorted = [...data.notifications].sort((a, b) => a.id - b.id)
          const newItems: ToastItem[] = []
          for (const item of sorted) {
            if (!seenNotificationIdsRef.current.has(item.id)) {
              recordSeenId(item.id)
              newItems.push({ id: item.id, notification: item })
            }
          }
          if (newItems.length > 0) {
            enqueueToasts(newItems)
          }
        }
      },
      onNotifications: (data) => {
        if (isDisposed || abortController.signal.aborted) return
        queryClient.setQueryData(['notifications', userId, 'summary'], {
          unreadCount: data.unreadCount,
        })
        void queryClient.invalidateQueries({ queryKey: ['notifications', userId, 'list'] })

        const sorted = [...data.notifications].sort((a, b) => a.id - b.id)
        const newItems: ToastItem[] = []
        for (const item of sorted) {
          if (!seenNotificationIdsRef.current.has(item.id)) {
            recordSeenId(item.id)
            newItems.push({ id: item.id, notification: item })
          }
        }
        if (newItems.length > 0) {
          enqueueToasts(newItems)
        }
      },
      onSummary: (data) => {
        if (isDisposed || abortController.signal.aborted) return
        queryClient.setQueryData(['notifications', userId, 'summary'], {
          unreadCount: data.unreadCount,
        })
        void queryClient.invalidateQueries({ queryKey: ['notifications', userId, 'list'] })
      },
    })

    return () => {
      isDisposed = true
      abortController.abort()
      cleanup()
    }
  }, [userId, queryClient])

  const handleDismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((item) => item.id !== id))
  }, [])

  const visibleToasts = toasts.slice(0, MAX_VISIBLE_TOASTS)

  if (visibleToasts.length === 0) {
    return null
  }

  return (
    <div
      data-testid="notification-toasts-container"
      style={{
        position: 'fixed',
        top: '72px',
        right: '16px',
        left: isMobile ? '16px' : 'auto',
        width: isMobile ? 'auto' : '360px',
        maxWidth: 'calc(100vw - 32px)',
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        pointerEvents: 'none',
        boxSizing: 'border-box',
      }}
    >
      {visibleToasts.map((toast) => (
        <ToastCard key={toast.id} toast={toast} onDismiss={handleDismiss} />
      ))}
    </div>
  )
}

export function NotificationLiveProvider({ children }: NotificationLiveProviderProps): React.ReactElement {
  const auth = useOptionalAuth()
  const authedUserId = auth?.status === 'authed' ? auth.user?.id : undefined

  return (
    <>
      {children}
      {typeof authedUserId === 'number' && authedUserId > 0 ? (
        <NotificationLiveSession key={authedUserId} userId={authedUserId} />
      ) : null}
    </>
  )
}
