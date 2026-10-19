# Newtonite Ops

A team-scoped operations workspace for creating, assigning, discussing, and resolving work items. It includes role-aware attention queues, an activity timeline, approval workflows, in-app notifications, and administrative controls.

Built with Bun, TypeScript, Express, Drizzle/MySQL, React, TanStack Query, and Vite.

**Live preview:** <http://140.238.229.160/> — HTTP only, no domain. Use the demo accounts below; do not enter real or sensitive data.

## Run the local demo

Prerequisites: Docker with Docker Compose. The container build installs dependencies from `bun.lock`; a host Bun installation is not required for this path.

```sh
cp .env.example .env
docker compose up --build --wait
```

Open **http://localhost:8080**. Initial startup runs migrations and seeds two teams, four demo accounts, and at least 5,000 work items before starting the API. MySQL data persists in the Compose volume. The worker runs as a separate service and delivers demo email to Mailpit, not to external recipients.

| Service | Address | Purpose |
| --- | --- | --- |
| Application | http://localhost:8080 | Built SPA and same-origin API proxy |
| API | http://localhost:3000 | Direct API access; `/health` and `/ready` |
| Mailpit | http://localhost:8025 | Inspect invitation, password-reset, and assignment email |
| SMTP | localhost:1025 | Local email capture |
| MySQL | localhost:3306 | Database `newtonite`, local credentials `root` / `root` |

These ports must be available. The web port is published on all host interfaces; use local firewall/network controls if the machine is shared. The other published service ports bind to loopback.

### Demo accounts

All four accounts use the **demo-only password `Passw0rd!`**.

| Email | Role | Starting experience |
| --- | --- | --- |
| `admin@newtonite.test` | Platform administrator | Users, teams, administrative audit log, and outbox jobs |
| `lead@newtonite.test` | Lead in both demo teams | Attention queues, assignment, approval, team membership and invitations |
| `member@newtonite.test` | Member in both demo teams | Create, claim, edit, comment, and submit work |
| `viewer@newtonite.test` | Viewer in both demo teams | Read-only work items and history |

A user's operational permissions come from their membership in the item's team. Platform administration does not bypass work-item permissions; administrators cannot create work items. Other operational actions still depend on actual team membership.

### Try the important workflows

1. Sign in as a member, create an item, and open it. Use an idempotent retry rather than creating another item if a create request's response is lost.
2. Open an unassigned item in separate member/lead sessions and attempt to claim it simultaneously. Only one claimant succeeds.
3. Open the same item for editing in two sessions. Save one edit, then save the other; the stale edit is rejected rather than overwriting the accepted version.
4. Submit an assigned item for approval. A lead can resolve it or return it with a reason. Inspect the activity timeline to see ownership, field, workflow, and discussion changes.
5. Use the dashboard's assigned, urgent-unassigned, approval, and overdue views, or search/filter the item list. Lists fetch server-side pages rather than downloading all items.
6. Invite an address from a team, open its message in Mailpit, and redeem the link. Administrators can inspect failed outbox jobs and explicitly retry them.

In-app notifications cover collaboration events. Email delivery covers invitations, password resets, and assignments. Notifications do not replace the durable item history.

## Local development

Use **Bun 1.4.3**, the runtime verified with this lockfile. Bun 1.3.14 cannot parse its lockfile format. Check `bun --version` before installing; do not regenerate the lockfile to work around an older runtime.

```sh
bun install --frozen-lockfile
cp .env.example .env
docker compose up -d mysql mailpit
```

For host-run processes, set these values in `.env`:

```dotenv
DATABASE_URL=mysql://root:root@127.0.0.1:3306/newtonite
SMTP_URL=smtp://127.0.0.1:1025
APP_BASE_URL=http://localhost:5173
```

Then run:

```sh
bun run db:migrate
bun run seed
bun run dev
```

Open **http://localhost:5173**. The root development command starts the API, Vite, and outbox worker together. API scripts explicitly load the repository-root `.env`. Vite proxies API requests; production assets use the nginx same-origin proxy. Do not run the Compose API and the host API on port 3000 at the same time.

Compose overrides the API/worker database and SMTP endpoints with container-network addresses, and sets email links to `http://localhost:8080`, so a host-oriented `.env` still works with the demo stack.

## Verification

The API suite requires MySQL and Mailpit. **Tests migrate and truncate the database named by `TEST_DATABASE_URL`. Always use a disposable test database, never the application database.** An explicit URL is required, but the suite does not independently prove that the target is safe to erase.

```sh
docker compose up -d mysql mailpit
docker compose exec -T mysql mysql -uroot -proot -e 'CREATE DATABASE IF NOT EXISTS newtonite_test;'
TEST_DATABASE_URL=mysql://root:root@127.0.0.1:3306/newtonite_test bun run test
bun run typecheck
bun --cwd web run build
```

The full test command runs API tests followed by web tests. API test files run sequentially to prevent shared-table resets from interfering. SMTP integration tests use Mailpit at `localhost:1025` and its HTTP API at `localhost:8025`. Web tests use jsdom; they are not a browser-rendering or load-test certification.

| Guarantee | Representative regression coverage |
| --- | --- |
| One winner for concurrent claims | `api/tests/routes/concurrency.test.ts` |
| Stale edits cannot overwrite newer versions | `api/tests/services/items-patch.test.ts`, `web/src/components/ItemForm.test.tsx` |
| Repeated creation with one key has one effect | `api/tests/services/invariant.test.ts`, `api/tests/services/idempotency.test.ts` |
| Permissions and lifecycle rules enforced on the server | `api/tests/policy/`, `api/tests/services/items-transition.test.ts` |
| State and history commit together | `api/tests/services/invariant.test.ts` |
| Failed, delayed, or reclaimed jobs remain recoverable | `api/tests/outbox/reliability.test.ts` |
| History, comments, and conflict handling remain usable | `web/src/pages/ItemDetail.test.tsx`, `web/src/pages/ItemActions.test.tsx` |

## Architecture

```mermaid
flowchart LR
  UI[React SPA] --> API[Express API]
  API --> Policy[Team-scoped authorization]
  Policy --> Services[Transactional services]
  Services --> DB[(MySQL)]
  DB --> Stream[Notification stream]
  Stream --> UI
  Worker[Outbox worker] --> DB
  Worker --> SMTP[SMTP / Mailpit]
```

A work-item change, its activity events, and any related notifications or outbox jobs are written in the same database transaction. Email runs after commit in the worker. In-app updates use an authenticated event stream backed by database polling; the paginated notification feed holds the complete retained history.

- [Engineering decisions](ENGINEERING_DECISIONS.md): five choices, alternatives, and trade-offs.
- [Known limitations](docs/known-limitations.md): delivery semantics, scale boundaries, and deployment assumptions.
- [Environment example](.env.example): runtime settings and local defaults.

## Operations and deployment boundaries

```sh
docker compose logs -f api worker
docker compose down
```

Stopping the stack does not remove its database volume. `bun run db:reset` is a destructive development helper: it drops application tables in `DATABASE_URL`, reapplies migrations, and does not reseed. Do not use it on data you need to keep.

This Compose stack is a **local demonstration**, not an internet-hardened deployment. Before hosting it, replace the example signing secret with a generated secret, remove/replace demo accounts and shared database credentials, terminate HTTPS, enable secure cookies, configure exact trusted proxies, use a real verified mail sender, and establish backups and monitoring. The startup command automatically seeds demo data; do not use that command unchanged for production.

Keep `.env` and database dumps out of source control.

## License

No license is currently provided. Public visibility alone does not grant reuse rights.
