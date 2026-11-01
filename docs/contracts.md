# Shared contracts

These agreements allow backend modules and frontend screens to be developed against fixtures. M01 implements them as runtime schemas and TypeScript types in `packages/contracts/src/index.ts`, with fixture exports in `packages/contracts/src/fixtures.ts`. Endpoint metadata is not a registered backend workflow. Changes must update schemas, fixtures, documentation, and affected consumers together.

## Enumerations

| Concept       | API values                                        | Display labels                      |
| ------------- | ------------------------------------------------- | ----------------------------------- |
| Role          | AUTHOR, ADMIN                                     | Author, Admin                       |
| Ticket status | OPEN, IN_PROGRESS, RESOLVED, CLOSED               | Open, In Progress, Resolved, Closed |
| Priority      | CRITICAL, HIGH, MEDIUM, LOW                       | Critical, High, Medium, Low         |
| Category      | ROYALTY_PAYMENTS                                  | Royalty & Payments                  |
| Category      | ISBN_METADATA                                     | ISBN & Metadata Issues              |
| Category      | PRINTING_QUALITY                                  | Printing & Quality                  |
| Category      | DISTRIBUTION_AVAILABILITY                         | Distribution & Availability         |
| Category      | BOOK_STATUS_PRODUCTION                            | Book Status & Production Updates    |
| Category      | GENERAL_INQUIRY                                   | General Inquiry                     |
| AI task state | NOT_REQUESTED, QUEUED, RUNNING, SUCCEEDED, FAILED | Human-readable equivalent           |

Book status is separate from ticket status. Preserve the dataset's book-status strings, including production stages.

Before classification, category is nullable and priority defaults provisionally to MEDIUM. AI status and provenance identify this as pending/unavailable, not a completed AI assessment. Category and priority each have their own manual-override flag.

## Response conventions

- Prefix: `/api/v1`.
- Singular response: `{ data: resource }`.
- List response: `{ data: resources, meta: { page, pageSize, total } }`.
- Error: `{ error: { code, message, fieldErrors?, requestId } }`.
- Page defaults: page 1, pageSize 20; maximum pageSize 100.
- Dates: YYYY-MM-DD for calendar dates; UTC ISO 8601 for timestamps.
- Money: integer fields with `Paise` suffix; currency is INR. UI formats rupees.
- IDs are opaque strings. Sample author/book IDs retain their original values.
- Return 400 for malformed/invalid input, 401 for missing/expired session, 403 for forbidden role, 404 for absent or inaccessible author resources, 409 for revision/state conflicts, and 429 for application rate limits.
- Never return raw database/provider errors or credentials.

## Core resource shapes

| Resource            | Fields                                                                                                                                                                                                                                                                         |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| CurrentUser         | id, email, role, displayName, authorId nullable                                                                                                                                                                                                                                |
| Book                | id, authorId, title, isbn, genre, publicationDate nullable, status, mrpPaise nullable, authorRoyaltyPerCopyPaise nullable, totalCopiesSold, totalRoyaltyEarnedPaise, royaltyPaidPaise, royaltyPendingPaise, lastRoyaltyPayoutDate nullable, printPartner nullable, availableOn |
| AuthorTicketSummary | id, book reference nullable, subject, status, createdAt, updatedAt                                                                                                                                                                                                             |
| AuthorTicketDetail  | Summary fields, description, public replies                                                                                                                                                                                                                                    |
| AdminTicketSummary  | Author summary fields, author reference, category nullable, priority, classificationState, categorySource, prioritySource, assignee nullable, revision                                                                                                                         |
| AdminTicketDetail   | Admin summary fields, description, public replies, internal notes, change events, AI state                                                                                                                                                                                     |
| PublicReply         | id, body, sender display name, createdAt                                                                                                                                                                                                                                       |
| PrivateNote         | id, body, creator reference, createdAt; admin only                                                                                                                                                                                                                             |
| AiDraft             | id, text, state, contextRevision, stale, createdAt, safe failure reason nullable; admin only                                                                                                                                                                                   |

Concrete field names in M01: public replies use `senderDisplayName`; private notes use `creator`; admin detail uses `notes`, `events`, and `draftState`. Classification provenance is DEFAULT, AI, or MANUAL; DEFAULT identifies the provisional value while classification is pending/unavailable. Change events use `type`, `actor`, `oldValue`, and `newValue`.

AI drafts are a state-discriminated union rather than a record full of nulls: NOT_REQUESTED has only `state`; QUEUED/RUNNING add `id`, `contextRevision`, `stale`, and `createdAt`; SUCCEEDED adds `text`; FAILED adds `failureReason`. The create-ticket response also includes `classificationState`; retry-classification returns `ticketId` and `state`.

Use distinct author and admin schemas. Do not send admin fields to authors and rely on UI hiding.

## Endpoints

