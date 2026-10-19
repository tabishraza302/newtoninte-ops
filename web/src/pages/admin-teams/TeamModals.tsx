import React from 'react'
import type { Team, PublicUser, Role } from '../../api/types'
import { ROLES } from '../../api/types'
import { commonStyles } from '../../theme'

export interface TeamModalsProps {
  showCreateTeam: boolean
  onCloseCreateTeam: () => void
  teamName: string
  teamSlug: string
  onTeamNameChange: (val: string) => void
  onTeamSlugChange: (val: string) => void
  teamError: string | null
  isCreatingTeam: boolean
  onCreateTeamSubmit: (e: React.FormEvent) => void | Promise<void>

  showAddMember: boolean
  onCloseAddMember: () => void
  selectedTeam: Team | null
  selectedUser: PublicUser | null
  onSelectUser: (user: PublicUser) => void
  selectedRole: Role
  onRoleChange: (role: Role) => void
  memberSuccess: string | null
  memberError: string | null
  pickerSearch: string
  onPickerSearchChange: (val: string) => void
  pickerUsers: PublicUser[]
  pickerLoading: boolean
  pickerFetching: boolean
  pickerError: Error | null
  pickerNextCursor?: string | null
  onLoadMoreUsers: () => void
  isAddingMember: boolean
  onAddMemberSubmit: (e: React.FormEvent) => void | Promise<void>
  memberInitials: (name: string) => string
}

function DialogCloseButton({ onClick }: { onClick: () => void }): React.ReactElement {
  return (
    <button type="button" className="modal-close" aria-label="Close dialog" onClick={onClick}>
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
        <path
          d="M4.5 4.5l7 7m0-7l-7 7"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
    </button>
  )
}

