# Modules and implementation prompts

Each prompt is a complete trigger for one module. Paste it into a coding session in this repository. The documents establish defaults; implementation may make small compatible choices, but changes to shared contracts must be documented and applied to affected consumers.

## M01 Foundation and contracts

**Dependencies:** None.

**Owns:** Workspace configuration, application entry points, shared schemas/fixtures, common error handling, environment validation, database wiring, and minimal UI shell. Business modules own their subsequent migrations.

**Deliverables:** npm workspaces for api/web/contracts; TypeScript configuration; Fastify server; Vite React shell; PostgreSQL/Prisma setup; Zod contracts; common scripts; `.env.example`; ignore rules; local setup instructions. Secrets remain outside tracked files. Establish a basic same-origin development proxy and production serving strategy.

**Acceptance:** Clean install works; typecheck/build pass; liveness and database readiness behave correctly; web loads; shared fixtures cover published/production books, pending/failed AI, and role-specific ticket responses. Choose compatible supported package versions and record them in the lockfile.

**Implementation prompt**

```text
Implement M01 Foundation and contracts for this BookLeaf repository.
Read docs/README.md, docs/architecture.md, docs/contracts.md, and the M01 section of docs/modules.md. Inspect repository instructions and existing work first.
Set up npm workspaces with React/TypeScript/Vite, Node.js/TypeScript/Fastify, PostgreSQL/Prisma, and a shared Zod contracts package. Implement the documented API shapes, enums, error envelope, and fixtures without implementing the business workflows. Add environment validation, safe example configuration, database wiring, a minimal web shell, health endpoints, and useful development/build/typecheck commands. Configure same-origin API access and document how production will serve the web application.
Do not add credentials or keys to tracked files. Do not build later modules or introduce extra infrastructure. Run appropriate build/type checks and a startup smoke check; report actual results. Update docs/README.md progress and setup documentation. Stop after M01 and report changes, checks, limitations, and the next module.
```

## M02 Identity and access

**Dependencies:** M01. An author link is a defined interface; catalog supplies the actual profiles in M03.

**Owns:** User/session schema and migrations; credential verification; role guards; current-user context; demo account seed support.

**Deliverables:** Login/logout/me endpoints; secure password hashing; random session tokens stored hashed; expiry; login throttling; secure production cookie settings; mutation origin/CSRF protection. Use the sample emails for author login and one clearly documented demo admin. Coordinate author FK creation with M03 so clean migrations and seed work.

**Acceptance:** Valid and invalid login; normalized email handling; expired/revoked session; logout; unauthenticated requests; author blocked from admin actions; no password hash/token in response/log; production cookie configuration verified.

**Implementation prompt**

```text
Implement M02 Identity and access only.
Read docs/architecture.md, docs/contracts.md, docs/modules.md M02, and current repository instructions. Inspect M01 and reuse its contracts and error handling.
Build server-side email/password authentication, expiring opaque cookie sessions with hashed stored tokens, logout, current-user lookup, role guards, login throttling, and mutation origin/CSRF protection. Add required migrations and repeatable demo-user seed support, coordinating the author relation with the catalog schema. Use strong password hashing and keep secrets out of logs and responses. Document demo credential configuration without using personal credentials.
Verify login failures, session expiry/revocation, role enforcement, and cookie/security behavior with meaningful tests. Do not treat frontend route guards as authorization. Update documentation/progress and stop after this module with results and any integration dependencies.
```

## M03 Author and book catalog

**Dependencies:** M01; M02 for protected routes. Domain logic can use a fixture principal while developing.

**Owns:** Author/book schema, import mapping, money/date/null handling, catalog queries, book-ownership validation, minimal AI fact projections.

**Deliverables:** Idempotent import of the exact supplied JSON; book list/detail APIs; preservation of original IDs/ISBN placeholders; 10 seeded author logins linked correctly. Admin context can fetch book facts through this module.

**Acceptance:** Exactly 10 authors/18 books from the fixture; repeated seed creates no duplicates or ticket deletion; author cannot retrieve another author's book; nulls and zero remain distinct; INR-to-paise conversion exact; production books remain selectable.

**Implementation prompt**

```text
Implement M03 Author and book catalog only.
Read docs/architecture.md, docs/contracts.md, docs/modules.md M03, the supplied sample JSON, and repository instructions. Reuse the authentication principal and shared schemas.
Create catalog migrations, repeatable seed/import, protected book list/detail endpoints, ownership assertions, and minimal verified context helpers for future AI use. Preserve sample author/book IDs, placeholder ISBNs, production statuses, date-only fields, and nulls. Convert currency exactly to integer paise. Link the 10 demo author accounts and preserve existing support data on seed reruns.
Test counts, seed repeatability, ownership isolation, money mapping, and production/null cases. Do not invent sales history or banking data. Update documentation/progress and stop after M03 with validation results.
```

## M04 Ticket management

**Dependencies:** M01–M03. Uses a job-enqueue contract; the runner arrives in M06.

