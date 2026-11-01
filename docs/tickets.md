# M04 Ticket management

M04 implements the manual ticket API and durable classification enqueue boundary. It does not call an LLM, execute jobs, create drafts, or add frontend screens. Existing auth cookies, CSRF checks, safe errors, catalog ownership checks, and shared Zod request/response schemas are reused.

## Setup

After pulling the changes, apply the committed migration from the repository root:

```powershell
npm run db:deploy
npm run dev
```

The M04 migration adds Ticket, TicketReply, TicketNote, TicketEvent, and AiJob tables, enums, foreign keys, indexes, and revision/count checks. Existing catalog and identity data remain intact. No ticket seed is required. Existing demo accounts work; `npm run db:seed` can still be rerun and preserves tickets, replies, notes, events, and jobs.

Agent-side migration deployment is blocked by Prisma's schema-engine subprocess EPERM. All migrations have been applied and tested against isolated schemas in the real local PostgreSQL container. The application database still needs the command above; its migration ledger has not been edited manually.

## Manual API

All paths begin with `/api/v1`. Mutations require the session cookie, matching `Origin`, `X-BookLeaf-Request: 1`, and JSON bodies. Unknown request fields are rejected. Responses follow the shared resource/list/error envelopes.

| Endpoint                  | Access | Behavior                                                                                                    |
| ------------------------- | ------ | ----------------------------------------------------------------------------------------------------------- |
| POST /tickets             | Author | `{ bookId: null or owned ID, subject, description }`; 201 with public ticket and classificationState QUEUED |
| GET /tickets              | Both   | Author's own tickets or admin queue; pagination/filtering below                                             |
| GET /tickets/:id          | Both   | Explicit author/admin detail projection; inaccessible and missing tickets both return 404                   |
| PATCH /tickets/:id        | Admin  | expectedRevision plus status/category/priority/assignmentAction; returns updated admin detail               |
| POST /tickets/:id/replies | Admin  | body and expectedRevision; required Idempotency-Key; 201 public reply                                       |
| POST /tickets/:id/notes   | Admin  | body; 201 private note                                                                                      |

Authors cannot submit authorId, assignment, priority, status, or classification fields, and cannot reply or add notes. Their responses never contain notes, events, assignment, category/priority, revisions, suggestions, or AI draft data. The create response alone includes the documented classification state. Book ownership is checked by catalog and rechecked inside the creation transaction while locking the book. Production books and general/account-level tickets are supported.

Subjects are trimmed and limited to 200 characters; descriptions, replies, and notes are trimmed and limited to 10,000. Blank text is rejected. Text is stored as plain text; future UIs must render it safely.

### Queue

Authors can filter by status and inclusive createdFrom/createdTo UTC calendar dates and sort oldest/newest (default newest). Admins additionally filter by category/priority and use the default queue sort. Admin-only filters on author requests return 400, rather than being silently ignored.

Queue ordering is unresolved (OPEN/IN_PROGRESS) first, then CRITICAL, HIGH, MEDIUM, LOW, then oldest creation time, then ID ascending. Resolved/closed tickets follow with the same priority/age ordering. Explicit oldest/newest sorts order solely by creation time and ID. Pages default to 1/20, maximum pageSize is 100, and excessive offsets return 400. Count and results use one repeatable-read snapshot; no historical-date filter is silently applied.

### Lifecycle and concurrent edits

The allowed transitions remain those in `contracts.md`. Supplying the current status is accepted as a no-op status change. New public replies require reopening a CLOSED ticket and never change status implicitly. SELF assignment resolves to the current admin; UNASSIGN clears it.

All ticket mutations acquire a PostgreSQL row lock. PATCH and new replies compare expectedRevision with the locked row; stale edits return 409 CONFLICT with a safe instruction to reload. Successful PATCH, reply, note, and classification application increment revision. Notes need no expectedRevision because they append independently, but they invalidate an admin's stale editing revision. Every accepted PATCH increments revision even if the supplied effective value was already current.

Status, assignment, category, and priority changes record an event with actor, old/new value, and timestamp. Explicitly selecting an existing category/priority still marks that field as manually overridden and records the initial override event. An AI event has a null actor. Category and priority overrides are independent and are not reset by later AI results.

### Reply idempotency