export function TeamModals({
  showCreateTeam,
  onCloseCreateTeam,
  teamName,
  teamSlug,
  onTeamNameChange,
  onTeamSlugChange,
  teamError,
  isCreatingTeam,
  onCreateTeamSubmit,

  showAddMember,
  onCloseAddMember,
  selectedTeam,
  selectedUser,
  onSelectUser,
  selectedRole,
  onRoleChange,
  memberSuccess,
  memberError,
  pickerSearch,
  onPickerSearchChange,
  pickerUsers,
  pickerLoading,
  pickerFetching,
  pickerError,
  pickerNextCursor,
  onLoadMoreUsers,
  isAddingMember,
  onAddMemberSubmit,
  memberInitials,
}: TeamModalsProps): React.ReactElement {
  return (
    <>
      {showCreateTeam && (
        <div
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              onCloseCreateTeam()
            }
          }}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              onCloseCreateTeam()
            }
          }}
          className="admin-teams-dialog-layer"
          role="dialog"
          aria-modal="true"
          aria-labelledby="create-team-title"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 50,
            display: 'grid',
            placeItems: 'center',
            backgroundColor: 'rgba(15, 23, 42, 0.45)',
          }}
        >
          <div
            className="modal-card"
            style={{
              width: 'min(100%, 640px)',
              maxHeight: 'calc(100vh - 2rem)',
              overflowY: 'auto',
            }}
          >
            <div className="modal-head">
              <div>
                <h2
                  id="create-team-title"
                  style={{
                    fontSize: '1.25rem',
                    fontWeight: 800,
                    color: '#0f172a',
                    margin: '0 0 0.5rem',
                    letterSpacing: '-0.02em',
                  }}
                >
                  Create Team
                </h2>
                <p style={{ fontSize: '0.8125rem', color: '#64748b', margin: '0 0 1.25rem' }}>
                  Add a new team to organize member access.
                </p>
              </div>
              <DialogCloseButton onClick={onCloseCreateTeam} />
            </div>
            {teamError && (
              <div role="alert" style={{ ...commonStyles.alertError, marginBottom: '1.25rem' }}>
                {teamError}
              </div>
            )}
            <form onSubmit={(event) => void onCreateTeamSubmit(event)}>
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
                    onChange={(event) => onTeamNameChange(event.target.value)}
                    style={commonStyles.input}
                    className="modal-input"
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
                    onChange={(event) => onTeamSlugChange(event.target.value)}
                    style={commonStyles.input}
                    className="modal-input"
                  />
                </div>
              </div>
              <div className="modal-actions" style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  onClick={onCloseCreateTeam}
                  className="btn-secondary"
                  style={commonStyles.buttonSecondary}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isCreatingTeam}
                  className="admin-teams-create-btn"
                  style={{
                    ...commonStyles.buttonPrimary,
                    opacity: isCreatingTeam ? 0.7 : 1,
                    cursor: isCreatingTeam ? 'not-allowed' : 'pointer',
                  }}
                >
                  {isCreatingTeam ? 'Creating…' : 'Create Team'}
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
              onCloseAddMember()
            }
          }}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              onCloseAddMember()
            }
          }}
          role="dialog"
          className="admin-teams-dialog-layer"
          aria-modal="true"
          aria-labelledby="add-member-title"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 50,
            display: 'grid',
            placeItems: 'center',
            backgroundColor: 'rgba(15, 23, 42, 0.45)',
          }}
        >
          <div
            className="modal-card"
            style={{
              width: 'min(100%, 680px)',
              maxHeight: 'calc(100vh - 2rem)',
              overflowY: 'auto',
            }}
          >
            <div className="modal-head">
              <div>
                <h2
                  id="add-member-title"
                  style={{
                    fontSize: '1.25rem',
                    fontWeight: 800,
                    color: '#0f172a',
                    margin: '0 0 0.5rem',
                    letterSpacing: '-0.02em',
                  }}
                >
                  Add Member to {selectedTeam.name}
                </h2>
                <p style={{ fontSize: '0.8125rem', color: '#64748b', margin: '0 0 1.25rem' }}>
                  Search the user directory and assign a role.
                </p>
              </div>
              <DialogCloseButton onClick={onCloseAddMember} />
            </div>
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
            <form onSubmit={(event) => void onAddMemberSubmit(event)}>
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
                  onChange={(event) => onPickerSearchChange(event.target.value)}
                  style={{ ...commonStyles.input, marginBottom: '0.75rem' }}
                  className="modal-input"
                />
                <div
                  className="user-picker-list"
                  style={{
                    border: '1px solid #e2e8f0',
                    borderRadius: '8px',
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
                        onClick={() => onSelectUser(pickerUser)}
                        className={`user-picker-row ${isPicked ? 'selected' : ''}`}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '0.65rem 0.85rem',
                          borderBottom: '1px solid #e2e8f0',
                          backgroundColor: isPicked ? '#f0fdfa' : '#ffffff',
                          cursor: 'pointer',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flex: 1, minWidth: 0 }}>
                          <div
                            style={{
                              width: '32px',
                              height: '32px',
                              borderRadius: '50%',
                              backgroundColor: isPicked ? '#0f766e' : '#f1f5f9',
                              color: isPicked ? '#ffffff' : '#475569',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontWeight: 700,
                              fontSize: '0.75rem',
                              flexShrink: 0,
                            }}
                          >
                            {memberInitials(pickerUser.displayName)}
                          </div>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontWeight: 600, fontSize: '0.8125rem', color: '#0f172a' }}>
                              {pickerUser.displayName}
                            </div>
                            <div style={{ fontSize: '0.75rem', color: '#64748b', overflowWrap: 'anywhere' }}>
                              {pickerUser.email}
                            </div>
                          </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
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
                            onChange={() => onSelectUser(pickerUser)}
                            aria-label={`Select user ${pickerUser.displayName}`}
                          />
                        </div>
                      </div>
                    )
                  })}
                  {pickerNextCursor && (
                    <div style={{ padding: '0.5rem', textAlign: 'center', backgroundColor: '#f1f5f9' }}>
                      <button
                        type="button"
                        onClick={onLoadMoreUsers}
                        disabled={pickerFetching}
                        className="btn-secondary"
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
                  aria-label="Select Role"
                  value={selectedRole}
                  onChange={(event) => onRoleChange(event.target.value as Role)}
                  style={commonStyles.select}
                  className="modal-input"
                >
                  {ROLES.map((role) => (
                    <option key={role} value={role}>
                      {role.charAt(0).toUpperCase() + role.slice(1)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="modal-actions" style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
                <button
                  type="button"
                  onClick={onCloseAddMember}
                  className="btn-secondary"
                  style={commonStyles.buttonSecondary}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!selectedUser || isAddingMember}
                  className="admin-teams-create-btn"
                  style={{
                    ...commonStyles.buttonPrimary,
                    opacity: !selectedUser || isAddingMember ? 0.6 : 1,
                    cursor: !selectedUser || isAddingMember ? 'not-allowed' : 'pointer',
                  }}
                >
                  {isAddingMember
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
    </>
  )
}
