# BookLeaf implementation guide

Build the Author Support and Communication Portal in small, independently testable modules. This directory records the agreed scope, interfaces, and prompts for implementing each module. M01–M08 are implemented, including M06 job execution and AI endpoints. PostgreSQL and live HTTP checks cover identity, catalog, tickets and orchestration. The user confirmed the manual author/admin browser workflow, including replies, private-note isolation and updates without refresh. Live provider quality and the browser AI flow remain unverified; application migration deployment is pending. M09 integration and delivery is next.

## Read in this order

1. [Architecture and scope](architecture.md): requirements, decisions, data ownership, and AI behavior.
2. [Shared contracts](contracts.md): API, security, data, and workflow agreements.
3. [Modules and implementation prompts](modules.md): module responsibilities, acceptance checks, and copyable prompts.
4. [Delivery checklist](delivery.md): integration checks and submission requirements.
5. [Local setup](../README.md) and [M01 verification](m01-verification.md): commands, evidence, and outstanding checks.
6. [Identity and access](identity.md): M02 security behavior, migration/seed instructions, and verification.
7. [Catalog](catalog.md): M03 import, ownership/context helpers, tests, and integration dependencies.
8. [Ticket management](tickets.md): M04 API, revision/idempotency behavior, job boundary, and verification.
9. [Author interface](author-interface.md): M07 screens, session/draft handling, polling, and exact verification limitations.
10. [Admin interface](admin-interface.md): M08 queue/workspace, dirty editors, safe retries, AI fixtures and integration gaps.

## Fastest implementation path

Use the prompts in `modules.md`, one at a time, in this order:

**M01 Foundation → M02 Identity → M03 Catalog → M04 Tickets → M07 Author UI → M08 Admin UI → M05 AI → M06 Jobs → M09 Delivery.**

This order produces a working manual support workflow before integrating external AI. M05 and M06 are separate development boundaries, but both must be integrated before automatic classification and draft generation are complete.

Modules can also be developed independently against the contracts and fixtures. Independence does not mean every module can ship without its dependencies. Each module prompt instructs the implementer to stop after completing that module.

## Sources and status

- Assignment: `../FULLSTACK-ASSIGNMENT1 (1).docx (1) (1).pdf`.
- Seed data: `../FULLSTACK-SAMPLEDATA (1) (1) (1).json`.
- User confirmed React, TypeScript, Node.js, and PostgreSQL.
- User has an OpenRouter key for a rate-limited free LLM and requires configurable, replaceable AI providers.
- User wants to finish as soon as possible. The assignment allows four days from receipt; the actual deadline is not yet specified.
- Framework and infrastructure choices below are implementation defaults, not additional assignment requirements.

## Progress

M09 preparation (2026-11-02): the full production build including Vite and PostgreSQL/static HTTP smoke now pass. The user confirmed local browser classification and drafting. Added [deployment instructions](deployment.md), [API examples](api-examples.md) and a [one-page approach](approach.md). Render Free + Neon Free is recommended with sleep/quota limitations documented. A credential was removed from `.env.example`; rotation is required before publishing. Hosted URL, dedicated public-demo credentials, clean-checkout verification and hosted acceptance remain pending. No deployment or push is claimed.

Live AI follow-up (2026-11-02): a configured OpenRouter key is now available. The `openai/gpt-4.1-nano:batch` classification request was rejected; a bounded diagnostic using `openai/gpt-4.1-nano` passed classification. Prompt v2 fixes confusing draft reference instructions and removes conflicting action-confirmation examples from runtime prompts while preserving the source KB. One synthetic royalty classification/draft pair passed live after the fix; 19 deterministic AI tests passed. No model/key setting was changed automatically. See [AI assistance](ai-assistance.md) for exact call counts and remaining quality limits. Earlier no-key notes below record the original module checks.

