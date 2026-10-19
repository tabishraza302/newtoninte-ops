import React from 'react'
import type { Team } from '../../api/types'
import { commonStyles } from '../../theme'

export interface TeamsDirectoryProps {
  teams: Team[]
  visibleTeams: Team[]
  selectedTeamId: number | null
  onSelectTeam: (id: number) => void
  searchInput: string
  onSearchChange: (val: string) => void
  effectiveQ: string
  teamsLoading: boolean
  teamsFetching: boolean
  teamsError: Error | null
  nextCursor?: string | null
  onLoadMore: () => void
  itemEls: React.RefObject<Map<number, HTMLButtonElement>>
}

export function TeamsDirectory({
  teams,
  visibleTeams,
  selectedTeamId,
  onSelectTeam,
  searchInput,
  onSearchChange,
  effectiveQ,
  teamsLoading,
  teamsFetching,
  teamsError,
  nextCursor,
  onLoadMore,
  itemEls,
}: TeamsDirectoryProps): React.ReactElement {
  return (
    <section aria-label="Teams directory" className="teams-picker-bar">
      <div className="team-picker-header">
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
          <label htmlFor="team-directory-search" className="sr-only" style={commonStyles.label}>
            Search teams
          </label>
          <input
            id="team-directory-search"
            type="search"
            aria-label="Search teams"
            placeholder="Search by name or slug"
            value={searchInput}
            onChange={(event) => onSearchChange(event.target.value)}
            className="team-directory-search-input"
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
        <div className="team-directory-list">
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
                onClick={() => onSelectTeam(team.id)}
                ref={(element) => {
                  if (element) itemEls.current.set(team.id, element)
                }}
                className={`team-directory-item${isSelected ? ' active' : ''}`}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.625rem',
                  padding: '0.625rem 0.85rem',
                  borderRadius: '8px',
                  textAlign: 'left',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  width: '100%',
                  minWidth: 0,
                  boxSizing: 'border-box',
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    display: 'grid',
                    placeItems: 'center',
                    width: '2rem',
                    height: '2rem',
                    borderRadius: '6px',
                    flexShrink: 0,
                    backgroundColor: isSelected ? '#0f766e' : '#f1f5f9',
                    color: isSelected ? '#ffffff' : '#475569',
                    fontSize: '0.75rem',
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
                      color: isSelected ? '#134e4a' : '#0f172a',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      maxWidth: '100%',
                    }}
                  >
                    {team.name}
                  </div>
                </div>

                {isSelected && (
                  <span
                    aria-hidden="true"
                    style={{
                      width: '6px',
                      height: '6px',
                      borderRadius: '999px',
                      backgroundColor: '#0f766e',
                      flexShrink: 0,
                      marginLeft: '0.25rem',
                    }}
                  />
                )}
              </button>
            )
          })}

          {nextCursor && (
            <button
              type="button"
              onClick={onLoadMore}
              disabled={teamsFetching}
              className="btn-secondary"
              style={{
                ...commonStyles.buttonSecondary,
                padding: '0.5rem 0.85rem',
                fontSize: '0.8125rem',
                marginTop: '0.5rem',
                alignSelf: 'flex-start',
              }}
            >
              {teamsFetching ? 'Loading teams…' : 'Load more teams'}
            </button>
          )}
        </div>
      )}
    </section>
  )
}