Idempotency-Key is 1–128 characters using letters, digits, underscore, or hyphen. It is scoped to ticket and admin sender and persisted with a SHA-256 fingerprint of the validated body and expectedRevision. Concurrent or later retries of the same request return the existing reply with 201 and do not increment revision again, even if the ticket has since closed. Changing either request field while reusing the key returns 409. A new logical send needs a new key and current revision. Keys are not expired in M04. Notes and ticket creation have no idempotency contract yet; clients must not automatically retry those POSTs after an ambiguous response.

## M05/M06 integration boundary

`enqueueClassification(tx, ticketId, contextRevision)` upserts a job using the unique key `ticketId:classification:revision` inside the caller's transaction. Ticket creation stores the resulting job ID as its current classification job. Enqueue failure rolls back both ticket and job. This is durable work persistence, not a running queue: jobs remain QUEUED in M04 and manual support continues normally.

AiJob includes state, attempts, availableAt, leaseToken, leaseExpiresAt, contextRevision, safe failureReason, and completion timestamps. Only CLASSIFICATION is supported now. M06 will add claim/reclaim/retry scheduling; M05 owns provider configuration and validated inference. Neither is implemented here.

`ticketService.applyClassification(jobId, leaseToken, validatedResult)` is an internal server boundary, not an HTTP endpoint. It validates the shared classification result, locks the ticket and then the job, and requires:

- The job is the ticket's current CLASSIFICATION job.
- Its contextRevision equals the ticket's classificationRevision.
- It is RUNNING with the supplied lease token and an unexpired lease.

It saves the suggestions/rationale, applies each effective field only when its own override flag is false, records effective changes, increments ticket revision, and completes the job in the same transaction. A duplicate completion, old generation, reclaimed/expired lease, or invalid result cannot mutate the ticket. Duplicate completion currently returns 409; the future runner should inspect job state after ambiguous delivery rather than apply twice. The method never changes assignment/status or sends a reply. Raw suggestions and rationale are internal and absent from current HTTP DTOs.

M06 must use the same ticket-before-job lock order when a transaction locks both, and must issue a fresh token on each claim/reclaim. Claims must be committed before any provider call. Explicit reclassification must increment classificationRevision and replace classificationJobId atomically with enqueue; the enqueue helper alone does not supersede current work. The current original subject/description/book association is immutable, so ordinary manual updates do not invalidate this classification input. Future additional classification inputs/configuration changes must be represented by a new generation.

The separate contextRevision tracks draft-relevant changes: public replies and effective category changes increment it; private notes do not. It is a future invalidation input, not a complete AI fingerprint. M05/M06 must additionally include verified catalog facts, prompt/KB versions, and provider/model identity. Draft storage, cache semantics, retry endpoints, and worker failure handling remain future work. Current admin detail reports draftState NOT_REQUESTED honestly.

## Verification

Actual results: 36 API tests and 6 contract tests passed, with zero failures/skips. This includes the M04 parent test and its 11 behavior groups. Workspace typechecking, contracts/API builds, Prisma generation/validation, lint, and formatting passed. API and contract tests were compiled and run directly to avoid the environment's blocked test-launcher subprocesses. Dependency deprecation notices from Fastify request logging and Prisma/pg query execution were emitted without test failures. No dependency upgrades were introduced.

The M04 PostgreSQL suite runs 11 behavior groups under one parent test. It exercises all status pairs; role/ownership attacks; general and production-book submission; private-note isolation; all queue filters, ordering, date boundaries, and pagination; stale/concurrent edits; concurrent and restarted-service reply retries; closed-ticket replies; seed preservation of real support records; failure rollback; independent overrides; invalid, duplicate, superseded, and expired AI results; and live HTTP login, cookies, CSRF, role enforcement, and envelopes.

Injected database triggers verify rollback when writes fail after reply/event creation or after applying an AI result but before job completion. Test suggestions and simulated lease claims are clearly test-only and provide no evidence of a running worker or live model quality.

Set TEST_DATABASE_URL to a local disposable PostgreSQL database before `npm test`. Integration tests create random schemas, apply all migrations, and remove only their generated schemas. Without this explicit variable, database tests are skipped. The development role needs schema-creation rights.

Next in the agreed fastest delivery sequence is **M07 Author interface**, then M08 Admin interface; M05 AI and M06 worker remain separate backend modules. No frontend or AI infrastructure is added by M04.
