---
name: "Newtonite Operations"
description: "Precision internal operations workspace for team-scoped work tracking and lifecycle governance."
colors:
  bg-app: "#f4f6f8"
  bg-card: "#ffffff"
  bg-card-muted: "#f8fafc"
  bg-hover: "#f1f5f9"
  sidebar-bg: "#11161d"
  sidebar-border: "#1e293b"
  border: "#e2e8f0"
  border-strong: "#cbd5e1"
  border-focus: "#0f766e"
  text-primary: "#0f172a"
  text-secondary: "#334155"
  text-muted: "#64748b"
  text-subtle: "#94a3b8"
  text-inverse: "#ffffff"
  accent: "#0f766e"
  accent-hover: "#115e59"
  accent-active: "#134e4a"
  accent-subtle: "#f0fdfa"
  accent-border: "#ccfbf1"
  status-open-bg: "#e0f2fe"
  status-open-text: "#0369a1"
  status-open-border: "#bae6fd"
  status-in-progress-bg: "#fef3c7"
  status-in-progress-text: "#92400e"
  status-in-progress-border: "#fde68a"
  status-awaiting-approval-bg: "#f3e8ff"
  status-awaiting-approval-text: "#6b21a8"
  status-awaiting-approval-border: "#ddd6fe"
  status-resolved-bg: "#ecfdf5"
  status-resolved-text: "#047857"
  status-resolved-border: "#a7f3d0"
  status-closed-bg: "#f1f5f9"
  status-closed-text: "#475569"
  status-closed-border: "#cbd5e1"
  status-cancelled-bg: "#fef2f2"
  status-cancelled-text: "#991b1b"
  status-cancelled-border: "#fecaca"
  priority-urgent-bg: "#fef2f2"
  priority-urgent-text: "#dc2626"
  priority-urgent-border: "#fecaca"
  priority-high-bg: "#fff7ed"
  priority-high-text: "#c2410c"
  priority-high-border: "#fed7aa"
  priority-medium-bg: "#f0fdfa"
  priority-medium-text: "#0f766e"
  priority-medium-border: "#ccfbf1"
  priority-low-bg: "#f8fafc"
  priority-low-text: "#64748b"
  priority-low-border: "#e2e8f0"
rounded:
  sm: "4px"
  md: "6px"
  lg: "12px"
  pill: "9999px"
spacing:
  xs: "0.25rem"
  sm: "0.5rem"
  md: "1rem"
  lg: "1.5rem"
  xl: "2rem"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.text-inverse}"
    rounded: "{rounded.md}"
    padding: "0.55rem 1.15rem"
  button-secondary:
    backgroundColor: "{colors.bg-card}"
    textColor: "{colors.text-secondary}"
    rounded: "{rounded.md}"
    padding: "0.55rem 1.15rem"
  button-danger:
    backgroundColor: "{colors.priority-urgent-bg}"
    textColor: "{colors.priority-urgent-text}"
    rounded: "{rounded.md}"
    padding: "0.55rem 1.15rem"
  card-standard:
    backgroundColor: "{colors.bg-card}"
    rounded: "{rounded.lg}"
    padding: "1.5rem"
  input-standard:
    backgroundColor: "{colors.bg-card}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.md}"
    padding: "0.55rem 0.75rem"
---

# Design System: Newtonite Operations

## Overview

**Creative North Star: "The Precision Instrument Workspace"**

Newtonite Operations is an operational workbench engineered for clarity, speed, and authoritative governance of internal company work. Replacing ad-hoc chats, opaque spreadsheets, and fragmented email threads, the interface acts as a calibrated instrument: visual hierarchy is established through high-contrast typography, strict layout containment, semantic pill indicators, and predictable interactive states.

The aesthetic marries deep graphite structural navigation with mineral-white content tiles and targeted deep teal focal accents. Surfaces remain predominantly flat with subtle boundary delineation, avoiding decorative shadows, unnecessary card floating, and saturated neon gradients.

