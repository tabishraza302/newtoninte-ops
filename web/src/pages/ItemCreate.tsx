import React, { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMe, useTeams } from '../api/hooks'
import { useOptionalAuth } from '../auth/AuthContext'
import { ItemForm } from '../components/ItemForm'
import type { Role, WorkItem } from '../api/types'
import { commonStyles, theme } from '../theme'

export interface ItemCreateProps {
  userRole?: Role
  teamId?: number
}

export function ItemCreate({ userRole: propRole, teamId: propTeamId }: ItemCreateProps = {}): React.ReactElement {
  const navigate = useNavigate()
  const { data: meData, isLoading: meLoading } = useMe()
  const { data: teamsData, isLoading: teamsLoading } = useTeams()
  const auth = useOptionalAuth()

  const userMemberships = meData?.memberships ?? []
  const teams = teamsData?.teams ?? []

  // Teams where user has create permission (member or lead)
  const creatableMemberships = userMemberships.filter(
    (m) => m.role === 'member' || m.role === 'lead',
  )

  const defaultTeamId =
    propTeamId ??
    creatableMemberships[0]?.teamId ??
    userMemberships[0]?.teamId ??
    teams[0]?.id ??
    1

  const [selectedTeamId, setSelectedTeamId] = useState<number>(defaultTeamId)

  useEffect(() => {
    if (defaultTeamId && !propTeamId) {
      setSelectedTeamId(defaultTeamId)
    }
  }, [defaultTeamId, propTeamId])

  const currentMembership = userMemberships.find((m) => m.teamId === selectedTeamId)
  const effectiveRole: Role =
    propRole ??
    currentMembership?.role ??
    (auth?.user && 'role' in auth.user && typeof auth.user.role === 'string'
      ? (auth.user.role as Role)
      : 'viewer')

  const canCreateInTeam = effectiveRole === 'member' || effectiveRole === 'lead'

  const handleSuccess = (createdItem: WorkItem): void => {
    navigate(`/items/${createdItem.id}`)
  }

  if (meLoading || teamsLoading) {
    return (
      <div className="item-create-page" style={commonStyles.narrowContainer}>
        <div role="status" style={{ ...commonStyles.cardPadded, padding: '3rem', textAlign: 'center', color: theme.colors.textMuted }}>
          Loading workspace...
        </div>
      </div>
    )
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
            color: theme.colors.textMuted,
            textDecoration: 'none',
            fontSize: '0.875rem',
            fontWeight: 500,
          }}
        >
          &larr; Back to items
        </Link>
      </nav>

      <header style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.75rem', fontWeight: 800, color: theme.colors.textPrimary, margin: '0 0 0.25rem', letterSpacing: '-0.02em' }}>
          Create New Item
        </h1>
        <p style={{ color: theme.colors.textMuted, fontSize: '0.875rem', margin: 0 }}>
          Queue an operational task, incident, or customer ticket in the system of record
        </p>
      </header>

      {/* Team selection if user belongs to multiple teams */}
      {teams.length > 1 && (
        <div
          style={{
            ...commonStyles.cardPadded,
            padding: '1.25rem 1.5rem',
            marginBottom: '1.5rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '1rem',
          }}
        >
          <div>
            <label htmlFor="team-select" style={commonStyles.label}>
              Target Team *
            </label>
            <div style={{ fontSize: '0.8125rem', color: theme.colors.textMuted }}>
              Select which operational team owns this work item
            </div>
          </div>
          <select
            id="team-select"
            value={selectedTeamId}
            onChange={(e) => setSelectedTeamId(Number(e.target.value))}
            style={{ ...commonStyles.select, maxWidth: '280px' }}
          >
            {teams.map((t) => {
              const mem = userMemberships.find((m) => m.teamId === t.id)
              const roleLabel = mem ? ` (${mem.role})` : ''
              return (
                <option key={t.id} value={t.id}>
                  {t.name}
                  {roleLabel}
                </option>
              )
            })}
          </select>
        </div>
      )}

      {!canCreateInTeam ? (
        <div role="alert" style={{ ...commonStyles.cardPadded, padding: '2rem', textAlign: 'center' }}>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: theme.colors.textPrimary, margin: '0 0 0.5rem' }}>
            Cannot Create Work Item
          </h2>
          <p style={{ color: theme.colors.textMuted, fontSize: '0.875rem', margin: '0 0 1.5rem' }}>
            You hold a <strong>viewer</strong> role in this team. Only team members and leads may create new work items.
          </p>
          <Link to="/items" style={commonStyles.buttonSecondary}>
            View Work Items
          </Link>
        </div>
      ) : (
        <div
          style={{
            ...commonStyles.cardPadded,
            padding: '2rem',
          }}
        >
          <ItemForm
            teamId={selectedTeamId}
            userRole={effectiveRole}
            onSuccess={handleSuccess}
            onCancel={() => navigate('/items')}
          />
        </div>
      )}
    </div>
  )
}
