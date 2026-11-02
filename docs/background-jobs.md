# M06 Background execution and AI orchestration

The API process now runs a PostgreSQL-backed AI worker alongside Fastify. M04 still creates a ticket and its classification job in one short transaction. Ticket submission never waits for AI. M06 also registers the three authenticated admin AI endpoints used by M08; no fixture is substituted for a real response. Draft creation remains an explicit POST, and sending remains a separate, reviewed public-reply operation.

## Setup

Apply migrations before restarting the API:

```powershell
npm run db:generate
npm run db:deploy
npm run dev
```

The M06 migration adds DRAFT jobs, the current draft pointer, run/job associations, fingerprint and lease metadata, a partial unique index permitting only one active job per ticket/task, and persistent provider budget/pause state. It retains existing tickets and queued classification work. M05's AI-run migration is also required; `db:deploy` applies any outstanding migrations in order.

Configure the ignored `.env` as described in [AI assistance](ai-assistance.md). Keep `AI_PROVIDER=disabled` until you supply an explicit provider, server-side key, and model IDs. Disabled AI produces a safe failed state without a provider request; manual ticket operations remain available. Invalid AI/worker environment settings produce a safe startup warning and disable AI, rather than preventing manual API startup. Database migrations remain mandatory.

| Setting                  | Default | Behavior                                                                         |
| ------------------------ | ------- | -------------------------------------------------------------------------------- |
| `AI_WORKER_ENABLED`      | `true`  | Set `false` to stop automatic execution while retaining endpoints/queued work    |
| `AI_JOB_POLL_MS`         | `1000`  | Delay between worker cycles; storage failures back off to at least five seconds  |
| `AI_CONCURRENCY`         | `1`     | Maximum 1–4 live leases for this provider configuration, shared across processes |
| `AI_REQUESTS_PER_MINUTE` | `6`     | Durable fixed-window reservation budget shared across processes                  |
| `AI_MAX_ATTEMPTS`        | `3`     | Maximum 1–5 claims per job, including recovered leases                           |
| `AI_RETRY_BASE_MS`       | `2000`  | Exponential backoff base, capped at 60 seconds before Retry-After is considered  |

Restart after changing environment values. Provider/model/base URL switching still uses the M05 adapter; there is no paid fallback or hidden model substitution. A private hash of the AI configuration, including credentials, identifies the limiter/pause domain. Key rotation therefore uses a fresh domain without storing or exposing the credential. Job-limit settings do not reset an existing budget. Deliberate key/config rotation can start a new domain; these are local safeguards, not provider-account-wide billing controls.

## Endpoints and cache behavior

All paths below are prefixed by `/api/v1`. They require an admin session. POSTs also require the existing exact Origin and `X-BookLeaf-Request: 1` protection.

