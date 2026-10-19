import React from 'react'
import { Link } from 'react-router-dom'
import type { WorkItem } from '../api/types'
import { useTeams } from '../api/hooks'
import { getStatusBadgeStyle, getPriorityBadgeStyle, theme } from '../theme'

const ITEM_TABLE_GRID_TEMPLATE =
  'minmax(70px, max-content) minmax(200px, 3fr) minmax(100px, max-content) max-content max-content minmax(130px, 1.5fr) minmax(90px, max-content)'
const ITEM_TABLE_COLUMN_GAP = '1rem'
const ITEM_TABLE_MIN_WIDTH = 'fit-content'
/* Without subgrid a row cannot borrow the container's tracks, so every row
   resolves this uniform template itself; `max-content` tracks are excluded
   because they would size per row and break the shared column edges. */
const ITEM_TABLE_FALLBACK_GRID_TEMPLATE =
  'minmax(70px, 100px) minmax(200px, 3fr) 120px 160px 110px minmax(130px, 1.5fr) 120px'

export const TeamContext = React.createContext<Map<number, string>>(new Map())
export function ItemTableGrid({
  label,
  teams,
  children,
}: {
  label: string
  teams?: { id: number; name: string }[]
  children: React.ReactNode
}): React.ReactElement {
  const teamsQuery = useTeams()
  const parentTeamMap = React.useContext(TeamContext)
  const teamMap = React.useMemo(() => {
    const map = new Map(parentTeamMap)
    const list = teams ?? teamsQuery.data?.teams
    if (list) {
      for (const t of list) {
        map.set(t.id, t.name)
      }
    }
    return map
  }, [teams, teamsQuery.data?.teams, parentTeamMap])
  return (
    <TeamContext.Provider value={teamMap}>
      <div
        role="table"
        aria-label={label}
        className="item-table"
        style={
          {
            minWidth: ITEM_TABLE_MIN_WIDTH,
            display: 'grid',
            gridTemplateColumns: ITEM_TABLE_GRID_TEMPLATE,
            columnGap: ITEM_TABLE_COLUMN_GAP,
            '--item-table-columns': ITEM_TABLE_FALLBACK_GRID_TEMPLATE,
          } as React.CSSProperties & Record<'--item-table-columns', string>
        }
      >
        {children}
      </div>
    </TeamContext.Provider>
  )
}

export function ItemTableHeader(): React.ReactElement {
  return (
    <div
      role="row"
      className="item-table-header"
      style={{
        display: 'grid',
        gridColumn: '1 / -1',
        gridTemplateColumns: 'subgrid',
        columnGap: ITEM_TABLE_COLUMN_GAP,
        padding: '0.75rem 1rem',
        backgroundColor: theme.colors.bgCardMuted,
        borderBottom: `1px solid ${theme.colors.border}`,
        fontSize: '0.75rem',
        fontWeight: 700,
        color: theme.colors.textSecondary,
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
        alignItems: 'center',
      }}
    >
      <span role="columnheader">ID</span>
      <span role="columnheader">Title</span>
      <span role="columnheader">Team</span>
      <span role="columnheader">Status</span>
      <span role="columnheader">Priority</span>
      <span role="columnheader">Assignee</span>
      <span role="columnheader" style={{ textAlign: 'right' }}>
        Due
      </span>
    </div>
  )
}

export interface ItemRowProps {
  item: WorkItem
  teamName?: string | undefined
}

export function ItemRow({ item, teamName: propTeamName }: ItemRowProps): React.ReactElement {
  const teamMap = React.useContext(TeamContext)
  const teamName =
    propTeamName ??
    item.team?.name ??
    teamMap.get(item.teamId) ??
    `Team #${item.teamId}`
  const assigneeName = item.assignee?.displayName ?? 'Unassigned'
  const dueDate = item.dueAt ? new Date(item.dueAt).toLocaleDateString() : 'No due date'
  return (
    <div
      role="row"
      className="item-table-row"
      data-testid={`item-row-${item.id}`}
      style={{
        display: 'grid',
        gridColumn: '1 / -1',
        gridTemplateColumns: 'subgrid',
        columnGap: ITEM_TABLE_COLUMN_GAP,
        alignItems: 'center',
        padding: '0.875rem 1rem',
        borderBottom: '1px solid #f1f5f9',
        backgroundColor: '#ffffff',
      }}
    >
      <div role="cell" style={{ minWidth: 0 }}>
        <Link
          to={`/items/${item.id}`}
          style={{
            fontFamily: 'ui-monospace, monospace',
            fontSize: '0.8125rem',
            fontWeight: 600,
            color: theme.colors.textMuted,
            textDecoration: 'none',
            fontVariantNumeric: 'tabular-nums',
            transition: 'color 0.15s ease',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = theme.colors.accent)}
          onMouseLeave={(e) => (e.currentTarget.style.color = theme.colors.textMuted)}
        >
          #{item.id}
        </Link>
      </div>

      <div role="cell" style={{ minWidth: 0, overflow: 'hidden' }}>
        <Link
          to={`/items/${item.id}`}
          title={item.title}
          style={{
            fontWeight: 600,
            color: '#0f172a',
            textDecoration: 'none',
            fontSize: '0.9375rem',
            lineHeight: 1.3,
            display: 'block',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            transition: 'color 0.15s ease',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = theme.colors.accent)}
          onMouseLeave={(e) => (e.currentTarget.style.color = theme.colors.textPrimary)}
        >
          {item.title}
        </Link>
        <div
          style={{
            fontSize: '0.75rem',
            color: '#64748b',
            marginTop: '0.2rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.375rem',
          }}
        >
          <span style={{ textTransform: 'capitalize' }}>{item.type.replace(/_/g, ' ')}</span>
        </div>
      </div>

      <div role="cell" style={{ minWidth: 0 }}>
        <span
          data-testid="item-team-badge"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            padding: '0.15rem 0.5rem',
            borderRadius: '4px',
            fontSize: '0.75rem',
            fontWeight: 500,
            backgroundColor: '#f1f5f9',
            color: '#334155',
            border: '1px solid #e2e8f0',
            whiteSpace: 'nowrap',
          }}
        >
          {teamName}
        </span>
      </div>
      <div role="cell" style={{ minWidth: 0 }}>
        <span
          data-testid="item-status"
          style={getStatusBadgeStyle(item.status)}
        >
          {item.status.replace(/_/g, ' ')}
        </span>
      </div>

      <div role="cell" style={{ minWidth: 0 }}>
        <span
          data-testid="item-priority"
          style={getPriorityBadgeStyle(item.priority)}
        >
          {item.priority}
        </span>
      </div>

      <div
        role="cell"
        style={{
          fontSize: '0.8125rem',
          color: item.assignee ? '#334155' : '#94a3b8',
          fontWeight: 500,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {assigneeName}
      </div>

      <div
        role="cell"
        style={{
          fontSize: '0.8125rem',
          color: '#64748b',
          textAlign: 'right',
          whiteSpace: 'nowrap',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {dueDate}
      </div>
    </div>
  )
}