**Key Characteristics:**
- Graphite navigation shell framing high-legibility slate-tinted canvas surfaces.
- Singular deep teal accent reserved exclusively for primary actions, current selections, active focus boundaries, and actionable links.
- Semantic status and priority indicator tokens adhering to distinct role-based background tints and bounding strokes.
- Tabular figures (`tabular-nums`) and monospace identifiers for all entity IDs, numeric timestamps, and queue counts.
- Predictable tactile interaction feedback without heavy choreography or ungrounded motion.

## Colors

The palette balances cool slate neutrals with purposeful semantic indicators and a singular deep teal primary accent.

### Primary
- **Deep Teal** (`{colors.accent}`): Primary interactive action color, focus rings, selected navigation item indicators, and active hyperlink states.
- **Deep Teal Hover** (`{colors.accent-hover}`): Hover elevation on primary actions.
- **Deep Teal Active** (`{colors.accent-active}`): Pressed active state for primary buttons.
- **Teal Subtle** (`{colors.accent-subtle}`): Soft background tint for selection highlights, medium priority badges, and active item detail tabs.
- **Teal Border** (`{colors.accent-border}`): Subtle border framing teal tint containers and text selections.

### Neutral
- **Graphite Sidebar** (`{colors.sidebar-bg}`): Fixed root structural navigation background providing strong spatial anchoring.
- **Sidebar Border** (`{colors.sidebar-border}`): Subtle dark boundary separating navigation from the active canvas.
- **App Background Canvas** (`{colors.bg-app}`): Calm, neutral mineral surface backing all workspace pages.
- **Card Background** (`{colors.bg-card}`): Pure white interior card, row, and form container surface.
- **Muted Surface** (`{colors.bg-card-muted}`): Subtle container background for empty states, table headers, and secondary grouping zones.
- **Border Default** (`{colors.border}`): Standard container divider and outline stroke.
- **Border Strong** (`{colors.border-strong}`): Input outline and prominent boundary stroke.
- **Text Primary** (`{colors.text-primary}`): Slate-900 typography for headlines, titles, and data values.
- **Text Secondary** (`{colors.text-secondary}`): Slate-700 typography for form labels, descriptions, and metadata.
- **Text Muted** (`{colors.text-muted}`): Slate-500 for secondary timestamps, breadcrumbs, and inactive counts.
- **Text Subtle** (`{colors.text-subtle}`): Slate-400 for entity numeric prefixes (`#1234`) and inactive placeholders. Note: Contrast compliance on subtle text is held for final parent visual review and is not canonized as AA-compliant.

### Semantic Status
- **Open**: Unstarted work awaiting triage or claim.
- **In Progress**: Active work under ownership.
- **Awaiting Approval**: Completed work submitted for team lead verification.
- **Resolved**: Approved work state. Note: Resolved is not a terminal state (an item can be reopened or closed).
- **Closed**: Completed terminal state.
- **Cancelled**: Withdrawn or discarded terminal state.

### Named Rules
**The Singular Accent Rule.** Deep teal is the sole primary accent color across the entire application. It is never mixed with secondary brand colors or synthetic gradients.
**The Bounded Indicator Rule.** Status and priority pills must pair an intentional soft background with an identified text color and a bounding 1px stroke.

## Typography

**Display & Body Font Stack:** `system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif`
**Monospace / Identifier Stack:** `ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`

**Character:** Clean, functional system sans-serif rendering crisply across operating systems without external font network dependencies. Specific typography role definitions, weights, and clamp scalings are pending parent sampled computed styles from final rendering.

### Hierarchy
- **Page Header**: Observed in source headers with font weights 700 to 800 and sizes ranging from 1.5rem to 1.75rem.
- **Section / Card Header**: Observed in section headers with font weights 600 to 700 and sizes around 1.125rem to 1.25rem.
- **Work Item Title**: Observed in item titles with font weight 600, line-height 1.3, and size 0.9375rem.
- **Body & Inputs**: Observed in inputs and text with 0.875rem font size and 1.5 line height.
- **Label**: Observed in form labels with font weight 600, size 0.8125rem, and line height 1.
- **Pill / Badge**: Compact metadata with font weight 600 and size 0.75rem.

