import React, { useState, useEffect } from 'react'
import { Navigate } from 'react-router-dom'
import {
  useTeams,
  useCreateTeam,
  useAddTeamMember,
  useAdminUsers,
  useAdminTeamMembers,
  useAdminRemoveTeamMember,
} from '../api/hooks'
import {
  type Role,
  type PublicUser,
  type ListAdminUsersQuery,
  type AdminTeamMember,
  ROLES,
} from '../api/types'
import { ApiError } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { commonStyles, theme } from '../theme'

export function AdminTeams(): React.ReactElement {
  const { user, status } = useAuth()

  if (status === 'loading') {
    return (
      <div style={commonStyles.narrowContainer}>
        <div style={{ color: theme.colors.textMuted, padding: '2rem 0' }}>Checking authorization…</div>
      </div>
    )
  }

  if (status === 'anon' || !user) {
    return <Navigate to="/login" replace />
  }

  if (!user.isAdmin) {
    return (
      <div style={commonStyles.narrowContainer}>
        <div
          role="alert"
          style={{
            ...commonStyles.alertError,
            padding: '1.5rem',
            textAlign: 'center',
            display: 'block',
          }}
        >
          <div style={{ fontWeight: 700, fontSize: '1rem', marginBottom: '0.25rem' }}>Access Denied</div>
          <div>Not authorised - team management is admin only.</div>
        </div>
      </div>
    )
  }

  return <AdminTeamsContent />
}

