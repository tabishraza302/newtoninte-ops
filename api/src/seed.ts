import { inArray, sql } from 'drizzle-orm'
import { closeDb, db } from './db/client'
import { memberships, teams, users, workItems } from './db/schema'
import type { NewMembership, NewWorkItem, TeamRow } from './db/schema'
import { ITEM_TYPES, PRIORITIES, STATUSES, type Role, type Status } from './domain/types'
import { hashPassword } from './services/crypto'

// The seed runs against the app database, so its parameter is exactly the
// type exported by src/db/client.ts.
type Db = typeof db

/** Row counts the seed reports back after each run. */
export interface SeedCounts {
  teams: number
  users: number
  items: number
}

/** Every run leaves exactly this many work items on the two demo teams. */
const TARGET_ITEMS = 5000

/** Rows per INSERT statement — large enough to be quick, small enough for max_allowed_packet. */
const INSERT_CHUNK_SIZE = 500

/** Shared demo password, hashed with our bcrypt helper (src/services/crypto.ts). */
const DEMO_PASSWORD = 'Passw0rd!'

const DEMO_TEAMS = [
  { name: 'Operations', slug: 'ops' },
  { name: 'Finance', slug: 'finance' },
]

interface DemoUser {
  email: string
  displayName: string
  isAdmin: boolean
  /** Role held on both demo teams; the admin holds no membership. */
  role?: Role
}

const DEMO_USERS: DemoUser[] = [
  { email: 'admin@newtonite.test', displayName: 'Admin User', isAdmin: true },
  { email: 'lead@newtonite.test', displayName: 'Lead User', isAdmin: false, role: 'lead' },
  { email: 'member@newtonite.test', displayName: 'Member User', isAdmin: false, role: 'member' },
  { email: 'viewer@newtonite.test', displayName: 'Viewer User', isAdmin: false, role: 'viewer' },
]

// Fixed title fragments and fixed due-date anchors keep the generated data
// reproducible: no Math.random(), no Date.now()-dependent values.
const TITLE_SUBJECTS = [
  'reconcile the nightly settlement batch',
  'triage webhook delivery failures',
  'rotate expiring API credentials',
  'audit access-log retention',
  'patch vulnerable transitive dependency',
  'chase overdue customer invoice',
  'drill password-reset latency',
  'review flaky end-to-end suite',
  'clean up orphaned oauth grants',
  'migrate legacy import script',
  'document incident runbook',
  'verify backup restore procedure',
]

const DAY_MS = 86_400_000
const OVERDUE_ANCHOR = Date.UTC(2025, 5, 1) // 2025-06-01
const UPCOMING_ANCHOR = Date.UTC(2035, 0, 1) // 2035-01-01 — far enough out that "future due" never decays into "overdue"

// A 60-slot status cycle — the lcm of the 2/4/5 attribute moduli below, so
// every row's attributes are a pure function of its slot. Open dominates like
// a real ops backlog; all six domain statuses appear. Weights are in STATUSES
// order (domain/types.ts): open 24, in_progress 12, awaiting_approval 6,
// resolved 9, closed 6, cancelled 3.
const STATUS_WEIGHTS: readonly number[] = [24, 12, 6, 9, 6, 3]
const STATUS_CYCLE: Status[] = STATUSES.flatMap((status, idx) => Array<Status>(STATUS_WEIGHTS[idx]!).fill(status))

// Cycle slots [0, 15) are open-and-unassigned: exactly 15/60 = 25% of all
// items. Every unassigned item is open — spec §6 allows a NULL assignee only
// for open items (an item is never in_progress without an assignee).
const UNASSIGNED_SLOTS = 15

// Terminal statuses per spec §6: only closed and cancelled. Resolved items can
// still transition (to closed, or reopen to in_progress), so they are not
// terminal and can be overdue.
function isTerminal(status: Status): boolean {
  return status === 'closed' || status === 'cancelled'
}

/**
 * Builds `count` deterministic work-item rows continuing the global sequence
 * at `startIndex`. Every modulo index is in range, so the non-null assertions
 * always hold. A past `dueAt` goes only to non-terminal items on a 1-in-5
 * cadence (~20% of non-terminal items overdue); every other item — terminal
 * ones included — gets a far-future due date. Only open items are unassigned
 * (spec §6); assignees and creators are the lead and member users only.
 */
