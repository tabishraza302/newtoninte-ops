# Architecture

Static structure, the write path, the async path, and auth — in pictures.

---

## 1. System overview

```mermaid
flowchart LR
  subgraph Browser
    SPA["React SPA<br/>Vite · TanStack Query"]
  end

  subgraph API["API container — Bun + Express"]
    R["Routers<br/>/auth · /items · /teams · /invitations"]
    P["Policy<br/>can(user, action, resource)"]
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

Everything stateful lives in MySQL. The API container is **stateless** — any number
could run behind a load balancer. The worker is a clean seam inside the same container
for dev, movable to its own container in prod with no code change.

---

## 2. Layering (request → response)

```mermaid
flowchart TD
  REQ["HTTP request"] --> MW["Middleware<br/>auth · rate-limit · body parse"]
  MW --> ROUTE["Router"]
  ROUTE --> POL["Policy: can(user, action, resource)<br/>reads memberships, decides allow/deny"]
  POL -->|denied| ERR["404 / 403 error envelope"]
  POL -->|allowed| SVC["Service<br/>opens ONE transaction"]
  SVC --> REPO["Repository (Drizzle)"]
  REPO --> DB[("MySQL")]
  SVC --> OUT["append activity_event + outbox_job<br/>(same transaction)"]
  SVC --> COMMIT["COMMIT"]
  COMMIT --> RESP["Response"]

  style ERR fill:#fdd
```

The rule the whole codebase obeys: **a business change, its activity event, and any
outbox job are written in a single transaction.** There is no code path that writes
one without the others.

---

## 3. Write path — the correctness spine

### 3.1 Two users claim the same item

```mermaid
sequenceDiagram
  autonumber
  participant A as User A
  participant B as User B
  participant API as Express API
  participant DB as MySQL

  par Both click "Claim" at once
    A->>API: POST /items/42/claim
  and
    B->>API: POST /items/42/claim
  end

  API->>DB: BEGIN
  API->>DB: UPDATE work_items SET assignee_id=A, version=version+1<br/>WHERE id=42 AND assignee_id IS NULL
  DB-->>API: 1 row affected
  API->>DB: INSERT activity_event(assignee_changed)
  API->>DB: COMMIT
  API-->>A: 200 { assignee: A, version: 8 }

  API->>DB: UPDATE … WHERE id=42 AND assignee_id IS NULL
  DB-->>API: 0 rows affected
  API-->>B: 409 ALREADY_CLAIMED
```

The database picks the winner. There is no read-then-write window to lose.

### 3.2 Stale edit

```mermaid
sequenceDiagram
  autonumber
  participant U as User
  participant API as Express API
  participant DB as MySQL
  U->>API: PATCH /items/42 {description, version: 7}
  API->>DB: UPDATE work_items SET description=?, version=version+1<br/>WHERE id=42 AND version=7
  alt version matches
    DB-->>API: 1 row
    API->>DB: INSERT activity_event(description_changed) · COMMIT
    API-->>U: 200 { version: 8 }
  else someone already saved version 8
    DB-->>API: 0 rows
    API->>DB: SELECT current item
    API-->>U: 409 VERSION_CONFLICT + current item (reload)
  end
```

---

## 4. Async path — transactional outbox

```mermaid
sequenceDiagram
  autonumber
  participant API as Express API
  participant DB as MySQL
  participant W as Worker
  participant M as SMTP

  API->>DB: BEGIN
  API->>DB: INSERT activity_event(assignee_changed)
  API->>DB: INSERT outbox_jobs(type=email.assigned, dedupe_key=…)
  API->>DB: COMMIT
  API-->>API: respond 201 — email not sent yet

  loop every N seconds
    W->>DB: SELECT … WHERE status='pending' AND available_at<=NOW()<br/>ORDER BY id LIMIT 10 FOR UPDATE SKIP LOCKED
    DB-->>W: batch
    W->>W: mark rows 'processing'
    W->>M: send email (Nodemailer)
    alt success
      W->>DB: status='done'
    else failure
      W->>DB: attempts++, available_at=NOW()+backoff, last_error=…
      Note over W,DB: attempts >= max_attempts → status='failed' (visible)
    end
  end
```

- Enqueue is **atomic with the business change** — a lost email would mean a lost job row,
  which can't happen.
- Delivery is **at-least-once**; a `dedupe_key` makes the handler effectively once.
- `SKIP LOCKED` lets many workers run without stepping on each other.

---

## 5. Auth — refresh rotation with reuse detection

```mermaid
sequenceDiagram
  autonumber
  participant C as Browser
  participant API as Express API
  participant DB as MySQL

  C->>API: POST /auth/refresh (cookie RT1)
  API->>DB: BEGIN · SELECT … WHERE token_hash=H(RT1) FOR UPDATE

  alt RT1 is the current token
    API->>DB: INSERT RT2 (same family) · RT1.replaced_by=RT2 · RT1.revoked_at=NOW()
    API->>DB: COMMIT
    API-->>C: 200 new access token + Set-Cookie RT2
  else RT1 is revoked — could be theft
    alt replaced inside grace window (benign concurrent refresh)
      API-->>C: 200 — return the existing successor
    else
      API->>DB: revoke the ENTIRE family
      API-->>C: 401 UNAUTHENTICATED
    end
  end
