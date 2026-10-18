import React from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMe } from '../api/hooks'
import { useOptionalAuth } from '../auth/AuthContext'
import { ItemForm } from '../components/ItemForm'
import type { Role, WorkItem } from '../api/types'
import { commonStyles } from '../theme'

export interface ItemCreateProps {
  userRole?: Role
  teamId?: number
}

export function ItemCreate({ userRole: propRole, teamId = 1 }: ItemCreateProps = {}): React.ReactElement {
  const navigate = useNavigate()
  const { data: meData } = useMe()
  const auth = useOptionalAuth()

  const membershipRole = meData?.memberships.find((m) => m.teamId === teamId)?.role
  const effectiveRole: Role =
    propRole ??
    membershipRole ??
    (auth?.user && 'role' in auth.user && typeof auth.user.role === 'string'
      ? (auth.user.role as Role)
      : 'lead')

  const handleSuccess = (createdItem: WorkItem): void => {
    navigate(`/items/${createdItem.id}`)
  }

  return (
    <div className="item-create-page" style={commonStyles.narrowContainer}>
      <nav style={{ marginBottom: '1.25rem' }}>
        <Link
          to="/items"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.4rem',
            color: '#64748b',
            textDecoration: 'none',
            fontSize: '0.875rem',
            fontWeight: 500,
          }}
        >
          &larr; Back to items
        </Link>
      </nav>

      <header style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.75rem', fontWeight: 800, color: '#0f172a', margin: '0 0 0.25rem', letterSpacing: '-0.02em' }}>
          Create New Item
        </h1>
        <p style={{ color: '#64748b', fontSize: '0.875rem', margin: 0 }}>
          Queue a new operations task, incident, or customer issue
        </p>
      </header>

      <div
        style={{
          ...commonStyles.cardPadded,
          padding: '2rem',
        }}
      >
        <ItemForm
          teamId={teamId}
          userRole={effectiveRole}
          onSuccess={handleSuccess}
          onCancel={() => navigate('/items')}
        />
      </div>
    </div>
  )
}
