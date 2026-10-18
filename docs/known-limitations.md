# Known limitations

Newtonite Ops v1 is complete and honest about its edges. Every entry below names the
mechanism in this repository that produces the limitation (with the file and line it lives
at), the consequence an operator or reviewer should expect, and what would remove it. Nothing here is a measurement taken on faith: each behaviour
is either readable in the cited code, or was observed directly on this build.

## Correctness and delivery

- **Email delivery is at-least-once, not exactly-once.** The worker runs a job's handler and
  only then flips the row to `done` (`api/src/outbox/worker.ts:197-208`). A handler that
  throws — including an SMTP send the server accepted but whose reply the client never read —
  increments `attempts` and returns the job to `pending` with backoff, so it is sent again
  (the one failure transition, `api/src/outbox/worker.ts:209-216` calling
  `api/src/outbox/worker.ts:43-71`; `max_attempts` default 5 at `api/src/db/schema.ts:255`).
  `dedupe_key` de-duplicates the *enqueue*, never the send
  (`api/src/services/outbox.ts:39`, `api/src/db/schema.ts:260`). A crash between the claim and
  the `done` update is the opposite failure and just as real, but it is no longer a silent
  loss: step 0 of every pass reclaims rows whose `status='processing'` and whose `locked_at` is
  older than `WORKER_LEASE_SEC` (default 300 s) and drives them through that same failure
  transition, so the message becomes deliverable again
  (`api/src/outbox/worker.ts:113-138`; `api/src/config.ts:14`; `.env.example:17`). The residual
  risk is the double send the re-delivery creates — a handler that legitimately outlives the
  lease runs twice (`api/src/outbox/worker.ts:99-103`), which only a provider-side idempotency
  token would close. A reclaimed row is also a partly mute witness: the sweep writes
  `last_error` only when the row has none, so a row whose handler had already reported a
  failure keeps *that* message rather than "the lease expired"
  (`api/src/outbox/worker.ts:132-137`). *Removed by:* a provider-side idempotency token on
  send, or a per-attempt audit instead of one `last_error` column.

- **The worker polls; it is never woken.** `startWorker` is a `setTimeout` loop
  (`api/src/outbox/worker.ts:226-268`) that claims a batch every `WORKER_INTERVAL_MS`
  (default 3000 ms — `api/src/config.ts:12`, `.env.example:15`) with
  `FOR UPDATE SKIP LOCKED` (`api/src/outbox/worker.ts:141-170`). MySQL has no `LISTEN/NOTIFY`.
  *Consequence:* invite/reset/assignment mail is late by up to one interval plus the job's
  backoff, and every idle tick costs a lease sweep plus a claim query against `outbox_jobs`
  (`api/src/outbox/worker.ts:113-138`, `api/src/outbox/worker.ts:141-153`). *Removed by:* a broker,
  or a database-native wake mechanism.

- **Deadlocks are retried, not eliminated.** MySQL's default `REPEATABLE READ` takes gap locks
  under concurrent writes.
  `withTransaction` retries errno 1213/1205 up to three times with jittered backoff and
  rethrows anything else (`api/src/db/tx.ts:6`, `api/src/db/tx.ts:44-59`). *Consequence:* a
  transaction that loses every retry fails to the caller as a `500`; the retry buys headroom,
  not immunity. *Removed by:* narrower transactions and fewer contended gap locks (for the
  cases that allow it), keeping the wrapper as a safety net.

- **Idempotency keys expire after 24 h.** A keyed request stores its response with an
  `expires_at` (`api/src/services/idempotency.ts:106-118`); past expiry the stored row is
  deleted and the handler runs again (`api/src/services/idempotency.ts:85-101`). The default
  TTL is 86400 s (`api/src/config.ts:11`, `.env.example:14`). *Consequence:* a retry after
  expiry is a new operation — a second item, not a replay — so clients that retry on a timer
  longer than a day are not protected. *Removed by:* a longer or unbounded TTL plus an
  explicit retention policy for the table.

- **The rate limiter's buckets live in one process's memory.** `rateLimit()` closes over a
  `new Map` (`api/src/http/middleware/rateLimit.ts:9-10`) keyed by client IP plus route.
  *Consequence:* counters reset on every api restart, and running more than one api process
  makes the effective limit a multiple of the configured one, because each process counts
  alone. *Removed by:* a store shared across processes (MySQL or Redis) with the same key.

## API and data model