M06: PostgreSQL leasing/restart recovery, shared concurrency/request budgets, bounded retries/Retry-After, provider pause/recovery, draft cache/regeneration, and protected AI endpoints are implemented. All 70 API tests (including 15 M06 tests), 12 web tests and 6 contract tests pass with zero skips. Workspace typechecking, contracts/API builds, Prisma validation/generation and lint pass. See [Background execution](background-jobs.md) for configuration, exact verification and remaining integration work. No live key is configured. Apply pending migrations using `npm run db:deploy` in a normal terminal; this environment blocks the Prisma migration-engine subprocess. No automatic sending or paid fallback was added.

M05: versioned assignment KB and seven sample examples, topic selection, provider-independent classification/drafting, OpenRouter and compatible adapters, structured validation, safe run persistence and migration, deterministic failure/quality fixtures, and a bounded evaluation command are implemented. All 55 API tests pass with zero skips (19 new M05 tests including real PostgreSQL persistence); workspace typechecking, contracts/API builds, Prisma validation/generation, lint and formatting pass. See [AI assistance](ai-assistance.md) for exact configuration, checks and limits. No key was present; live AI remains unverified. Application migration deployment needs `npm run db:deploy` from a normal terminal. M06 is next; existing queued jobs and draft endpoints remain unconnected.

Manual workflow browser acceptance: the user confirmed both logins, author books, ticket creation, admin handling, public replies, hidden private notes, and automatic updates after the development launcher fix. This is user-reported acceptance, distinct from the agent's automated checks.

M08: all 12 author/admin web tests passed, plus a real PostgreSQL/HTTP integration check using the admin web adapters. Workspace typechecking, lint, and formatting passed. Standard Vite build and interactive browser acceptance remain blocked by environment restrictions. Live AI endpoints remain unavailable; draft states are tested with explicit fixtures, never silently substituted for live results. Next: M05 Knowledge base and AI assistance, then M06 execution.

M07: six original web tests and workspace typechecking passed; the author application uses real endpoints with no mocked integrations. Standard Vite build and interactive browser acceptance are blocked by environment process/access restrictions; see the author-interface verification report. The three application database migrations are confirmed applied.

M04 regression results: 42 tests passed (36 API including the M04 parent test and its 11 behavior groups, plus 6 contract tests), with no skips. Real PostgreSQL and HTTP integration tests passed for M02–M04. Workspace typechecking, contracts/API builds, Prisma validation/generation, lint, and formatting passed. Tests were compiled and executed directly because this environment blocks the standard launcher's subprocesses. The existing M01 Vite/browser limitation remains; M04 changes no web code.

M03 migration and demo seed completed successfully in the application database, as confirmed by the user. M04 migration was also verified applied during M07. See [M04 verification](tickets.md) for database/HTTP coverage and the distinction between queued jobs and a running worker. M05/M06 remain separate backend work.

| Module                       | Status                                                                                               |
| ---------------------------- | ---------------------------------------------------------------------------------------------------- |
| M01 Foundation and contracts | Implemented; 12 tests pass; web/runtime acceptance checks remain (see verification report)           |
| M02 Identity and access      | Complete; security, seed, PostgreSQL, and real HTTP integration checks pass                          |
| M03 Author and book catalog  | Complete; DB/HTTP checks pass; user confirmed application migration and seed                         |
| M04 Ticket management        | Complete; DB/HTTP checks pass; application migration verified applied                                |
| M05 Knowledge base and AI    | Implemented; see AI verification report; live provider evaluation and application migration pending  |
| M06 Background execution     | Implemented; real DB/HTTP tests pass; application migration and live provider/browser checks pending |
| M07 Author interface         | Implemented; six web tests pass; Vite/browser acceptance blocked                                     |
| M08 Admin interface          | Implemented; web/real API checks pass; browser acceptance and live AI remain outstanding             |
| M09 Integration and delivery | In progress; production build/smoke and handoff docs ready; hosted acceptance pending                |

Update this table only after the module's acceptance checks have been completed. Record limitations honestly rather than treating mocked behavior as integrated functionality.
