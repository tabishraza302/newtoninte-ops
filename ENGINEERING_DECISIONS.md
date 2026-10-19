# Engineering decisions

## 1. Mutable relational state with transactional history

**Context.** Work items need efficient current-state queries and an explanation of every important change.

**Alternatives.** Database audit triggers hide behavior from service code; full event sourcing makes every query depend on projections and introduces rebuild/versioning obligations.

**Choice.** Store current work-item state in MySQL and append granular activity events through the same transaction. Comments, membership events, administrative audit events, in-app notifications, and outbox jobs have distinct responsibilities. A business change and its associated records commit or roll back together. See `api/src/services/items.ts`, `activity.ts`, `adminAudit.ts`, and `db/schema.ts`.

**Trade-offs.** Each change adds writes. Append-only behavior is enforced by application paths, not by an independent database immutability policy. Activity is an audit trail, not a disaster-recovery replacement for database backups. Invariant tests replay business fields and compare them with the stored item.

## 2. Explicit concurrency guards instead of broad locks

**Context.** Claims race, forms become stale, and network retries can repeat requests.

**Alternatives.** Unconditional updates lose work. Locking every read across user interaction is impractical. A separate distributed lock service adds infrastructure without removing the need for database constraints.

**Choice.** Claims use a conditional update on open/unassigned state. Edits and assignments compare the version the caller observed. Workflow transitions recheck status and permissions under a transaction, and accept an expected version for decisions made from a displayed snapshot. Edit forms retain a coherent baseline rather than silently rebasing a draft. Creation accepts an actor-scoped idempotency key: matching retries return the original receipt, while a different request using that key is rejected. See `api/src/services/items.ts`, `idempotency.ts`, and `web/src/components/ItemForm.tsx`.

**Trade-offs.** Conflicts require user reconciliation; they are not silently merged. Idempotency applies only where explicitly used and expires after 24 hours by default. Comments are not generally request-key deduplicated. Database deadlocks can still occur; transactions retry selected driver errors a bounded number of times. Cursor browsing is not a frozen dataset snapshot when items are reprioritized between requests.

## 3. Live team authorization, separate from platform administration

**Context.** A person can lead one team, view another, and have no access to a third. Permission changes must affect later operations without waiting for an access token's roles to expire.

**Alternatives.** UI-only controls are bypassable. Roles embedded in JWTs become stale. A global administrator bypass would expose unrelated operational work.

**Choice.** Centralize permission decisions in `api/src/policy/index.ts`; resolve roles from current memberships and scope resource queries on the server. Transactional permission reads hold shared locks where necessary. Missing team access returns 404, while insufficient permission within an accessible team returns 403. Platform administrators manage accounts, teams, membership, and jobs without automatically gaining work-item access; item creation is explicitly unavailable to administrators. Sessions use short-lived access JWTs and rotating, hashed-at-rest refresh tokens with family revocation.

**Trade-offs.** Authorization adds database reads and must be applied to every new service operation, including cached receipts. A brief refresh-token grace window tolerates concurrent browser refreshes but narrows theft detection during that interval. Passwords use bcrypt, which is not memory-hard and has a 72-byte input boundary. The role model is intentionally small rather than configurable per action.

## 4. A transactional outbox for email; persistent notifications for collaboration

**Context.** A slow or unavailable mail server must not roll back accepted business work, and a committed change must not lose its queued side effect.

**Alternatives.** Sending SMTP inside a request transaction holds locks across external I/O and can send mail for rolled-back work. Publishing to an external broker after commit introduces a dual-write gap unless another delivery mechanism closes it.

**Choice.** Insert outbox jobs in the business transaction. A separate worker claims bounded batches with `FOR UPDATE SKIP LOCKED`, processes handlers outside the claim transaction, retries with backoff, reclaims expired leases, and fences acknowledgments by claim ownership. Exhausted jobs remain visible and explicitly retryable by administrators. In-app notifications are separate persisted records, filtered by current team membership and available through a paginated feed and authenticated live stream. See `api/src/services/outbox.ts`, `api/src/outbox/worker.ts`, and the notification services.

**Trade-offs.** Email delivery is at-least-once, not exactly-once: SMTP acceptance followed by a lost acknowledgment can cause a duplicate. Unique enqueue keys prevent duplicate queue rows, not duplicate external delivery. Polling adds latency and database work. Live notifications are a bounded convenience channel; the durable feed and activity timeline remain the authoritative history.

## 5. Server-side discovery and bounded client state

**Context.** Teams need attention queues and searchable history without transferring every item to the browser.

**Alternatives.** Client-only filtering requires whole-dataset downloads. Offset pagination becomes increasingly expensive and unstable on a changing list. A dedicated search cluster adds operational complexity before its need is demonstrated.

**Choice.** Filter and authorize in SQL, return cursor pages with explicit limits, and provide focused assigned/urgent/approval/overdue queues. Item search is escaped, title-only substring matching. TanStack Query owns fetched state; dialogs own local drafts; route-level splitting keeps infrequently used screens out of the initial bundle. Activity history and notifications are browsed incrementally. See `api/src/services/items.ts`, `api/src/http/cursor.ts`, and `web/src/api/hooks.ts`.

**Trade-offs.** Leading-wildcard title searches do not gain the usual prefix-index benefit. Successive user-requested pages accumulate in the browser without list virtualization. Live-stream work and transient queues need explicit bounds rather than lifetime-history sets. Functional tests and a 5,000-item demo are not proof of capacity at thousands of simultaneous users; query plans, load testing, retention, and deployment sizing are required before making that claim.