**Owns:** Ticket/reply/note/event schema and routes, lifecycle, assignment, manual overrides, queue queries, author/admin projections, transaction boundaries. Define the minimal job persistence/enqueue seam with the M06 contract so ticket creation remains durable before the runner exists.

**Deliverables:** Complete manual workflow; filters/sorting/pagination; expectedRevision protection; reply idempotency; classification job queued transactionally; service to safely apply future AI results.

**Acceptance:** Owned-book check; private-note isolation; all permitted/forbidden state transitions; queue ordering/filtering; stale edit conflict; duplicate reply prevention; late AI cannot undo overrides; ticket and job commit or roll back together. No LLM request is required to create or handle tickets.

**Implementation prompt**

```text
Implement M04 Ticket management only.
Read docs/architecture.md, docs/contracts.md, docs/modules.md M04, and existing module code/instructions.
Build the complete manual ticket API: submission, role-scoped list/detail, admin filters and priority/age sorting, status transitions, self-assignment/unassignment, public replies, internal notes, and change events. Enforce book ownership and explicit author/admin DTOs. Add revision conflict handling, reply idempotency, and independent category/priority override flags. Implement a transactional job-enqueue seam so creation saves a classification job without calling an LLM. Provide a ticket service method for applying future AI suggestions safely.
Test ownership attacks, private-note leakage, transitions, queue filters/order, stale edits, duplicate sends, transaction rollback, and delayed AI override protection. Do not implement provider calls or the worker. Update docs/progress and stop after M04 with results and integration notes.
```

## M05 Knowledge base and AI

**Dependencies:** M01 contracts. Can be implemented with fixtures before ticket/UI modules are complete.

**Owns:** Versioned policy resource, topic selection, prompts, provider adapters, output validation, normalized failures, context fingerprints, AI run persistence interface.

**Deliverables:** classifyTicket and draftResponse services; OpenRouter integration; compatible endpoint configuration; separate task models; safe usage metadata; deterministic fake provider for tests; representative evaluation fixtures. Provider calls contain no arbitrary cross-author queries. Automatic retries are owned by M06 to avoid nested retry loops.

**Acceptance:** All six category outputs validated; malformed model output rejected; quota/auth/rate-limit/timeout failures normalized; API keys remain server-only; missing facts not presented as known; sample royalty/ISBN/print/distribution/production/general cases evaluated. Automated test fixtures are not evidence of live model quality: perform a small explicitly reported live smoke evaluation when credentials are available.

**Implementation prompt**

```text
Implement M05 Knowledge base and AI assistance only.
Read docs/architecture.md, docs/contracts.md, docs/modules.md M05, the original assignment PDF and sample JSON, and repository instructions. Transcribe the supplied knowledge base faithfully into a versioned resource, including tone and sample-response guidance.
Implement provider-independent classification/priority and drafting services, topic-based context selection, structured output validation, context fingerprints, safe AI-run records, and an OpenRouter adapter. Make provider/base URL/key/model/timeouts/token caps configurable, with a compatible chat-completions adapter path and a deterministic fake provider for tests. Models without native JSON schema support must still have validated outputs. Normalize failures and expose retry metadata; leave scheduling/retries to M06.
Enforce factual grounding, minimal author context, prompt-injection boundaries, and no claims of completed external actions. Never auto-send drafts or expose secrets. Add representative quality fixtures and deterministic failure tests. If a usable key exists, run a small quota-conscious live evaluation and report exactly what was checked; otherwise explicitly record that live AI remains unverified. Update docs/progress and stop after M05.
```

## M06 Background execution and AI orchestration

**Dependencies:** M04 and M05; M01 infrastructure.

**Owns:** Persistent job execution, leasing, restart recovery, retry scheduling, request budgets, deduplication, AI draft endpoints, application of AI results through ticket services.

**Deliverables:** Runner alongside API; asynchronous classification on submission; on-demand draft jobs; cached result reuse; explicit retry/regenerate behavior; timeout/temporary failure handling; exhausted-provider pause; clean shutdown. Keep provider configuration replaceable without changing ticket code.

**Acceptance:** Slow/down AI does not block ticket submission; jobs survive restart; two runners cannot claim the same live lease; repeated draft requests reuse work; attempts are bounded; stale results/overrides protected; polling never calls a provider; real manual fallback works; retry after configuration change works.

**Implementation prompt**

```text
Implement M06 Background execution and AI orchestration only.
Read docs/architecture.md, docs/contracts.md, docs/modules.md M06, and existing ticket/AI interfaces. Reuse the persisted enqueue seam from M04.
Build an atomically leased PostgreSQL job runner with restart recovery, bounded retries/backoff, Retry-After support, concurrency/request-budget limits, and exhausted-provider pause behavior. Run it alongside the API initially. Wire automatic classification, on-demand draft creation, draft retrieval, and explicit classification retry endpoints. Reuse cached current results, deduplicate active jobs, and preserve overrides, context versions, and admin edits. Never hold database transactions open across LLM calls. Do not silently enable a paid fallback.
Test timeout/rate-limit/quota/auth failures, process recovery, duplicate claims/requests, stale results, and continued manual ticket handling. Verify the configured OpenRouter path if credentials are available and clearly distinguish mocks from live checks. Update docs/progress and stop after M06 with results and remaining gaps.
```