### Named Rules
**The Tabular Numbers Rule.** All tables, timestamps, entity IDs, and counts must use `font-variant-numeric: tabular-nums` to guarantee vertical column alignment.

## Layout

The spatial model enforces strict desktop density and accessible mobile responsiveness.
- **Desktop Grid & Sidebar:** Desktop layout features a fixed 260px graphite sidebar on the left, paired with a 56px sticky top navigation bar providing breadcrumb orientation and actor session management.
- **Content Max-Width:** Primary workspace queues and administrative lists expand within `max-width: 1200px` with `2rem 1.5rem` outer padding; focused single-column forms (item creation, account settings) constrain to `max-width: 800px`.
- **Responsive Breakpoints:** The application source codebase defines responsive behaviors around explicit media queries (`max-width: 768px` for mobile navigation drawer collapse and single-column grid fallback; `max-width: 600px` for dense admin form grids).
- **Mobile Collapse:** Below 768px, the sidebar collapses into a modal drawer off-canvas, toggled via an accessible mobile menu button with trapped keyboard focus and Escape dismissal. Data tables scroll locally within regional containers rather than causing document-level horizontal overflow.

## Elevation & Depth

Surfaces rely on structural 1px borders and tonal layering.
- **Resting Depth:** Standard cards and table containers rest with a subtle border (`1px solid {colors.border}`) and an ambient micro-shadow (`theme.shadows.sm`: `0 1px 2px 0 rgba(15, 23, 42, 0.04)` or card micro-shadow `0 1px 3px 0 rgba(15, 23, 42, 0.03)`).
- **Interactive Depth:** Primary buttons carry subtle micro-shadows (`0 1px 2px 0 rgba(15, 118, 110, 0.15)`) that collapse into tactile compression (`transform: scale(0.98)`) on `:active`.
- **Modal Depth:** Dialogs and mobile drawers use high-elevation overlays backed by a 50% opacity backdrop scrim (`rgba(15, 23, 42, 0.5)`).

## Shapes

- **Base Radius Scale:**
  - Micro / Controls: `4px` (`rounded.sm`) for compact tags and internal badges.
  - Buttons & Inputs: `6px` (`rounded.md`) for all interactive form inputs, buttons, and selects.
  - Cards & Containers: `12px` (`rounded.lg`) for major white content cards and grouping panels.
  - Badges / Pills: `9999px` (`rounded.pill`) for lifecycle status and priority pills.
- **Borders:** Consistent `1px solid` border framing throughout inputs, cards, and table rows.

## Components

### Buttons
- **Shape:** Rounded rectangle (6px radius).
- **Primary:** Background deep teal (`#0f766e`), text white (`#ffffff`), border `1px solid #0f766e`, padding `0.55rem 1.15rem`, font-weight 600. Hover: `#115e59`. Active: `scale(0.98)`.
- **Secondary:** Background white (`#ffffff`), text slate-700 (`#334155`), border `1px solid #cbd5e1`, padding `0.55rem 1.15rem`, font-weight 500.
- **Danger:** Soft red tint background (`#fef2f2`), red text (`#dc2626`), border `1px solid #fecaca`, padding `0.55rem 1.15rem`, font-weight 600. Matches `commonStyles.buttonDanger` from source.

### Cards & Containers
- **Card:** White background (`#ffffff`), border `1px solid #e2e8f0`, border-radius 12px, box-shadow `0 1px 3px 0 rgba(15, 23, 42, 0.03)`.
- **Card Padded:** Same as Card with `1.5rem` internal padding.