function buildItemRows(startIndex: number, count: number, demoTeams: TeamRow[], assigneeIds: number[]): NewWorkItem[] {
  const rows: NewWorkItem[] = []
  for (let n = 0; n < count; n++) {
    const i = startIndex + n
    const slot = i % STATUS_CYCLE.length
    const team = demoTeams[i % demoTeams.length]!
    const type = ITEM_TYPES[i % ITEM_TYPES.length]!
    const priority = PRIORITIES[i % PRIORITIES.length]!
    const status = STATUS_CYCLE[slot]!
    // (i >> 1) & 1 alternates lead/member with period 4, decorrelated from the
    // team (i % 2); the creator is the other of the two.
    const assigneeSlot = (i >> 1) & 1
    const assigneeId = slot < UNASSIGNED_SLOTS ? null : assigneeIds[assigneeSlot]!
    const createdBy = assigneeIds[1 - assigneeSlot]!
    const dueAt =
      !isTerminal(status) && i % 5 === 0
        ? new Date(OVERDUE_ANCHOR - ((i % 30) + 1) * DAY_MS)
        : new Date(UPCOMING_ANCHOR + (i % 60) * DAY_MS)
    rows.push({
      teamId: team.id,
      title: `[${type}] ${TITLE_SUBJECTS[i % TITLE_SUBJECTS.length]!} (${team.slug} #${i + 1})`,
      description: `Seeded ${type} item #${i + 1} for the ${team.name} demo team.`,
      type,
      priority,
      status,
      assigneeId,
      createdBy,
      dueAt,
    })
  }
  return rows
}

/**
 * Idempotently seeds the demo dataset and returns the row counts present
 * afterwards. Teams, users and memberships upsert on their unique keys
 * (`INSERT ... ON DUPLICATE KEY UPDATE id = id`, which MariaDB applies to any
 * unique-key collision), so re-runs never duplicate those rows. `work_items`
 * has no unique constraint, so items are seeded by count instead: each call
 * inserts only the shortfall up to TARGET_ITEMS for the two demo teams, so a
 * second call inserts nothing and the reported item count stays put.
 */
export async function runSeed(db: Db): Promise<SeedCounts> {
  const passwordHash = await hashPassword(DEMO_PASSWORD)
  await db.insert(teams).values(DEMO_TEAMS).onDuplicateKeyUpdate({ set: { id: sql`id` } })
  await db
    .insert(users)
    .values(
      DEMO_USERS.map((u) => ({
        email: u.email,
        passwordHash,
        displayName: u.displayName,
        isAdmin: u.isAdmin,
      })),
    )
    .onDuplicateKeyUpdate({ set: { id: sql`id` } })

  const teamRows = await db.select().from(teams).where(inArray(teams.slug, DEMO_TEAMS.map((t) => t.slug)))
  const teamIdBySlug = new Map(teamRows.map((row) => [row.slug, row.id]))
  const userRows = await db.select().from(users).where(inArray(users.email, DEMO_USERS.map((u) => u.email)))
  const userIdByEmail = new Map(userRows.map((row) => [row.email, row.id]))

  const membershipValues: NewMembership[] = []
  for (const u of DEMO_USERS) {
    if (!u.role) continue
    for (const t of DEMO_TEAMS) {
      membershipValues.push({ userId: userIdByEmail.get(u.email)!, teamId: teamIdBySlug.get(t.slug)!, role: u.role })
    }
  }
  await db.insert(memberships).values(membershipValues).onDuplicateKeyUpdate({ set: { id: sql`id` } })

  const opsTeam = teamRows.find((row) => row.slug === 'ops')!
  const financeTeam = teamRows.find((row) => row.slug === 'finance')!
  const teamIdList = [opsTeam.id, financeTeam.id]
  const [existingItemsRow] = await db
    .select({ items: sql<number>`COUNT(*)` })
    .from(workItems)
    .where(inArray(workItems.teamId, teamIdList))
  const existingItems = existingItemsRow?.items ?? 0
  const shortfall = Math.max(0, TARGET_ITEMS - existingItems)
  if (shortfall > 0) {
    // Only lead and member receive items — a viewer has no write role (§7).
    const assigneeIds = DEMO_USERS.filter((u) => u.role === 'lead' || u.role === 'member').map((u) => userIdByEmail.get(u.email)!)
    const itemRows = buildItemRows(existingItems, shortfall, [opsTeam, financeTeam], assigneeIds)
    for (let offset = 0; offset < itemRows.length; offset += INSERT_CHUNK_SIZE) {
      await db.insert(workItems).values(itemRows.slice(offset, offset + INSERT_CHUNK_SIZE))
    }
  }

  const [teamCountRow] = await db
    .select({ teams: sql<number>`COUNT(*)` })
    .from(teams)
    .where(inArray(teams.slug, DEMO_TEAMS.map((t) => t.slug)))
  const [userCountRow] = await db
    .select({ users: sql<number>`COUNT(*)` })
    .from(users)
    .where(inArray(users.email, DEMO_USERS.map((u) => u.email)))
  const [itemCountRow] = await db
    .select({ items: sql<number>`COUNT(*)` })
    .from(workItems)
    .where(inArray(workItems.teamId, teamIdList))
  return {
    teams: teamCountRow?.teams ?? 0,
    users: userCountRow?.users ?? 0,
    items: itemCountRow?.items ?? 0,
  }
}

if (import.meta.main) {
  try {
    const counts = await runSeed(db)
    console.log(`seeded ${counts.teams} teams, ${counts.users} users, ${counts.items} work items`)
  } catch (error) {
    console.error('seed failed:', error)
    process.exitCode = 1
  } finally {
    await closeDb()
  }
}
