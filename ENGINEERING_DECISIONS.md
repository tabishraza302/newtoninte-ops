# Engineering decisions

Five decisions carry this system: how state and history are stored, how concurrent writers are
policed, where authorization is decided, how side effects leave the request, and how accounts and
sessions exist at all. Each decision describes its context, options, choice, and trade-off, with references to the implementation.

---

## 1. Data model: mutable state, append-only history, one transaction

**Context.** The thesis is that history can never disagree with current state: an item's row and the
record of how it got there are the same fact seen twice. MySQL offers no `RETURNING`, so a write has
to be re-read inside its own transaction to know what changed, and the default isolation level
(`REPEATABLE READ`) makes read-then-write sequences racy. Every write therefore runs through one
wrapper, `withTransaction` (api/src/db/tx.ts:44-61), which is also where deadlock retry lives.

**Options.** (a) Audit triggers on the mutable tables — invisible to the application, but the audit
row then bypasses the application's transaction handle and cannot carry the actor or a plain-language
event type without extra plumbing. (b) Full event sourcing — state derived by replaying events — which
makes every read a fold and every query a projection to maintain. (c) A mutable row plus an
append-only event table written through the *same* transaction handle as the change.

**Choice.** (c). `activity_events` and `comments` are append-only, carry no `updated_at`, and have no
update or delete path (api/src/db/schema.ts:203-240; docs/architecture.md:375-377).
`recordActivity` inserts through the caller's `Tx` (api/src/services/activity.ts:13-22), and
`recordFieldChanges` writes one event per changed field (api/src/services/activity.ts:32-73), so a
patch that changes `title` and `priority` leaves two rows, not one blob. Claim shows the shape
exactly: one guarded `UPDATE`, then `assignee_changed` and `status_changed` in the same transaction
(api/src/services/items.ts:672-709). Creation writes the item, the `created` event carrying the full
initial field set as `metadata` (needed so history is replayable from the first row), and the
assignment email job in one transaction (api/src/services/items.ts:410-476). Membership follows the
same pattern with `membership_events` — role change and `role_changed` row commit together
(api/src/services/memberships.ts:195-207). The rule is proven, not asserted: an integration test
drives an item through create → patch → claim → assign → submit → send-back → approve → patch →
comment and asserts the replayed event log equals the live row field by field
(api/tests/services/invariant.test.ts:42-149).

**Trade-off.** Write amplification: every changed field costs one extra insert inside the write
transaction, and the guarantee is structural rather than database-enforced — a future caller that
writes `work_items` outside `withTransaction` silently produces state that history cannot explain,
with no constraint to stop it. There is no event-sourced rebuild path either: history is an audit
trail and a UI timeline, not the source of truth, so corrupting `work_items` is not recoverable by
replay. `outbox_jobs` deliberately carries no foreign keys (docs/architecture.md:354-356) so a job can
be enqueued alongside any change; the cost is that job rows are not protected by referential
integrity.

## 2. Concurrency control: compare-and-set writes, an optimistic `version`, and idempotency keys

**Context.** Two people can click "claim" on the same item; a form open in a tab can submit an edit
built on a version that no longer exists; a double-click or a network retry can post the same create
twice. Pessimistic locking across every read would serialise the API, and a stale write silently
overwriting a newer one is precisely the failure the system exists to prevent.

**Options.** (a) `SELECT … FOR UPDATE` the row, decide in application code, write — correct but holds
locks across round trips and invites deadlocks. (b) An external lock manager (Redis) — new
infrastructure the project explicitly excludes. (c) Compare-and-set predicates in the `WHERE` clause
plus a client-supplied `Idempotency-Key` for retries: the database decides the winner in one
statement, and retries replay a stored response instead of repeating the effect.