| Method/path                           | Behavior                                                                                                                                                                                                                                                   |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /tickets/:id/ai-drafts/latest`   | Returns NOT_REQUESTED or the current queued/running/succeeded/failed draft. Computes staleness without creating work, changing pauses, or calling AI.                                                                                                      |
| `POST /tickets/:id/ai-drafts`         | Body `{ "regenerate": false }` by default. Returns 202 for active work; returns 200 for a current cached result. Failed/stale work can be requested again. `regenerate: true` deliberately creates a fresh generation after existing active work finishes. |
| `POST /tickets/:id/ai-classification` | Empty body or `{}`. Returns 202 for active/new work, or 200 when the current classification fingerprint is already successful. New generations preserve independent manual category/priority overrides.                                                    |

Concurrent draft requests, including regeneration requests, return the same active job. If its input becomes stale while running, it finishes as a safe stale failure; request a new draft after it terminates. This prevents repeatedly opening a ticket or clicking regeneration from starting overlapping requests. The database index enforces one active job per ticket/task in addition to ticket row locking.

Ordinary requests may reuse a validated, persisted successful AI run with the same context fingerprint. Explicit regeneration skips older generations' results. AI runs are linked to their originating job, so a restart after saving a successful regeneration can still reuse that same job's result without generating again. Cache identity includes the M05 prompt/policy/provider/model and relevant ticket/catalog/history context. Credential rotation alone does not invalidate content; model/output configuration changes do.

Public replies and effective category changes advance the ticket context revision. Final draft acceptance also recomputes the fingerprint under catalog locks, catching imported book changes without relying solely on revision. Private notes, assignment/status-only changes and unsent editor text do not enter prompts. Current draft lookup exposes staleness when relevant data changes. Classification updates go through M04's existing lease/generation checks and override-preserving transaction, with a validated AI-run association.

The M08 UI already uses real POST/GET adapters and deliberate copy/send actions. Polling cannot replace a dirty reply editor. Author DTOs expose neither drafts, private notes, provider failures, job tokens nor AI-run records. No M06 change adds an author-facing AI endpoint or automatic reply sending.

## Transactions, leasing and recovery

The lock order is provider state, ticket, then job where those locks are needed. Provider state initialization uses PostgreSQL `INSERT ... ON CONFLICT`, avoiding client-side upsert races. Claims use row locks and SKIP LOCKED; provider state serializes the shared concurrency/budget decision. Every claim writes a random lease token, lease deadline, provider identity and incremented attempt count atomically. A live lease cannot be reclaimed. Pending jobs survive API restarts.

The lease lasts the configured HTTP timeout plus 30 seconds for bounded database preparation/completion. Expired RUNNING jobs can be reclaimed with a different token; interrupted RUNNING AI-run records are marked failed. Exhausted jobs fail safely instead of being reclaimed forever. A worker holding an old token cannot complete or overwrite the new owner's work.

Context loading and final freshness checks use short transactions. Catalog facts are projected through the existing book DTO mapping and exact paise validation, scoped to the persisted ticket author; no client-supplied author ID or private note is queried. The last three public replies are selected in stable chronological order. All transactions have ended before invoking the provider. Completing a classification or draft does not send anything externally.

On shutdown, the runner stops claiming, aborts provider calls, waits for all in-flight tasks to settle, then allows database shutdown. Cancelled work is requeued within its attempt limit. If shutdown or a process crash interrupts persistence, lease expiry provides recovery. External calls cannot be guaranteed exactly once: a crash after a provider processed a request but before its output was persisted may require another call. Persisted successful results are reused whenever possible; lease tokens protect application writes, not an external provider's billing.

## Failure and budget behavior

M05 makes one HTTP attempt and returns normalized failure metadata. M06 handles retryable timeout/rate-limit/network/upstream failures by leaving the job QUEUED with a future availableAt. The delay is the larger of exponential backoff and Retry-After. Rate limits also set a shared configuration cooldown, so other tickets cannot immediately bypass it. Permanent quota/authentication/configuration failures pause that provider configuration. Queued work encountered while paused fails with a safe explanation without calling the provider.

An explicit admin POST that creates a new generation clears the permanent pause for a deliberate retry. It does not clear a Retry-After cooldown or consumed request budget. Rotating configuration and restarting uses the new configuration domain; failed jobs still require deliberate retry. Other requests already in flight when a pause is reported may finish, bounded by configured concurrency.

Budget reservations are taken at claim time and survive crashes. Cache hits or stale jobs can consume a reservation without making a provider call: this conservative accounting prevents overspend during recovery at the cost of potentially waiting until the next minute. Disabled/paused work does not consume request reservations. Repeated explicit regenerations remain bounded by this global budget. There is no nested SDK retry loop.

Output validation/grounding/configuration/persistence failures are terminal for that job and remain available for deliberate review/retry. M05 records safe AI metadata, not raw prompts, keys or upstream error bodies. Worker storage warnings are fixed strings and are suppressed until the next successful cycle. If storage fails during final handling, the lease remains recoverable.

## Verification and remaining work

Focused M06 tests exercise real PostgreSQL transactions and HTTP with deterministic fake providers: automatic enqueue, manual overrides, competing claimers, expired/replaced leases, restart after persisted success, bounded attempts, Retry-After, shared budgets, quota/auth pauses, deliberate retry/key rotation, duplicate draft POSTs, GET purity, cache reuse/regeneration, stale delayed/queued context, catalog/public-reply changes, private-note exclusion, completion rollback, disabled-provider manual replies, abort/shutdown, role enforcement and CSRF.

Actual results: **70 API tests passed**, including 15 M06 tests; **12 web tests and 6 contract tests passed**, including dirty-editor preservation. There were zero failures or skips in the final runs. Tests were bundled with the installed esbuild executable and run directly with Node because the standard launcher's child processes are restricted here. The contract harness required a copy of the supplied sample JSON at its relative path in the ignored output directory; the corrected harness passed. Workspace typechecking, contracts/API builds, Prisma generation/schema validation and ESLint passed. Full browser AI acceptance and a production Vite build were not performed for this backend module.

There is no configured AI key. `npm run ai:evaluate` therefore makes zero requests and records live AI as unverified. Simulated provider responses are not evidence of OpenRouter availability or model quality. The existing evaluation command can make a maximum of two explicit calls after configuration; follow with a browser ticket/draft flow during M09.

Compiled API startup smoke passed: liveness/readiness returned 200, signed-out current-user lookup returned 401, and SIGTERM exited cleanly. The worker was explicitly disabled for this application-database smoke because its migration is pending; actual execution/recovery/shutdown behavior was verified in the isolated PostgreSQL orchestration tests described above. Formatting and diff whitespace checks also passed.

Application migration deployment is pending: `npm run db:deploy` is blocked here by Prisma's schema-engine subprocess restriction (`EPERM`). The complete migration chain is verified in isolated PostgreSQL test schemas, not silently applied to the application's schema. Run it from your normal terminal. The worker and endpoints should be exercised in the browser after migration and provider setup; manual workflow acceptance was previously confirmed by the user. Next module: M09 integration and delivery.