### Inputs & Selects
- **Style:** Background white (`#ffffff`), text slate-900 (`#0f172a`), border `1px solid #cbd5e1`, 6px radius, padding `0.55rem 0.75rem`, font-size `0.875rem`.
- **Focus:** Focus styling matches source `index.html`: `border-color: #0f766e !important` and `outline: 2px solid rgba(15, 118, 110, 0.25) !important`.
- **Label Placement:** Bold label (`#334155`, font-weight 600, `0.8125rem`) positioned directly above the input with `0.375rem` margin.

### Status & Priority Pills
- **Style:** Rounded full pill (`9999px`), inline-flex, padding `0.25rem 0.6rem`, font-size `0.75rem`, font-weight 600, letter-spacing `0.01em`, 1px solid border.

### Table Rows
- **Style:** Flexbox row, padding `0.875rem 1.25rem`, border-bottom `1px solid #f1f5f9`, background white (`#ffffff`).
- **Typography:** Monospace item ID (`ui-monospace`), tabular due date alignment.

### Administrative Teams
- **Selection Above Roster:** A searchable, paginated team picker sits above one full-width members panel, rather than a permanent directory column beside the roster.
- **Compact Membership Rows:** Keep member name and email together, with role controls and removal actions in the same row. On narrow screens, constrain long team names and slugs to the picker width and keep any table overflow local.
- **Stable Search and Selection:** Search inputs preserve typed whitespace while results use trimmed search terms. Equivalent searches retain loaded results; closing the user-provisioning form restores the initial team-picker page on reopening.

### Collaboration Notifications
- **Shared Topbar Bell:** Shared member/admin bell icon in the fixed 56px header featuring a 20px authored SVG bell inside a 44x44 square touch target (`min-width: 44px`, `min-height: 44px`), unread badge with a 99+ cap, and accessible name specifying exact unread count.
- **Real-Time Stream Delivery:** Persistent authenticated Server-Sent Events (SSE) via `/notifications/stream` replacing 30s periodic polling. Initial connection establishes a per-user baseline snapshot to avoid toasting existing history, while subsequent snapshots catch up on missed notifications with automatic deduplication and exponential reconnect backoff.
- **Dismissible Live Toasts:** New collaboration events produce floating dismissible toasts displaying actor name, action badge, and direct work item link (navigating links does not auto-mark notifications as read). Positioned fixed below the header (`top: 72px`, `right: 16px` on desktop, `inset: 16px` on mobile), toasts are bounded by a FIFO queue displaying a maximum of 3 cards simultaneously. Cards feature an ~8s auto-dismiss timer that pauses on hover and keyboard focus, alongside a minimum 44px close button.
- **Directly Responsible Recipients:** Notifications target only directly responsible recipients with the actor excluded:
  - Item assignment: new assignee.
  - Comments and workflow decisions: item creator and current assignee.
  - Approval requests: team leads.
- **Explicit Read Controls:** Explicit read controls via per-notification "Mark as read" and batch "Mark all as read" buttons with minimum 44px touch targets; navigating item deep links does not auto-mark notifications as read.
- **Membership Filtering:** Current team membership filters visible notification history and unread count; retained history reappears upon rejoining the team.
- **Delivery Channels:** Existing email notification coverage remains unchanged alongside in-app collaboration inbox delivery.
## Do's and Don'ts

### Do:
- **Do** use deep teal (`#0f766e`) for all primary actions and focused interactive controls.
- **Do** set `font-variant-numeric: tabular-nums` on all table data, IDs, and timestamps.
- **Do** position form labels directly above inputs with clear 600-weight typography.
- **Do** provide immediate inline conflict banners when an optimistic concurrency 409 conflict occurs.
- **Do** enforce `min-height: 100vh` and respect `prefers-reduced-motion: reduce`.

### Don't:
- **Don't** use decorative gradients or ungrounded card elevations in data tables.
- **Don't** use generic circular spinners when inline status or skeleton placeholders can communicate progress.
- **Don't** mix multiple corner radius styles within the same component hierarchy.
- **Don't** allow horizontal document-level scrolling on mobile viewports (keep tables contained).
- **Don't** treat resolved as terminal (only closed and cancelled are terminal).
