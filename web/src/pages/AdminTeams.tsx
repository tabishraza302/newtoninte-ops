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
} from '../api/types'
import { ApiError } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { commonStyles, theme } from '../theme'
import { adminTeamsStyles } from './admin-teams/adminTeamsStyles'
import { TeamsDirectory } from './admin-teams/TeamsDirectory'
import { TeamRoster } from './admin-teams/TeamRoster'
import { TeamModals } from './admin-teams/TeamModals'

function normalizeSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function parseTeamParam(value: string | null): number | null {
  if (!value) return null
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
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
  const detailHeadingRef = useRef<HTMLHeadingElement | null>(null)
  const directoryItemEls = useRef(new Map<number, HTMLButtonElement>())
  const lastOpenTeamIdRef = useRef<number | null>(null)
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

  const detailTeamId = parseTeamParam(searchParams.get('team'))
  // The loaded page counts as part of the directory even before the accumulated list state syncs
  const detailTeamResolved =
    detailTeamId !== null &&
    ((teamsData?.teams.some((t) => t.id === detailTeamId) ?? false) ||
      teams.some((t) => t.id === detailTeamId) ||
      pinnedTeam?.id === detailTeamId)
  const mobileView: 'list' | 'detail' = detailTeamResolved ? 'detail' : 'list'

  // Retain selected team if still in current result set, or pick first team if unselected or missing
  useEffect(() => {
    if (detailTeamResolved && selectedTeamId !== detailTeamId) {
      setSelectedTeamId(detailTeamId)
      return
    }
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
  }, [teams, selectedTeamId, qParam, pinnedTeam, detailTeamResolved, detailTeamId])

  // Drop a ?team= id the loaded directory cannot resolve, so no phantom detail survives
  useEffect(() => {
    if (detailTeamId === null || detailTeamResolved) return
    if (teamsLoading || teamsError) return
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.delete('team')
        return next
      },
      { replace: true },
    )
  }, [detailTeamId, detailTeamResolved, teamsLoading, teamsError, setSearchParams])

  // Move focus and scroll only where the drill-down replaces the directory (single column)
  useEffect(() => {
    const singleColumn =
      typeof window !== 'undefined' && window.matchMedia('(max-width: 1024px)').matches

    if (!detailTeamResolved || detailTeamId === null) {
      const previousId = lastOpenTeamIdRef.current
      lastOpenTeamIdRef.current = null
      if (singleColumn && previousId !== null) directoryItemEls.current.get(previousId)?.focus()
      return
    }

    if (lastOpenTeamIdRef.current === detailTeamId) return

    // A deep-linked detail mounts the roster heading only once the selected team is applied to it,
    // so wait for the panel rather than focusing nothing (this effect re-runs when selection lands)
    if (singleColumn && !detailHeadingRef.current) return

    lastOpenTeamIdRef.current = detailTeamId
    if (!singleColumn) return
    window.scrollTo({ top: 0 })
    detailHeadingRef.current?.focus()
  }, [detailTeamResolved, detailTeamId, selectedTeamId])

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

  const openTeamInUrl = (teamId: number): void => {
    const singleColumn =
      typeof window !== 'undefined' && window.matchMedia('(max-width: 1024px)').matches
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.set('team', String(teamId))
        return next
      },
      { replace: !singleColumn },
    )
  }

  const handleBackToDirectory = (): void => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      next.delete('team')
      return next
    })
  }

  // Reset member form feedback when selected team changes
  const handleSelectTeam = (id: number): void => {
    selectedTeamIdRef.current = id
    setSelectedTeamId(id)
    setPinnedTeam(null)
    setMemberError(null)
    setMemberSuccess(null)
    setSelectedUser(null)
    setRemovalError(null)
    setRemovalSuccess(null)
    setRosterError(null)
    setRosterSuccess(null)
    setMemberToRemove(null)
    openTeamInUrl(id)
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
      openTeamInUrl(res.team.id)
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
    <div
      className="admin-teams-page"
      data-mobile-view={mobileView}
      style={{ ...commonStyles.pageContainer, maxWidth: '100%', boxSizing: 'border-box' }}
    >
      <style>{adminTeamsStyles}</style>

      <header className="admin-teams-header">
        <div className="admin-teams-header-text">
          <h1 className="admin-teams-title">Teams</h1>
          <p className="admin-teams-subtitle">
            Manage organizational teams, inspect member rosters, and assign roles.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setShowCreateTeam(true)
            setTeamError(null)
          }}
          className="admin-teams-create-btn"
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

      <div className="admin-teams-workbench">
        <TeamsDirectory
          teams={teams}
          visibleTeams={visibleTeams}
          selectedTeamId={selectedTeamId}
          onSelectTeam={handleSelectTeam}
          searchInput={searchInput}
          onSearchChange={handleDirectorySearchChange}
          effectiveQ={effectiveQ}
          teamsLoading={teamsLoading}
          teamsFetching={teamsFetching}
          teamsError={teamsError}
          nextCursor={teamsData?.nextCursor ?? null}
          onLoadMore={() => setTeamsCursor(teamsData?.nextCursor ?? undefined)}
          itemEls={directoryItemEls}
        />

        <TeamRoster
          selectedTeam={selectedTeam}
          visibleTeams={visibleTeams}
          memberFilter={memberFilter}
          onMemberFilterChange={setMemberFilter}
          onOpenAddMember={() => {
            setShowAddMember(true)
            setMemberError(null)
          }}
          rosterSuccess={rosterSuccess}
          removalSuccess={removalSuccess}
          rosterError={rosterError}
          removalError={removalError}
          teamMembersLoading={teamMembersLoading}
          teamMembersFetching={teamMembersFetching}
          teamMembersError={teamMembersError}
          rosterMembers={rosterMembers}
          visibleMembers={visibleMembers}
          updatingMemberUserId={updatingMemberUserId}
          isRemoving={removeMemberMutation.isPending}
          memberToRemoveId={memberToRemove?.id ?? null}
          onRoleChange={handleRoleChange}
          onRemoveMember={handleRemoveMember}
          nextCursor={teamMembersData?.nextCursor ?? null}
          onLoadMore={() => setRosterCursor(teamMembersData?.nextCursor ?? undefined)}
          memberInitials={memberInitials}
          onBackToDirectory={handleBackToDirectory}
          headingRef={detailHeadingRef}
        />
      </div>

      <TeamModals
        showCreateTeam={showCreateTeam}
        onCloseCreateTeam={() => {
          setShowCreateTeam(false)
          setTeamError(null)
        }}
        teamName={teamName}
        teamSlug={teamSlug}
        onTeamNameChange={(val) => {
          const prevNormalized = normalizeSlug(teamName)
          setTeamName(val)
          if (!teamSlug || teamSlug === prevNormalized) {
            setTeamSlug(normalizeSlug(val))
          }
        }}
        onTeamSlugChange={(val) => setTeamSlug(val.toLowerCase())}
        teamError={teamError}
        isCreatingTeam={createTeamMutation.isPending}
        onCreateTeamSubmit={handleCreateTeamSubmit}
        showAddMember={showAddMember}
        onCloseAddMember={() => {
          setShowAddMember(false)
          setMemberError(null)
        }}
        selectedTeam={selectedTeam}
        selectedUser={selectedUser}
        onSelectUser={setSelectedUser}
        selectedRole={selectedRole}
        onRoleChange={setSelectedRole}
        memberSuccess={memberSuccess}
        memberError={memberError}
        pickerSearch={pickerSearch}
        onPickerSearchChange={(val) => {
          setPickerSearch(val)
          setPickerCursor(undefined)
          setPickerUsers([])
        }}
        pickerUsers={pickerUsers}
        pickerLoading={pickerLoading}
        pickerFetching={pickerFetching}
        pickerError={pickerError}
        pickerNextCursor={pickerData?.nextCursor ?? null}
        onLoadMoreUsers={() => setPickerCursor(pickerData?.nextCursor ?? undefined)}
        isAddingMember={addMemberMutation.isPending}
        onAddMemberSubmit={handleAddMemberSubmit}
        memberInitials={memberInitials}
      />
    </div>
  )
}
