# Architecture and scope

M04 implementation: ticket mutations serialize on a database row lock, with optimistic revision checks for edits and new public replies. A durable per-ticket/admin idempotency key protects reply retries. Classification jobs are inserted in the ticket-creation transaction; no worker or provider is called. The internal result-application method checks active job generation and lease, preserves independent overrides, and completes the job atomically. See [Ticket management](tickets.md) for the exact M05/M06 integration boundary.

M03 implementation: the catalog extends M02's Author table in place and adds Book. Author profile columns remain nullable for identity-only anchors, while catalog import requires complete profiles. Imports and combined demo seeds use atomic transactions and never delete records missing from the sample. Currency is stored as bounded BIGINT paise, dates as DATE, and nullable production fields remain null. Read endpoints and internal context helpers enforce ownership using the persisted authentication principal. See [Catalog](catalog.md) for migration, import, and module integration details.

## Product goal

Authors can see their books and raise support tickets. Administrators can prioritize work, review AI suggestions, send replies, add private notes, and manage ticket status. AI assists staff; it never sends a reply automatically.

## Required scope

| Area              | Required behavior                                                                                                |
| ----------------- | ---------------------------------------------------------------------------------------------------------------- |
| Authentication    | Email/password login; author and admin roles; authors see only their own records                                 |
| Books             | Title, ISBN, genre, publication date, status, MRP, copies sold, earned/paid/pending royalties                    |
| Ticket submission | Optional owned book or General / Account Level, subject, description, attachment selection UI                    |
| Author tickets    | Own ticket list and detail, original query, public replies, status, near-real-time updates                       |
| Admin queue       | All tickets; status, category, priority, and creation-date filters; urgent and oldest unresolved tickets visible |
| AI                | Automatic category and priority; editable policy-grounded response drafts; manual overrides                      |
| Ticket operations | Status changes, private notes, assignment to self                                                                |
| API               | Protected REST endpoints, validation, ownership checks, meaningful errors, documentation                         |
| Submission        | Public source repository, live seeded demo, test logins, README, maximum one-page approach write-up              |

The six categories and four statuses/priorities are fixed in `contracts.md`.

## Scope decisions

- Show all books, including books in production, because the evaluation explicitly includes these edge cases.
- Provide seeded logins. Registration, recovery, OTP, and social login are out of initial scope.
- Authors submit and view tickets. Author follow-up replies are deferred because they are not explicitly required.
- Attachments are UI-only initially. Clearly state that selected files are not uploaded or sent; do not imply that the administrator received them.
- Email notifications, banking, payment execution, accounting, external escalations, marketplace synchronization, charts, and actual uploads are deferred.
- Poll active ticket screens about every five seconds; pause unnecessary polling when hidden and back off after errors.
- No automatic AI sending or automatic paid fallback.

## Stack and deployment defaults

| Layer             | Default                                                                   | Reason                                                    |
| ----------------- | ------------------------------------------------------------------------- | --------------------------------------------------------- |
| Web               | React, TypeScript, Vite, React Router                                     | Small client application with two role-specific areas     |
| Server state      | TanStack Query                                                            | API caching, mutations, and polling                       |
| REST API          | Node.js, TypeScript, Fastify                                              | Clear route modules and validation boundaries             |
| Database          | PostgreSQL with Prisma                                                    | Relational ownership, migrations, transactions            |
| Shared validation | Zod                                                                       | Explicit runtime validation and inferred TypeScript types |
| Workspace         | npm workspaces                                                            | One repository and straightforward commands               |
| Authentication    | Opaque server-side sessions in secure HTTP-only cookies                   | Simple session revocation; no browser token storage       |
| AI transport      | Provider adapter, OpenRouter initially                                    | Provider concerns do not enter ticket code                |
| Jobs              | PostgreSQL-backed jobs with a runner alongside the API initially          | Durable work without Redis or a separate queue service    |
| Hosting shape     | Node process serving API and built web assets, plus persistent PostgreSQL | Same-origin cookies and a small deployment footprint      |

Select compatible supported versions at implementation time and pin dependencies in the lockfile. Hosting vendor and exact LLM model remain configurable; neither is a dependency of the domain design.

## Repository layout

```text
apps/
  api/
    prisma/                 schema, migrations, seed
    src/
      modules/auth/
      modules/catalog/
      modules/tickets/
      modules/ai/
      modules/jobs/
      infrastructure/       database, configuration, logging, server setup
  web/
    src/
      features/auth/
      features/books/
      features/author-tickets/
      features/admin-tickets/
      shared/               API client, layout, common UI
packages/
  contracts/                enums, schemas, request/response types, fixtures
docs/
```

## Module boundaries

Catalog owns author/book records. Identity owns users and sessions. Tickets owns the ticket lifecycle, public replies, private notes, effective classification, and assignment. AI owns prompts, policy selection, provider adapters, and AI run records. Jobs owns scheduling and retry state.

The web application calls REST endpoints only. AI accepts an explicit, minimal context and returns suggestions; it does not query arbitrary author records or mutate ticket status. Tickets applies AI results through a service method that preserves manual overrides. Jobs orchestrates the AI and ticket services through explicit interfaces.

Use database transactions for ticket creation plus classification-job insertion, and for applying AI results plus completing their job. The ticket module owns the transaction boundary for ticket creation; an injected job-enqueue interface accepts that transaction. Avoid remote API calls inside database transactions.

## Data model