**Choice.** (c). Claim is a single guarded `UPDATE` requiring `status='open' AND assignee_id IS NULL`;
zero affected rows means `ALREADY_CLAIMED` (409), and the role check happens in the policy module
*before* the statement so the SQL deliberately encodes no role
(api/src/services/items.ts:665-692). Partial edits compare-and-set the `version` the client saw —
`WHERE id = ? AND version = ?`, zero rows → `VERSION_CONFLICT` (409) with the current item in the
body — and the `UPDATE` is assembled only from the fields actually present in the request
(api/src/services/items.ts:590-644); the client passes that version as `If-Match` or a `version`
body field (api/src/http/routes/items.ts:213-227). Transitions compare-and-set the expected `from`
status and return `STALE_STATE` (409) when the item moved underneath the caller
(api/src/services/items.ts:879-890), and `/assign` compares-and-sets `version` the same way
(api/src/services/items.ts:746-757). Retries are absorbed by `withIdempotency`: it takes the key row
under a lock, replays the stored status and body for a repeat, throws
`IDEMPOTENCY_KEY_MISMATCH` (422) when the same key arrives with a different canonicalised body, and
stores the response with a TTL (api/src/services/idempotency.ts:74-131); the unique
`(user_id, key)` constraint (api/src/db/schema.ts:290) turns a true concurrent race into a duplicate
key error, which is retried and then replayed (api/src/services/idempotency.ts:48-60, 133-137). Six
parallel requests carrying one key yield exactly one item and identical bodies
(api/tests/services/invariant.test.ts:203-268).

**Trade-off.** Deadlocks are **retried, not eliminated** — the system accepts `REPEATABLE READ` gap
locks and bounds the damage with a wrapper that retries error 1213 (deadlock) and 1205 (lock-wait
timeout) up to three times with jittered backoff (api/src/db/tx.ts:33-61).
That wrapper has to read the raw driver `errno` off `err.cause` because Drizzle wraps in-transaction
errors (api/src/db/tx.ts:23-37): a subtlety that would silently disable all retrying if it regressed.
Idempotency keys expire (24h by default, api/src/services/idempotency.ts:106-107,
.env.example:14), so a retry that arrives after expiry is a genuinely new operation — the honest
boundary of store-and-replay. `If-Match` is parsed by hand including the `W/` prefix strip
(api/src/http/routes/items.ts:216) rather than implemented as full HTTP entity-tag semantics, and
every successful write bumps `version`, so a client must refetch after any change before its next
partial edit.

## 3. Authorization: one module, and 404 before 403

**Context.** Roles are per-team (`viewer`/`member`/`lead`) plus a narrow global `is_admin`, and the
same person can be a lead in one team and a stranger in another. Authorization must therefore be
resolved *for the resource's team* on every call, must never leak the existence of another team's
work, and must not be duplicated into routes and services where one copy will drift.

**Options.** (a) Roles inside the access token — no DB read per request, but a role change stays
stale until the token expires, and demotion must take effect immediately. (b) Per-route middleware
(each route declares what it needs) — readable, but the same action is then checked in several
places. (c) One module exposing exactly two entry points — a resource decision and a query-scope
helper — with every service required to call it.

**Choice.** (c). `api/src/policy/index.ts` holds `can(actor, action, resource)`
(api/src/policy/index.ts:56-107), `scopeTeamIds(actor)` (api/src/policy/index.ts:113-116) and
`authorize(...)` (api/src/policy/index.ts:123-136), and roles are read live from `memberships` on
each request rather than trusted from the token (api/src/policy/index.ts:9-11, 71). `authorize` is
where the leak rule lives: no membership in the resource's team → `NOT_FOUND` (404); a member who
may not perform the action → `FORBIDDEN` (403). Reads are scoped in SQL, not filtered afterwards —
lists add `inArray(workItems.teamId, targetTeamIds)` (api/src/services/items.ts:127) and a `?team=`
the caller does not belong to returns 404 rather than an empty page
(api/src/services/items.ts:84-88). Admin is a fixed short list of actions that ignores team
membership and nothing else (api/src/policy/index.ts:62-67). Services call `authorize` before
touching rows, e.g. claim (api/src/services/items.ts:665-670), and the outsider-404 rule is pinned
by a route test (api/tests/routes/items-read-hardening.test.ts:14).

