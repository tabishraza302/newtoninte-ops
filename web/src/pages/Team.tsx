import React, { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import {
  useMe,
  useTeams,
  useTeamMembers,
  useSetMemberRole,
  useRemoveMember,
  useTeamInvitations,
  useCreateInvitation,
  useRevokeInvitation,
} from '../api/hooks'
import {
  type Role,
  type Team,
  type TeamMember,
  type TeamInvitation,
  ROLES,
} from '../api/types'
import { useAuth } from '../auth/AuthContext'
import { commonStyles, theme, getApiErrorMessage } from '../theme'

export function Team(): React.ReactElement {
  const { id } = useParams<{ id?: string }>()
  const navigate = useNavigate()
  const { user, status: authStatus } = useAuth()
  const { data: teamsData, isLoading: teamsLoading, error: teamsError, refetch: refetchTeams } = useTeams()
  const { data: meData, isLoading: meLoading, error: meError, refetch: refetchMe } = useMe()

  const hasIdParam = id !== undefined
  const isPositiveIntFormat = hasIdParam && typeof id === 'string' && /^\d+$/.test(id.trim())
  const paramNum = isPositiveIntFormat ? Number(id.trim()) : undefined
  const isValidPositiveInt = isPositiveIntFormat && Number.isSafeInteger(paramNum) && (paramNum ?? 0) > 0

  const userMemberships = meData?.memberships ?? []
  const teams = teamsData?.teams ?? []

  // Resolve active team
  const activeTeamId = hasIdParam
    ? isValidPositiveInt
      ? paramNum
      : undefined
    : (userMemberships.length > 0 ? userMemberships[0]?.teamId : teams[0]?.id)

  const activeTeam = teams.find((t) => t.id === activeTeamId)
  const currentMembership = userMemberships.find((m) => m.teamId === activeTeamId)
  const userRole: Role = currentMembership?.role ?? 'viewer'
  const isLead = userRole === 'lead'
  // Invitations state
  const [showInviteModal, setShowInviteModal] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<Role>('member')
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [inviteSuccess, setInviteSuccess] = useState<string | null>(null)

  const inviteTriggerRef = useRef<HTMLButtonElement>(null)
  const inviteModalRef = useRef<HTMLDivElement>(null)
  const inviteEmailInputRef = useRef<HTMLInputElement>(null)
  const wasInviteOpenRef = useRef(false)
  const sectionRef = useRef<HTMLDivElement>(null)
  const [sectionCenter, setSectionCenter] = useState<{ x: number; y: number } | null>(null)
  // Member actions error/success
  const [memberActionError, setMemberActionError] = useState<string | null>(null)
  const [memberActionSuccess, setMemberActionSuccess] = useState<string | null>(null)

  // Cursor pagination for members
  const [memberCursor, setMemberCursor] = useState<string | undefined>(undefined)
  const [allMembers, setAllMembers] = useState<TeamMember[]>([])

  const membersQueryParam = memberCursor ? { cursor: memberCursor, limit: 20 } : { limit: 20 }
  const {
    data: membersData,
    isLoading: membersLoading,
    isFetching: membersFetching,
    error: membersError,
    refetch: refetchMembers,
  } = useTeamMembers(activeTeamId ?? 0, membersQueryParam, { enabled: !!activeTeamId })
  // Cursor pagination for invitations
  const [inviteCursor, setInviteCursor] = useState<string | undefined>(undefined)
  const [allInvitations, setAllInvitations] = useState<TeamInvitation[]>([])

  const inviteQueryParam = inviteCursor ? { cursor: inviteCursor, limit: 20 } : { limit: 20 }
  const {
    data: invitationsData,
    isLoading: invitationsLoading,
    isFetching: invitationsFetching,
    error: invitationsError,
    refetch: refetchInvitations,
  } = useTeamInvitations(activeTeamId ?? 0, inviteQueryParam, { enabled: !!activeTeamId && isLead })

  const setRoleMutation = useSetMemberRole()
  const removeMemberMutation = useRemoveMember()
  const createInviteMutation = useCreateInvitation()
  const revokeInviteMutation = useRevokeInvitation()

  // Reset pagination and members when active team changes
  useEffect(() => {
    setMemberCursor(undefined)
    setAllMembers([])
    setInviteCursor(undefined)
    setAllInvitations([])
    setMemberActionError(null)
    setMemberActionSuccess(null)
    setInviteError(null)
    setInviteSuccess(null)
    setShowInviteModal(false)
    setInviteEmail('')
    setInviteRole('member')
  }, [activeTeamId])

  // Accumulate invitations as pages are loaded
  useEffect(() => {
    if (invitationsData?.invitations) {
      if (!inviteCursor) {
        setAllInvitations(invitationsData.invitations)
      } else {
        setAllInvitations((prev) => {
          const freshIds = new Set(invitationsData.invitations.map((i) => i.id))
          const existing = prev.filter((i) => !freshIds.has(i.id))
          return [...existing, ...invitationsData.invitations]
        })
      }
    }
  }, [invitationsData, inviteCursor])

  // Accumulate members as pages are loaded
  useEffect(() => {
    if (membersData?.members) {
      if (!memberCursor) {
        setAllMembers(membersData.members)
      } else {
        setAllMembers((prev) => {
          const freshIds = new Set(membersData.members.map((m) => m.id))
          const existing = prev.filter((m) => !freshIds.has(m.id))
          return [...existing, ...membersData.members]
        })
      }
    }
  }, [membersData, memberCursor])

  useEffect(() => {
    if (!showInviteModal && wasInviteOpenRef.current) {
      inviteTriggerRef.current?.focus()
    }
    wasInviteOpenRef.current = showInviteModal
  }, [showInviteModal])

  useEffect(() => {
    if (showInviteModal && isLead) {
      inviteEmailInputRef.current?.focus()
    }
  }, [showInviteModal, isLead])

  useEffect(() => {
    if (!showInviteModal || !isLead) return
    const mainColumn = document.querySelector<HTMLElement>('.app-main-column')
    const originalOverflow = document.body.style.overflow
    const originalMainOverflow = mainColumn?.style.overflowY ?? ''
    // The app shell scrolls inside .app-main-column, not body, so lock both.
    document.body.style.overflow = 'hidden'
    if (mainColumn) mainColumn.style.overflowY = 'hidden'
    return () => {
      document.body.style.overflow = originalOverflow
      if (mainColumn) mainColumn.style.overflowY = originalMainOverflow
    }
  }, [showInviteModal, isLead])


  useEffect(() => {
    if (!showInviteModal) return

    const updateCenter = (): void => {
      if (!sectionRef.current) return
      const rect = sectionRef.current.getBoundingClientRect()
      if (rect.width === 0) return
      const centerX = rect.left + rect.width / 2
      const visibleTop = Math.max(rect.top, 0)
      const visibleBottom = Math.min(rect.bottom, window.innerHeight)
      const centerY = visibleBottom > visibleTop ? (visibleTop + visibleBottom) / 2 : rect.top + rect.height / 2
      setSectionCenter({ x: centerX, y: centerY })
    }

    updateCenter()
    window.addEventListener('resize', updateCenter)
    window.addEventListener('scroll', updateCenter, true)
    return () => {
      window.removeEventListener('resize', updateCenter)
      window.removeEventListener('scroll', updateCenter, true)
    }
  }, [showInviteModal])
  useEffect(() => {
    if (!showInviteModal || !isLead) return

    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        if (createInviteMutation.isPending) return
        e.preventDefault()
        setShowInviteModal(false)
        setInviteEmail('')
        setInviteRole('member')
        setInviteError(null)
        return
      }

      if (e.key === 'Tab') {
        const focusables = Array.from(
          inviteModalRef.current?.querySelectorAll<HTMLElement>(
            'select:not([disabled]), button:not([disabled]), input:not([disabled]), [href], textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
          ) ?? [],
        )

        if (focusables.length === 0) {
          e.preventDefault()
          inviteModalRef.current?.focus()
          return
        }

        const first = focusables[0]
        const last = focusables[focusables.length - 1]
        if (!first || !last) return

        if (e.shiftKey) {
          if (document.activeElement === first || !inviteModalRef.current?.contains(document.activeElement)) {
            e.preventDefault()
            last.focus()
          }
        } else {
          if (document.activeElement === last || !inviteModalRef.current?.contains(document.activeElement)) {
            e.preventDefault()
            first.focus()
          }
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [showInviteModal, isLead, createInviteMutation.isPending])

  const handleCloseInviteModal = (): void => {
    if (createInviteMutation.isPending) return
    setShowInviteModal(false)
    setInviteEmail('')
    setInviteRole('member')
    setInviteError(null)
  }

  const handleRoleChange = async (member: TeamMember, newRole: Role): Promise<void> => {
    if (!activeTeamId || member.role === newRole) return
    setMemberActionError(null)
    setMemberActionSuccess(null)

    try {
      await setRoleMutation.mutateAsync({
        teamId: activeTeamId,
        userId: member.userId,
        role: newRole,
      })
      setMemberActionSuccess(`Updated role for ${member.user.displayName} to ${newRole}.`)
      setAllMembers((members) =>
        members.map((current) => current.id === member.id ? { ...current, role: newRole } : current),
      )
      void refetchMe()
    } catch (err) {
      setMemberActionError(getApiErrorMessage(err, 'Failed to update member role.'))
    }
  }

  const handleRemoveMember = async (member: TeamMember): Promise<void> => {
    if (!activeTeamId) return
    const confirmed = window.confirm(
      `Remove ${member.user.displayName} from ${activeTeam?.name ?? 'the team'}? They will lose access to team work items.`,
    )
    if (!confirmed) return

    setMemberActionError(null)
    setMemberActionSuccess(null)

    try {
      await removeMemberMutation.mutateAsync({
        teamId: activeTeamId,
        userId: member.userId,
      })
      setMemberActionSuccess(`Removed ${member.user.displayName} from the team.`)
      setAllMembers((members) => members.filter((current) => current.id !== member.id))
      void refetchMe()
      void refetchTeams()
    } catch (err) {
      setMemberActionError(getApiErrorMessage(err, 'Failed to remove member.'))
    }
  }

  const handleCreateInvitation = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    if (!activeTeamId) return

    setInviteError(null)

    const trimmedEmail = inviteEmail.trim()
    if (!trimmedEmail) {
      setInviteError('Please enter an email address.')
      return
    }

    try {
      const res = await createInviteMutation.mutateAsync({
        teamId: activeTeamId,
        email: trimmedEmail,
        role: inviteRole,
      })

      setInviteSuccess(`Invitation sent to ${trimmedEmail} (${inviteRole}).`)
      setInviteEmail('')
      setInviteRole('member')
      setShowInviteModal(false)
      setInviteCursor(undefined)
      if (res?.invitation) {
        setAllInvitations((prev) => [res.invitation, ...prev.filter((i) => i.id !== res.invitation.id)])
      }
      void refetchInvitations()
    } catch (err) {
      setInviteError(getApiErrorMessage(err, 'Failed to send invitation.'))
    }
  }

  const handleRevokeInvitation = async (invitation: TeamInvitation): Promise<void> => {
    setInviteError(null)
    setInviteSuccess(null)

    try {
      await revokeInviteMutation.mutateAsync(invitation.id)
      setInviteSuccess(`Revoked invitation for ${invitation.email}.`)
      setAllInvitations((prev) =>
        prev.map((i) => (i.id === invitation.id ? { ...i, revokedAt: new Date().toISOString() } : i)),
      )
      void refetchInvitations()
    } catch (err) {
      setInviteError(getApiErrorMessage(err, 'Failed to revoke invitation.'))
    }
  }
  if (authStatus === 'loading' || meLoading || teamsLoading) {
    return (
      <div style={commonStyles.pageContainer}>
        <div role="status" style={{ padding: '3rem', textAlign: 'center', color: theme.colors.textMuted }}>
          Loading team details…
        </div>
      </div>
    )
  }

  if (meError || teamsError) {
    const errorMsg = getApiErrorMessage(meError || teamsError, 'Failed to load team data.')
    return (
      <div style={commonStyles.pageContainer}>
        <header style={{ marginBottom: '1.5rem' }}>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 800, color: theme.colors.textPrimary, margin: 0 }}>
            Team Management
          </h1>
        </header>
        <div
          role="alert"
          style={{
            ...commonStyles.cardPadded,
            textAlign: 'center',
            borderColor: '#fca5a5',
            backgroundColor: '#fef2f2',
            padding: '2rem 1.5rem',
          }}
        >
          <p style={{ color: '#991b1b', fontWeight: 600, margin: '0 0 0.5rem', fontSize: '1rem' }}>
            Failed to load team data
          </p>
          <p style={{ color: '#b91c1c', margin: '0 0 1.25rem', fontSize: '0.875rem' }}>
            {errorMsg}
          </p>
          <button
            type="button"
            onClick={() => {
              if (meError) void refetchMe()
              if (teamsError) void refetchTeams()
            }}
            style={commonStyles.buttonSecondary}
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  if (!user) {
    return (
      <div style={commonStyles.narrowContainer}>
        <div role="alert" style={{ ...commonStyles.alertError, padding: '1.5rem', textAlign: 'center' }}>
          Please log in to view team memberships.
        </div>
      </div>
    )
  }

  if (hasIdParam && !isValidPositiveInt) {
    return (
      <div style={commonStyles.narrowContainer}>
        <div role="alert" style={{ ...commonStyles.cardPadded, textAlign: 'center', padding: '3rem 1.5rem' }}>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.5rem', color: theme.colors.textPrimary }}>
            Invalid Team Identifier
          </h1>
          <p style={{ color: theme.colors.textMuted, marginBottom: '1.5rem', fontSize: '0.9375rem' }}>
            The team identifier &quot;{id}&quot; is invalid. Team identifiers must be positive integers.
          </p>
          <Link to="/teams" style={commonStyles.buttonSecondary}>
            View Available Teams
          </Link>
        </div>
      </div>
    )
  }

  if (hasIdParam && isValidPositiveInt && !activeTeam) {
    return (
      <div style={commonStyles.narrowContainer}>
        <div role="alert" style={{ ...commonStyles.cardPadded, textAlign: 'center', padding: '3rem 1.5rem' }}>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.5rem', color: theme.colors.textPrimary }}>
            Team Not Found
          </h1>
          <p style={{ color: theme.colors.textMuted, marginBottom: '1.5rem', fontSize: '0.9375rem' }}>
            Team #{paramNum} could not be found or you do not have permission to access it.
          </p>
          <Link to="/teams" style={commonStyles.buttonSecondary}>
            View Available Teams
          </Link>
        </div>
      </div>
    )
  }

  if (teams.length === 0) {
    return (
      <div style={commonStyles.pageContainer}>
        <header style={{ marginBottom: '1.5rem' }}>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 800, color: theme.colors.textPrimary, margin: 0 }}>
            Team Management
          </h1>
        </header>
        <div
          role="status"
          style={{
            ...commonStyles.cardPadded,
            textAlign: 'center',
            color: theme.colors.textMuted,
          }}
        >
          <p style={{ margin: 0, fontSize: '0.9375rem' }}>
            You do not currently belong to any teams. Contact a platform administrator to join a team or receive an invitation.
          </p>
        </div>
      </div>
    )
  }

  return (
    <>
      <div
        ref={sectionRef}
        className="team-page"
        style={commonStyles.pageContainer}
        inert={showInviteModal && isLead ? true : undefined}
        aria-hidden={showInviteModal && isLead ? 'true' : undefined}
      >
      {/* Team Selection Bar if multiple teams */}
      {teams.length > 1 && (
        <nav
          aria-label="Team switcher"
          style={{
            display: 'flex',
            gap: '0.5rem',
            marginBottom: '1.5rem',
            overflowX: 'auto',
            paddingBottom: '0.25rem',
          }}
        >
          {teams.map((t) => {
            const isSelected = t.id === activeTeamId
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => navigate(`/teams/${t.id}`)}
                style={{
                  padding: '0.45rem 0.85rem',
                  borderRadius: '6px',
                  fontSize: '0.8125rem',
                  fontWeight: isSelected ? 600 : 500,
                  backgroundColor: isSelected ? theme.colors.accent : '#ffffff',
                  color: isSelected ? '#ffffff' : theme.colors.textSecondary,
                  border: isSelected ? `1px solid ${theme.colors.accent}` : `1px solid ${theme.colors.border}`,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  whiteSpace: 'nowrap',
                  transition: 'all 0.15s ease',
                }}
              >
                {t.name}
              </button>
            )
          })}
        </nav>
      )}

      {/* Team Header */}
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          flexWrap: 'wrap',
          gap: '1rem',
          marginBottom: '1.75rem',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.25rem' }}>
            <h1
              style={{
                fontSize: '1.75rem',
                fontWeight: 800,
                color: theme.colors.textPrimary,
                margin: 0,
                letterSpacing: '-0.02em',
              }}
            >
              {activeTeam?.name ?? 'Team Workspace'}
            </h1>
            <span
              style={{
                display: 'inline-block',
                padding: '0.2rem 0.55rem',
                borderRadius: '9999px',
                fontSize: '0.6875rem',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                backgroundColor: isLead ? '#ecfdf5' : '#f0fdfa',
                color: isLead ? '#047857' : '#0f766e',
                border: isLead ? '1px solid #a7f3d0' : '1px solid #ccfbf1',
              }}
            >
              Your Role: {userRole}
            </span>
          </div>
          <p style={{ color: theme.colors.textMuted, fontSize: '0.875rem', margin: 0 }}>
            {activeTeam?.slug ? (
              <span>
                Team identifier: <code style={{ fontVariantNumeric: 'tabular-nums' }}>{activeTeam.slug}</code>
              </span>
            ) : (
              'Manage members and invitations for your team'
            )}
          </p>
        </div>

        {isLead && (
          <button
            ref={inviteTriggerRef}
            type="button"
            onClick={() => {
              setInviteError(null)
              setInviteSuccess(null)
              setInviteEmail('')
              setInviteRole('member')
              setShowInviteModal(true)
            }}
            style={commonStyles.buttonPrimary}
          >
            <span>+ Invite Member</span>
          </button>
        )}
      </header>


      {/* Status Messages */}
      {inviteSuccess && (
        <div role="status" style={{ ...commonStyles.alertError, backgroundColor: '#f0fdf4', borderColor: '#bbf7d0', color: '#166534', marginBottom: '1.5rem' }}>
          {inviteSuccess}
        </div>
      )}

      {memberActionSuccess && (
        <div role="status" style={{ ...commonStyles.alertError, backgroundColor: '#f0fdf4', borderColor: '#bbf7d0', color: '#166534', marginBottom: '1.5rem' }}>
          {memberActionSuccess}
        </div>
      )}

      {memberActionError && (
        <div role="alert" style={{ ...commonStyles.alertError, marginBottom: '1.5rem' }}>
          {memberActionError}
        </div>
      )}

      {/* Members Section */}
      <section aria-label="Team Members" style={{ marginBottom: '2.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.875rem' }}>
          <h2 style={{ fontSize: '1.125rem', fontWeight: 700, color: theme.colors.textPrimary, margin: 0 }}>
            Members ({allMembers.length})
          </h2>
          {!isLead && (
            <span style={{ fontSize: '0.75rem', color: theme.colors.textMuted }}>
              Read-only view • Team lead role required to modify memberships
            </span>
          )}
        </div>

        {membersLoading && allMembers.length === 0 ? (
          <div role="status" style={{ ...commonStyles.cardPadded, textAlign: 'center', color: theme.colors.textMuted }}>
            Loading team members…
          </div>
        ) : membersError ? (
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
            <span>Failed to load members: {getApiErrorMessage(membersError)}</span>
            <button
              type="button"
              onClick={() => void refetchMembers()}
              style={{
                ...commonStyles.buttonSecondary,
                fontSize: '0.8125rem',
                padding: '0.35rem 0.75rem',
                whiteSpace: 'nowrap',
              }}
            >
              Retry
            </button>
          </div>
        ) : allMembers.length === 0 ? (
          <div role="status" style={{ ...commonStyles.cardPadded, textAlign: 'center', color: theme.colors.textMuted }}>
            No members found for this team.
          </div>
        ) : (
          <div
            style={{
              backgroundColor: '#ffffff',
              border: `1px solid ${theme.colors.border}`,
              borderRadius: '12px',
              overflow: 'hidden',
              boxShadow: theme.shadows.sm,
            }}
          >
            <div style={{ overflowX: 'auto' }}>
              <table
                style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  textAlign: 'left',
                  fontSize: '0.875rem',
                }}
              >
                <thead>
                  <tr
                    style={{
                      borderBottom: `1px solid ${theme.colors.border}`,
                      backgroundColor: theme.colors.bgCardMuted,
                      color: theme.colors.textSecondary,
                      fontSize: '0.75rem',
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                    }}
                  >
                    <th style={{ padding: '0.75rem 1rem' }}>User</th>
                    <th style={{ padding: '0.75rem 1rem' }}>Email</th>
                    <th style={{ padding: '0.75rem 1rem' }}>Role</th>
                    <th style={{ padding: '0.75rem 1rem' }}>Joined Date</th>
                    {isLead && <th style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {allMembers.map((member) => {
                    const isSelf = member.userId === user.id
                    return (
                      <tr
                        key={member.id}
                        data-testid={`member-row-${member.userId}`}
                        style={{
                          borderBottom: `1px solid ${theme.colors.border}`,
                          transition: 'background-color 0.15s ease',
                        }}
                      >
                        <td style={{ padding: '0.85rem 1rem', fontWeight: 600, color: theme.colors.textPrimary }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <span>{member.user.displayName}</span>
                            {isSelf && (
                              <span
                                style={{
                                  fontSize: '0.6875rem',
                                  fontWeight: 600,
                                  padding: '0.1rem 0.4rem',
                                  borderRadius: '4px',
                                  backgroundColor: theme.colors.accentSubtle,
                                  color: theme.colors.accent,
                                }}
                              >
                                You
                              </span>
                            )}
                          </div>
                        </td>
                        <td style={{ padding: '0.85rem 1rem', color: theme.colors.textSecondary }}>
                          {member.user.email}
                        </td>
                        <td style={{ padding: '0.85rem 1rem' }}>
                          {isLead ? (
                            <select
                              aria-label={`Change role for ${member.user.displayName}`}
                              value={member.role}
                              disabled={setRoleMutation.isPending}
                              onChange={(e) => void handleRoleChange(member, e.target.value as Role)}
                              style={{
                                padding: '0.25rem 0.5rem',
                                borderRadius: '4px',
                                border: `1px solid ${theme.colors.borderStrong}`,
                                fontSize: '0.8125rem',
                                fontWeight: 500,
                                backgroundColor: '#ffffff',
                                cursor: 'pointer',
                              }}
                            >
                              {ROLES.map((r) => (
                                <option key={r} value={r}>
                                  {r.charAt(0).toUpperCase() + r.slice(1)}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <span
                              style={{
                                display: 'inline-block',
                                padding: '0.15rem 0.5rem',
                                borderRadius: '4px',
                                fontSize: '0.75rem',
                                fontWeight: 600,
                                textTransform: 'capitalize',
                                backgroundColor:
                                  member.role === 'lead'
                                    ? '#ecfdf5'
                                    : member.role === 'member'
                                      ? '#f0fdfa'
                                      : '#f8fafc',
                                color:
                                  member.role === 'lead'
                                    ? '#047857'
                                    : member.role === 'member'
                                      ? '#0f766e'
                                      : '#64748b',
                                border: `1px solid ${
                                  member.role === 'lead'
                                    ? '#a7f3d0'
                                    : member.role === 'member'
                                      ? '#ccfbf1'
                                      : '#e2e8f0'
                                }`,
                              }}
                            >
                              {member.role}
                            </span>
                          )}
                        </td>
                        <td
                          style={{
                            padding: '0.85rem 1rem',
                            color: theme.colors.textMuted,
                            fontSize: '0.8125rem',
                            fontVariantNumeric: 'tabular-nums',
                          }}
                        >
                          {new Date(member.createdAt).toLocaleDateString()}
                        </td>
                        {isLead && (
                          <td style={{ padding: '0.85rem 1rem', textAlign: 'right' }}>
                            <button
                              type="button"
                              aria-label={`Remove ${member.user.displayName}`}
                              disabled={removeMemberMutation.isPending}
                              onClick={() => void handleRemoveMember(member)}
                              style={{
                                background: 'transparent',
                                border: '1px solid #fecaca',
                                borderRadius: '4px',
                                color: '#dc2626',
                                fontSize: '0.75rem',
                                fontWeight: 600,
                                padding: '0.25rem 0.5rem',
                                cursor: 'pointer',
                                fontFamily: 'inherit',
                                transition: 'all 0.15s ease',
                              }}
                            >
                              Remove
                            </button>
                          </td>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Keyset Cursor Pagination */}
            {membersData?.nextCursor && (
              <div
                style={{
                  padding: '0.85rem',
                  borderTop: `1px solid ${theme.colors.border}`,
                  textAlign: 'center',
                  backgroundColor: theme.colors.bgCardMuted,
                }}
              >
                <button
                  type="button"
                  disabled={membersFetching}
                  onClick={() => setMemberCursor(membersData.nextCursor ?? undefined)}
                  style={{
                    ...commonStyles.buttonSecondary,
                    padding: '0.4rem 1rem',
                    fontSize: '0.8125rem',
                  }}
                >
                  {membersFetching ? 'Loading more members…' : 'Load More Members'}
                </button>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Invitations Section (Lead Only) */}
      {isLead && (
        <section aria-label="Team Invitations">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.875rem' }}>
            <h2 style={{ fontSize: '1.125rem', fontWeight: 700, color: theme.colors.textPrimary, margin: 0 }}>
              Active Invitations
            </h2>
            <span style={{ fontSize: '0.75rem', color: theme.colors.textMuted }}>
              Single-use invitations pending redemption
            </span>
          </div>

          {invitationsLoading ? (
            <div role="status" style={{ ...commonStyles.cardPadded, textAlign: 'center', color: theme.colors.textMuted }}>
              Loading team invitations…
            </div>
          ) : invitationsError ? (
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
              <span>Failed to load invitations: {getApiErrorMessage(invitationsError)}</span>
              <button
                type="button"
                onClick={() => void refetchInvitations()}
                style={{
                  ...commonStyles.buttonSecondary,
                  fontSize: '0.8125rem',
                  padding: '0.35rem 0.75rem',
                  whiteSpace: 'nowrap',
                }}
              >
                Retry
              </button>
            </div>
          ) : allInvitations.length === 0 ? (
            <div
              role="status"
              style={{
                ...commonStyles.cardPadded,
                textAlign: 'center',
                color: theme.colors.textMuted,
                fontSize: '0.875rem',
              }}
            >
              No active invitations for this team. Click &quot;+ Invite Member&quot; above to invite colleagues.
            </div>
          ) : (
            <div
              style={{
                backgroundColor: '#ffffff',
                border: `1px solid ${theme.colors.border}`,
                borderRadius: '12px',
                overflow: 'hidden',
                boxShadow: theme.shadows.sm,
              }}
            >
              <div style={{ overflowX: 'auto' }}>
                <table
                  style={{
                    width: '100%',
                    borderCollapse: 'collapse',
                    textAlign: 'left',
                    fontSize: '0.875rem',
                  }}
                >
                  <thead>
                    <tr
                      style={{
                        borderBottom: `1px solid ${theme.colors.border}`,
                        backgroundColor: theme.colors.bgCardMuted,
                        color: theme.colors.textSecondary,
                        fontSize: '0.75rem',
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        letterSpacing: '0.04em',
                      }}
                    >
                      <th style={{ padding: '0.75rem 1rem' }}>Invited Email</th>
                      <th style={{ padding: '0.75rem 1rem' }}>Target Role</th>
                      <th style={{ padding: '0.75rem 1rem' }}>Status</th>
                      <th style={{ padding: '0.75rem 1rem' }}>Expires</th>
                      <th style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allInvitations.map((inv) => {
                      const isRevoked = !!inv.revokedAt
                      const isExpired = inv.expiresAt ? new Date(inv.expiresAt) < new Date() : false
                      const isExhausted = inv.uses >= 1

                      let statusBadge = (
                        <span style={{ color: '#047857', fontWeight: 600, fontSize: '0.75rem' }}>Active</span>
                      )
                      if (isRevoked) {
                        statusBadge = <span style={{ color: '#dc2626', fontSize: '0.75rem' }}>Revoked</span>
                      } else if (isExpired) {
                        statusBadge = <span style={{ color: '#94a3b8', fontSize: '0.75rem' }}>Expired</span>
                      } else if (isExhausted) {
                        statusBadge = <span style={{ color: '#64748b', fontSize: '0.75rem' }}>Redeemed</span>
                      }

                      return (
                        <tr
                          key={inv.id}
                          data-testid={`invitation-row-${inv.id}`}
                          style={{
                            borderBottom: `1px solid ${theme.colors.border}`,
                            opacity: isRevoked || isExpired || isExhausted ? 0.6 : 1,
                          }}
                        >
                          <td style={{ padding: '0.85rem 1rem', fontWeight: 600, color: theme.colors.textPrimary }}>
                            {inv.email}
                          </td>
                          <td style={{ padding: '0.85rem 1rem' }}>
                            <span
                              style={{
                                display: 'inline-block',
                                padding: '0.15rem 0.5rem',
                                borderRadius: '4px',
                                fontSize: '0.75rem',
                                fontWeight: 600,
                                textTransform: 'capitalize',
                                backgroundColor: theme.colors.accentSubtle,
                                color: theme.colors.accent,
                                border: `1px solid ${theme.colors.accentBorder}`,
                              }}
                            >
                              {inv.role}
                            </span>
                          </td>
                          <td style={{ padding: '0.85rem 1rem' }}>
                            {statusBadge}
                          </td>
                          <td style={{ padding: '0.85rem 1rem', fontVariantNumeric: 'tabular-nums', color: theme.colors.textMuted, fontSize: '0.8125rem' }}>
                            {inv.expiresAt ? new Date(inv.expiresAt).toLocaleDateString() : 'Never'}
                          </td>
                          <td style={{ padding: '0.85rem 1rem', textAlign: 'right' }}>
                            {!isRevoked && !isExpired && !isExhausted ? (
                              <button
                                type="button"
                                aria-label={`Revoke invitation for ${inv.email}`}
                                disabled={revokeInviteMutation.isPending}
                                onClick={() => void handleRevokeInvitation(inv)}
                                style={{
                                  background: 'transparent',
                                  border: '1px solid #cbd5e1',
                                  borderRadius: '4px',
                                  color: '#64748b',
                                  fontSize: '0.75rem',
                                  fontWeight: 500,
                                  padding: '0.25rem 0.5rem',
                                  cursor: 'pointer',
                                  fontFamily: 'inherit',
                                }}
                              >
                                Revoke
                              </button>
                            ) : (
                              <span style={{ color: theme.colors.textMuted }}>—</span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {invitationsData?.nextCursor && (
                <div
                  style={{
                    padding: '0.85rem',
                    borderTop: `1px solid ${theme.colors.border}`,
                    textAlign: 'center',
                    backgroundColor: theme.colors.bgCardMuted,
                  }}
                >
                  <button
                    type="button"
                    disabled={invitationsFetching}
                    onClick={() => setInviteCursor(invitationsData.nextCursor ?? undefined)}
                    style={{
                      ...commonStyles.buttonSecondary,
                      padding: '0.4rem 1rem',
                      fontSize: '0.8125rem',
                    }}
                  >
                    {invitationsFetching ? 'Loading more invitations…' : 'Load More Invitations'}
                  </button>
                </div>
              )}
            </div>
          )}
        </section>
      )}
      </div>
      {showInviteModal && isLead && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.45)',
            backdropFilter: 'blur(2px)',
            zIndex: 100,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '1rem',
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget && !createInviteMutation.isPending) {
              handleCloseInviteModal()
            }
          }}
        >
          <div
            ref={inviteModalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="invite-member-title"
            aria-describedby="invite-member-description"
            tabIndex={-1}
            style={{
              position: 'absolute',
              left: sectionCenter
                ? `${sectionCenter.x}px`
                : typeof window !== 'undefined' && window.innerWidth <= 768
                  ? '50vw'
                  : 'calc(50vw + 128px)',
              top: sectionCenter ? `${sectionCenter.y}px` : '50vh',
              transform: 'translate(-50%, -50%)',
              backgroundColor: '#ffffff',
              border: `1px solid ${theme.colors.border}`,
              borderRadius: '12px',
              padding: '1.75rem',
              boxSizing: 'border-box',
              width: 'min(520px, calc(100vw - 2rem))',
              maxWidth: '520px',
              maxHeight: 'calc(100dvh - 2rem)',
              overflowY: 'auto',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
              outline: 'none',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                gap: '1rem',
                marginBottom: '1.25rem',
              }}
            >
              <div>
                <h2
                  id="invite-member-title"
                  style={{
                    fontSize: '1.125rem',
                    fontWeight: 700,
                    color: theme.colors.textPrimary,
                    margin: '0 0 0.35rem',
                  }}
                >
                  Invite Member to {activeTeam?.name}
                </h2>
                <p
                  id="invite-member-description"
                  style={{
                    fontSize: '0.8125rem',
                    color: theme.colors.textMuted,
                    margin: 0,
                  }}
                >
                  A single-use invitation link will be emailed to this address. Only the invited account can redeem it.
                </p>
              </div>
              <button
                type="button"
                aria-label="Close dialog"
                disabled={createInviteMutation.isPending}
                onClick={handleCloseInviteModal}
                style={{
                  ...commonStyles.buttonSecondary,
                  padding: '0.35rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  lineHeight: 1,
                  cursor: createInviteMutation.isPending ? 'not-allowed' : 'pointer',
                  opacity: createInviteMutation.isPending ? 0.6 : 1,
                }}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
                  <path
                    d="M4.5 4.5l7 7m0-7l-7 7"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </div>

            {inviteError && (
              <div role="alert" style={{ ...commonStyles.alertError, marginBottom: '1.25rem' }}>
                {inviteError}
              </div>
            )}

            <form onSubmit={(e) => void handleCreateInvitation(e)}>
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '1rem',
                  marginBottom: '1.5rem',
                }}
              >
                <div>
                  <label htmlFor="invite-email" style={commonStyles.label}>
                    Invitee Email Address *
                  </label>
                  <input
                    ref={inviteEmailInputRef}
                    id="invite-email"
                    type="email"
                    required
                    disabled={createInviteMutation.isPending}
                    placeholder="colleague@company.com"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    style={commonStyles.input}
                  />
                </div>

                <div>
                  <label htmlFor="invite-role" style={commonStyles.label}>
                    Initial Team Role *
                  </label>
                  <select
                    id="invite-role"
                    value={inviteRole}
                    disabled={createInviteMutation.isPending}
                    onChange={(e) => setInviteRole(e.target.value as Role)}
                    style={commonStyles.select}
                  >
                    <option value="member">Member (create, edit, claim, comment)</option>
                    <option value="lead">Lead (full team management & approval)</option>
                    <option value="viewer">Viewer (read-only access)</option>
                  </select>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  disabled={createInviteMutation.isPending}
                  onClick={handleCloseInviteModal}
                  style={{
                    ...commonStyles.buttonSecondary,
                    cursor: createInviteMutation.isPending ? 'not-allowed' : 'pointer',
                    opacity: createInviteMutation.isPending ? 0.6 : 1,
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createInviteMutation.isPending}
                  style={{
                    ...commonStyles.buttonPrimary,
                    opacity: createInviteMutation.isPending ? 0.7 : 1,
                    cursor: createInviteMutation.isPending ? 'not-allowed' : 'pointer',
                  }}
                >
                  {createInviteMutation.isPending ? 'Queuing Invitation…' : 'Send Invitation'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}
