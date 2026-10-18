import React from 'react'
import { Link } from 'react-router-dom'
import {
  useInfiniteNotifications,
  useNotificationsSummary,
  useMarkNotificationRead,
  useMarkAllNotificationsRead,
} from '../api/hooks'
import type { CollaborationNotification } from '../api/types'
import { formatNotificationLabel } from '../api/notificationStream'
import { useAuth } from '../auth/AuthContext'
import { commonStyles, theme, getApiErrorMessage } from '../theme'

export function Notifications(): React.ReactElement {
  const { user } = useAuth()
  const userId = user?.id

  const {
    data: summary,
    isLoading: summaryLoading,
    isError: isSummaryError,
  } = useNotificationsSummary(userId)

  const {
    data,
    isLoading: listLoading,
    isError: isListError,
    error: listError,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
  } = useInfiniteNotifications(userId)

  const markReadMutation = useMarkNotificationRead(userId)
  const markAllMutation = useMarkAllNotificationsRead(userId)

  const notifications = data?.pages.flatMap((page) => page.notifications) ?? []

  return (
    <div style={commonStyles.pageContainer}>
      {/* Header */}
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '1rem',
          marginBottom: '1.75rem',
        }}
      >
        <div style={{ minWidth: 0, maxWidth: '100%' }}>
          <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
            <h1
              style={{
                fontSize: '1.5rem',
                fontWeight: 700,
                color: theme.colors.textPrimary,
                letterSpacing: '-0.025em',
                margin: 0,
              }}
            >
              Notifications
            </h1>
            {isSummaryError ? (
              <span
                style={{
                  ...commonStyles.badgePill,
                  fontSize: '0.8125rem',
                  fontWeight: 600,
                  color: theme.colors.priority.urgent.text,
                  backgroundColor: theme.colors.priority.urgent.bg,
                  border: `1px solid ${theme.colors.priority.urgent.border}`,
                }}
              >
                Unread count unavailable
              </span>
            ) : summaryLoading ? (
              <span style={{ fontSize: '0.875rem', color: theme.colors.textMuted }}>Loading...</span>
            ) : (
              <span
                style={{
                  ...commonStyles.badgePill,
                  fontSize: '0.8125rem',
                  fontWeight: 600,
                  color: summary && summary.unreadCount > 0 ? theme.colors.accent : theme.colors.textMuted,
                  backgroundColor:
                    summary && summary.unreadCount > 0 ? theme.colors.accentSubtle : theme.colors.bgHover,
                  border: `1px solid ${
                    summary && summary.unreadCount > 0 ? theme.colors.accentBorder : theme.colors.border
                  }`,
                }}
              >
                {summary?.unreadCount ?? 0} unread
              </span>
            )}
          </div>
          <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.875rem', color: theme.colors.textMuted }}>
            Collaboration updates and direct workflow decisions across your teams
          </p>
        </div>

        <button
          type="button"
          onClick={() => markAllMutation.mutate()}
          disabled={markAllMutation.isPending || summary?.unreadCount === 0}
          style={{
            ...commonStyles.buttonSecondary,
            minHeight: '44px',
            boxSizing: 'border-box',
            opacity: markAllMutation.isPending || summary?.unreadCount === 0 ? 0.5 : 1,
            cursor:
              markAllMutation.isPending || summary?.unreadCount === 0 ? 'not-allowed' : 'pointer',
          }}>
          {markAllMutation.isPending ? 'Marking all as read...' : 'Mark all as read'}
        </button>
      </header>

      {/* Mutation Error Alerts */}
      {markAllMutation.isError && (
        <div role="alert" style={{ ...commonStyles.alertError, marginBottom: '1rem' }}>
          <span>Failed to mark all notifications as read: {getApiErrorMessage(markAllMutation.error)}</span>
        </div>
      )}
      {markReadMutation.isError && (
        <div role="alert" style={{ ...commonStyles.alertError, marginBottom: '1rem' }}>
          <span>Failed to mark notification as read: {getApiErrorMessage(markReadMutation.error)}</span>
        </div>
      )}

      {/* Main Content Area */}
      {listLoading ? (
        <div
          role="status"
          style={{
            padding: '3rem',
            textAlign: 'center',
            color: theme.colors.textMuted,
            fontSize: '0.9375rem',
          }}
        >
          Loading notifications...
        </div>
      ) : isListError && !data ? (
        <div
          role="alert"
          style={{
            ...commonStyles.alertError,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '1rem',
          }}
        >
          <span>{getApiErrorMessage(listError)}</span>
          <button
            type="button"
            onClick={() => refetch()}
            style={{ ...commonStyles.buttonSecondary, padding: '0.35rem 0.75rem' }}
          >
            Retry
          </button>
        </div>
      ) : notifications.length === 0 ? (
        <div
          style={{
            padding: '3rem',
            textAlign: 'center',
            backgroundColor: theme.colors.bgCard,
            borderRadius: theme.radius.md,
            border: `1px solid ${theme.colors.border}`,
          }}
        >
          <p style={{ margin: 0, fontSize: '0.9375rem', color: theme.colors.textMuted }}>
            You're all caught up. No notifications yet.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {notifications.map((notification) => (
            <div
              key={notification.id}
              data-testid={`notification-item-${notification.id}`}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '0.5rem',
                padding: '1rem 1.25rem',
                backgroundColor: notification.readAt ? theme.colors.bgCard : theme.colors.bgCardMuted,
                border: `1px solid ${notification.readAt ? theme.colors.border : theme.colors.borderStrong}`,
                borderRadius: theme.radius.md,
                boxShadow: theme.shadows.sm,
                minWidth: 0,
                maxWidth: '100%',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  flexWrap: 'wrap',
                  gap: '0.75rem',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    flexWrap: 'wrap',
                    minWidth: 0,
                    flex: '1 1 auto',
                  }}
                >
                  <span style={{ fontWeight: 600, color: theme.colors.textPrimary }}>
                    {notification.actor?.displayName ?? 'Someone'}
                  </span>
                  <span
                    style={{
                      ...commonStyles.badgePill,
                      fontSize: '0.75rem',
                      backgroundColor: theme.colors.bgHover,
                      color: theme.colors.textSecondary,
                      border: `1px solid ${theme.colors.borderStrong}`,
                    }}
                  >
                    {formatNotificationLabel(notification)}
                  </span>
                  <span
                    style={{
                      ...commonStyles.badgePill,
                      fontSize: '0.6875rem',
                      backgroundColor: notification.readAt ? theme.colors.bgHover : theme.colors.accentSubtle,
                      color: notification.readAt ? theme.colors.textMuted : theme.colors.accent,
                      border: `1px solid ${
                        notification.readAt ? theme.colors.borderStrong : theme.colors.accentBorder
                      }`,
                    }}
                  >
                    {notification.readAt ? 'Read' : 'Unread'}
                  </span>
                </div>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.75rem',
                    flexWrap: 'wrap',
                    justifyContent: 'flex-end',
                    flexShrink: 0,
                    maxWidth: '100%',
                  }}
                >
                  <time
                    dateTime={notification.createdAt}
                    style={{
                      fontSize: '0.75rem',
                      color: theme.colors.textMuted,
                      fontVariantNumeric: 'tabular-nums',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {new Date(notification.createdAt).toLocaleString()}
                  </time>
                  {!notification.readAt && (
                    <button
                      type="button"
                      onClick={() => markReadMutation.mutate(notification.id)}
                      disabled={markReadMutation.isPending && markReadMutation.variables === notification.id}
                      style={{
                        minHeight: '44px',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: '0.25rem 0.65rem',
                        boxSizing: 'border-box',
                        borderRadius: theme.radius.sm,
                        fontSize: '0.75rem',
                        fontWeight: 600,
                        cursor:
                          markReadMutation.isPending && markReadMutation.variables === notification.id
                            ? 'not-allowed'
                            : 'pointer',
                        opacity:
                          markReadMutation.isPending && markReadMutation.variables === notification.id
                            ? 0.7
                            : 1,
                        backgroundColor: theme.colors.bgCard,
                        color: theme.colors.accent,
                        border: `1px solid ${theme.colors.accent}`,
                        transition: 'all 0.15s ease',
                        flexShrink: 0,
                      }}>
                      {markReadMutation.isPending && markReadMutation.variables === notification.id
                        ? 'Marking read...'
                        : 'Mark as read'}
                    </button>
                  )}
                </div>
              </div>

              <div style={{ fontSize: '0.875rem', wordBreak: 'break-word' }}>
                <Link
                  to={`/items/${notification.workItemId}`}
                  style={{
                    color: theme.colors.accent,
                    fontWeight: 600,
                    textDecoration: 'none',
                  }}
                >
                  {notification.itemTitle}
                </Link>
              </div>
            </div>
          ))}

          {/* Next Page Failure Alert */}
          {isFetchNextPageError && (
            <div
              role="alert"
              style={{
                ...commonStyles.alertError,
                marginTop: '0.5rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '1rem',
              }}
            >
              <span>{getApiErrorMessage(listError, 'Failed to load next page')}</span>
              <button
                type="button"
                onClick={() => fetchNextPage()}
                style={{ ...commonStyles.buttonSecondary, padding: '0.35rem 0.75rem' }}
              >
                Retry
              </button>
            </div>
          )}

          {/* Load More Button */}
          {hasNextPage && (
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: '1rem' }}>
              <button
                type="button"
                onClick={() => fetchNextPage()}
                disabled={isFetchingNextPage}
                style={{
                  ...commonStyles.buttonSecondary,
                  minWidth: '140px',
                  opacity: isFetchingNextPage ? 0.7 : 1,
                  cursor: isFetchingNextPage ? 'not-allowed' : 'pointer',
                }}
              >
                {isFetchingNextPage ? 'Loading more...' : 'Load more'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