**Trade-off.** A membership read happens on every authorized request, on top of the query it guards.
That is the accepted price for role changes taking effect on the very next request.
The 404-before-403 rule prevents callers from probing other teams' resources. A rule enforced by
convention is only as good as its coverage: a new query that forgets its scope predicate fails open, which is why the
scoping cases carry their own tests rather than relying on the module's existence.

## 4. Sync vs async: a transactional outbox on MySQL, not a message broker

**Context.** Assigning an item must email the assignee, but a side effect must never fire for a
transaction that rolled back, and a committed change must never lose its email. There is no separate queue
infrastructure in the project, and the trigger for the side effect is always already inside a database transaction.

**Options.** (a) Send mail inline in the request: simplest, but a slow or failing SMTP call becomes
the caller's problem and an email can be sent for a transaction that later rolls back. (b) Publish to
an external broker after commit: re-opens the dual-write window the outbox exists to close, unless
the broker itself is written to transactionally. (c) Insert a job row in the *same* transaction as
the change, and drain it with a poller.

**Choice.** (c). `enqueue(tx, job)` takes the caller's transaction handle so job and change commit or
roll back together; `dedupe_key` is unique and a repeat enqueue is an explicit no-op
(`ON DUPLICATE KEY UPDATE id = id`), preserving the original row's payload and claim state, and
`available_at` is computed by the database clock so it agrees with the worker's comparisons
(api/src/services/outbox.ts:26-39; api/src/db/schema.ts:260). The worker claims a batch with
`status='pending' AND available_at <= NOW(3)`, `ORDER BY id LIMIT n`, `FOR UPDATE SKIP LOCKED`, marks
it `processing` with `locked_by`, and runs handlers *outside* the lock
(api/src/outbox/worker.ts:44-73); success nulls the payload and marks `done`, failure increments
`attempts` and schedules exponential backoff `min(2^attempts · 5s, 300s)` with `last_error`, or
parks the row as `failed` at `max_attempts` (default 5) so a broken job stays visible instead of
disappearing (api/src/outbox/worker.ts:18-21, 100-143; api/src/db/schema.ts:251-255). Cadence and
batch size are configuration, defaulting to a 3000 ms poll of 10 jobs
(api/src/outbox/worker.ts:158, 163-178; .env.example:15-16). Handlers are the three real email types
over real SMTP (api/src/outbox/handlers.ts:123-139). The dividing line is stated in one sentence in
the architecture doc: anything that must be consistent with the item is synchronous; anything that
is a side effect which can fail and retry is a job (docs/architecture.md:415-416).

**Trade-off.** Delivery is **at-least-once**, not exactly-once: a crash between "sent" and "marked
done" can double-send, mitigated by the `dedupe_key` and not eliminated. Notification latency is
bounded by the poll interval rather than by an event, and the queue is a table, so worker activity
appears as ordinary row contention — the poller's own load is part of the database's. `SKIP LOCKED` requires MySQL 8,
which is why the deliverable pins `mysql:8.0` (docker-compose.yml:19).

## 5. Auth: closed registration by invitation, refresh rotation with family revocation

**Context.** There is no public signup: an account exists only because someone invited a specific
address. A stolen refresh token must be detectable and its whole lineage revocable, while a browser's
ordinary behaviour — two tabs refreshing at once — must not be mistaken for theft. The refresh cookie
is `httpOnly`/`Secure`/`SameSite=Lax` with `Path=/auth`
(api/src/http/cookies.ts:7-13), which constrains where the API may live.

**Options.** (a) Open registration with email verification — familiar, but it makes "who may exist"
an email-deliverability question. (b) An invitation link that is not bound to an address — simpler to
share, and precisely the wrong property for an internal ops tool. (c) An email-bound, single-use,
hashed-at-rest invitation token redeemed through the same compare-and-set idiom as claiming an item,
paired with short-lived access tokens and rotating refresh tokens grouped into families.

