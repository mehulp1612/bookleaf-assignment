# M01 implementation and verification

## Database follow-up

Docker PostgreSQL is now configured, and the user applied the identity migration. The database connection and real HTTP readiness endpoint pass. M02's isolated PostgreSQL/HTTP integration test also passes. This resolves the database-availability blocker in the historical record below; M01 web build/browser acceptance and a clean npm ci checkpoint remain outstanding.

## Current verification on 2026-10-31

The user completed installation. `npm ls --depth=0` succeeds and `package-lock.json` exists. The initial installation blocker is resolved.

| Check                                          | Actual result                                                                                           |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Full workspace typecheck                       | Passed, including tests and configuration                                                               |
| Prisma schema validation and client generation | Passed with Prisma 7.10.1                                                                               |
| Contracts and API compilation                  | Passed                                                                                                  |
| Full web build                                 | Blocked: Vite/esbuild subprocess fails with spawn EPERM in this execution environment                   |
| Normal npm test launcher                       | Blocked by spawn EPERM when launching test-file subprocesses                                            |
| Direct compiled test execution                 | All 12 passed: 6 contracts, 4 API, 2 configuration                                                      |
| ESLint and Prettier                            | Passed                                                                                                  |
| Real HTTP smoke                                | Passed: liveness 200, unavailable database 503 in approximately 317 ms, unknown API 404; clean shutdown |
| Successful live database connection            | Deferred by user; no .env exists and local PostgreSQL service is stopped                                |
| SPA routing                                    | Passed against temporary test HTML/assets, not the actual Vite bundle                                   |
| Browser verification                           | Blocked: browser tool initialization reports missing sandboxPolicy metadata                             |
| Clean npm ci                                   | Not repeated; installed dependency tree and lockfile inspected                                          |

The real HTTP smoke used the actual Prisma adapter with an intentionally unavailable local endpoint. It verifies safe failure behavior, not successful database access. API tests inject database-health behavior.

One bug was found and fixed: URL refinements could call `new URL()` after format validation failed, bypassing safe configuration diagnostics. DATABASE_URL and APP_ORIGIN now guard parsing with `URL.canParse`; regression checks cover malformed values without exposing them.

Tests were compiled and run directly using installed dependencies, without modifying the standard scripts:

```powershell
node node_modules/typescript/bin/tsc -p apps/api/tsconfig.check.json --noEmit false --outDir .tmp/m01-api-check
node .tmp/m01-api-check/test/app.test.js
node .tmp/m01-api-check/test/config.test.js
node node_modules/typescript/bin/tsc -p packages/contracts/tsconfig.check.json --noEmit false --outDir .tmp/m01-contract-check
node .tmp/m01-contract-check/test/contracts.test.js
```

The remaining acceptance checks are a normal `npm run build` and `npm test` in an unrestricted local terminal, browser/development proxy verification, successful database readiness via `npm run smoke` once configured, and a clean `npm ci` checkpoint. M01 is not marked fully complete; no later module was implemented.

## Implemented

- npm workspace manifests for contracts, API, and web.
- Strict TypeScript, ESLint, React hooks rules, and Prettier configuration.
- Shared Zod enums, labels, resource/request/error schemas, pagination/filters, endpoint metadata, and inferred types.
- Distinct author/admin projections and fixtures for published/production books, tickets, and queued/failed AI.
- Fastify application factory with injectable database health, safe error responses, generated request IDs, liveness/readiness, and production static/SPA routing.
- Environment validation with safe diagnostics, ignored local configuration, and a credential-free example file.
- Prisma 7 schema/generation configuration and PostgreSQL driver adapter with bounded connection/query timeouts and graceful close.
- React shell with router and query providers, responsive styling, and an explicit coming-soon state. No fake sign-in or support actions.
- Same-origin Vite proxy and a real HTTP/PostgreSQL smoke command for use after installation/build.
- Local setup and production serving instructions in the repository README.

## Historical checks on 2026-10-30

The following records the original attempt; the current status above supersedes these blockers.

| Check                                                | Actual result                                                                                                               |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Repository instructions and existing code inspection | No AGENTS.md or prior application/package files found in the repository or checked parent directories                       |
| Node/npm discovery                                   | Node 22.16.0 and npm 10.9.2 available                                                                                       |
| npm registry access                                  | Blocked; normal access uses offline cache mode, and network attempt returned ECONNREFUSED from the configured network proxy |
| Offline workspace install                            | Failed with ENOTCACHED; required dependencies including Fastify and Prisma are absent from the local cache                  |
| Contracts strict typecheck                           | Passed with isolated cached TypeScript 5.9.3, Zod 4.6.7, and Node declarations                                              |
| Contracts behavior tests                             | 6 passed, 0 failed using transpiled source and the actual cached Zod package                                                |
| Standard workspace typecheck/build/test/lint         | Attempted; blocked by missing installed dependencies/tool executables                                                       |
| Production start                                     | Attempted; blocked because the API build output could not be produced                                                       |
| Formatting                                           | Source/configuration/documentation formatted and checked with cached Prettier                                               |
| API tests                                            | Written but not executed: Fastify is unavailable                                                                            |
| Prisma generation and real PostgreSQL readiness      | Unverified: Prisma dependencies cannot be installed                                                                         |
| Browser rendering and development proxy              | Unverified: the web dependencies/build are unavailable                                                                      |
| Dependency lockfile and clean npm ci                 | Outstanding; no lockfile fabricated without successful dependency resolution                                                |

The isolated verification packages and transpiled files are ignored under `.tmp/verification`; they are not a workspace install, application build, or production dependency artifact. The normal reproducible test entry point after installation is `npm test`.

The six passing contract cases cover: private-field stripping; sample book values/nulls/paise; rejection of impersonation fields and invalid text; pagination/date/role-filter validation; invalid AI output states/categories; email normalization without password modification.

## Original acceptance checklist from 2026-10-30

In an environment with npm access:

1. Run `npm install`; review and retain `package-lock.json`.
2. Configure the ignored root `.env` with a reachable PostgreSQL database.
3. Run `npm run db:validate`, `npm run typecheck`, `npm run build`, `npm test`, `npm run lint`, and `npm run format:check`.
4. Run `npm run smoke` to verify real HTTP startup, real PostgreSQL readiness, production HTML serving, and JSON API 404 behavior.
5. Run `npm run dev`; verify the rendered page and proxy behavior in a browser.
6. Check readiness with PostgreSQL unavailable: `/health/live` should remain 200 and `/health/ready` should return a safe 503 promptly.
7. Verify a clean `npm ci` and rebuild from the resolved lockfile.

Resolve any dependency/type/runtime problems discovered by these checks before marking M01 complete. No later module was implemented. M02 Identity and access is next after foundation acceptance.
