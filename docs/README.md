# BookLeaf implementation guide

Build the Author Support and Communication Portal in small, independently testable modules. This directory records the agreed scope, interfaces, and prompts for implementing each module. M01 foundations and M02 backend identity are implemented. M02 live PostgreSQL and HTTP integration checks pass; M01 web build/browser verification remains outstanding. Catalog, tickets, and AI workflows are not implemented yet.

## Read in this order

1. [Architecture and scope](architecture.md): requirements, decisions, data ownership, and AI behavior.
2. [Shared contracts](contracts.md): API, security, data, and workflow agreements.
3. [Modules and implementation prompts](modules.md): module responsibilities, acceptance checks, and copyable prompts.
4. [Delivery checklist](delivery.md): integration checks and submission requirements.
5. [Local setup](../README.md) and [M01 verification](m01-verification.md): commands, evidence, and outstanding checks.
6. [Identity and access](identity.md): M02 security behavior, migration/seed instructions, and verification.

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

| Module                       | Status                                                                                     |
| ---------------------------- | ------------------------------------------------------------------------------------------ |
| M01 Foundation and contracts | Implemented; 12 tests pass; web/runtime acceptance checks remain (see verification report) |
| M02 Identity and access      | Complete; security, seed, PostgreSQL, and real HTTP integration checks pass                |
| M03 Author and book catalog  | Not started                                                                                |
| M04 Ticket management        | Not started                                                                                |
| M05 Knowledge base and AI    | Not started                                                                                |
| M06 Background execution     | Not started                                                                                |
| M07 Author interface         | Not started                                                                                |
| M08 Admin interface          | Not started                                                                                |
| M09 Integration and delivery | Not started                                                                                |

Update this table only after the module's acceptance checks have been completed. Record limitations honestly rather than treating mocked behavior as integrated functionality.