```

Closed registration sits in front of this: an account can only be created by redeeming an
invitation, and redemption is the same atomic compare-and-set as claiming an item (§8.8 of
the design).

---

## 6. Data model

Split into two diagrams — mixing identity, work, and infrastructure into one made the
first version unreadable and got `work_items → users` wrong (it has **two** foreign keys
to `users`, so it needs two labelled lines, not one).

### 6.1 Identity & access

```mermaid
erDiagram
  users ||--o{ memberships : "belongs to"
  teams ||--o{ memberships : "has members"
  users ||--o{ invitations : "created_by"
  teams ||--o{ invitations : "issues"
  users ||--o{ refresh_tokens : "owns"
  users ||--o{ password_reset_tokens : "requests"
  users ||--o{ email_verification_tokens : "verifies"

  users {
    bigint id PK
    varchar email UK "lowercased"
    varchar password_hash "argon2id"
    varchar display_name
    datetime email_verified_at "nullable"
    bool is_admin "seed-only, narrow (§7.1)"
    varchar status "active | disabled"
  }
  teams {
    bigint id PK
    varchar name
    varchar slug UK
  }
  memberships {
    bigint id PK
    bigint user_id FK
    bigint team_id FK
    varchar role "viewer | member | lead"
  }
  invitations {
    bigint id PK
    bigint team_id FK
    varchar role "viewer | member | lead"
    varchar email "nullable → shareable code"
    varchar code_hash "sha256"
    int max_uses
    int uses "atomic compare-and-set (§8.8)"
    datetime expires_at
    bigint created_by FK
    datetime revoked_at
  }
  refresh_tokens {
    bigint id PK
    bigint user_id FK
    varchar token_hash UK
    varchar family_id "session family"
    datetime expires_at
    datetime revoked_at
    bigint replaced_by "rotation successor"
  }
  password_reset_tokens {
    bigint id PK
    bigint user_id FK
    varchar token_hash UK
    datetime expires_at
    datetime consumed_at
  }
  email_verification_tokens {
    bigint id PK
    bigint user_id FK
    varchar token_hash UK
    datetime expires_at
    datetime consumed_at
  }
```

### 6.2 Work & asynchronous infrastructure

```mermaid
erDiagram
  teams ||--o{ work_items : "contains"
  users ||--o{ work_items : "creates (created_by)"
  users ||--o{ work_items : "assigned (assignee_id, 0..1 at a time)"
  work_items ||--o{ activity_events : "append-only history"
  users ||--o{ activity_events : "actor (0 = system)"
  work_items ||--o{ comments : "has"
  users ||--o{ comments : "writes"
  users ||--o{ idempotency_keys : "scopes"

  work_items {
    bigint id PK
    bigint team_id FK
    varchar title
    text description
    varchar type "incident | customer_issue | payment | compliance | task"
    varchar priority "low | medium | high | urgent"
    varchar status "open | in_progress | awaiting_approval | resolved | closed | cancelled"
    bigint assignee_id FK "nullable"
    bigint created_by FK
    datetime due_at "nullable"
    int version "optimistic lock"
  }
  activity_events {
    bigint id PK
    bigint work_item_id FK
    bigint actor_id FK "null = system"
    varchar type
    varchar from_value
    varchar to_value
    json metadata
    datetime created_at
  }
  comments {
    bigint id PK
    bigint work_item_id FK
    bigint author_id FK
    text body
    datetime created_at
    datetime deleted_at "soft delete, nullable"
  }
  idempotency_keys {
    bigint id PK
    bigint user_id FK
    varchar key "Idempotency-Key header"
    varchar endpoint
    json response_body "replayed on repeat"
    datetime expires_at
  }
  outbox_jobs {
    bigint id PK
    varchar type "email.verify | email.reset | email.invite | email.assigned"
    json payload
    varchar status "pending | processing | done | failed"
    int attempts
    int max_attempts
    datetime available_at "backoff schedule"
    datetime locked_at
    varchar locked_by "worker lease"
    text last_error
    varchar dedupe_key
  }
```

`outbox_jobs` has **no foreign keys by design** — it references entities only through its
JSON `payload`, so a job can be enqueued in the same transaction as any change without
coupling to one table's lifecycle.

### 6.3 Keys and constraints not visible above

| Table | Constraint |
|---|---|
| `memberships` | `UNIQUE(user_id, team_id)` |
| `idempotency_keys` | `UNIQUE(user_id, key)` |
| `outbox_jobs` | `INDEX(status, available_at, id)` |
| `work_items` | `INDEX(team_id, status, priority)`, `INDEX(team_id, created_at, id)`, `INDEX(assignee_id, status)` |
| `activity_events` | `INDEX(work_item_id, id)` — append-only, never updated |

---

## 7. Work item lifecycle

```mermaid
stateDiagram-v2
  [*] --> open
  open --> in_progress : claim / start (member)
  open --> cancelled : cancel (lead)
  in_progress --> awaiting_approval : submit (member)
  awaiting_approval --> resolved : approve (LEAD ONLY)
  awaiting_approval --> in_progress : send back (lead)
  resolved --> closed : close (lead)
  resolved --> in_progress : reopen (lead)
  in_progress --> cancelled : cancel (lead)
  closed --> [*]
  cancelled --> [*]
```

Every arrow writes an `activity_event` in the same transaction as the status change.

---

## 8. Sync vs async boundary

| Synchronous (in the request) | Asynchronous (outbox → worker) |
|---|---|
| Create / edit / claim / transition | Email: verify, reset, invite, assigned |
| Authorization decision | (anything slow or external, later) |
| Activity event write | |
| Idempotency key + stored response | |
| Outbox row insert | |

If it must be consistent with the item, it's synchronous. If it's a side effect that can
fail and retry, it's a job.