## M07 Author interface

**Dependencies:** M01; integrates M02–M04. Can develop using contract-aligned mocks until endpoints exist.

**Owns:** Login screen, author layout, My Books, ticket form, ticket list/detail, polling, accessible states. Shared authentication UI and API client are reused by M08.

**Deliverables:** Responsive author views; all required book fields; production/null handling; optional owned-book selection; clearly labeled UI-only attachment selection; public replies/status refresh; logout and session-expiry handling.

**Acceptance:** Full author login → view books → submit → view reply flow; general/book-specific tickets; no private data rendered; loading/empty/error states; polling updates without a refresh; no submission data loss on recoverable errors; forms keyboard accessible.

**Implementation prompt**

```text
Implement M07 Author interface only.
Read docs/architecture.md, docs/contracts.md, docs/modules.md M07, and repository instructions. Use existing shared components/API contracts and React/TypeScript/Vite with React Router and TanStack Query.
Build login/logout and author screens for books, ticket submission, ticket list, and ticket detail. Show all required book fields with correct INR/date/null formatting. Allow an owned book or General / Account Level. Include optional attachment selection UI with an explicit notice that files are not uploaded/sent. Poll active ticket views approximately every five seconds, avoiding hidden-tab churn and backing off on failures. Handle session expiry, loading, empty, validation, and network-error states accessibly.
Develop against matching fixtures where necessary, then integrate available real endpoints. Verify the author journey and updates without manual refresh. Do not build admin screens or extra features. Update docs/progress and stop after M07, explicitly listing any still-mocked integrations.
```

## M08 Admin interface

**Dependencies:** M01, shared UI/auth from M07, and M04. AI states can be mocked until M06 exists.

**Owns:** Admin layout, queue filters/order, ticket context, management controls, public-reply composer, private-note form, AI states/draft editing.

**Deliverables:** Queue with urgent/old unresolved tickets easy to spot; author/book context; self-assignment; lifecycle controls; override controls; private-note section visually distinct from public responses; editable draft with deliberate send/regenerate.

**Acceptance:** Complete manual handling before AI integration; AI pending/unavailable/failed states; cache reuse on reopen; unsent edits survive polling; reply updates author view; conflict messages preserve local work; private notes cannot be accidentally submitted through public controls.

**Implementation prompt**

```text
Implement M08 Admin interface only.
Read docs/architecture.md, docs/contracts.md, docs/modules.md M08, and existing shared UI/auth code and repository instructions.
Build the admin queue with status/category/priority/date filters, pagination, and clear priority/age cues. Build ticket detail with author/book context, status controls, assignment to self/unassignment, category/priority overrides, private notes, and public reply composition. Display AI suggestions and pending/failure states; request a draft only when needed through POST and poll through GET. Allow editing and deliberate regeneration/send without ever overwriting unsaved text during polling. Keep public replies and private notes clearly separated. Manual reply composition must work without AI.
Use fixtures for unavailable AI endpoints and document them, then integrate real endpoints when present. Verify queue operations, manual workflow, dirty-editor preservation, conflicts, and accessible states. Update docs/progress and stop after M08 with checks and remaining integration work.
```

## M09 Integration and delivery

**Dependencies:** M01–M08.

**Owns:** Cross-module verification, fixes needed for integration, deployment packaging, README/API docs, demo credentials, one-page approach write-up, final evidence.

**Deliverables:** Working locally and deployed; persistent seeded database; API documentation; environment/provider-switch instructions; known limitations; submission checklist and test evidence. Actual external publishing must follow the user's authorization and available account permissions; prepare a concrete deployable result first.

**Acceptance:** All checks in `delivery.md`; real AI path demonstrated when credentials allow; no unresolved mocks on required paths; clean setup/build; accessible live URL tested with both roles; no secrets in repository/bundle/logs. If deployment access is absent, report it as outstanding rather than claiming submission readiness.

**Implementation prompt**

```text
Implement M09 Integration and delivery for the BookLeaf assignment.
Read all docs, repository instructions, and module progress. Run the checklist in docs/delivery.md and close integration gaps without expanding scope. Exercise both portals, access isolation, notes privacy, ticket lifecycle, polling, classification, draft editing, manual fallback, quota handling, seed repeatability, and provider configuration changes. Use deterministic provider failures for reliability checks and distinguish them from live AI evaluation.
Prepare production build/start/migration/seed commands and deploy using available authorized hosting. Do not claim deployment if no accessible URL was verified. Write a complete project README, API documentation, demo credentials guidance, and a maximum one-page approach write-up with honest tradeoffs and limitations. Check for secrets and unresolved required-path mocks. Update progress with evidence and report completed checks, live URL if verified, and any remaining submission blockers. Do not add bonus features before required checks pass.
```
