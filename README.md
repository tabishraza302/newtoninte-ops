# Newtonite Ops

An internal operations app for coordinating **work items**:
create, search, filter, assign, transition through an explicit server-enforced lifecycle, and
discuss — with per-team authorization and an append-only history that can never disagree with the
current state. Registration is closed: an account exists only by redeeming an emailed invitation.

## How it works

Browser → Express API → MySQL, where **a business change, its activity event, and any outbox job
are written in one transaction** (no code path writes one without the others) → a polling worker
drains `outbox_jobs` → SMTP. Enqueue being atomic with the change is what buys the guarantee: a
side effect can never fire for a transaction that rolled back, and the side effect for a committed
change cannot be lost. Everything stateful is in MySQL; the API process is stateless.

## Prerequisites

- Docker + Docker Compose — for the one-command stack.
- Bun ≥ 1.1 — for local dev and the test suites.
- For tests: a reachable MySQL/MariaDB and Mailpit (both are in `docker-compose.yml`).

## Run it — Docker (one command)

Copy `.env.example` to `.env` (compose reads it via `env_file`; no secrets are committed), then:

```bash
docker compose up --build
```

The `api` service runs `bun run db:migrate && bun run seed && bun run start`, so the schema and the
idempotent demo seed are in place before it serves. What the compose file actually publishes:

| URL | What it is |
| --- | --- |
| http://localhost:8080 | The app. nginx serves the built SPA and reverse-proxies `/auth /items /teams /invitations /admin /health /ready` to the api service, so the browser only ever talks to one origin. |
| http://localhost:3000 | The API directly: `/health` (liveness), `/ready` (readiness — reflects the database). |
| http://localhost:8025 | Mailpit UI / HTTP API — every email the worker sends lands here. |
| localhost:1025 | Mailpit SMTP. |
| localhost:3306 | MySQL 8.0 (root/root, database `newtonite`). |

The compose stack does not run the outbox worker, so start it against the same database to drain
jobs (invitation, password-reset and assignment emails):

```bash
docker compose exec api bun run worker
```

## Run it — local dev

```bash
bun install
docker compose up -d mysql mailpit     # the database and mailbox the API talks to
bun run db:migrate && bun run seed     # create the schema, then the demo data
bun run dev                            # API + SPA, both watching
```

`bun run dev` is the root script
`concurrently -n api,web "bun --cwd api dev" "bun --cwd web dev"`: the API from `api/src/index.ts`
under `bun --watch` on `:3000`, and the Vite dev server for the SPA on `:5173` (Vite proxies
`/auth /items /teams /invitations /admin /health /ready` to `:3000`).

It does **not** start the outbox worker — run it in a second terminal, or no queued email is ever
sent:

```bash
bun --cwd api worker     # api script: bun src/worker-main.ts — poll loop + graceful shutdown
```

`.env.example` uses the compose hostnames (`mysql`, `mailpit`). For host-run dev, point the same
values at loopback — `DATABASE_URL=mysql://root:root@127.0.0.1:3306/newtonite` and
`SMTP_URL=smtp://127.0.0.1:1025`. `APP_BASE_URL` already defaults to the dev SPA,
`http://localhost:5173`, so invite and reset links point there. Other root scripts:
`bun run db:reset` (dev-only: drops every application table and re-runs all migrations; it does not
re-seed), `bun run typecheck`.

## Seeded demo credentials

| Role | Email | Password | What it can do |
| --- | --- | --- | --- |
| admin | `admin@newtonite.test` | `Passw0rd!` | `is_admin`, and holds **no** team membership: create teams, direct-add an existing user to any team, list all teams, enable/disable accounts, inspect and retry background jobs. No special access to work items. |
| lead | `lead@newtonite.test` | `Passw0rd!` | `lead` on both demo teams: approve `awaiting_approval → resolved`, close/reopen, change priority/assignee, create and revoke invitations, manage member roles. |
| member | `member@newtonite.test` | `Passw0rd!` | `member` on both demo teams: create, edit, claim/start, comment, submit for approval, cancel their own item. |
| viewer | `viewer@newtonite.test` | `Passw0rd!` | `viewer` on both demo teams: read items and activity only. |

All four share the password `Passw0rd!`. The seed also creates the `Operations` and `Finance` teams
and 5,000 work items distributed across them.

## Tests

```bash
# api suite — needs a reachable MySQL/MariaDB and Mailpit, plus TEST_DATABASE_URL pointing at a
# database the suite may migrate and truncate
TEST_DATABASE_URL=mysql://root:root@127.0.0.1:3306/newtonite_test bun --cwd api test

bun --cwd web test        # SPA unit/component tests (jsdom) — no services needed
bun run typecheck         # tsc over both workspaces
```

`bun run test` from the root runs the api suite and then the web suite, so it needs the same
MySQL/Mailpit and `TEST_DATABASE_URL`. The api suite runs migrations against `TEST_DATABASE_URL` in
global setup and its SMTP round-trip test posts to Mailpit's HTTP API. Every knob the API reads —
ports, database and SMTP URLs, token TTLs, worker interval and batch size, idempotency TTL — is
documented in [`.env.example`](.env.example).

## Architecture

```mermaid
flowchart LR
  subgraph Browser
    SPA["React SPA<br/>Vite · TanStack Query"]
  end

  subgraph API["API container — Bun + Express"]
    R["Routers<br/>/auth · /items · /teams · /invitations · /admin"]
    P["Policy module<br/>can(user, action, resource)<br/>+ scope(user)"]
    S["Services<br/>claim · assign · transition · update · invite · redeem"]
    RP["Repository — Drizzle"]
    W["Worker<br/>(poller)"]
  end

  DB[("MySQL 8 · InnoDB")]
  SMTP["SMTP provider<br/>Resend (verified domain)"]
  SINK["Dev/test SMTP<br/>Mailpit"]

  SPA -- "HTTPS JSON<br/>access JWT (memory)<br/>refresh cookie httpOnly" --> R
  R --> P --> S --> RP --> DB
  W -- "SELECT … FOR UPDATE SKIP LOCKED" --> DB
  W -- "Nodemailer" --> SMTP
  W -. "non-prod" .-> SINK
```

The worker is a clean seam inside the API container for dev and can move to its own container in
production with no code change. [`docs/architecture.md`](docs/architecture.md) has the full
picture: the write path (atomic claim, stale-edit rejection), the outbox path, refresh-token
rotation, and the data model.

## Known Limitations

- Email delivery is **at-least-once** — a crash between send and mark-done can double-send;
  mitigated by the `dedupe_key`, not eliminated.
- The worker **polls**, so notification latency is bounded by its interval, and it adds DB load.
- `REPEATABLE READ` + gap locks can deadlock under contention; handled by retry, not eliminated.
- Search is escaped `LIKE` on `title` (no index for a leading wildcard). Elasticsearch is deferred.
- Comments cannot be edited or deleted; idempotency keys expire after 24h.
- No realtime — clients poll/refetch. Roles are read from the DB per request for correctness.
- Single database, single worker; no read replicas, partitioning, or dedicated broker.
- Deferred (never started): Elasticsearch search and a personal "my work" Kanban board.

The honest, complete list with rationale is
[`docs/known-limitations.md`](docs/known-limitations.md).

## Docs

- [`docs/architecture.md`](docs/architecture.md) — static structure, the write path, the async
  path, and auth, in diagrams.
- [`ENGINEERING_DECISIONS.md`](ENGINEERING_DECISIONS.md) — the five decisions (context / options /
  choice / trade-off) and what we chose not to build.
- [`.env.example`](.env.example) — every configuration value the API reads.