**Choice.** (c). Creating an invitation generates a 32-byte random token, stores only
`sha256(token)`, sets `uses`/`max_uses` and an expiry, and mails the plaintext token to the invitee
(api/src/services/invitations.ts:68-90); redemption requires the redeemer's address to match the
invitation on both branches — the submitted email when unauthenticated, the authenticated user's
stored email otherwise — and answers `FORBIDDEN` (403) when it does not
(api/src/services/invitations.ts:224-238). An existing member is rejected *before* a use is spent
(api/src/services/invitations.ts:294-303), and the seat itself is taken by a compare-and-set
`uses < max_uses AND revoked_at IS NULL AND expires_at > NOW(3)`, with the failing row re-read so the
caller gets `INVITE_REVOKED`, `INVITE_EXPIRED` or `INVITE_EXHAUSTED` rather than a generic conflict
(api/src/services/invitations.ts:306-336). The auth router exposes login, refresh, logout, password
forgot/reset and me — there is no register endpoint — and login, forgot and reset are rate-limited
(api/src/http/routes/auth.ts:40-111); redeem is unauthenticated by design and sets the refresh cookie
on success (api/src/http/routes/invitations.ts:80-87). Sessions rotate: the presented token's row is
locked by hash (api/src/services/sessions.ts:72-76), a successor is minted in the same family, and the
presented token is marked revoked with `replaced_by` recorded (api/src/services/sessions.ts:134-154).
A revoked token presented within the 10 s grace window while a live successor exists is treated as a
benign concurrent refresh: the family's active tokens are revoked and a fresh successor is issued
(api/src/services/sessions.ts:90-123; .env.example:6). Outside that window, reuse revokes the entire
family and answers `UNAUTHENTICATED` (api/src/services/sessions.ts:126-131, 165). Only digests are
stored (api/src/services/crypto.ts:39-41), so the successor is re-derived, never read back from the
database.

**Trade-off.** Passwords are hashed with **bcrypt** using one dependency-free call to `Bun.password.hash(pw, { algorithm: 'bcrypt' })`
(api/src/services/crypto.ts:12-13). The costs are real and worth naming: bcrypt is not memory-hard, so
it is weaker than argon2id against GPU-accelerated cracking at comparable cost. The 10 s rotation grace
window is a deliberate, narrow blind spot in theft detection, bought so that two concurrent refreshes
from the same browser do not log the user out and revoke their whole family
(api/src/services/sessions.ts:90-123). Binding an invitation to an address means a typo burns a seat
and the invitee must control that mailbox, with no resend shortcut. And roles are read from
`memberships` per request instead of being embedded in the access token — the same trade-off as
decision 3, taken knowingly for immediacy over per-request cost.

---

## What we chose not to build

- **A message broker or cache.** No Redis, no queue service: the outbox table is the queue, and the
  stateless API holds no session state. Exactly-once delivery is therefore also not claimed — the `dedupe_key` narrows the
  duplicate window, it does not close it.
- **A search engine.** Search is an escaped `LIKE` on `title`
  (api/src/services/items.ts:50-55), which is honest about its limits: no leading-wildcard index, and
  Elasticsearch stays deferred.
- **Realtime.** No websockets, no server push: clients poll and refetch.
- **Event sourcing / CQRS.** History is an append-only audit trail beside mutable state, not the
  source of truth; there is no projection to rebuild and no replay-to-recover path.
- **Offset pagination.** Keyset cursors on every list, with the cursor fingerprinted to its filter
  scope so a cursor cannot be replayed against a different query
  (api/src/services/items.ts:57-68; api/tests/routes/items-read-hardening.test.ts:115).
- **Editable comments.** Comments are append-only by design in this version; the row has no `updated_at` and no
  update path (api/src/db/schema.ts:223-240).
- **Long-lived idempotency keys.** They expire after 24 h, so "retry after expiry" is a new operation.
- **Attachments, SSO/OAuth/MFA, mobile, i18n**.
- **An admin superuser over work items.** `is_admin` is seed-only and grants a short, enumerated list
  — team creation, direct member add, listing all teams, job management — and nothing about other
  teams' items (api/src/policy/index.ts:62-67).
- **A Kanban board.** Deferred, along with Elasticsearch.
- **Silent job drops, soft deletes, or replicated topology.** A job that exhausts `max_attempts`
  becomes a visible `failed` row with `last_error` (api/src/outbox/worker.ts:120-129); there is one
  database and one worker process, with no partitioning or read replicas.
