import React, { useState, useEffect, useRef } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import {
  useAdminTeams,
  useAdminSetTeamMemberRole,
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
  type ListAdminTeamsQuery,
  type AdminTeamMember,
  type Team,
  ROLES,
} from '../api/types'
import { ApiError } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { commonStyles, theme } from '../theme'
function normalizeSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}


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
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const qParam = searchParams.get('q') ?? ''

  const createTeamMutation = useCreateTeam()
  const addMemberMutation = useAddTeamMember()

  const [selectedTeamId, setSelectedTeamId] = useState<number | null>(null)
  const selectedTeamIdRef = useRef<number | null>(selectedTeamId)
  selectedTeamIdRef.current = selectedTeamId
  const [showCreateTeam, setShowCreateTeam] = useState(false)
  const [showAddMember, setShowAddMember] = useState(false)
  const [teamsCursor, setTeamsCursor] = useState<string | undefined>(undefined)
  const [teams, setTeams] = useState<Team[]>([])
  const [searchInput, setSearchInput] = useState(qParam)
  const [prevQParam, setPrevQParam] = useState(qParam)
  const submittedQueriesRef = useRef<Set<string>>(new Set())

  // Keep local search input synchronized with external navigation (back/forward, external URL changes)
  if (qParam !== prevQParam) {
    setPrevQParam(qParam)
    if (submittedQueriesRef.current.has(qParam)) {
      submittedQueriesRef.current.delete(qParam)
    } else {
      setSearchInput(qParam)
      submittedQueriesRef.current.clear()
    }
  }
  const effectiveQ = qParam.trim()
  const [prevEffectiveQ, setPrevEffectiveQ] = useState(effectiveQ)
  const [pinnedTeam, setPinnedTeam] = useState<Team | null>(null)
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

  // Team roster & continuation & role update state
  const [rosterCursor, setRosterCursor] = useState<string | undefined>(undefined)
  const rosterCursorRef = useRef<string | undefined>(rosterCursor)
  rosterCursorRef.current = rosterCursor
  const [rosterMembers, setRosterMembers] = useState<AdminTeamMember[]>([])
  const [prevRosterTeamId, setPrevRosterTeamId] = useState<number | null>(null)
  const [updatingMemberUserId, setUpdatingMemberUserId] = useState<number | null>(null)
  const [rosterError, setRosterError] = useState<string | null>(null)
  const [rosterSuccess, setRosterSuccess] = useState<string | null>(null)
  const [removalError, setRemovalError] = useState<string | null>(null)
  const [removalSuccess, setRemovalSuccess] = useState<string | null>(null)
  const [memberToRemove, setMemberToRemove] = useState<AdminTeamMember | null>(null)

  // Searchable paginated user picker state
  const [pickerSearch, setPickerSearch] = useState('')
  const [pickerCursor, setPickerCursor] = useState<string | undefined>(undefined)
  const [pickerUsers, setPickerUsers] = useState<PublicUser[]>([])

  if (effectiveQ !== prevEffectiveQ) {
    setPrevEffectiveQ(effectiveQ)
    setPinnedTeam(null)
    setTeamsCursor(undefined)
    setTeams([])
  }

  const adminTeamsQuery: ListAdminTeamsQuery = {
    ...(effectiveQ ? { q: effectiveQ } : {}),
    ...(teamsCursor ? { cursor: teamsCursor } : {}),
  }
  const {
    data: teamsData,
    isLoading: teamsLoading,
    isFetching: teamsFetching,
    error: teamsError,
  } = useAdminTeams(adminTeamsQuery)

  useEffect(() => {
    if (teamsData?.teams) {
      if (!teamsCursor) {
        setTeams(teamsData.teams)
      } else {
        setTeams((prev) => {
          const freshById = new Map(teamsData.teams.map((t: Team) => [t.id, t]))
          const updated = prev.map((t) => freshById.get(t.id) ?? t)
          const prevIds = new Set(prev.map((t) => t.id))
          const additions = teamsData.teams.filter((t: Team) => !prevIds.has(t.id))
          return [...updated, ...additions]
        })
      }
    }
  }, [teamsData, teamsCursor])

  // Retain selected team if still in current result set, or pick first team if unselected or missing
  useEffect(() => {
    if (pinnedTeam && selectedTeamId === pinnedTeam.id) {
      return
    }
    if (teams.length === 0) {
      if (!effectiveQ) {
        setSelectedTeamId(null)
      }
      return
    }
    if (selectedTeamId === null || !teams.some((t) => t.id === selectedTeamId)) {
      const first = teams[0]
      if (first) {
        setSelectedTeamId(first.id)
      }
    }
  }, [teams, selectedTeamId, qParam, pinnedTeam])

  if (selectedTeamId !== prevRosterTeamId) {
    selectedTeamIdRef.current = selectedTeamId
    setPrevRosterTeamId(selectedTeamId)
    setRosterCursor(undefined)
    rosterCursorRef.current = undefined
    setRosterMembers([])
    setRosterError(null)
    setRosterSuccess(null)
    setRemovalError(null)
    setRemovalSuccess(null)
    setMemberError(null)
    setMemberSuccess(null)
    setMemberToRemove(null)
  }

  const rosterQuery = {
    ...(rosterCursor ? { cursor: rosterCursor } : {}),
  }
  const {
    data: teamMembersData,
    isLoading: teamMembersLoading,
    isFetching: teamMembersFetching,
    error: teamMembersError,
  } = useAdminTeamMembers(selectedTeamId ?? 0, rosterQuery)

  const setMemberRoleMutation = useAdminSetTeamMemberRole()
  const removeMemberMutation = useAdminRemoveTeamMember()

  useEffect(() => {
    if (teamMembersData?.members) {
      if (!rosterCursor) {
        setRosterMembers(teamMembersData.members)
      } else {
        setRosterMembers((prev) => {
          const freshById = new Map(teamMembersData.members.map((m: AdminTeamMember) => [m.id, m]))
          const updated = prev.map((m) => freshById.get(m.id) ?? m)
          const prevIds = new Set(prev.map((m) => m.id))
          const additions = teamMembersData.members.filter((m: AdminTeamMember) => !prevIds.has(m.id))
          return [...updated, ...additions]
        })
      }
    }
  }, [teamMembersData, rosterCursor])
  const reloadAuthoritativeFirstPage = async (teamId: number): Promise<void> => {
    if (selectedTeamIdRef.current === teamId && rosterCursorRef.current) {
      setRosterCursor(undefined)
      rosterCursorRef.current = undefined
      setRosterMembers([])
    }
    await queryClient.invalidateQueries({
      queryKey: ['admin', 'teams', teamId, 'members'],
      refetchType: 'none',
    })
    await queryClient.refetchQueries({
      queryKey: ['admin', 'teams', teamId, 'members', {}],
      exact: true,
    })
    if (selectedTeamIdRef.current !== teamId) {
      return
    }
    const freshData = queryClient.getQueryData<{
      members: AdminTeamMember[]
      nextCursor?: string | null
    }>(['admin', 'teams', teamId, 'members', {}])
    if (freshData?.members) {
      setRosterMembers(freshData.members)
    }
  }


  // Reset member form feedback when selected team changes
  const handleSelectTeam = (id: number): void => {
    selectedTeamIdRef.current = id
    setSelectedTeamId(id)
    setPinnedTeam(null)
    // Single full-width layout without mobileView split
    setMemberError(null)
    setMemberSuccess(null)
    setSelectedUser(null)
    setRemovalError(null)
    setRemovalSuccess(null)
    setRosterError(null)
    setRosterSuccess(null)
    setMemberToRemove(null)
  }

  const handleDirectorySearchChange = (val: string): void => {
    submittedQueriesRef.current.add(val)
    setSearchInput(val)
    setPinnedTeam(null)
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      if (val) {
        next.set('q', val)
      } else {
        next.delete('q')
      }
      return next
    })
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

  // Roster mutations and queries defined above
  const handleRemoveMember = async (member: AdminTeamMember): Promise<void> => {
    setRemovalError(null)
    setRemovalSuccess(null)
    if (!selectedTeamId) return
    const targetTeamId = selectedTeamId
    setMemberToRemove(member)

    try {
      await removeMemberMutation.mutateAsync({
        teamId: targetTeamId,
        userId: member.userId,
      })
      if (selectedTeamIdRef.current === targetTeamId) {
        setRemovalSuccess(`Removed ${member.user.displayName} from the team.`)
        setMemberToRemove(null)
      }
      await reloadAuthoritativeFirstPage(targetTeamId)
    } catch (err) {
      if (selectedTeamIdRef.current === targetTeamId) {
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
  }
  const handleRoleChange = async (member: AdminTeamMember, newRole: Role): Promise<void> => {
    if (!selectedTeamId || member.role === newRole) return
    const targetTeamId = selectedTeamId
    setRosterError(null)
    setRosterSuccess(null)
    setUpdatingMemberUserId(member.userId)

    try {
      await setMemberRoleMutation.mutateAsync({
        teamId: targetTeamId,
        userId: member.userId,
        role: newRole,
      })
      if (selectedTeamIdRef.current === targetTeamId) {
        setRosterSuccess(`Role for ${member.user.displayName} updated to ${newRole}.`)
      }
      await reloadAuthoritativeFirstPage(targetTeamId)
    } catch (err) {
      if (selectedTeamIdRef.current === targetTeamId) {
        if (err instanceof ApiError) {
          if (typeof err.data === 'object' && err.data !== null && 'error' in err.data) {
            const dataObj = err.data as { error?: { code?: string; message?: string } | string }
            if (typeof dataObj.error === 'string') {
              setRosterError(dataObj.error)
              return
            }
            if (dataObj.error?.message) {
              setRosterError(dataObj.error.message)
              return
            }
          }
        }
        setRosterError(err instanceof Error ? err.message : 'Failed to update member role.')
      }
    } finally {
      setUpdatingMemberUserId(null)
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

  const selectedTeam =
    pinnedTeam && pinnedTeam.id === selectedTeamId
      ? pinnedTeam
      : (teams.find((t) => t.id === selectedTeamId) ?? null)

  const visibleTeams =
    pinnedTeam && !teams.some((t) => t.id === pinnedTeam.id)
      ? [pinnedTeam, ...teams]
      : teams
  const normalizedMemberFilter = memberFilter.trim().toLowerCase()
  const visibleMembers = rosterMembers.filter((member) =>
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
      setPinnedTeam(res.team)
      setSelectedTeamId(res.team.id)
      // Direct selection without mobileView toggle
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
    const targetTeamId = selectedTeam.id
    const targetTeamName = selectedTeam.name
    const targetUser = selectedUser

    setMemberError(null)
    setMemberSuccess(null)

    try {
      await addMemberMutation.mutateAsync({
        teamId: targetTeamId,
        userId: targetUser.id,
        role: selectedRole,
      })

      if (selectedTeamIdRef.current === targetTeamId) {
        setMemberSuccess(
          `Added ${targetUser.displayName} (${targetUser.email}) to "${targetTeamName}" as ${selectedRole}.`,
        )
        setSelectedUser(null)
      }
      await reloadAuthoritativeFirstPage(targetTeamId)
    } catch (err) {
      if (selectedTeamIdRef.current === targetTeamId) {
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
  }

  return (
    <div className="admin-teams-page" style={{ ...commonStyles.pageContainer, maxWidth: '100%', boxSizing: 'border-box' }}>
      <style>{`
        .admin-teams-page {
          width: 100%;
          max-width: 100%;
          box-sizing: border-box;
          overflow-x: hidden;
        }
        .admin-teams-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          flex-wrap: wrap;
          gap: 1rem;
          width: 100%;
          max-width: 100%;
          box-sizing: border-box;
        }
        .admin-teams-dialog-layer {
          padding: 1rem 1rem 1rem calc(260px + 1rem);
        }
        .teams-picker-bar {
          width: 100%;
          max-width: 100%;
          box-sizing: border-box;
        }
        .team-picker-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          flex-wrap: wrap;
          gap: 0.75rem;
          width: 100%;
          max-width: 100%;
          box-sizing: border-box;
        }
        .team-picker-search-wrap {
          min-width: 0;
          width: 100%;
          max-width: 360px;
          flex: 1 1 200px;
          box-sizing: border-box;
        }
        .team-directory-list {
          display: flex;
          flex-wrap: wrap;
          gap: 0.5rem;
          align-items: center;
          width: 100%;
          max-width: 100%;
          box-sizing: border-box;
        }
        .team-directory-item {
          display: inline-flex;
          align-items: center;
          gap: 0.625rem;
          padding: 0.5rem 0.85rem;
          background-color: #ffffff;
          border: 1px solid #e2e8f0;
          border-radius: 8px;
          text-align: left;
          cursor: pointer;
          font-family: inherit;
          transition: all 0.15s ease;
          max-width: 100%;
          min-width: 0;
          box-sizing: border-box;
        }
        .team-directory-item:hover:not(.active) {
          background-color: #f8fafc !important;
          border-color: #cbd5e1 !important;
        }
        .team-directory-item:focus-visible {
          outline: 2px solid #0f766e;
          outline-offset: 2px;
        }
        .team-roster-panel {
          width: 100%;
          max-width: 100%;
          box-sizing: border-box;
        }
        .team-roster-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          flex-wrap: wrap;
          gap: 1rem;
          margin-bottom: 1.25rem;
          padding-bottom: 1.25rem;
          border-bottom: 1px solid #f1f5f9;
          width: 100%;
          max-width: 100%;
          box-sizing: border-box;
        }
        .team-roster-actions {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          flex-wrap: wrap;
          max-width: 100%;
          box-sizing: border-box;
        }
        .team-members-table-wrap {
          overflow-x: auto;
          border: 1px solid #e2e8f0;
          border-radius: 12px;
          width: 100%;
          max-width: 100%;
          box-sizing: border-box;
        }
        @media (max-width: 768px) {
          .admin-teams-dialog-layer {
            padding: 1rem;
          }
        }
        @media (max-width: 640px) {
          .admin-teams-page {
            padding: 1rem 0.75rem !important;
          }
          .admin-teams-header {
            flex-direction: column !important;
            align-items: flex-start !important;
            gap: 0.75rem !important;
          }
          .admin-teams-header button {
            align-self: flex-start !important;
          }
          .teams-picker-bar {
            padding: 1rem 0.75rem !important;
          }
          .team-picker-header {
            flex-direction: column !important;
            align-items: stretch !important;
            gap: 0.75rem !important;
          }
          .team-picker-search-wrap {
            max-width: 100% !important;
            width: 100% !important;
            flex: none !important;
          }
          .team-directory-item {
            width: 100% !important;
          }
          .team-roster-panel {
            padding: 1rem 0.75rem !important;
          }
          .team-roster-header {
            flex-direction: column !important;
            align-items: stretch !important;
            gap: 0.75rem !important;
          }
          .team-roster-actions {
            width: 100% !important;
            flex-direction: column !important;
            align-items: stretch !important;
          }
          .team-roster-actions .member-filter-wrap {
            width: 100% !important;
            max-width: 100% !important;
          }
          .team-roster-actions button {
            width: 100% !important;
            align-self: stretch !important;
          }
          .team-members-table-wrap table thead {
            display: none;
          }
          .team-members-table-wrap table,
          .team-members-table-wrap tbody {
            display: block;
            width: 100%;
            max-width: 100%;
            box-sizing: border-box;
          }
          .team-members-table-wrap tr {
            display: grid;
            grid-template-columns: 1fr auto;
            gap: 0.5rem 0.75rem;
            align-items: center;
            background: #ffffff;
            border-bottom: 1px solid #e2e8f0;
            padding: 0.875rem 0.5rem;
            box-sizing: border-box;
            width: 100%;
          }
          .team-members-table-wrap td.col-user-info {
            grid-column: 1 / 3;
            padding: 0 !important;
            min-width: 0;
            overflow: hidden;
            word-break: break-word;
          }
          .team-members-table-wrap td.col-role {
            grid-column: 1;
            padding: 0 !important;
          }
          .team-members-table-wrap td.col-action {
            grid-column: 2;
            padding: 0 !important;
            text-align: right;
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
          width: '100%',
          maxWidth: '100%',
          boxSizing: 'border-box',
        }}
      >
        <div style={{ minWidth: 0, maxWidth: '100%' }}>
          <h1
            style={{
              fontSize: '1.75rem',
              fontWeight: 800,
              color: '#0f172a',
              margin: '0 0 0.35rem',
              letterSpacing: '-0.02em',
              wordBreak: 'break-word',
            }}
          >
            Teams
          </h1>
          <p style={{ color: '#64748b', fontSize: '0.875rem', margin: 0, wordBreak: 'break-word' }}>
            Manage organizational teams, inspect member rosters, and assign roles.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setShowCreateTeam(true)
            setTeamError(null)
          }}
          style={{ ...commonStyles.buttonPrimary, whiteSpace: 'nowrap' }}
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

      <section
        aria-label="Teams directory"
        className="teams-picker-bar"
        style={{
          ...commonStyles.cardPadded,
          backgroundColor: '#ffffff',
          border: '1px solid #e2e8f0',
          borderRadius: '12px',
          padding: '1.25rem',
          display: 'flex',
          flexDirection: 'column',
          marginBottom: '1.5rem',
          width: '100%',
          maxWidth: '100%',
          boxSizing: 'border-box',
        }}
      >
        <div
          className="team-picker-header"
          style={{
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '0.75rem',
            width: '100%',
            maxWidth: '100%',
            boxSizing: 'border-box',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
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

          <div className="team-picker-search-wrap" style={{ minWidth: 0, width: '100%', maxWidth: '360px', flex: '1 1 200px', boxSizing: 'border-box' }}>
            <label htmlFor="team-directory-search" style={commonStyles.label}>
              Search teams
            </label>
            <input
              id="team-directory-search"
              type="search"
              aria-label="Search teams"
              placeholder="Search by name or slug"
              value={searchInput}
              onChange={(event) => handleDirectorySearchChange(event.target.value)}
              style={{
                ...commonStyles.input,
                fontSize: '0.8125rem',
                padding: '0.5rem 0.75rem',
                backgroundColor: '#f8fafc',
                borderRadius: '6px',
              }}
            />
          </div>
        </div>

        {teamsLoading && (
          <div
            role="status"
            style={{
              padding: '1.5rem',
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
          <div role="alert" style={{ ...commonStyles.alertError, margin: 0 }}>
            Failed to load teams: {teamsError.message}
          </div>
        )}
        {!teamsLoading && !teamsError && teams.length === 0 && !effectiveQ && (
          <div
            role="status"
            data-testid="empty-teams-state"
            style={{
              padding: '2rem 1rem',
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
        {!teamsLoading && !teamsError && teams.length === 0 && !!effectiveQ && (
          <div role="status" style={{ color: '#64748b', fontSize: '0.875rem', padding: '0.5rem 0' }}>
            No teams match your search.
          </div>
        )}

        {visibleTeams.length > 0 && (
          <div
            className="team-directory-list"
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '0.5rem',
              alignItems: 'center',
            }}
          >
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
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.625rem',
                    padding: '0.5rem 0.85rem',
                    backgroundColor: isSelected ? theme.colors.accentSubtle : '#ffffff',
                    border: `1px solid ${isSelected ? theme.colors.accentBorder : '#e2e8f0'}`,
                    borderRadius: '8px',
                    textAlign: 'left',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    transition: 'all 0.15s ease',
                    maxWidth: '100%',
                    minWidth: 0,
                    boxSizing: 'border-box',
                  }}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      display: 'grid',
                      placeItems: 'center',
                      width: '1.75rem',
                      height: '1.75rem',
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
                  <div style={{ minWidth: 0, flex: 1, overflow: 'hidden' }}>
                    <div
                      style={{
                        fontWeight: isSelected ? 700 : 600,
                        fontSize: '0.875rem',
                        color: isSelected ? theme.colors.accentActive : '#0f172a',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        maxWidth: '100%',
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
                        maxWidth: '100%',
                      }}
                    >
                      slug: {team.slug}
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
                        marginLeft: '0.25rem',
                      }}
                    />
                  )}
                </button>
              )
            })}
            {teamsData?.nextCursor && (
              <button
                type="button"
                onClick={() => setTeamsCursor(teamsData.nextCursor ?? undefined)}
                disabled={teamsFetching}
                style={{
                  ...commonStyles.buttonSecondary,
                  padding: '0.5rem 0.85rem',
                  fontSize: '0.8125rem',
                }}
              >
                {teamsFetching ? 'Loading teams…' : 'Load more teams'}
              </button>
            )}
          </div>
        )}
      </section>

      {selectedTeam && visibleTeams.some((team) => team.id === selectedTeam.id) ? (
        <section aria-label="Team Roster" className="team-roster-panel" style={{ ...commonStyles.cardPadded, width: '100%', maxWidth: '100%', boxSizing: 'border-box' }}>
          <div
            className="team-roster-header"
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              flexWrap: 'wrap',
              gap: '1rem',
              marginBottom: '1.25rem',
              paddingBottom: '1.25rem',
              borderBottom: '1px solid #f1f5f9',
              width: '100%',
              maxWidth: '100%',
              boxSizing: 'border-box',
            }}
          >
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                <h2
                  style={{
                    fontSize: '1.375rem',
                    fontWeight: 800,
                    color: '#0f172a',
                    margin: 0,
                    letterSpacing: '-0.02em',
                  }}
                >
                  {selectedTeam.name}
                </h2>
                <span
                  style={{
                    ...commonStyles.badgePill,
                    backgroundColor: '#f1f5f9',
                    color: '#475569',
                    fontSize: '0.75rem',
                  }}
                >
                  slug: {selectedTeam.slug}
                </span>
              </div>
              <div style={{ fontSize: '0.8125rem', color: '#64748b', marginTop: '0.35rem' }}>
                Team ID: {selectedTeam.id} • Created{' '}
                {selectedTeam.createdAt ? new Date(selectedTeam.createdAt).toLocaleDateString() : 'Unknown'}
              </div>
            </div>

            <div
              className="team-roster-actions"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                flexWrap: 'wrap',
                maxWidth: '100%',
                boxSizing: 'border-box',
              }}
            >
              <div className="member-filter-wrap" style={{ minWidth: 0, width: '180px', maxWidth: '100%', boxSizing: 'border-box' }}>
                <label htmlFor="member-filter" style={commonStyles.label}>
                  Filter loaded members
                </label>
                <input
                  id="member-filter"
                  type="search"
                  aria-label="Filter loaded members"
                  placeholder="Name, email, or role"
                  value={memberFilter}
                  onChange={(e) => setMemberFilter(e.target.value)}
                  style={commonStyles.input}
                />
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowAddMember(true)
                  setMemberError(null)
                }}
                style={{ ...commonStyles.buttonPrimary, alignSelf: 'flex-end' }}
              >
                + Add Member
              </button>
            </div>
          </div>

          <h3
            style={{
              fontSize: '1.125rem',
              fontWeight: 700,
              color: '#0f172a',
              margin: '0 0 0.25rem',
            }}
          >
            Team Roster
          </h3>
          <p style={{ fontSize: '0.8125rem', color: '#64748b', margin: '0 0 1rem' }}>
            Inspect and manage memberships for {selectedTeam.name}.
          </p>

          {rosterSuccess && (
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
              {rosterSuccess}
            </div>
          )}
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
          {rosterError && (
            <div role="alert" style={{ ...commonStyles.alertError, marginBottom: '1rem' }}>
              {rosterError}
            </div>
          )}
          {removalError && (
            <div role="alert" style={{ ...commonStyles.alertError, marginBottom: '1rem' }}>
              {removalError}
            </div>
          )}
          {teamMembersLoading && rosterMembers.length === 0 && (
            <div role="status" style={{ padding: '2rem', textAlign: 'center', color: '#64748b', fontSize: '0.875rem' }}>
              Loading team members…
            </div>
          )}
          {teamMembersError && (
            <div role="alert" style={{ ...commonStyles.alertError }}>
              Failed to load team members: {teamMembersError.message}
            </div>
          )}
          {!teamMembersLoading && !teamMembersError && rosterMembers.length === 0 && (
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
          {!teamMembersLoading && !teamMembersError && rosterMembers.length > 0 && (
            <>
              {visibleMembers.length === 0 && (
                <div role="status" style={{ color: '#64748b', fontSize: '0.875rem', marginBottom: '0.75rem' }}>
                  No members match your filter.
                </div>
              )}
              <div className="team-members-table-wrap">
                <table
                  data-testid="team-members-table"
                  style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}
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
                      <th style={{ padding: '0.75rem 1rem' }}>Member</th>
                      <th style={{ padding: '0.75rem 1rem' }}>Role</th>
                      <th style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleMembers.map((member) => (
                      <tr key={member.id} style={{ borderBottom: '1px solid #f1f5f9', verticalAlign: 'middle' }}>
                        <td className="col-user-info" style={{ padding: '0.875rem 1rem' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
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
                                flexShrink: 0,
                              }}
                            >
                              {memberInitials(member.user.displayName)}
                            </span>
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontWeight: 600, color: '#0f172a' }}>{member.user.displayName}</div>
                              <div style={{ color: '#64748b', fontSize: '0.8125rem' }}>
                                <span>{member.user.email}</span>
                                <span style={{ margin: '0 0.35rem', color: '#cbd5e1' }}>•</span>
                                <span style={{ color: '#94a3b8', fontSize: '0.75rem' }}>
                                  {new Date(member.createdAt).toLocaleDateString()}
                                </span>
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="col-role" style={{ padding: '0.875rem 1rem' }}>
                          <select
                            aria-label={`Role for ${member.user.displayName}`}
                            value={member.role}
                            disabled={updatingMemberUserId === member.userId}
                            onChange={(e) => void handleRoleChange(member, e.target.value as Role)}
                            style={{
                              ...commonStyles.select,
                              padding: '0.25rem 0.5rem',
                              fontSize: '0.8125rem',
                              width: 'auto',
                            }}
                          >
                            <option value="viewer">Viewer</option>
                            <option value="member">Member</option>
                            <option value="lead">Lead</option>
                          </select>
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
          {teamMembersData?.nextCursor && (
            <div style={{ marginTop: '1rem', textAlign: 'center' }}>
              <button
                type="button"
                onClick={() => setRosterCursor(teamMembersData.nextCursor ?? undefined)}
                disabled={teamMembersFetching}
                style={commonStyles.buttonSecondary}
              >
                {teamMembersFetching ? 'Loading members…' : 'Load more members'}
              </button>
            </div>
          )}
        </section>
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
                      const prevNormalized = normalizeSlug(teamName)
                      setTeamName(value)
                      if (!teamSlug || teamSlug === prevNormalized) {
                        setTeamSlug(normalizeSlug(value))
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
