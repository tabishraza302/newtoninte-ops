import React from 'react'

export const theme = {
  colors: {
    bgApp: '#f4f6f8',
    bgCard: '#ffffff',
    bgCardMuted: '#f8fafc',
    bgHover: '#f1f5f9',
    sidebarBg: '#11161d',
    sidebarBorder: '#1e293b',
    border: '#e2e8f0',
    borderStrong: '#cbd5e1',
    borderFocus: '#0f766e',

    textPrimary: '#0f172a',
    textSecondary: '#334155',
    textMuted: '#64748b',
    textSubtle: '#94a3b8',
    textInverse: '#ffffff',

    accent: '#0f766e',
    accentHover: '#115e59',
    accentActive: '#134e4a',
    accentSubtle: '#f0fdfa',
    accentBorder: '#ccfbf1',

    status: {
      open: { bg: '#e0f2fe', text: '#0369a1', border: '#bae6fd' },
      in_progress: { bg: '#fef3c7', text: '#92400e', border: '#fde68a' },
      awaiting_approval: { bg: '#f3e8ff', text: '#6b21a8', border: '#ddd6fe' },
      resolved: { bg: '#ecfdf5', text: '#047857', border: '#a7f3d0' },
      closed: { bg: '#f1f5f9', text: '#475569', border: '#cbd5e1' },
      cancelled: { bg: '#fef2f2', text: '#991b1b', border: '#fecaca' },
    },

    priority: {
      urgent: { bg: '#fef2f2', text: '#dc2626', border: '#fecaca' },
      high: { bg: '#fff7ed', text: '#c2410c', border: '#fed7aa' },
      medium: { bg: '#f0fdfa', text: '#0f766e', border: '#ccfbf1' },
      low: { bg: '#f8fafc', text: '#64748b', border: '#e2e8f0' },
    },
  },

  shadows: {
    sm: '0 1px 2px 0 rgba(15, 23, 42, 0.04)',
    md: '0 3px 6px -1px rgba(15, 23, 42, 0.05), 0 2px 4px -2px rgba(15, 23, 42, 0.03)',
    lg: '0 10px 15px -3px rgba(15, 23, 42, 0.06), 0 4px 6px -4px rgba(15, 23, 42, 0.03)',
  },

  radius: {
    sm: '4px',
    md: '6px',
    lg: '12px',
    pill: '9999px',
  },
} as const

export const commonStyles = {
  pageContainer: {
    maxWidth: '1200px',
    margin: '0 auto',
    padding: '2rem 1.5rem',
  } as React.CSSProperties,

  narrowContainer: {
    maxWidth: '800px',
    margin: '0 auto',
    padding: '2rem 1.5rem',
  } as React.CSSProperties,

  card: {
    backgroundColor: '#ffffff',
    border: '1px solid #e2e8f0',
    borderRadius: '12px',
    boxShadow: '0 1px 3px 0 rgba(15, 23, 42, 0.03)',
  } as React.CSSProperties,

  cardPadded: {
    backgroundColor: '#ffffff',
    border: '1px solid #e2e8f0',
    borderRadius: '12px',
    padding: '1.5rem',
    boxShadow: '0 1px 3px 0 rgba(15, 23, 42, 0.03)',
  } as React.CSSProperties,

  label: {
    display: 'block',
    fontSize: '0.8125rem',
    fontWeight: 600,
    color: '#334155',
    marginBottom: '0.375rem',
    letterSpacing: '-0.01em',
  } as React.CSSProperties,

  input: {
    width: '100%',
    padding: '0.55rem 0.75rem',
    border: '1px solid #cbd5e1',
    borderRadius: '6px',
    fontSize: '0.875rem',
    color: '#0f172a',
    backgroundColor: '#ffffff',
    boxSizing: 'border-box' as const,
    outline: 'none',
    fontFamily: 'inherit',
    transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
  } as React.CSSProperties,

  select: {
    width: '100%',
    padding: '0.55rem 0.75rem',
    border: '1px solid #cbd5e1',
    borderRadius: '6px',
    fontSize: '0.875rem',
    color: '#0f172a',
    backgroundColor: '#ffffff',
    boxSizing: 'border-box' as const,
    outline: 'none',
    fontFamily: 'inherit',
    cursor: 'pointer',
  } as React.CSSProperties,

  buttonPrimary: {
    padding: '0.55rem 1.15rem',
    backgroundColor: '#0f766e',
    color: '#ffffff',
    border: '1px solid #0f766e',
    borderRadius: '6px',
    fontSize: '0.875rem',
    fontWeight: 600,
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.4rem',
    textDecoration: 'none',
    boxShadow: '0 1px 2px 0 rgba(15, 118, 110, 0.15)',
    fontFamily: 'inherit',
    transition: 'background-color 0.15s ease, border-color 0.15s ease',
  } as React.CSSProperties,

  buttonSecondary: {
    padding: '0.55rem 1.15rem',
    backgroundColor: '#ffffff',
    color: '#334155',
    border: '1px solid #cbd5e1',
    borderRadius: '6px',
    fontSize: '0.875rem',
    fontWeight: 500,
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.4rem',
    textDecoration: 'none',
    fontFamily: 'inherit',
  } as React.CSSProperties,

  buttonDanger: {
    padding: '0.55rem 1.15rem',
    backgroundColor: '#fef2f2',
    color: '#dc2626',
    border: '1px solid #fecaca',
    borderRadius: '6px',
    fontSize: '0.875rem',
    fontWeight: 600,
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: 'inherit',
  } as React.CSSProperties,

  badgePill: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.3rem',
    fontSize: '0.75rem',
    fontWeight: 600,
    lineHeight: 1,
    padding: '0.25rem 0.6rem',
    borderRadius: '9999px',
    border: '1px solid transparent',
    letterSpacing: '0.01em',
    textTransform: 'capitalize' as const,
    whiteSpace: 'nowrap',
  } as React.CSSProperties,

  alertError: {
    padding: '0.75rem 1rem',
    backgroundColor: '#fef2f2',
    border: '1px solid #fecaca',
    borderRadius: '6px',
    color: '#991b1b',
    fontSize: '0.875rem',
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
  } as React.CSSProperties,
}

export function getStatusBadgeStyle(status: string): React.CSSProperties {
  const norm = status.toLowerCase() as keyof typeof theme.colors.status
  const s = theme.colors.status[norm] || theme.colors.status.open
  return {
    ...commonStyles.badgePill,
    backgroundColor: s.bg,
    color: s.text,
    borderColor: s.border,
  }
}

export function getPriorityBadgeStyle(priority: string): React.CSSProperties {
  const norm = priority.toLowerCase() as keyof typeof theme.colors.priority
  const p = theme.colors.priority[norm] || theme.colors.priority.low
  return {
    ...commonStyles.badgePill,
    backgroundColor: p.bg,
    color: p.text,
    borderColor: p.border,
  }
}

export function getApiErrorMessage(err: unknown, fallback = 'An unexpected error occurred'): string {
  if (err && typeof err === 'object') {
    if ('data' in err && err.data && typeof err.data === 'object') {
      const data = err.data
      if ('error' in data) {
        const errField = data.error
        if (typeof errField === 'string') return errField
        if (errField && typeof errField === 'object' && 'message' in errField && typeof errField.message === 'string') {
          return errField.message
        }
      }
      if ('message' in data && typeof data.message === 'string') {
        return data.message
      }
    }
    if ('message' in err && typeof err.message === 'string') {
      return err.message
    }
  }
  return fallback
}
