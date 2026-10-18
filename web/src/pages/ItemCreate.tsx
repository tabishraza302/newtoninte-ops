import React from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMe } from '../api/hooks'
import { useOptionalAuth } from '../auth/AuthContext'
import { ItemForm } from '../components/ItemForm'
import type { Role, WorkItem } from '../api/types'

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
    <div className="item-create-page" style={{ padding: '1.5rem', maxWidth: '800px', margin: '0 auto' }}>
      <nav style={{ marginBottom: '1.5rem' }}>
        <Link to="/items" style={{ color: '#2563eb', textDecoration: 'none' }}>
          &larr; Back to items
        </Link>
      </nav>

      <header style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.75rem', fontWeight: 700, margin: 0 }}>Create New Item</h1>
      </header>

      <div
        style={{
          padding: '1.5rem',
          backgroundColor: '#ffffff',
          border: '1px solid #e2e8f0',
          borderRadius: '8px',
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
