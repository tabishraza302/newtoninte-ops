import React from 'react'

export const theme = {
  colors: {
    bgApp: '#f8fafc',
    bgCard: '#ffffff',
    bgCardMuted: '#f1f5f9',
    bgHover: '#f8fafc',
    border: '#e2e8f0',
    borderStrong: '#cbd5e1',
    borderFocus: '#2563eb',

    textPrimary: '#0f172a',
    textSecondary: '#475569',
    textMuted: '#64748b',
    textSubtle: '#94a3b8',
    textInverse: '#ffffff',

    accent: '#2563eb',
    accentHover: '#1d4ed8',
    accentActive: '#1e40af',
    accentSubtle: '#eff6ff',
    accentBorder: '#bfdbfe',

    status: {
      open: { bg: '#f0f9ff', text: '#0284c7', border: '#bae6fd' },
      in_progress: { bg: '#fffbeb', text: '#b45309', border: '#fde68a' },
      awaiting_approval: { bg: '#f5f3ff', text: '#7c3aed', border: '#ddd6fe' },
      resolved: { bg: '#ecfdf5', text: '#059669', border: '#a7f3d0' },
      closed: { bg: '#f1f5f9', text: '#475569', border: '#cbd5e1' },
      cancelled: { bg: '#f8fafc', text: '#64748b', border: '#e2e8f0' },
    },

    priority: {
      urgent: { bg: '#fef2f2', text: '#dc2626', border: '#fecaca' },
      high: { bg: '#fff7ed', text: '#ea580c', border: '#fed7aa' },
      medium: { bg: '#fffbeb', text: '#b45309', border: '#fde68a' },
      low: { bg: '#f8fafc', text: '#475569', border: '#e2e8f0' },
    },
  },

  shadows: {
    sm: '0 1px 2px 0 rgba(15, 23, 42, 0.05)',
    md: '0 4px 6px -1px rgba(15, 23, 42, 0.07), 0 2px 4px -2px rgba(15, 23, 42, 0.05)',
    lg: '0 10px 15px -3px rgba(15, 23, 42, 0.08), 0 4px 6px -4px rgba(15, 23, 42, 0.04)',
  },

  radius: {
    sm: '4px',
    md: '6px',
    lg: '8px',
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
    borderRadius: '8px',
    boxShadow: '0 1px 3px 0 rgba(15, 23, 42, 0.04)',
  } as React.CSSProperties,

  cardPadded: {
    backgroundColor: '#ffffff',
    border: '1px solid #e2e8f0',
    borderRadius: '8px',
    padding: '1.5rem',
    boxShadow: '0 1px 3px 0 rgba(15, 23, 42, 0.04)',
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
    backgroundColor: '#2563eb',
    color: '#ffffff',
    border: '1px solid transparent',
    borderRadius: '6px',
    fontSize: '0.875rem',
    fontWeight: 600,
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.4rem',
    textDecoration: 'none',
    boxShadow: '0 1px 2px 0 rgba(37, 99, 235, 0.2)',
    fontFamily: 'inherit',
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
