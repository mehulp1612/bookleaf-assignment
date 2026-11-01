# BookLeaf implementation guide

Build the Author Support and Communication Portal in small, independently testable modules. This directory records the agreed scope, interfaces, and prompts for implementing each module. M01 foundations, M02 identity, M03 catalog, and M04 manual ticket API are implemented. PostgreSQL and live HTTP checks cover identity, catalog, and tickets. M01 web build/browser verification remains outstanding. AI provider calls, job execution, and frontend workflows are not implemented yet.

## Read in this order

1. [Architecture and scope](architecture.md): requirements, decisions, data ownership, and AI behavior.
2. [Shared contracts](contracts.md): API, security, data, and workflow agreements.
3. [Modules and implementation prompts](modules.md): module responsibilities, acceptance checks, and copyable prompts.
4. [Delivery checklist](delivery.md): integration checks and submission requirements.
5. [Local setup](../README.md) and [M01 verification](m01-verification.md): commands, evidence, and outstanding checks.
6. [Identity and access](identity.md): M02 security behavior, migration/seed instructions, and verification.
7. [Catalog](catalog.md): M03 import, ownership/context helpers, tests, and integration dependencies.
8. [Ticket management](tickets.md): M04 API, revision/idempotency behavior, job boundary, and verification.

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

M04 regression results: 42 tests passed (36 API including the M04 parent test and its 11 behavior groups, plus 6 contract tests), with no skips. Real PostgreSQL and HTTP integration tests passed for M02–M04. Workspace typechecking, contracts/API builds, Prisma validation/generation, lint, and formatting passed. Tests were compiled and executed directly because this environment blocks the standard launcher's subprocesses. The existing M01 Vite/browser limitation remains; M04 changes no web code.

M03 migration and demo seed completed successfully in the application database, as confirmed by the user. M04 adds a new migration; run `npm run db:deploy` locally because agent-side schema-engine execution is blocked by EPERM. No new seed is required. See [M04 verification](tickets.md) for database/HTTP coverage and the distinction between queued jobs and a running worker. Next in the agreed delivery sequence: M07 Author interface, then M08 Admin interface; M05/M06 remain separate backend work.

| Module                       | Status                                                                                     |
| ---------------------------- | ------------------------------------------------------------------------------------------ |
| M01 Foundation and contracts | Implemented; 12 tests pass; web/runtime acceptance checks remain (see verification report) |
| M02 Identity and access      | Complete; security, seed, PostgreSQL, and real HTTP integration checks pass                |
| M03 Author and book catalog  | Complete; DB/HTTP checks pass; user confirmed application migration and seed               |
| M04 Ticket management        | Implemented; DB/HTTP checks pass; application migration pending                            |
| M05 Knowledge base and AI    | Not started                                                                                |
| M06 Background execution     | Not started                                                                                |
| M07 Author interface         | Not started                                                                                |
| M08 Admin interface          | Not started                                                                                |
| M09 Integration and delivery | Not started                                                                                |

Update this table only after the module's acceptance checks have been completed. Record limitations honestly rather than treating mocked behavior as integrated functionality.