| Method and path                      | Access        | Request and behavior                                                                             |
| ------------------------------------ | ------------- | ------------------------------------------------------------------------------------------------ |
| POST /auth/login                     | Public        | email, password; sets session cookie; returns CurrentUser                                        |
| POST /auth/logout                    | Authenticated | Revokes session and clears cookie; 204                                                           |
| GET /auth/me                         | Authenticated | Returns CurrentUser                                                                              |
| GET /books                           | Authenticated | Own books for author; admin may filter by authorId; paginated                                    |
| GET /books/{id}                      | Authenticated | Own book for author; any book for admin                                                          |
| POST /tickets                        | Author        | bookId nullable, subject, description; 201 with saved ticket and classification state            |
| GET /tickets                         | Authenticated | Own tickets for author; all for admin; paginated and filtered                                    |
| GET /tickets/{id}                    | Authenticated | Role-specific detail DTO                                                                         |
| PATCH /tickets/{id}                  | Admin         | expectedRevision plus supplied status/category/priority/assignmentAction; returns updated detail |
| POST /tickets/{id}/replies           | Admin         | body, expectedRevision; Idempotency-Key header; 201                                              |
| POST /tickets/{id}/notes             | Admin         | body; 201; never public                                                                          |
| POST /tickets/{id}/ai-drafts         | Admin         | regenerate boolean default false; queues or reuses current work; 202 pending or 200 cached       |
| GET /tickets/{id}/ai-drafts/latest   | Admin         | Current draft state; NOT_REQUESTED if absent; no side effects                                    |
| POST /tickets/{id}/ai-classification | Admin         | Explicit classification retry; deduplicates pending work; 202                                    |

All paths above follow `/api/v1`. Public liveness/readiness endpoints may exist outside the business API; expose no secrets.

M02 implements login/logout/me. API mutations require `Origin` equal to APP_ORIGIN and `X-BookLeaf-Request: 1`; missing or mismatched headers return 403. The shared web request helper adds the custom header. All registered business routes except POST login require a persisted session by default, and admin-only handlers attach `requireRole('ADMIN')`. `request.user` contains CurrentUser; use its `authorId` for future ownership checks. Identity responses use no-store caching. See [Identity and access](identity.md) for cookie, expiry, throttling, and seeding details.

Queue query parameters: `status`, `category`, `priority`, `createdFrom`, `createdTo`, `page`, `pageSize`, `sort`. Date filters are inclusive calendar dates interpreted in UTC; internally use an exclusive next-day boundary. Author filters are restricted to public fields such as status/date. Default admin sort puts unresolved tickets first, ordered by priority descending and creation time ascending, with ID as a stable tie-breaker. Support explicit oldest/newest sorting. No date filter is active by default because sample records are historical.

## Validation and state rules

- Trim subject/body fields; reject blank values. Initial limits: subject 200 characters, description 10,000, reply/note 10,000. Document these in schemas and UI.
- General tickets use null bookId. Book-linked tickets must reference a book owned by the authenticated author.
- Ticket author and original query are immutable in the initial scope.
- Assignment actions are SELF or UNASSIGN; the server resolves SELF to the current admin. Arbitrary assignment to another admin is deferred.
- Legal transitions: OPEN → IN_PROGRESS or RESOLVED; IN_PROGRESS → OPEN or RESOLVED; RESOLVED → IN_PROGRESS or CLOSED; CLOSED → IN_PROGRESS. Only admins change status. Reopening is an explicit admin action.
- Replies do not implicitly change status. Closed tickets require reopening before a new public reply.
- Sending a public reply never sends an AI draft implicitly: the request contains the reviewed final text.
- Manual category/priority changes set the corresponding override flag. Subsequent AI runs may update suggestions but cannot change overridden effective values.
- Record status, assignment, and classification changes with actor and timestamp.
- expectedRevision rejects stale admin edits with 409. Return enough safe information for the UI to reload rather than silently retrying edits.

## Internal interfaces

| Interface         | Contract                                                                                                                                                     |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Authentication    | Resolve a session into userId, role, authorId; reject expired/revoked sessions                                                                               |
| Catalog           | Fetch authorized books and minimal verified AI context; assert book ownership                                                                                |
| Ticket service    | Create/read/manage tickets; apply validated AI suggestions preserving overrides                                                                              |
| Job enqueue       | Insert a deduplicated task within a supplied database transaction                                                                                            |
| AI classification | Input: bounded query and relevant policy; output: allowed category, priority, short rationale                                                                |
| AI drafting       | Input: query, verified book/account facts, selected policy, bounded public replies; output: draft text and policy section references                         |
| Provider          | Generate from messages/options; return output text and optional usage; normalize timeout, rate limit, quota, authentication, invalid output, upstream errors |
| Job runner        | Claim leased work, call AI, apply current results, record outcome; recover expired leases                                                                    |

Test doubles must implement these same contracts. A fake provider is a test/development tool and must not masquerade as a live model in the submitted demo.

## Job and cache semantics

Persist job states QUEUED, RUNNING, SUCCEEDED, FAILED. Delayed retries stay QUEUED with a future availableAt. Atomically claim eligible jobs with a lease; expired leases can be reclaimed after restart. Deduplicate by ticket, task, and relevant context fingerprint. Use bounded attempts and safe failure summaries.

Do not hold a database transaction open during a model call. When storing results, recheck overrides and context. Old draft results may be retained as stale but must not replace a newer current draft. A successful model run is persisted before being served as reusable output. Polling and component remounts do not create duplicate work.

Cache fingerprints include relevant query/book facts/public replies, prompt and KB versions, and model/provider identity. Do not include private notes. A changed effective category can affect policy selection and must invalidate the relevant draft context. An admin's unsent local edits are never automatically replaced by polling.