export function AdminTeamsContent(): React.ReactElement {
  const { data: teamsData, isLoading: teamsLoading, error: teamsError } = useTeams({ all: true })
  const createTeamMutation = useCreateTeam()
  const addMemberMutation = useAddTeamMember()

  const [selectedTeamId, setSelectedTeamId] = useState<number | null>(null)
  const [mobileView, setMobileView] = useState<'directory' | 'roster'>('directory')
  const [showCreateTeam, setShowCreateTeam] = useState(false)
  const [showAddMember, setShowAddMember] = useState(false)
  const [teamDirectorySearch, setTeamDirectorySearch] = useState('')
  const [memberFilter, setMemberFilter] = useState('')
  const [teamName, setTeamName] = useState('')
  const [teamSlug, setTeamSlug] = useState('')
  const [teamError, setTeamError] = useState<string | null>(null)
  const [teamSuccess, setTeamSuccess] = useState<string | null>(null)

  // Direct-add member state
  const [selectedRole, setSelectedRole] = useState<Role>('member')
  const [selectedUser, setSelectedUser] = useState<PublicUser | null>(null)
  const [memberError, setMemberError] = useState<string | null>(null)
  const [memberSuccess, setMemberSuccess] = useState<string | null>(null)

  // Team roster & removal state
  const [removalError, setRemovalError] = useState<string | null>(null)
  const [removalSuccess, setRemovalSuccess] = useState<string | null>(null)
  const [memberToRemove, setMemberToRemove] = useState<AdminTeamMember | null>(null)
  // Searchable paginated user picker state
  const [pickerSearch, setPickerSearch] = useState('')
  const [pickerCursor, setPickerCursor] = useState<string | undefined>(undefined)
  const [pickerUsers, setPickerUsers] = useState<PublicUser[]>([])

  const teams = teamsData?.teams ?? []

  // Default selection to first team with guard for noUncheckedIndexedAccess
  useEffect(() => {
    const firstTeam = teams[0]
    if (selectedTeamId === null && firstTeam) {
      setSelectedTeamId(firstTeam.id)
    }
  }, [teams, selectedTeamId])

  // Reset member form feedback when selected team changes
  const handleSelectTeam = (id: number): void => {
    setSelectedTeamId(id)
    setMobileView('roster')
    setMemberError(null)
    setMemberSuccess(null)
    setSelectedUser(null)
    setRemovalError(null)
    setRemovalSuccess(null)
    setMemberToRemove(null)
  }
  // Reset cursor and accumulated results with each new picker query.

  const pickerQuery: ListAdminUsersQuery = {
    ...(pickerSearch ? { q: pickerSearch } : {}),
    ...(pickerCursor ? { cursor: pickerCursor } : {}),
    limit: 10,
  }

  const {
    data: pickerData,
    isLoading: pickerLoading,
    isFetching: pickerFetching,
    error: pickerError,
  } = useAdminUsers(pickerQuery, { enabled: !!selectedTeamId })

  useEffect(() => {
    if (pickerData?.users) {
      if (!pickerCursor) {
        setPickerUsers(pickerData.users)
      } else {
        setPickerUsers((prev) => {
          const freshById = new Map(pickerData.users.map((u: PublicUser) => [u.id, u]))
          const updated = prev.map((u) => freshById.get(u.id) ?? u)
          const prevIds = new Set(prev.map((u) => u.id))
          const additions = pickerData.users.filter((u: PublicUser) => !prevIds.has(u.id))
          return [...updated, ...additions]
        })
      }
    }
  }, [pickerData, pickerCursor])

  const removeMemberMutation = useAdminRemoveTeamMember()
  const {
    data: teamMembersData,
    isLoading: teamMembersLoading,
    error: teamMembersError,
  } = useAdminTeamMembers(selectedTeamId ?? 0)

  const handleRemoveMember = async (member: AdminTeamMember): Promise<void> => {
    setRemovalError(null)
    setRemovalSuccess(null)
    if (!selectedTeamId) return
    setMemberToRemove(member)

    try {
      await removeMemberMutation.mutateAsync({
        teamId: selectedTeamId,
        userId: member.userId,
      })
      setRemovalSuccess(`Removed ${member.user.displayName} from the team.`)
      setMemberToRemove(null)
    } catch (err) {
      if (err instanceof ApiError) {
        if (typeof err.data === 'object' && err.data !== null && 'error' in err.data) {
          const dataObj = err.data as { error?: { code?: string; message?: string } | string }
          if (typeof dataObj.error === 'string') {
            setRemovalError(dataObj.error)
            return
          }
          if (dataObj.error?.message) {
            setRemovalError(dataObj.error.message)
            return
          }
        }
      }
      setRemovalError(err instanceof Error ? err.message : 'Failed to remove member from team.')
      setMemberToRemove(null)
    }
  }

  const getRoleBadgeStyle = (role: Role): React.CSSProperties => {
    switch (role) {
      case 'lead':
        return {
          ...commonStyles.badgePill,
          backgroundColor: '#eff6ff',
          color: '#1d4ed8',
          border: '1px solid #bfdbfe',
        }
      case 'member':
        return {
          ...commonStyles.badgePill,
          backgroundColor: '#f0fdf4',
          color: '#15803d',
          border: '1px solid #bbf7d0',
        }
      case 'viewer':
      default:
        return {
          ...commonStyles.badgePill,
          backgroundColor: '#f8fafc',
          color: '#475569',
          border: '1px solid #e2e8f0',
        }
    }
  }

  const selectedTeam = teams.find((t) => t.id === selectedTeamId) ?? null

  const normalizedTeamDirectorySearch = teamDirectorySearch.trim().toLowerCase()
  const visibleTeams = normalizedTeamDirectorySearch
    ? teams.filter((team) =>
        `${team.name} ${team.slug}`.toLowerCase().includes(normalizedTeamDirectorySearch),
      )
    : teams
  const normalizedMemberFilter = memberFilter.trim().toLowerCase()
  const visibleMembers = (teamMembersData?.members ?? []).filter((member) =>
    `${member.user.displayName} ${member.user.email} ${member.role}`
      .toLowerCase()
      .includes(normalizedMemberFilter),
  )

  const memberInitials = (displayName: string): string =>
    displayName
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('')

  const handleCreateTeamSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    setTeamError(null)
    setTeamSuccess(null)

    const trimmedName = teamName.trim()
    const trimmedSlug = teamSlug.trim().toLowerCase()

    if (!trimmedName) {
      setTeamError('Team name is required.')
      return
    }
    if (!trimmedSlug) {
      setTeamError('Team slug is required.')
      return
    }

    try {
      const res = await createTeamMutation.mutateAsync({
        name: trimmedName,
        slug: trimmedSlug,
      })

      setTeamSuccess(`Team "${res.team.name}" created successfully.`)
      setTeamName('')
      setTeamSlug('')
      setShowCreateTeam(false)
      setSelectedTeamId(res.team.id)
      setMobileView('roster')
    } catch (err) {
      if (err instanceof ApiError) {
        if (typeof err.data === 'object' && err.data !== null && 'error' in err.data) {
          const dataObj = err.data as { error?: { message?: string } | string }
          if (typeof dataObj.error === 'string') {
            setTeamError(dataObj.error)
            return
          }
          if (dataObj.error?.message) {
            setTeamError(dataObj.error.message)
            return
          }
        }
      }
      setTeamError(err instanceof Error ? err.message : 'Failed to create team.')
    }
  }

  const handleAddMemberSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    if (!selectedTeam || !selectedUser) return

    setMemberError(null)
    setMemberSuccess(null)

    try {
      await addMemberMutation.mutateAsync({
        teamId: selectedTeam.id,
        userId: selectedUser.id,
        role: selectedRole,
      })

      setMemberSuccess(
        `Added ${selectedUser.displayName} (${selectedUser.email}) to "${selectedTeam.name}" as ${selectedRole}.`,
      )
      setSelectedUser(null)
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 409) {
          setMemberError('This user is already a member of this team.')
          return
        }
        if (typeof err.data === 'object' && err.data !== null && 'error' in err.data) {
          const dataObj = err.data as { error?: { message?: string } | string }
          if (typeof dataObj.error === 'string') {
            setMemberError(dataObj.error)
            return
          }
          if (dataObj.error?.message) {
            setMemberError(dataObj.error.message)
            return
          }
        }
      }
      setMemberError(err instanceof Error ? err.message : 'Failed to add member to team.')
    }
  }

  return (
    <div className={`admin-teams-page mobile-view-${mobileView}`} style={{ ...commonStyles.pageContainer, maxWidth: '100%', boxSizing: 'border-box' }}>
      <style>{`
        .admin-teams-grid {
          display: grid;
          grid-template-columns: minmax(280px, 320px) minmax(0, 1fr);
          gap: 1.5rem;
          align-items: start;
        }
        .admin-teams-grid > main,
        .admin-teams-grid > aside {
          min-width: 0;
        }
        .admin-teams-dialog-layer {
          padding: 1rem 1rem 1rem calc(260px + 1rem);
        }
        .team-directory-item:hover:not(.active) {
          background-color: #f8fafc !important;
          border-color: #e2e8f0 !important;
        }
        .team-directory-item:focus-visible {
          outline: 2px solid #0f766e;
          outline-offset: 2px;
        }
        .mobile-back-button {
          display: none;
        }
        @media (max-width: 768px) {
          .admin-teams-grid {
            display: block;
          }
          .mobile-view-directory .admin-teams-main {
            display: none !important;
          }
          .mobile-view-roster .admin-teams-aside {
            display: none !important;
          }
          .mobile-view-roster .admin-teams-header {
            display: none !important;
          }
          .mobile-back-button {
            display: inline-flex !important;
          }
          .admin-teams-dialog-layer {
            padding: 1rem;
          }
        }
        @media (max-width: 640px) {
          .team-members-table-wrap thead {
            display: none;
          }
          .team-members-table-wrap table {
            min-width: 0 !important;
            display: block !important;
          }
          .team-members-table-wrap tbody {
            display: flex !important;
            flex-direction: column !important;
            gap: 0.75rem;
            padding: 0.5rem;
          }
          .team-members-table-wrap tr {
            display: grid !important;
            grid-template-columns: auto 1fr auto;
            gap: 0.25rem 0.75rem;
            align-items: center;
            background: #ffffff;
            border: 1px solid #e2e8f0 !important;
            border-radius: 6px;
            padding: 0.875rem !important;
          }
          .team-members-table-wrap td {
            padding: 0 !important;
            border: none !important;
          }
          .team-members-table-wrap td.col-avatar {
            grid-column: 1;
            grid-row: 1 / 3;
            align-self: start;
          }
          .team-members-table-wrap td.col-user {
            grid-column: 2;
            grid-row: 1;
            font-weight: 700;
          }
          .team-members-table-wrap td.col-email {
            grid-column: 2;
            grid-row: 2;
            font-size: 0.8125rem;
            color: #64748b;
            word-break: break-all;
          }
          .team-members-table-wrap td.col-role {
            grid-column: 3;
            grid-row: 1;
            justify-self: end;
          }
          .team-members-table-wrap td.col-action {
            grid-column: 3;
            grid-row: 2;
            justify-self: end;
          }
          .team-members-table-wrap td.col-joined {
            grid-column: 1 / 4;
            grid-row: 3;
            font-size: 0.75rem;
            color: #94a3b8;
            border-top: 1px solid #f1f5f9 !important;
            padding-top: 0.5rem !important;
            margin-top: 0.25rem;
          }
        }
      `}</style>

      <header
        className="admin-teams-header"
        style={{
          marginBottom: '1.75rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '1rem',
        }}
      >
        <div>
          <h1
            style={{
              fontSize: '1.75rem',
              fontWeight: 800,
              color: '#0f172a',
              margin: '0 0 0.35rem',
              letterSpacing: '-0.02em',
            }}
          >
            Teams
          </h1>
          <p style={{ color: '#64748b', fontSize: '0.875rem', margin: 0 }}>
            Manage organizational teams, inspect member rosters, and assign roles.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setShowCreateTeam(true)
            setTeamError(null)
          }}
          style={commonStyles.buttonPrimary}
        >
          + Create Team
        </button>
      </header>

      {teamSuccess && (
        <div
          role="status"
          style={{
            padding: '0.75rem 1rem',
            backgroundColor: '#ecfdf5',
            border: '1px solid #a7f3d0',
            borderRadius: '6px',
            color: '#065f46',
            fontSize: '0.875rem',
            marginBottom: '1.5rem',
          }}
        >
          {teamSuccess}
        </div>
      )}

      <div className={`admin-teams-grid mobile-view-${mobileView}`}>
        <aside
          className="admin-teams-aside"
          aria-label="Teams directory"
          style={{
            ...commonStyles.cardPadded,
            backgroundColor: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: '12px',
            padding: '1.25rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.875rem',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2
              style={{
                fontSize: '0.9375rem',
                fontWeight: 700,
                color: '#0f172a',
                margin: 0,
                letterSpacing: '-0.01em',
              }}
            >
              All Teams
            </h2>
            <span
              style={{
                ...commonStyles.badgePill,
                backgroundColor: '#f1f5f9',
                color: '#475569',
                fontSize: '0.75rem',
                fontWeight: 700,
                padding: '0.15rem 0.55rem',
              }}
            >
              {teams.length}
            </span>
          </div>
          <div>
            <label htmlFor="team-directory-search" style={commonStyles.label}>
              Search teams
            </label>
            <input
              id="team-directory-search"
              type="search"
              aria-label="Search teams"
              placeholder="Search by name or slug"
              value={teamDirectorySearch}
              onChange={(event) => setTeamDirectorySearch(event.target.value)}
              style={{
                ...commonStyles.input,
                fontSize: '0.8125rem',
                padding: '0.5rem 0.75rem',
                backgroundColor: '#f8fafc',
                borderRadius: '6px',
              }}
            />
          </div>

          {teamsLoading && (
            <div
              role="status"
              style={{
                padding: '2rem',
                textAlign: 'center',
                color: '#64748b',
                backgroundColor: '#ffffff',
                borderRadius: '8px',
                border: '1px solid #e2e8f0',
                fontSize: '0.875rem',
              }}
            >
              Loading teams…
            </div>
          )}
          {teamsError && (
            <div role="alert" style={{ ...commonStyles.alertError, marginBottom: '1rem' }}>
              Failed to load teams: {teamsError.message}
            </div>
          )}
          {!teamsLoading && !teamsError && teams.length === 0 && (
            <div
              role="status"
              data-testid="empty-teams-state"
              style={{
                padding: '2.5rem 1rem',
                textAlign: 'center',
                color: '#64748b',
                background: '#ffffff',
                borderRadius: '8px',
                border: '1px dashed #cbd5e1',
              }}
            >
              <div style={{ fontWeight: 600, color: '#0f172a', marginBottom: '0.25rem' }}>No teams created</div>
              <div style={{ fontSize: '0.8125rem' }}>Create a team to get started.</div>
            </div>
          )}
          {!teamsLoading && !teamsError && teams.length > 0 && visibleTeams.length === 0 && (
            <div role="status" style={{ color: '#64748b', fontSize: '0.875rem', padding: '1rem 0' }}>
              No teams match your search.
            </div>
          )}
          <div className="team-directory-list" style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            {visibleTeams.map((team) => {
              const isSelected = team.id === selectedTeamId
              const initials =
                team.name
                  .split(/\s+/)
                  .filter(Boolean)
                  .slice(0, 2)
                  .map((p) => p[0]?.toUpperCase() ?? '')
                  .join('') || team.name.slice(0, 2).toUpperCase()
              return (
                <button
                  key={team.id}
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => handleSelectTeam(team.id)}
                  className={`team-directory-item ${isSelected ? 'active' : ''}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '0.75rem',
                    padding: '0.625rem 0.75rem',
                    backgroundColor: isSelected ? theme.colors.accentSubtle : '#ffffff',
                    border: `1px solid ${isSelected ? theme.colors.accentBorder : '#f1f5f9'}`,
                    borderRadius: '6px',
                    textAlign: 'left',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    width: '100%',
                    boxSizing: 'border-box',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', minWidth: 0, flex: 1 }}>
                    <span
                      aria-hidden="true"
                      style={{
                        display: 'grid',
                        placeItems: 'center',
                        width: '2rem',
                        height: '2rem',
                        borderRadius: '6px',
                        flexShrink: 0,
                        backgroundColor: isSelected ? theme.colors.accent : '#f1f5f9',
                        color: isSelected ? '#ffffff' : '#475569',
                        fontSize: '0.6875rem',
                        fontWeight: 700,
                      }}
                    >
                      {initials}
                    </span>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div
                        style={{
                          fontWeight: isSelected ? 700 : 600,
                          fontSize: '0.875rem',
                          color: isSelected ? theme.colors.accentActive : '#0f172a',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {team.name}
                      </div>
                      <div
                        style={{
                          fontSize: '0.75rem',
                          color: isSelected ? theme.colors.accent : '#64748b',
                          fontFamily: 'ui-monospace, monospace',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        slug: {team.slug}
                      </div>
                    </div>
                  </div>
                  {isSelected && (
                    <span
                      aria-hidden="true"
                      style={{
                        width: '6px',
                        height: '6px',
                        borderRadius: '999px',
                        backgroundColor: theme.colors.accent,
                        flexShrink: 0,
                      }}
                    />
                  )}
                </button>
              )
            })}
          </div>
        </aside>

        <main className="admin-teams-main">
          <button
            type="button"
            onClick={() => setMobileView('directory')}
            className="mobile-back-button"
            style={{
              alignItems: 'center',
              gap: '0.4rem',
              background: 'none',
              border: 'none',
              color: theme.colors.accent,
              fontWeight: 600,
              fontSize: '0.875rem',
              cursor: 'pointer',
              padding: '0.35rem 0',
              marginBottom: '0.75rem',
              fontFamily: 'inherit',
            }}
          >
            ← Back to All Teams
          </button>
          {selectedTeam && visibleTeams.some((team) => team.id === selectedTeam.id) ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              <section style={commonStyles.cardPadded}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'start',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: '1rem',
                  }}
                >
                  <div>
                    <h2
                      style={{
                        fontSize: '1.25rem',
                        fontWeight: 800,
                        color: '#0f172a',
                        margin: 0,
                        letterSpacing: '-0.02em',
                      }}
                    >
                      {selectedTeam.name}
                    </h2>
                    <div style={{ fontSize: '0.8125rem', color: '#64748b', marginTop: '0.2rem' }}>
                      Team ID: {selectedTeam.id} • Slug: <code>{selectedTeam.slug}</code> • Created{' '}
                      {selectedTeam.createdAt ? new Date(selectedTeam.createdAt).toLocaleDateString() : 'Unknown'}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setShowAddMember(true)
                      setMemberError(null)
                    }}
                    style={commonStyles.buttonPrimary}
                  >
                    + Add Member
                  </button>
                </div>
              </section>

              <section aria-label="Team Roster" style={commonStyles.cardPadded}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'end',
                    flexWrap: 'wrap',
                    gap: '1rem',
                    marginBottom: '1.25rem',
                  }}
                >
                  <div>
                    <h2
                      style={{
                        fontSize: '1.125rem',
                        fontWeight: 700,
                        color: '#0f172a',
                        margin: '0 0 0.25rem',
                      }}
                    >
                      Team Roster
                    </h2>
                    <p style={{ fontSize: '0.8125rem', color: '#64748b', margin: 0 }}>
                      Inspect and manage memberships for {selectedTeam.name}.
                    </p>
                  </div>
                  <div style={{ minWidth: '220px', flex: '1 1 220px', maxWidth: '320px' }}>
                    <label htmlFor="member-filter" style={commonStyles.label}>
                      Filter members
                    </label>
                    <input
                      id="member-filter"
                      type="search"
                      aria-label="Filter members"
                      placeholder="Name, email, or role"
                      value={memberFilter}
                      onChange={(e) => setMemberFilter(e.target.value)}
                      style={commonStyles.input}
                    />
                  </div>
                </div>

                {removalSuccess && (
                  <div
                    role="status"
                    style={{
                      padding: '0.75rem 1rem',
                      backgroundColor: '#ecfdf5',
                      border: '1px solid #a7f3d0',
                      borderRadius: '6px',
                      color: '#065f46',
                      fontSize: '0.875rem',
                      marginBottom: '1rem',
                    }}
                  >
                    {removalSuccess}
                  </div>
                )}
                {removalError && (
                  <div role="alert" style={{ ...commonStyles.alertError, marginBottom: '1rem' }}>
                    {removalError}
                  </div>
                )}
                {teamMembersLoading && (
                  <div role="status" style={{ padding: '2rem', textAlign: 'center', color: '#64748b', fontSize: '0.875rem' }}>
                    Loading team members…
                  </div>
                )}
                {teamMembersError && (
                  <div role="alert" style={{ ...commonStyles.alertError }}>
                    Failed to load team members: {teamMembersError.message}
                  </div>
                )}
                {!teamMembersLoading && !teamMembersError && (teamMembersData?.members?.length ?? 0) === 0 && (
                  <div
                    role="status"
                    data-testid="empty-members-state"
                    style={{
                      padding: '2rem 1rem',
                      textAlign: 'center',
                      color: '#64748b',
                      backgroundColor: '#f8fafc',
                      borderRadius: '8px',
                      border: '1px dashed #cbd5e1',
                      fontSize: '0.875rem',
                    }}
                  >
                    No members found in this team.
                  </div>
                )}
                {!teamMembersLoading && !teamMembersError && (teamMembersData?.members?.length ?? 0) > 0 && (
                  <>
                    {visibleMembers.length === 0 && (
                      <div role="status" style={{ color: '#64748b', fontSize: '0.875rem', marginBottom: '0.75rem' }}>
                        No members match your filter.
                      </div>
                    )}
                    <div className="team-members-table-wrap" style={{ overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: '12px' }}>
                      <table
                        data-testid="team-members-table"
                        style={{ width: '100%', minWidth: '680px', borderCollapse: 'collapse', fontSize: '0.875rem' }}
                      >
                        <thead>
                          <tr
                            style={{
                              backgroundColor: '#f8fafc',
                              borderBottom: '1px solid #e2e8f0',
                              textAlign: 'left',
                              fontSize: '0.75rem',
                              fontWeight: 600,
                              color: '#64748b',
                              textTransform: 'uppercase',
                              letterSpacing: '0.04em',
                            }}
                          >
                            <th style={{ padding: '0.75rem 1rem' }} aria-label="Avatar" />
                            <th style={{ padding: '0.75rem 1rem' }}>User</th>
                            <th style={{ padding: '0.75rem 1rem' }}>Email</th>
                            <th style={{ padding: '0.75rem 1rem' }}>Role</th>
                            <th style={{ padding: '0.75rem 1rem' }}>Joined</th>
                            <th style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {visibleMembers.map((member) => (
                            <tr key={member.id} style={{ borderBottom: '1px solid #f1f5f9', verticalAlign: 'middle' }}>
                              <td className="col-avatar" style={{ padding: '0.875rem 0 0.875rem 1rem' }}>
                                <span
                                  aria-hidden="true"
                                  style={{
                                    display: 'grid',
                                    placeItems: 'center',
                                    width: '2rem',
                                    height: '2rem',
                                    borderRadius: '999px',
                                    backgroundColor: theme.colors.accentSubtle,
                                    color: theme.colors.accentActive,
                                    fontSize: '0.75rem',
                                    fontWeight: 700,
                                  }}
                                >
                                  {memberInitials(member.user.displayName)}
                                </span>
                              </td>
                              <td className="col-user" style={{ padding: '0.875rem 1rem', fontWeight: 600, color: '#0f172a' }}>
                                {member.user.displayName}
                              </td>
                              <td className="col-email" style={{ padding: '0.875rem 1rem', color: '#64748b', fontSize: '0.8125rem' }}>
                                {member.user.email}
                              </td>
                              <td className="col-role" style={{ padding: '0.875rem 1rem' }}>
                                <span style={getRoleBadgeStyle(member.role)}>{member.role}</span>
                              </td>
                              <td className="col-joined" style={{ padding: '0.875rem 1rem', color: '#64748b', fontSize: '0.8125rem' }}>
                                {new Date(member.createdAt).toLocaleDateString()}
                              </td>
                              <td className="col-action" style={{ padding: '0.875rem 1rem', textAlign: 'right' }}>
                                <button
                                  type="button"
                                  aria-label={`Remove ${member.user.displayName} from team`}
                                  onClick={() => void handleRemoveMember(member)}
                                  disabled={removeMemberMutation.isPending}
                                  style={{
                                    padding: '0.35rem 0.75rem',
                                    borderRadius: '6px',
                                    border: '1px solid #fecaca',
                                    backgroundColor: '#fef2f2',
                                    color: '#dc2626',
                                    fontWeight: 600,
                                    fontSize: '0.8125rem',
                                    cursor: removeMemberMutation.isPending ? 'not-allowed' : 'pointer',
                                    fontFamily: 'inherit',
                                  }}
                                >
                                  {removeMemberMutation.isPending && memberToRemove?.id === member.id ? 'Removing…' : 'Remove'}
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </section>
            </div>
          ) : (
            <div
              style={{
                ...commonStyles.cardPadded,
                textAlign: 'center',
                color: '#64748b',
                padding: '4rem 2rem',
              }}
            >
              Select a team from the directory to view its roster.
            </div>
          )}
        </main>
      </div>

      {showCreateTeam && (
        <div
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              setShowCreateTeam(false)
              setTeamError(null)
            }
          }}
          className="admin-teams-dialog-layer"
          role="dialog"
          aria-modal="true"
          aria-labelledby="create-team-title"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 20,
            display: 'grid',
            placeItems: 'center',
            backgroundColor: 'rgba(15, 23, 42, 0.45)',
          }}
        >
          <div style={{ ...commonStyles.cardPadded, width: 'min(100%, 640px)', maxHeight: 'calc(100vh - 2rem)', overflowY: 'auto' }}>
            <h2 id="create-team-title" style={{ fontSize: '1.25rem', fontWeight: 800, color: '#0f172a', margin: '0 0 0.5rem' }}>
              Create Team
            </h2>
            <p style={{ fontSize: '0.8125rem', color: '#64748b', margin: '0 0 1.25rem' }}>
              Add a new team to organize member access.
            </p>
            {teamError && (
              <div role="alert" style={{ ...commonStyles.alertError, marginBottom: '1.25rem' }}>
                {teamError}
              </div>
            )}
            <form onSubmit={(event) => void handleCreateTeamSubmit(event)}>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                  gap: '1rem',
                  marginBottom: '1.5rem',
                }}
              >
                <div>
                  <label htmlFor="team-name-input" style={commonStyles.label}>
                    Team Name *
                  </label>
                  <input
                    autoFocus
                    id="team-name-input"
                    type="text"
                    required
                    placeholder="e.g. Infrastructure Platform"
                    value={teamName}
                    onChange={(event) => {
                      const value = event.target.value
                      setTeamName(value)
                      if (!teamSlug || teamSlug === teamName.toLowerCase().replace(/[^a-z0-9]+/g, '-')) {
                        setTeamSlug(value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''))
                      }
                    }}
                    style={commonStyles.input}
                  />
                </div>
                <div>
                  <label htmlFor="team-slug-input" style={commonStyles.label}>
                    Team Slug (URL-friendly identifier) *
                  </label>
                  <input
                    id="team-slug-input"
                    type="text"
                    required
                    placeholder="e.g. infrastructure-platform"
                    value={teamSlug}
                    onChange={(event) => setTeamSlug(event.target.value.toLowerCase())}
                    style={commonStyles.input}
                  />
                </div>
              </div>
              <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  onClick={() => {
                    setShowCreateTeam(false)
                    setTeamError(null)
                  }}
                  style={commonStyles.buttonSecondary}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createTeamMutation.isPending}
                  style={{
                    ...commonStyles.buttonPrimary,
                    opacity: createTeamMutation.isPending ? 0.7 : 1,
                    cursor: createTeamMutation.isPending ? 'not-allowed' : 'pointer',
                  }}
                >
                  {createTeamMutation.isPending ? 'Creating…' : 'Create Team'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showAddMember && selectedTeam && (
        <div
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              setShowAddMember(false)
              setMemberError(null)
            }
          }}
          role="dialog"
          className="admin-teams-dialog-layer"
          aria-modal="true"
          aria-labelledby="add-member-title"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 20,
            display: 'grid',
            placeItems: 'center',
            backgroundColor: 'rgba(15, 23, 42, 0.45)',
          }}
        >
          <div style={{ ...commonStyles.cardPadded, width: 'min(100%, 680px)', maxHeight: 'calc(100vh - 2rem)', overflowY: 'auto' }}>
            <h2 id="add-member-title" style={{ fontSize: '1.25rem', fontWeight: 800, color: '#0f172a', margin: '0 0 0.5rem' }}>
              Add Member to {selectedTeam.name}
            </h2>
            <p style={{ fontSize: '0.8125rem', color: '#64748b', margin: '0 0 1.25rem' }}>
              Search the user directory and assign a role.
            </p>
            {memberSuccess && (
              <div
                role="status"
                style={{
                  padding: '0.75rem 1rem',
                  backgroundColor: '#ecfdf5',
                  border: '1px solid #a7f3d0',
                  borderRadius: '6px',
                  color: '#065f46',
                  fontSize: '0.875rem',
                  marginBottom: '1rem',
                }}
              >
                {memberSuccess}
              </div>
            )}
            {memberError && (
              <div role="alert" style={{ ...commonStyles.alertError, marginBottom: '1rem' }}>
                {memberError}
              </div>
            )}
            <form onSubmit={(event) => void handleAddMemberSubmit(event)}>
              <div style={{ marginBottom: '1.25rem' }}>
                <label htmlFor="user-picker-search" style={commonStyles.label}>
                  Search and select user *
                </label>
                <input
                  autoFocus
                  id="user-picker-search"
                  type="search"
                  aria-label="Search user to add"
                  placeholder="Type name or email to filter users"
                  value={pickerSearch}
                  onChange={(event) => {
                    const nextSearch = event.target.value
                    setPickerSearch(nextSearch)
                    setPickerCursor(undefined)
                    setPickerUsers([])
                  }}
                  style={{ ...commonStyles.input, marginBottom: '0.75rem' }}
                />
                <div
                  style={{
                    border: '1px solid #e2e8f0',
                    borderRadius: '6px',
                    maxHeight: '220px',
                    overflowY: 'auto',
                    backgroundColor: '#f8fafc',
                  }}
                >
                  {pickerLoading && pickerUsers.length === 0 && (
                    <div style={{ padding: '1.5rem', textAlign: 'center', color: '#64748b', fontSize: '0.8125rem' }}>
                      Searching users…
                    </div>
                  )}
                  {pickerError && (
                    <div style={{ padding: '1rem', color: '#dc2626', fontSize: '0.8125rem' }}>Failed to search users.</div>
                  )}
                  {!pickerLoading && !pickerError && pickerUsers.length === 0 && (
                    <div style={{ padding: '1.5rem', textAlign: 'center', color: '#64748b', fontSize: '0.8125rem' }}>
                      No users found matching &quot;{pickerSearch}&quot;.
                    </div>
                  )}
                  {pickerUsers.map((pickerUser) => {
                    const isPicked = selectedUser?.id === pickerUser.id
                    return (
                      <div
                        key={pickerUser.id}
                        onClick={() => setSelectedUser(pickerUser)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '0.65rem 0.85rem',
                          borderBottom: '1px solid #e2e8f0',
                          backgroundColor: isPicked ? '#dbeafe' : '#ffffff',
                          cursor: 'pointer',
                        }}
                      >
                        <div>
                          <div style={{ fontWeight: 600, fontSize: '0.8125rem', color: '#0f172a' }}>
                            {pickerUser.displayName}
                          </div>
                          <div style={{ fontSize: '0.75rem', color: '#64748b' }}>{pickerUser.email}</div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <span
                            style={{
                              ...commonStyles.badgePill,
                              fontSize: '0.6875rem',
                              backgroundColor: pickerUser.status === 'active' ? '#ecfdf5' : '#fef2f2',
                              color: pickerUser.status === 'active' ? '#059669' : '#dc2626',
                              border: `1px solid ${pickerUser.status === 'active' ? '#a7f3d0' : '#fecaca'}`,
                            }}
                          >
                            {pickerUser.status}
                          </span>
                          <input
                            type="radio"
                            name="selectedUserPicker"
                            checked={isPicked}
                            onChange={() => setSelectedUser(pickerUser)}
                            aria-label={`Select user ${pickerUser.displayName}`}
                          />
                        </div>
                      </div>
                    )
                  })}
                  {pickerData?.nextCursor && (
                    <div style={{ padding: '0.5rem', textAlign: 'center', backgroundColor: '#f1f5f9' }}>
                      <button
                        type="button"
                        onClick={() => setPickerCursor(pickerData.nextCursor ?? undefined)}
                        disabled={pickerFetching}
                        style={{
                          ...commonStyles.buttonSecondary,
                          padding: '0.35rem 0.85rem',
                          fontSize: '0.75rem',
                          width: '100%',
                        }}
                      >
                        {pickerFetching ? 'Loading more users…' : 'Load more users…'}
                      </button>
                    </div>
                  )}
                </div>
              </div>
              <div style={{ marginBottom: '1.25rem' }}>
                <label htmlFor="member-role-select" style={commonStyles.label}>
                  Select Role *
                </label>
                <select
                  id="member-role-select"
                  value={selectedRole}
                  onChange={(event) => setSelectedRole(event.target.value as Role)}
                  style={commonStyles.select}
                >
                  {ROLES.map((role) => (
                    <option key={role} value={role}>
                      {role.charAt(0).toUpperCase() + role.slice(1)}
                    </option>
                  ))}
                </select>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
                <button
                  type="button"
                  onClick={() => {
                    setShowAddMember(false)
                    setMemberError(null)
                  }}
                  style={commonStyles.buttonSecondary}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!selectedUser || addMemberMutation.isPending}
                  style={{
                    ...commonStyles.buttonPrimary,
                    opacity: !selectedUser || addMemberMutation.isPending ? 0.6 : 1,
                    cursor: !selectedUser || addMemberMutation.isPending ? 'not-allowed' : 'pointer',
                  }}
                >
                  {addMemberMutation.isPending
                    ? 'Adding member…'
                    : selectedUser
                      ? `Add ${selectedUser.displayName} to ${selectedTeam.name}`
                      : 'Select a user above to add'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