| Entity      | Key contents and constraints                                                                                                                   |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| User        | ID, normalized unique email, password hash, AUTHOR/ADMIN role, optional unique author link                                                     |
| Session     | Hashed opaque token, user ID, expiry; delete/revoke on logout                                                                                  |
| Author      | Original author ID, name, email, phone, city, joined date                                                                                      |
| Book        | Original book ID, author FK, supplied metadata, nullable production fields, platform list, money snapshots                                     |
| Ticket      | ID, author FK, optional owned book FK, original subject/description, status, category/priority, override flags, assignee, timestamps, revision |
| TicketReply | Ticket FK, admin sender, plain-text body, timestamp                                                                                            |
| TicketNote  | Ticket FK, admin creator, private plain-text body, timestamp                                                                                   |
| TicketEvent | Ticket FK, actor, change type, timestamp, relevant old/new values                                                                              |
| AiRun       | Ticket FK, task, context fingerprint, prompt/KB versions, provider/model, status, validated result, safe error, usage when supplied            |
| AiJob       | Ticket FK, task, unique deduplication key, state, attempts, available-at, lease expiry, context revision                                       |

Store monetary values as integer paise and expose the unit explicitly in API field names. Dates without a time remain date-only values; timestamps are UTC ISO 8601 strings. Retain sample IDs and preserve nulls. Never recalculate historical royalty snapshots from MRP.

There are 10 authors and 18 books: 16 published and 2 in production. The dataset has no passwords, administrator, tickets, payout ledger, bank details, platform sales breakdown, or production deadlines. Seed the given records and demo credentials; optional demonstration tickets must be clearly identified and must not modify the supplied books.

The seed must be repeatable without duplication or deletion of existing tickets. ISBN placeholders must be preserved. A null monetary amount means unavailable, not zero.

## AI design

### Workflow

1. Create ticket and durable classification job together; return immediately.
2. Runner requests category and priority in one model call.
3. Validate allowed values before applying results. Preserve any administrator overrides.
4. Opening an admin ticket requests a draft only if no current draft exists. A mutating POST starts work; a GET never triggers an LLM request.
5. Draft generation uses relevant verified account data and policy sections.
6. Administrator reviews/edits and explicitly sends a public response through ticket management.

The browser must not repeatedly regenerate while polling or overwrite a dirty draft editor when fresh server state arrives.

### Provider interface and settings

The domain-facing AI service exposes `classifyTicket(context)` and `draftResponse(context)`. Provider adapters expose a common text-generation operation and normalize provider failures. Provider-specific schemas, authentication headers, and response parsing stay inside adapters.

Configure provider, base URL where applicable, server-side key, classification model, drafting model, timeout, output token cap, concurrency, request budget, and retry limit. Optional fallback configurations must be explicit. Credentials never enter source control, browser bundles, API responses, or logs.

OpenRouter is the first adapter. Provide a compatible chat-completions adapter path so supported endpoints can be switched through configuration. An incompatible provider requires a new adapter, not a rewrite of ticket logic. Changes to environment configuration can require a restart/redeploy; hot switching and an admin secrets screen are out of scope.

Do not assume every model supports native structured output. Prefer it when supported; otherwise request JSON and validate it. Invalid output is an explicit failure, not a valid classification. Model selection must be justified after checking actual response quality and availability with the user's key.

### Grounding and policy

Keep the full supplied knowledge base in a versioned local resource. Organize it into company, royalties, ISBN, print quality, distribution, production, metadata updates, and communication guidance. Select relevant sections deterministically; no vector database is needed.

Include exact policies: 80% of net profit to the author; quarterly calculation and payment within 45 days of quarter end; minimum payout threshold of INR 1,000; ISBN errors treated as high priority; verified print defects eligible for free reprint; standard print turnaround 5–7 business days; new listings 7–10 business days; stock re-sync 24–48 hours; metadata changes 3–5 business days. Preserve qualifications and the assignment's sample-response guidance when transcribing.

Separate verified facts from the author's statements. Missing ledger/bank/stage-history data must remain unknown. Pending royalties and an old last-payout date do not alone prove overdue payment. Never invent platform-level sales, completion dates, delay causes, or completed escalation/re-sync actions. Propose next steps for admin review. Do not promise a confirmed operational result merely because a policy provides a typical timeline.

Treat user text as untrusted content, not system instructions. Supply only the selected author's relevant records. Exclude private notes from prompts initially. Drafts should acknowledge the concern, cite relevant facts and policy accurately, and end with a concrete next step.

### Failure and cost behavior

- Cache results using task, ticket context fingerprint, prompt/KB version, and configured model identity.
- Persist waiting/running/succeeded/failed states and show clear status in the admin UI.
- Deduplicate repeated draft/classification requests.
- Retry transient failures with bounded backoff and respect Retry-After where provided. Do not repeatedly retry invalid credentials or exhausted quota.
- Pause calls to an unavailable/exhausted configuration and allow deliberate retry after configuration or availability changes.
- Record latency and token usage when available; do not log secrets or full sensitive prompts.
- Limit history, input sizes, output tokens, concurrent requests, and regenerations.
- Keep manual ticket handling available throughout failures.

## Security and concurrency

Backend authorization is mandatory even when UI controls are hidden. Scope author queries by authenticated author identity; never trust an author ID supplied by the browser. Verify selected book ownership during submission. Author DTOs exclude notes, drafts, AI errors, and admin-only events by construction.

Use password hashing, expiring sessions, login throttling, secure production cookies, and same-origin/CSRF protection for mutations. Redact credentials and personal data from logs. Render text safely; do not render model output as unchecked HTML.

Use a ticket revision for admin updates so concurrent edits return a conflict instead of silently losing changes. AI application checks override flags and context validity. Sending a reply should support an idempotency key to avoid duplicate responses after network retries.
