# M08 Admin interface

M06 integration update: the backend now implements real draft POST/GET endpoints and classification retry. The existing draft adapter uses those routes; test fixtures remain test-only. Dirty-editor behavior is unchanged. See [Background execution](background-jobs.md) for migration/provider setup and verification limits. The original M08 unavailable-endpoint notes below describe the pre-M06 state.

M08 adds the admin queue and ticket workspace using the existing React Router, TanStack Query, authentication, and shared Zod contracts. Manual actions use the real M04 endpoints. No backend workflow, migration, provider call, or worker is added.

## Run and routes

Run `npm run dev` and open `http://localhost:5173`. Sign in with DEMO_ADMIN_EMAIL and DEMO_ADMIN_PASSWORD from the ignored environment configuration. Admin sessions open `/admin`; `/admin/tickets/:id` opens a ticket. Author sessions retain their M07 routes and do not render admin screens. This routing is only navigation: the existing backend role, ownership, session, and CSRF checks remain the authorization boundary. No reseeding is needed.

The queue supports status/category/priority, inclusive UTC creation-date filters, urgency/age or oldest/newest sorting, and pagination. Filters are reflected in the URL and reset the page when changed. Invalid filters show an error and suspend fetching rather than silently displaying unrelated results. Priority has text and color cues; provisional defaults are labeled. Age measures time since submission, not an SLA. Ordering comes from the server: unresolved first, priority, creation time, and stable ID.

Ticket detail includes the original query, author identity, verified book facts (or general/account-level context), public conversation, private notes, change history, assignment, lifecycle controls, and category/priority overrides. Status options follow the shared transition table. Only changed fields are sent, so changing category does not accidentally override priority. Assign to me/unassign selects a pending change, committed by Save ticket changes. Sources distinguish manual overrides, applied AI suggestions, and provisional defaults.

## Editing and conflict behavior

- Server data polls every five seconds while visible, using M07's hidden-tab pause and failure backoff. Form text and selections live separately from query results and are never reset by polling.
- Editing captures the revision at which work began. Later server changes show a review notice; the administrator must explicitly acknowledge the current ticket before saving/sending against its latest revision. A server 409 preserves unsent text/selections and refreshes the ticket.
- Public reply, private note, and management controls are separate forms with explicit labels and distinct visual sections. Notes never populate the public editor or AI context.
- A public reply stores its original validated body, expectedRevision, and generated Idempotency-Key for the send attempt. Ambiguous network/server failures lock the text and offer Retry same send with exactly that request. Concurrent/repeated retries are deduplicated by M04. A confirmed conflict clears the attempt but preserves the text for deliberate review.
- Closed tickets need reopening for a new public reply. An uncertain retry may still be replayed safely after closure, since M04 returns the original saved reply for its key. Sending never changes status implicitly.
- Private-note creation has no idempotency contract. Ambiguous failures require checking the refreshed notes before explicitly enabling another attempt. No mutations retry automatically.
- Unsaved text is local to the mounted ticket. Polling retains it; leaving the route, signing out, or reauthentication discards it. The ticket's back link asks before discarding, and closing/reloading the tab uses a native unsaved-change warning. The global queue navigation does not block route changes. Persistent drafts across navigation are not implemented.

Controls have labels, visible focus styles, loading/empty/error messages, and status announcements. Text is rendered escaped and multiline. Responsive layouts stack the management panel above the conversation on narrower screens. Actual browser keyboard and visual acceptance remains outstanding.

## AI integration and fixtures

The live draft adapter uses the documented endpoints:

- GET `/tickets/:id/ai-drafts/latest` reads state without creating work.
- POST `/tickets/:id/ai-drafts` with `{ regenerate: false }` requests a draft only after an explicit Request AI draft action and only when state is NOT_REQUESTED.
- Pending QUEUED/RUNNING work polls through GET. Polling/remounts never POST. Available completed/failed work can be deliberately regenerated using `{ regenerate: true }`.