- **Search is an escaped `LIKE` on `title`.** The query builds a `%…%` substring match with
  `%`, `_` and `\` escaped (`api/src/services/items.ts:50-55`,
  `api/src/services/items.ts:146-148`). A leading wildcard cannot use an index, no index
  covers `title` (`api/src/db/schema.ts:195-200`), and there is no `FULLTEXT` index anywhere in
  the schema or migrations. **Elasticsearch is deferred**. *Consequence:* results stay
  correct but each search scans the actor's scoped item set. *Removed by:*
  `FULLTEXT(title, description)` (mind `innodb_ft_min_token_size`), or the deferred
  Elasticsearch.

- **Comments cannot be edited or deleted.** The table is append-only by construction — it has
  no `updated_at` (`api/src/db/schema.ts:223-224`) — and the only route is
  `POST /items/:id/comments` (`api/src/http/routes/items.ts:303-304`). *Consequence:* a typo
  in a comment is permanent; corrections can only be new comments, and each of those adds an
  activity event too. *Removed by:* PATCH/DELETE routes plus `updated_at` and a new
  authorization action, since the current verb set has only `item:comment`
  (`api/src/policy/index.ts:41-46`).

- **Roles are read from the database on every request.** `roleIn`/`membershipsOf` query
  `memberships` per call (`api/src/policy/index.ts:9-11`, `api/src/policy/index.ts:17-32`) and
  the auth middleware reloads the user row for each authenticated request
  (`api/src/http/middleware/auth.ts:47-56`). This is deliberate: a role change or a disabled
  account takes effect on the actor's very next request instead of when a token expires. *Consequence:* one or
  two extra reads per authorized request — a correctness-over-speed trade-off to revisit at
  10×. *Removed by:* a membership cache invalidated explicitly on membership writes.

- **No realtime; clients pull.** The web client reads through TanStack Query
  (`web/src/api/hooks.ts:1-7`), and there is no `EventSource`, WebSocket or
  `text/event-stream` anywhere in `api/src` or `web/src`. *Consequence:* a view is stale until
  the client refetches, and two people on one item can hold different versions; the server
  settles that with a version check that answers `409 STALE_STATE`
  (`api/src/services/items.ts:755-757`, `api/src/services/items.ts:888-890`) instead of pushing
  the change. *Removed by:* an SSE or WebSocket channel fed by `activity_events`.

- **The personal Kanban board is deferred.** Not implemented. *Consequence:* "my work" is
  a filtered, paginated list (`web/src/pages/ItemList.tsx`), not a drag-and-drop board — no
  columns, WIP limits or swimlanes. *Removed by:* a view over the endpoints that already
  exist: columns = statuses, drag = `/transition` with optimistic rollback.

## Environment and operations

- **Passwords use bcrypt.** The implementation hashes and verifies passwords with
  `Bun.password` (`api/src/services/crypto.ts`). Bcrypt is not memory-hard and truncates
  input past 72 bytes. Switching algorithms requires password migration, such as rehashing
  on the next successful login.

- **One database, one worker process — and the delivered stack runs exactly one worker.** Compose
  defines one `mysql`, one `api` and one `worker`, the last two off the same image
  (`docker-compose.yml:17-116`): no read replicas, no partitioning, no broker, no second worker. The worker is a separate
  process (`api/src/worker-main.ts:1-4`, `api/package.json:8`) and the stack now does launch it: the
  `worker` service runs `bun run worker` after `mysql` is healthy and `api` is healthy — that is,
  after the migrations and seed — while the `api` command stays
  `bun run db:migrate && bun run seed && bun run start` and that start script serves HTTP only
  (`docker-compose.yml:82-104`, `docker-compose.yml:47-49`, `api/src/index.ts:1-8`), and root
  `bun run dev` starts api, web and worker together (`package.json:6`). *Consequence:* database
  throughput and that single worker process are the whole system's throughput, and nothing else
  drains `outbox_jobs` — one poller for every team's mail, with no failover and no replica, so a
  stopped `worker` stalls all invitation, password-reset and assignment mail while the ops screen
  reports the rows `pending`. *Removed by:* worker replicas (the claim is
  `FOR UPDATE SKIP LOCKED`, so a second worker is safe) plus a broker when the load demands it.

- **The `resend` mail driver has never run.** `buildTransport` branches on `MAIL_DRIVER`
  (`api/src/outbox/mailer.ts:39-49`), but everything exercised is the `mailpit` branch: the
  suite points SMTP at the local sink (`api/vitest.config.ts:22-25`) and the real-SMTP test
  asserts against Mailpit's HTTP API (`api/tests/outbox/mailer.test.ts:7`,
  `api/tests/outbox/mailer.test.ts:92-96`), while the config tests cover only the default and
  an unknown value (`api/tests/config.test.ts:15`, `api/tests/config.test.ts:17-18`). No API
  key was available, so Resend's endpoint and credential parsing
  (`api/src/outbox/mailer.ts:31-37`, `api/src/outbox/mailer.ts:40-46`) are unproven. *Removed
  by:* a Resend key in CI, or another real SMTP capture that drives the same code path.

- **The compose path is exercised by hand, not by `bun run test`.** The stack pins `mysql:8.0`
  (`docker-compose.yml:19`) and expects the `api` image to migrate, seed and start inside itself
  (`docker-compose.yml:47-49`), while the development and test loop runs the api as a plain Bun
  process against the database `TEST_DATABASE_URL` names, defaulting to `127.0.0.1:3306`
  (`api/vitest.config.ts:15-17`). Both answered `8.0.46` for `SELECT VERSION()`, so this is not a
  MariaDB-versus-MySQL divergence: the engine is the pinned MySQL 8 on either path. What was
  verified by hand on this build: `docker compose up -d --build --wait` brings up `mysql`,
  `mailpit`, `api` (healthy), `worker` and `web`; the nginx single-origin proxy serves the built
  SPA on `:8080` and proxies `/health` → `{"status":"ok"}` and `/ready` → `{"status":"ready"}`; an
  invited address gets its mail in Mailpit within seconds, carrying
  `http://localhost:8080/redeem?code=…`; redeeming that code returns a session, a replay with the
  same password returns `409` (the membership check fires before another use is spent), and a replay
  with no password for the account it just created returns `403`. What is still not covered: no test
  asserts any of it, so the image builds, the compose `db:migrate && seed && start` command and the
  proxy are only as good as the last manual run. *Removed by:* running that smoke in CI, where it re-runs on
  every push.

- **There is no CI pipeline.** The repository contains no CI configuration at all — no
  `.github/workflows`, no equivalent — and the root scripts are local-only
  (`package.json:5-12`). *Consequence:* nothing runs `bun run test` or `bun run typecheck`
  automatically, so the test suite is green only when a
  human runs it, and it gates no merge. *Removed by:* a workflow that provisions MySQL and
  Mailpit, then runs `bun run test && bun run typecheck` on every push.
