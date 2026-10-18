# Known limitations

Newtonite Ops v1 is complete and honest about its edges. Every entry below names the
mechanism in this repository that produces the limitation (with the file and line it lives
at), the consequence an operator or reviewer should expect, and what would remove it. Nothing here is a measurement taken on faith: each behaviour
is either readable in the cited code, or was observed directly on this build.

## Correctness and delivery

- **Email delivery is at-least-once, not exactly-once.** The worker runs a job's handler and
  only then flips the row to `done` (`api/src/outbox/worker.ts:95-111`). A handler that
  throws — including an SMTP send the server accepted but whose reply the client never read —
  increments `attempts` and returns the job to `pending` with backoff, so it is sent again
  (`api/src/outbox/worker.ts:112-142`; `max_attempts` default 5 at `api/src/db/schema.ts:255`).
  `dedupe_key` de-duplicates the *enqueue*, never the send
  (`api/src/services/outbox.ts:39`, `api/src/db/schema.ts:260`). A crash between the claim and
  the `done` update is the opposite failure and just as real: the row stays `processing` and
  is never re-claimed (the claim selects `pending` only, `api/src/outbox/worker.ts:48-56`;
  `locked_at` is written at `api/src/outbox/worker.ts:63-70` and nothing sweeps it), so that
  message is lost silently and never shows up as `failed`. *Removed by:* a provider-side
  idempotency token on send, or a lease with a `locked_at` sweep plus a per-attempt audit.

- **The worker polls; it is never woken.** `startWorker` is a `setTimeout` loop
  (`api/src/outbox/worker.ts:150-182`) that claims a batch every `WORKER_INTERVAL_MS`
  (default 3000 ms — `api/src/config.ts:12`, `.env.example:15`) with
  `FOR UPDATE SKIP LOCKED` (`api/src/outbox/worker.ts:44-73`). MySQL has no `LISTEN/NOTIFY`.
  *Consequence:* invite/reset/assignment mail is late by up to one interval plus the job's
  backoff, and every idle tick costs a query against `outbox_jobs`. *Removed by:* a broker, or
  a database-native wake mechanism.

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

- **One database, one worker process — and nothing in the delivered stack starts the worker.**
  Compose defines exactly one `mysql` and one `api`
  (`docker-compose.yml:17-56`): no read replicas, no partitioning, no broker. The worker is a separate
  process (`api/src/worker-main.ts:1-4`, `api/package.json:8`), and the stack never launches
  it: the compose `api` command is `bun run db:migrate && bun run seed && bun run start`
  (`docker-compose.yml:41-46`), that start script serves HTTP only (`api/src/index.ts:1-8`),
  and root `bun run dev` runs api + web only (`package.json:6`). *Consequence:* database
  throughput and the single worker are the whole system's throughput with no failover, and
  until someone runs `bun --cwd api worker` by hand, outbox jobs sit `pending` and no mail is
  sent. *Removed by:* a dedicated worker service in compose (and replicas plus a broker when
  the load demands it).

- **The `resend` mail driver has never run.** `buildTransport` branches on `MAIL_DRIVER`
  (`api/src/outbox/mailer.ts:39-49`), but everything exercised is the `mailpit` branch: the
  suite points SMTP at the local sink (`api/vitest.config.ts:22-25`) and the real-SMTP test
  asserts against Mailpit's HTTP API (`api/tests/outbox/mailer.test.ts:7`,
  `api/tests/outbox/mailer.test.ts:92-96`), while the config tests cover only the default and
  an unknown value (`api/tests/config.test.ts:14`, `api/tests/config.test.ts:16-18`). No API
  key was available, so Resend's endpoint and credential parsing
  (`api/src/outbox/mailer.ts:31-37`, `api/src/outbox/mailer.ts:40-46`) are unproven. *Removed
  by:* a Resend key in CI, or another real SMTP capture that drives the same code path.

- **Dev/test runs MySQL 8.0 natively, while the compose images and the single-origin proxy are
  unexercised.** The stack pins `mysql:8.0` (`docker-compose.yml:19`) and expects `api` and
  `web` images to migrate, seed and start inside themselves (`docker-compose.yml:40-46`), but
  the development and test loop runs the api as a plain Bun process against MySQL 8.0 at
  `127.0.0.1:3306` (`api/vitest.config.ts:15-17`; the server reported `8.0.46` for
  `SELECT VERSION()`). The engine matches, so this is not a MariaDB-versus-MySQL divergence —
  the gap is that the image builds, the compose `db:migrate && seed && start` command and the
  nginx single-origin proxy are not covered by `bun run test`. *Removed by:* running the
  compose smoke, and doing it in CI.

- **There is no CI pipeline.** The repository contains no CI configuration at all — no
  `.github/workflows`, no equivalent — and the root scripts are local-only
  (`package.json:5-12`). *Consequence:* nothing runs `bun run test` or `bun run typecheck`
  automatically, so the test suite is green only when a
  human runs it, and it gates no merge. *Removed by:* a workflow that provisions MySQL and
  Mailpit, then runs `bun run test && bun run typecheck` on every push.