Draft lookup is cached by administrator, ticket, and ticket revision. Reopening checks latest state; ticket changes recheck it as well, so a reply or effective category change does not leave a supposedly current suggestion permanently cached. The future M06 server remains responsible for authoritative fingerprints, deduplication, and stale-result handling.

A ready suggestion is shown separately from the public editor. Use draft in reply editor is explicit; replacing existing text requires a second confirmation. Confirmation is disabled if the selected draft or ticket revision has since changed. Stale drafts cannot be copied. Regeneration alone never changes unsent reply text; only Send public reply transmits the reviewed editor content.

Missing draft routes (404/501) render an honest unavailable state and a Check availability action. Other failures render safe errors with retry/backoff. Manual replying remains usable. Request failures recheck GET state before another deliberate attempt; there is no automatic POST retry.

M05/M06 are not implemented, so live draft generation and worker progress cannot yet be verified. Current classification states/provenance come from the real ticket DTO; raw alternative category/priority suggestions and rationale are not exposed by that DTO and are not invented in this UI. Applied AI suggestions are identifiable by their AI source; independent manual overrides remain explicit.

`apps/web/src/features/admin-tickets/ai-fixtures.ts` supplies an explicitly injected test/development adapter for NOT_REQUESTED, QUEUED, RUNNING, SUCCEEDED, FAILED, and stale cases. It is used by tests only, never installed as a silent fallback for real tickets. Its sample draft is labeled fixture content. These are the only mocked integrations; no live AI quality or provider reliability is claimed.

## Actual verification

- Six focused admin web tests passed: queue validation/rendering, dirty editor/conflict/idempotency state, fixture cache/request behavior, AI state rendering, private/public separation, and HTTP adapter methods/payloads/errors.
- The complete M07/M08 web regression has 12 passing tests with no skips. These use reducer tests, static React rendering, controlled HTTP responses, and query observers; they are not interactive browser evidence.
- `scripts/test-admin-api.mjs` passed against a real temporary PostgreSQL schema and a real Fastify HTTP server. It calls the actual web adapters to test filtering, assignment/unassignment, manual overrides, status changes, private notes, revision conflicts, concurrent idempotent replies, author visibility, role/ownership rejection, and unavailable AI routes. Only Node's relative URL and cookie-jar facilities are supplied by the test harness. It cleans up its generated schema and server without altering application tickets.
- Workspace typechecking, lint, and formatting passed. A direct executable esbuild diagnostic bundle succeeds; it is not a Vite production-build pass.
- `npm run build -w @bookleaf/web` passes TypeScript but fails in Vite's esbuild subprocess with EPERM. Browser initialization also fails due to the environment metadata/tool restriction. The interactive admin workflow, dirty-editor behavior under actual browser polling, mobile layout, and keyboard journey remain **unverified in a browser**.

### Repeat checks locally

```powershell
npm run typecheck
npm run test -w @bookleaf/web
npm run build
# Set TEST_DATABASE_URL to a disposable local development PostgreSQL database.
npx tsx scripts/test-admin-api.mjs
```

Build contracts/API before the integration script; it imports compiled backend code and web TypeScript adapters. Keep connection credentials out of tracked files and output. Database tests require schema-creation rights. The agent ran compiled/bundled tests directly because its normal test-launcher subprocess is restricted.

For browser acceptance, use separate author and admin sessions. Create an author ticket, find it using filters, assign yourself, independently override category/priority, add a private note, send a public reply, and change status. Confirm the author sees only the reply/status. Start a second reply, change the same ticket from another admin session, wait for polling, and verify text survives while review is required. Simulate interrupted delivery and use Retry same send; confirm only one reply exists. Exercise AI state fixtures separately from live data until M06 provides the routes. Check keyboard focus, field labels, empty/error states, and a narrow viewport.

Next: **M05 Knowledge base and AI assistance**, then M06 execution/integration. M08 does not implement either module.
