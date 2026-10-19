export const adminTeamsStyles = `
/* Admin Teams Workbench Stylesheet
 * Precision Instrument Workspace (web/DESIGN.md)
 */

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
  margin-bottom: 1.75rem;
}

.admin-teams-title {
  margin: 0;
  font-size: 1.75rem;
  font-weight: 800;
  letter-spacing: -0.025em;
  color: #0f172a;
  line-height: 1.25;
}

.admin-teams-subtitle {
  margin: 0.375rem 0 0 0;
  font-size: 0.875rem;
  color: #64748b;
  line-height: 1.5;
}

/* Primary Teal Action Button */
.admin-teams-create-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  background-color: #0f766e;
  color: #ffffff;
  border: 1px solid transparent;
  border-radius: 6px;
  padding: 0.55rem 1.15rem;
  font-size: 0.875rem;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  box-shadow: 0 1px 2px 0 rgba(15, 23, 42, 0.08);
  transition: background-color 0.15s ease, transform 0.1s ease, box-shadow 0.15s ease;
  white-space: nowrap;
}

.admin-teams-create-btn:hover:not(:disabled) {
  background-color: #115e59;
  box-shadow: 0 2px 4px 0 rgba(15, 23, 42, 0.12);
}

.admin-teams-create-btn:active:not(:disabled) {
  background-color: #134e4a;
  transform: scale(0.98);
}

.admin-teams-create-btn:focus-visible {
  outline: 2px solid #0f766e;
  outline-offset: 2px;
}

.admin-teams-create-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

/* Two-Column Master-Detail Workbench Layout */
.admin-teams-workbench {
  display: grid;
  grid-template-columns: 320px 1fr;
  gap: 1.5rem;
  align-items: start;
  width: 100%;
  box-sizing: border-box;
}

/* Grid items must not be stretched by long, unbreakable roster content */
.admin-teams-workbench > * {
  min-width: 0;
}

/* Secondary Button */
.btn-secondary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  background-color: #ffffff;
  color: #334155;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  padding: 0.55rem 1.15rem;
  font-size: 0.875rem;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  box-shadow: 0 1px 2px 0 rgba(15, 23, 42, 0.04);
  transition: background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease, transform 0.1s ease;
  white-space: nowrap;
}

.btn-secondary:hover:not(:disabled) {
  background-color: #f8fafc;
  border-color: #cbd5e1;
  color: #0f172a;
}

.btn-secondary:active:not(:disabled) {
  background-color: #f1f5f9;
  transform: scale(0.98);
}

.btn-secondary:focus-visible {
  outline: 2px solid #0f766e;
  outline-offset: 2px;
}

.btn-secondary:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

/* Subtle Danger Button */
.btn-danger-subtle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.375rem;
  background-color: #fff5f5;
  color: #dc2626;
  border: 1px solid #fecaca;
  border-radius: 6px;
  padding: 0.35rem 0.75rem;
  font-size: 0.8125rem;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  transition: background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease, transform 0.1s ease;
  white-space: nowrap;
}

.btn-danger-subtle:hover:not(:disabled) {
  background-color: #fee2e2;
  border-color: #fca5a5;
  color: #b91c1c;
}

.btn-danger-subtle:active:not(:disabled) {
  background-color: #fecaca;
  transform: scale(0.98);
}

.btn-danger-subtle:focus-visible {
  outline: 2px solid #dc2626;
  outline-offset: 2px;
}

.btn-danger-subtle:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

/* Accessible Screen Reader Only Utility */
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border-width: 0;
}

/* Teams Directory (Left Column) */
.teams-picker-bar {
  width: 100%;
  max-width: 100%;
  box-sizing: border-box;
  background-color: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 1.25rem;
  box-shadow: 0 1px 3px 0 rgba(15, 23, 42, 0.03);
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
  margin-bottom: 1rem;
}

.team-picker-search-wrap {
  min-width: 0;
  width: 100%;
  box-sizing: border-box;
}

.team-directory-search-input {
  width: 100%;
  box-sizing: border-box;
  padding: 0.55rem 0.75rem 0.55rem 2.25rem;
  font-size: 0.8125rem;
  color: #0f172a;
  background-color: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  outline: none;
  transition: border-color 0.15s ease, box-shadow 0.15s ease, background-color 0.15s ease;
  font-family: inherit;
}

.team-directory-search-input:hover {
  border-color: #cbd5e1;
}

.team-directory-search-input:focus {
  background-color: #ffffff;
  border-color: #0f766e;
  box-shadow: 0 0 0 3px rgba(15, 118, 110, 0.15);
}

.team-directory-search-input::placeholder {
  color: #94a3b8;
}

.team-directory-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  width: 100%;
  max-width: 100%;
  box-sizing: border-box;
}

.team-directory-item {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  padding: 0.625rem 0.85rem;
  background-color: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  text-align: left;
  cursor: pointer;
  font-family: inherit;
  transition: background-color 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  outline: none;
}

.team-directory-item:hover:not(.active) {
  background-color: #f8fafc;
  border-color: #cbd5e1;
}

.team-directory-item.active {
  background-color: #f0fdfa;
  border-color: #0f766e;
  box-shadow: 0 0 0 1px #0f766e, 0 1px 3px 0 rgba(15, 118, 110, 0.1);
}

.team-directory-item:focus-visible {
  outline: 2px solid #0f766e;
  outline-offset: 2px;
}

/* Team Roster Workspace (Right Column) */
.team-roster-panel {
  width: 100%;
  max-width: 100%;
  box-sizing: border-box;
  background-color: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 1.5rem;
  box-shadow: 0 1px 3px 0 rgba(15, 23, 42, 0.03);
  container-type: inline-size;
}

/* Drill-down back control (single-column layouts only) */
.team-roster-back {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  min-height: 2.25rem;
  padding: 0.25rem 0.5rem 0.25rem 0;
  margin-bottom: 0.75rem;
  background: transparent;
  border: none;
  border-radius: 6px;
  font-size: 0.875rem;
  font-weight: 600;
  color: #475569;
  font-family: inherit;
  cursor: pointer;
  touch-action: manipulation;
  transition: color 0.15s ease;
}

.team-roster-back:hover {
  color: #0f172a;
}

.team-roster-back:focus-visible {
  outline: 2px solid #0f766e;
  outline-offset: 2px;
}

@media (min-width: 1025px) {
  .team-roster-back {
    display: none !important;
  }
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

/* The team name is focused programmatically when the drill-down opens; it is not a tab stop,
 * so the focus ring would only ever be decorative noise */
.roster-heading:focus,
.roster-heading:focus-visible {
  outline: none;
}

.team-roster-actions {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
  max-width: 100%;
  box-sizing: border-box;
}

/* Keep the filter and the Add Member button at one uniform 38px height */
.team-roster-actions .admin-teams-create-btn {
  height: 2.375rem;
  padding: 0 1rem !important;
  font-size: 0.8125rem !important;
}

.member-filter-wrap {
  min-width: 0;
  width: 220px;
  max-width: 100%;
  box-sizing: border-box;
}

.member-filter-input {
  width: 100%;
  height: 38px;
  box-sizing: border-box;
  padding: 0 0.75rem 0 2.25rem;
  font-size: 0.8125rem;
  color: #0f172a;
  background-color: #ffffff;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  outline: none;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
  font-family: inherit;
}

.member-filter-input:hover {
  border-color: #94a3b8;
}

.member-filter-input:focus {
  border-color: #0f766e;
  box-shadow: 0 0 0 3px rgba(15, 118, 110, 0.15);
}

.member-filter-input::placeholder {
  color: #94a3b8;
}

/* Members Table Container */
.team-members-table-wrap {
  overflow-x: auto;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  width: 100%;
  max-width: 100%;
  box-sizing: border-box;
  box-shadow: 0 1px 2px 0 rgba(15, 23, 42, 0.04);
}

.team-members-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.875rem;
  text-align: left;
}

.team-members-table thead {
  background-color: #f8fafc;
  border-bottom: 1px solid #e2e8f0;
}

.team-members-table th {
  padding: 0.75rem 1rem;
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: #64748b;
  border: none;
}

/* Hold enough room for name + email before the table starts scrolling */
.team-members-table-wrap td.col-user-info {
  min-width: 15rem;
}

.member-row {
  border-bottom: 1px solid #f1f5f9;
  vertical-align: middle;
  transition: background-color 150ms ease;
  background-color: #ffffff;
}

.member-row:hover {
  background-color: #f8fafc;
}

.member-row:last-child {
  border-bottom: none;
}

/* Member identity meta line */
.member-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  column-gap: 0.35rem;
  row-gap: 0.125rem;
  font-size: 0.8125rem;
  color: #64748b;
}

.member-meta-email {
  overflow-wrap: anywhere;
}

.member-meta-date {
  color: #94a3b8;
  font-size: 0.75rem;
  white-space: nowrap;
}

.member-meta-date::before {
  content: '•';
  margin-right: 0.35rem;
  color: #cbd5e1;
}

/* Role Dropdown Selector */
.roster-role-select {
  appearance: none;
  -webkit-appearance: none;
  background-color: #ffffff;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  padding: 0.35rem 1.75rem 0.35rem 0.75rem;
  font-size: 0.8125rem;
  font-weight: 500;
  color: #0f172a;
  cursor: pointer;
  outline: none;
  font-family: inherit;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
  background-image: url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='%2364748b'%3e%3cpath fill-rule='evenodd' d='M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z' clip-rule='evenodd'/%3e%3c/svg%3e");
  background-position: right 0.5rem center;
  background-repeat: no-repeat;
  background-size: 1rem 1rem;
}

.roster-role-select:hover:not(:disabled) {
  border-color: #94a3b8;
}

.roster-role-select:focus {
  border-color: #0f766e;
  box-shadow: 0 0 0 3px rgba(15, 118, 110, 0.15);
}

.roster-role-select:disabled {
  background-color: #f8fafc;
  cursor: not-allowed;
  opacity: 0.7;
}

/* Modals & Dialog Layer */
.admin-teams-dialog-layer {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: grid;
  place-items: center;
  background-color: rgba(15, 23, 42, 0.45);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  padding: 1rem 1rem 1rem calc(260px + 1rem);
  box-sizing: border-box;
}

.modal-card {
  background-color: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  box-shadow: 0 20px 25px -5px rgba(15, 23, 42, 0.1), 0 8px 10px -6px rgba(15, 23, 42, 0.05);
  padding: 1.75rem;
  width: min(100%, 640px);
  max-height: calc(100vh - 2rem);
  overflow-y: auto;
  box-sizing: border-box;
}

.modal-actions {
  flex-wrap: wrap;
}

.modal-input {
  width: 100%;
  box-sizing: border-box;
  padding: 0.55rem 0.75rem;
  font-size: 0.875rem;
  color: #0f172a;
  background-color: #ffffff;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  outline: none;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
  font-family: inherit;
}

.modal-input:hover {
  border-color: #94a3b8;
}

.modal-input:focus {
  border-color: #0f766e;
  box-shadow: 0 0 0 3px rgba(15, 118, 110, 0.15);
}

.user-picker-list {
  display: flex;
  flex-direction: column;
  max-height: 220px;
  overflow-y: auto;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background-color: #f8fafc;
  box-sizing: border-box;
  -webkit-mask-image: linear-gradient(to bottom, #000 calc(100% - 14px), transparent 100%);
  mask-image: linear-gradient(to bottom, #000 calc(100% - 14px), transparent 100%);
}

.user-picker-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.65rem 0.85rem;
  border-bottom: 1px solid #e2e8f0;
  cursor: pointer;
  transition: background-color 0.15s ease, border-color 0.15s ease;
  box-sizing: border-box;
}

.user-picker-row:hover:not(.selected) {
  background-color: #f1f5f9;
}

.user-picker-row.selected {
  background-color: #f0fdfa;
  border-color: #0f766e;
}

/* Responsive Media Queries */
.modal-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
}

.modal-close {
  display: grid;
  place-items: center;
  width: 2rem;
  height: 2rem;
  flex-shrink: 0;
  margin: -0.375rem -0.5rem 0 0;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: #64748b;
  cursor: pointer;
  transition: background-color 0.15s ease, color 0.15s ease, border-color 0.15s ease;
}

.modal-close:hover {
  background-color: #f1f5f9;
  border-color: #e2e8f0;
  color: #0f172a;
}

.modal-close:focus-visible {
  outline: 2px solid #0f766e;
  outline-offset: 2px;
}

/* Member rows become cards whenever the roster panel itself is narrow,
 * and its toolbar keeps one row of 44px controls. */
@container (max-width: 640px) {
  .team-roster-header {
    flex-direction: column !important;
    align-items: stretch !important;
    gap: 0.75rem !important;
  }

  .team-roster-actions {
    width: 100%;
  }

  .team-roster-actions .member-filter-wrap {
    flex: 1 1 8rem;
    width: auto !important;
    max-width: 100% !important;
  }

  .team-roster-actions .admin-teams-create-btn {
    height: 2.75rem;
    font-size: 0.875rem !important;
  }

  .member-filter-input {
    height: 2.75rem;
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

  /* One card per member: identity on the left, role and removal stacked on the right */
  .team-members-table-wrap tr {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 0.5rem 0.875rem;
    background-color: #ffffff;
    border-bottom: 1px solid #f1f5f9 !important;
    padding: 0.75rem;
    box-sizing: border-box;
    width: 100%;
  }

  /* The wrapper draws the outer border, so the final divider is redundant */
  .team-members-table-wrap tr:last-child {
    border-bottom: none !important;
  }

  .team-members-table-wrap td.col-user-info {
    grid-column: 1;
    grid-row: 1 / span 2;
    padding: 0 !important;
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .team-members-table-wrap td.col-role {
    grid-column: 2;
    grid-row: 1;
    padding: 0 !important;
  }

  .team-members-table-wrap td.col-action {
    grid-column: 2;
    grid-row: 2;
    padding: 0 !important;
    text-align: right;
  }

  /* Card controls match the panel's touch-sized toolbar */
  .team-members-table-wrap .roster-role-select {
    min-height: 2.25rem;
  }

  .team-members-table-wrap .col-action button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    min-height: 2.25rem;
  }

  /* The identity stack keeps one item per line on the narrowest cards */
  .member-meta-date {
    flex-basis: 100%;
  }

  .member-meta-date::before {
    content: none;
  }
}

/* Wider cards keep the joined date beside the email */
@container (min-width: 460px) and (max-width: 640px) {
  .member-meta-date {
    flex-basis: auto;
  }

  .member-meta-date::before {
    content: '•';
  }
}

/* Phones: the identity takes the full card width and the controls sit below it as a pair */
@container (max-width: 340px) {
  .team-members-table-wrap td.col-user-info {
    grid-column: 1 / 3;
    grid-row: 1;
  }

  .team-members-table-wrap td.col-role {
    grid-column: 1;
    grid-row: 2;
    justify-self: end;
  }

  .team-members-table-wrap td.col-action {
    grid-column: 2;
    grid-row: 2;
  }
}

@media (max-width: 1024px) {
  .admin-teams-workbench {
    grid-template-columns: 1fr;
    gap: 1.25rem;
  }

  /* Single column: the selected team replaces the directory instead of stacking below it */
  .admin-teams-page[data-mobile-view='detail'] .admin-teams-header {
    display: none !important;
  }

  .admin-teams-page[data-mobile-view='detail'] [aria-label='Teams directory'] {
    display: none !important;
  }

  .admin-teams-page[data-mobile-view='list'] .team-roster-workspace,
  .admin-teams-page[data-mobile-view='list'] [aria-label='Team Roster'] {
    display: none !important;
  }
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

  .admin-teams-header .admin-teams-create-btn {
    align-self: stretch !important;
    width: 100% !important;
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

  .modal-card {
    padding: 1.25rem;
  }

  .modal-actions {
    flex-direction: column-reverse;
  }

  .modal-actions > button {
    width: 100%;
  }
}
`
