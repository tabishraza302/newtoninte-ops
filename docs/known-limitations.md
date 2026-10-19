# Known limitations

## Delivery and concurrency

- **Email is at-least-once.** Enqueue deduplication, worker claim fencing, and expired-lease recovery do not prevent a duplicate email when SMTP accepts a send but its acknowledgment is lost. Provider-side idempotency would be needed for a stronger guarantee.
- **The worker polls and processes a claimed batch serially.** Queue latency includes the polling interval, earlier jobs, retry backoff, and external SMTP latency. Lease sizing must exceed normal handler duration; an overlong execution may overlap a reclaimed attempt.
- **Idempotency is opt-in and time-limited.** The creation UI reuses its key on retry. API callers must supply one themselves. The default retention is 24 hours; a retry after expiry is a new operation. Other mutations, including comments, do not have general request-key deduplication.
- **Conflict handling is explicit, not automatic merging.** Stale edits and assignments are rejected. A client that omits the optional workflow version precondition does not receive browser-snapshot protection for changes that leave status unchanged. External API clients should supply the version they displayed.
- **History is not event-sourced recovery.** Events explain committed changes, but application code enforces append-only access. Backups remain necessary. There is no automatic ownership reassignment when a person leaves a team; leads can correct ownership.

## Scale and discovery

- **No load-tested concurrency claim.** The local demo seeds at least 5,000 items, and tests exercise competing operations. This does not establish throughput or latency for thousands of users. The demo Compose database deliberately has a small connection/buffer configuration.
- **Search is title-only substring matching.** Filtering happens on the server, but a leading wildcard and computed priority ordering may require substantial scans/sorts. Full-text search, query-plan benchmarking, and production index tuning are not included.
- **Lists are paginated, not virtualized.** Browsers retain pages explicitly requested with Load More. There is no stable historical snapshot across pages; an item whose priority changes may move across a cursor boundary.
- **Live notifications are not a complete event replay protocol.** A connection snapshots up to 50 visible records and polls the most recent 100 recipient IDs, including delayed commits within that window. Server deduplication retains up to 500 IDs; browser deduplication retains 200. The browser queues at most 10 toast cards and displays three at a time. Larger bursts, long disconnections, or commits outside the polling window can omit transient toasts; use the paginated notification feed and item history for complete retained records. The server still polls MySQL and computes unread counts; it is not a broker-backed push system.
- **No retention or archival automation.** Activity, notifications, audit records, and failed jobs can grow indefinitely without an operator-defined policy. Comments have no edit/delete workflow.

## Security and operations

- **Local-demo defaults are not production defaults.** Compose starts a demo seed, shares known account/database passwords, uses a sample signing secret unless changed, serves HTTP, and publishes the web port on host interfaces. Do not expose this stack unchanged to the internet.
- **Deployment is single-database and single-worker by default.** There is no configured failover, replica topology, managed backup, or monitoring service. Worker replicas can share the claim protocol, but must be sized and observed rather than assumed to scale linearly.
- **Rate limits are per process.** Buckets reset on restart and are not coordinated across API replicas. Use a shared limiter or trusted edge controls for multi-instance deployment.
- **Cookies and proxy trust need deliberate configuration.** Enable secure cookies behind HTTPS, retain same-origin API routing, and replace broad local/private proxy trust with exact controlled proxy ranges.
- **Passwords use bcrypt.** It is not memory-hard and has a 72-byte boundary. Changing algorithms requires an explicit password migration strategy.
- **SMTP integration verification uses Mailpit.** A real provider's credentials, verified sender, deliverability, and production failure modes require separate testing.
- **Tests require a disposable database.** An explicit `TEST_DATABASE_URL` is required, but there is no production-target detector before migration and truncation. Never point the suite at development/demo or production data.
- **No CI pipeline is included.** Local test, typecheck, frontend build, and stack smoke commands are documented, but are not automatically enforced on a hosting provider. Component tests use jsdom and do not certify browser accessibility or production rendering.

## Next engineering priorities

Measure the expected workload before selecting further infrastructure: profile SQL under realistic team/history sizes, load-test active streams and worker throughput, establish backup/retention policies, and add CI coverage of the clean Compose startup path. A public repository release is separate from approving an internet-facing deployment.
