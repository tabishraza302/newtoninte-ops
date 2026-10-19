import React from 'react'
import type { Team, AdminTeamMember, Role } from '../../api/types'
import { commonStyles, theme } from '../../theme'

export interface TeamRosterProps {
  selectedTeam: Team | null
  visibleTeams: Team[]
  memberFilter: string
  onMemberFilterChange: (val: string) => void
  onOpenAddMember: () => void
  rosterSuccess: string | null
  removalSuccess: string | null
  rosterError: string | null
  removalError: string | null
  teamMembersLoading: boolean
  teamMembersFetching: boolean
  teamMembersError: Error | null
  rosterMembers: AdminTeamMember[]
  visibleMembers: AdminTeamMember[]
  updatingMemberUserId: number | null
  isRemoving: boolean
  memberToRemoveId: number | null
  onRoleChange: (member: AdminTeamMember, newRole: Role) => void | Promise<void>
  onRemoveMember: (member: AdminTeamMember) => void | Promise<void>
  nextCursor?: string | null
  onLoadMore: () => void
  memberInitials: (name: string) => string
  onBackToDirectory: () => void
  headingRef: React.RefObject<HTMLHeadingElement | null>
}

export function TeamRoster({
  selectedTeam,
  visibleTeams,
  memberFilter,
  onMemberFilterChange,
  onOpenAddMember,
  rosterSuccess,
  removalSuccess,
  rosterError,
  removalError,
  teamMembersLoading,
  teamMembersFetching,
  teamMembersError,
  rosterMembers,
  visibleMembers,
  updatingMemberUserId,
  isRemoving,
  memberToRemoveId,
  onRoleChange,
  onRemoveMember,
  nextCursor,
  onLoadMore,
  memberInitials,
  onBackToDirectory,
  headingRef,
}: TeamRosterProps): React.ReactElement {
  if (!selectedTeam || !visibleTeams.some((t) => t.id === selectedTeam.id)) {
    return (
      <section
        aria-label="Team Roster"
        className="team-roster-panel"
        style={{
          ...commonStyles.cardPadded,
          textAlign: 'center',
          color: '#64748b',
          padding: '4rem 2rem',
        }}
      >
        Select a team from the directory to view its roster.
      </section>
    )
  }

  const teamInitials = selectedTeam.name
    ? selectedTeam.name
        .split(' ')
        .map((p) => p[0])
        .filter(Boolean)
        .slice(0, 2)
        .join('')
        .toUpperCase()
    : 'TM'

  const formattedCreatedDate = selectedTeam.createdAt
    ? new Date(selectedTeam.createdAt).toLocaleDateString()
    : 'Unknown'

  return (
    <div className="team-roster-workspace" style={{ width: '100%', maxWidth: '100%' }}>
      <button type="button" className="team-roster-back" onClick={onBackToDirectory}>
        <svg width="16" height="16" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <path
            d="M12.25 4.75 7 10l5.25 5.25"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        All teams
      </button>

      <section
        aria-label="Team Roster"
        className="team-roster-panel"
        style={{
          ...commonStyles.cardPadded,
          width: '100%',
          maxWidth: '100%',
          boxSizing: 'border-box',
        }}
      >
      {/* Profile Header */}
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
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.875rem' }}>
          <div
            aria-hidden="true"
            style={{
              width: '2.25rem',
              height: '2.25rem',
              borderRadius: '8px',
              backgroundColor: '#f0fdfa',
              color: '#0f766e',
              display: 'grid',
              placeItems: 'center',
              fontWeight: 700,
              fontSize: '0.875rem',
              flexShrink: 0,
              border: '1px solid #ccfbf1',
            }}
          >
            {teamInitials}
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
              <h2
                ref={headingRef}
                tabIndex={-1}
                className="roster-heading"
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
            </div>
            <div style={{ fontSize: '0.8125rem', color: '#64748b', marginTop: '0.35rem' }}>
              Team ID: {selectedTeam.id} • Created {formattedCreatedDate}
            </div>
          </div>
        </div>

        {/* Toolbar */}
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
          <div
            className="member-filter-wrap"
            style={{
              minWidth: 0,
              width: '180px',
              maxWidth: '100%',
              boxSizing: 'border-box',
            }}
          >
            <label htmlFor="member-filter" className="sr-only" style={commonStyles.label}>
              Filter loaded members
            </label>
            <input
              id="member-filter"
              type="search"
              aria-label="Filter loaded members"
              placeholder="Name, email, or role"
              value={memberFilter}
              onChange={(e) => onMemberFilterChange(e.target.value)}
              className="member-filter-input"
              style={commonStyles.input}
            />
          </div>
          <button
            type="button"
            onClick={onOpenAddMember}
            className="admin-teams-create-btn"
            style={{ ...commonStyles.buttonPrimary }}
          >
            + Add Member
          </button>
        </div>
      </div>

      {/* Subtitle */}
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

      {/* Feedback Alerts */}
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

      {/* Loading & Empty States */}
      {teamMembersLoading && rosterMembers.length === 0 && (
        <div
          role="status"
          style={{
            padding: '2rem',
            textAlign: 'center',
            color: '#64748b',
            fontSize: '0.875rem',
          }}
        >
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

      {/* Roster Content */}
      {!teamMembersLoading && !teamMembersError && rosterMembers.length > 0 && (
        <>
          {visibleMembers.length === 0 && (
            <div
              role="status"
              style={{
                color: '#64748b',
                fontSize: '0.875rem',
                marginBottom: '0.75rem',
              }}
            >
              No members match your filter.
            </div>
          )}
          <div className="team-members-table-wrap">
            <table
              data-testid="team-members-table"
              className="team-members-table"
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
                  <tr
                    key={member.id}
                    className="member-row"
                    style={{ borderBottom: '1px solid #f1f5f9', verticalAlign: 'middle' }}
                  >
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
                          <div style={{ fontWeight: 600, color: '#0f172a' }}>
                            {member.user.displayName}
                          </div>
                          <div className="member-meta">
                            <span className="member-meta-email">{member.user.email}</span>
                            <span className="member-meta-date">
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
                        onChange={(e) => void onRoleChange(member, e.target.value as Role)}
                        className="roster-role-select"
                        style={{
                          ...commonStyles.select,
                          padding: '0.35rem 1.75rem 0.35rem 0.75rem',
                          fontSize: '0.8125rem',
                          width: 'auto',
                          minWidth: '5.25rem',
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
                        onClick={() => void onRemoveMember(member)}
                        disabled={isRemoving}
                        className="btn-danger-subtle"
                        style={{
                          padding: '0.35rem 0.75rem',
                          borderRadius: '6px',
                          border: '1px solid #fecaca',
                          backgroundColor: '#fef2f2',
                          color: '#dc2626',
                          fontWeight: 600,
                          fontSize: '0.8125rem',
                          cursor: isRemoving ? 'not-allowed' : 'pointer',
                          fontFamily: 'inherit',
                        }}
                      >
                        {isRemoving && memberToRemoveId === member.id ? 'Removing…' : 'Remove'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Pagination */}
      {nextCursor && (
        <div style={{ marginTop: '1rem', textAlign: 'center' }}>
          <button
            type="button"
            onClick={onLoadMore}
            disabled={teamMembersFetching}
            style={commonStyles.buttonSecondary}
          >
            {teamMembersFetching ? 'Loading members…' : 'Load more members'}
          </button>
        </div>
      )}
      </section>
    </div>
  )
}
