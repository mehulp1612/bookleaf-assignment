# BookLeaf Author Support

React and TypeScript web application, Fastify REST API, PostgreSQL and Prisma, and a shared Zod contracts package. M01–M08 are implemented, including M06 background execution and AI endpoints. M09 integration and delivery remain outstanding.

## Current verification status

M09 delivery preparation: the user confirmed successful live draft generation and automatic classification in the local browser. The full production build (including Vite) and PostgreSQL/static-serving HTTP smoke now pass. See [Render + Neon deployment](docs/deployment.md), [API examples](docs/api-examples.md), and the [one-page approach](docs/approach.md). No hosted deployment has been created or verified; public-demo URL/credentials remain pending. A key found in `.env.example` was removed and must be rotated before publication. Earlier module-specific limitations below are historical.

M06 runs a leased PostgreSQL worker alongside the API, with durable budgets, bounded retries, provider pauses, cached/on-demand drafts, and admin AI endpoints. All 88 API/web/contract tests pass, including real PostgreSQL/HTTP orchestration with deterministic providers. See [Background execution](docs/background-jobs.md). Run `npm run db:deploy` in your normal terminal before restarting with `npm run dev`; migration deployment is blocked inside this agent environment. Keep AI disabled until you configure an explicit provider/key/model. No key is currently configured, so live AI remains unverified. Drafts always require deliberate review and sending. Earlier per-module status paragraphs below record their original verification boundaries.

M05 adds configurable OpenRouter/compatible AI services, the faithful versioned assignment knowledge base, output validation and safe AI-run persistence. No key was configured, so live AI quality remains unverified. Configure only the ignored `.env`; see [AI assistance](docs/ai-assistance.md). Run `npm run db:deploy` locally for the new AI-run migration, then `npm run ai:evaluate` when an explicit provider/key/model is configured. The evaluation makes at most two calls. Existing ticket creation and draft endpoints do not call these services until M06.

The user has confirmed both login roles and the manual author/admin browser workflow, including ticket submission, public replies, private-note isolation and automatic updates. Earlier agent-only browser restrictions below remain recorded as historical verification limits.

M08 adds the admin queue and ticket workspace, manual controls, separate public/private editors, safe reply retries, and a draft panel ready for M06's endpoints. All 12 web tests and a real PostgreSQL/HTTP check of the admin adapters pass. Typechecking, lint, and formatting pass. Vite build/browser acceptance remain blocked by environment restrictions; AI states are fixture-tested and the live app reports unavailable draft endpoints honestly. See [Admin interface](docs/admin-interface.md). Sign in with DEMO_ADMIN_EMAIL/DEMO_ADMIN_PASSWORD to open `/admin`; no migration or reseed is needed.

M07 adds login/logout, owned books, question submission, ticket lists/details, and visible-tab polling against the real API. Six web tests and workspace typechecking pass. The Vite build and interactive browser journey remain blocked by this environment's process restrictions; see [Author interface](docs/author-interface.md) for exact results and a repeatable browser test script. Run `npm run dev` locally, open `http://localhost:5173`, and sign in with a seeded author email and DEMO_AUTHOR_PASSWORD. All three existing database migrations are confirmed applied; M07 needs no migration or reseed.

M04 adds protected ticket creation/list/detail, admin updates, replies, private notes, change events, revision conflicts, persisted reply idempotency, and atomic classification enqueue. PostgreSQL and live HTTP tests pass, and its migration is applied in this workspace. Fresh installations should run `npm run db:deploy`. Jobs remain queued until M06. See [Ticket management](docs/tickets.md) for API usage and integration details.

M02 adds login/logout/current-user routes, hashed opaque sessions, backend guards, CSRF protection, durable throttling, and demo identity seeding. Its security/seed-validation tests and live PostgreSQL integration test pass, including real HTTP authentication, repeatable seeding, concurrent throttling, and session revocation. See [Identity and access](docs/identity.md) for setup and test details.

Dependencies are installed and `package-lock.json` records their resolution. Full typechecking, Prisma validation/generation, API compilation, lint, formatting, and all 12 foundation tests pass. Tests were compiled and executed directly because this environment blocks the standard test launcher's child processes. Real HTTP checks verified successful PostgreSQL readiness, safe database-unavailable handling, and JSON API 404s. The Vite build is blocked by the same process restriction; web build/browser verification remains outstanding. See [M01 verification](docs/m01-verification.md).

Run the remaining checks below in a normal local terminal before marking M01 complete. Do not interpret the scaffold as a deployed or functional support portal.

## Prerequisites

- Node.js 22.12 or newer in the 22.x line, or a supported 24+ release; npm 10+.
- A PostgreSQL database you can access; apply all committed migrations before using the API.
- npm registry access for the initial install.

The lockfile resolves Fastify 5.12.7, Prisma 7.10.1, Vite 7.3.7, React 19.3.1, and Zod 4.6.7. Use `npm ci` for clean reproducible installs and retain `package-lock.json` with the source.

## Local setup

### Local PostgreSQL with Docker

`compose.yaml` runs PostgreSQL 17 with a persistent named volume and a health check. The database is exposed only on `127.0.0.1:5433`, avoiding the usual local PostgreSQL port. Start Docker Desktop, then run:

```powershell
docker compose up -d --wait
npm run db:deploy
```

The ignored root `.env` holds `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_PORT`, and the matching `DATABASE_URL`. This workspace has been configured with a generated local password; it is not stored in tracked files. The URL has the form `postgresql://bookleaf:<password>@127.0.0.1:5433/bookleaf`. Application commands load it automatically. If you run the API in a container later, its database hostname must be the Compose service name `postgres`, with port 5432.

Docker setup verification: the container reached healthy status, and both the PostgreSQL driver and the application's Prisma connection succeeded using DATABASE_URL. The user applied the identity migration, and its completed database record was verified. Future migrations should still be applied from your normal terminal because this agent environment blocks Prisma's schema-engine subprocess.

Use `docker compose ps` to check health and `docker compose stop` to stop the database. `docker compose down` retains the data volume; adding `--volumes` deletes its data. PostgreSQL initialization credentials apply when the volume is first created; editing the environment password later does not change an existing database role's password.

### Application setup

From the repository root:

```powershell
npm ci
Copy-Item .env.example .env
```

Edit the ignored `.env` and set `DATABASE_URL` to your own PostgreSQL connection URL. Its shape is `postgresql://<user>:<password>@<host>:<port>/<database>`; percent-encode reserved characters in credentials. `.env.example` intentionally contains no working credentials. Do not use an LLM key yet; M01 does not call any provider.

```powershell
npm run db:validate
npm run db:generate
npm run dev
```

Open `http://localhost:5173`. Vite serves the web application; Fastify listens on port 3000. Browser requests to `/api/*` and `/health/*` are proxied to Fastify, preserving a same-origin browser interface. There is no permissive CORS configuration and no browser token storage.

Root `npm run dev` builds and watches contracts, generates Prisma, and runs the API and web watchers together. Stop with Ctrl+C. Update `PORT`, `WEB_PORT`, and `APP_ORIGIN` consistently if you use different ports. Environment values already supplied by the operating system take precedence over `.env`.

The contracts build and watcher share an incremental cache to avoid rewriting compiled files and restarting the API immediately on startup. The API closes its resources and exits explicitly on shutdown so its watcher can restart it cleanly.

API development compiles TypeScript before starting `node --watch dist/index.js`, with a separate TypeScript build watcher for edits. This replaces the silent `tsx watch` launch observed on Windows. Compiler errors appear under `[compiler]`; successful emitted changes restart `[server]`. Fix type errors before expecting new code to run; failed compilations do not emit JavaScript. The first API build can take a few seconds before the server reports `Server listening`.

To isolate a watcher problem, stop the root development command, then run `npm run build -w @bookleaf/contracts`, `npm run build -w @bookleaf/api`, and `npm run start -w @bookleaf/api`. In another terminal run `npm run dev -w @bookleaf/web`. This runs the same API without automatic reload; restart it after rebuilding API changes.

If Vite reports `ECONNREFUSED 127.0.0.1:3000`, the API is not listening; check the `[api]` startup output and restart `npm run dev` after stopping the old command with Ctrl+C. `http://127.0.0.1:3000/health/live` should return HTTP 200, and `/health/ready` also checks PostgreSQL. A signed-out `/api/v1/auth/me` returning HTTP 401 is expected. Open the web app using the exact `APP_ORIGIN` configured in `.env` (by default `http://localhost:5173`), even if Vite prints a `127.0.0.1` URL; mutation origin checks require that match.

The schema includes identity/session/throttle tables, author profiles, books, tickets, replies, notes, events, and queued classification jobs. For a fresh installation, configure the dedicated demo password variables from `.env.example`, then run `npm run db:deploy` and `npm run db:seed`. See [demo seed instructions](docs/identity.md). The combined seed imports 10 authors and 18 books and links demo accounts while preserving support data. Use `npm run db:import` for catalog-only import without changing login accounts. All committed migrations are applied in this workspace's application database.

## Commands

| Command                | Purpose                                                                                        |
| ---------------------- | ---------------------------------------------------------------------------------------------- |
| `npm run dev`          | Contracts watcher, API watcher, and Vite                                                       |
| `npm run build`        | Contracts, Prisma client, API JavaScript, web assets                                           |
| `npm run typecheck`    | Strict checking across source, tests, and configuration                                        |
| `npm test`             | Contract and API foundation tests; DB health is injected in API tests                          |
| `npm run lint`         | ESLint and React hooks rules                                                                   |
| `npm run format:check` | Prettier verification                                                                          |
| `npm run format`       | Format source and documentation                                                                |
| `npm run db:validate`  | Validate Prisma schema/configuration                                                           |
| `npm run db:generate`  | Generate ignored Prisma client source                                                          |
| `npm run db:migrate`   | Create/apply development migrations when later modules add models                              |
| `npm run db:deploy`    | Apply committed migrations when later modules introduce them                                   |
| `npm run start`        | Start built API; serves web assets when NODE_ENV=production                                    |
| `npm run smoke`        | Start a temporary real HTTP server and check PostgreSQL readiness, built web HTML, and API 404 |

`npm run db:deploy` applies committed migrations; `npm run db:seed` builds the API and seeds demo identities and catalog data. `npm run db:import` imports catalog data without requiring demo passwords. For future schema changes, pass arguments directly to Prisma's workspace script: `npm run db:migrate -w @bookleaf/api -- --name catalog`.

## Implemented HTTP endpoints

| Endpoint            | Success                               | Failure                                                |
| ------------------- | ------------------------------------- | ------------------------------------------------------ |
| `GET /health/live`  | 200, `{ "data": { "status": "ok" } }` | Process must be available                              |
| `GET /health/ready` | 200 after database `SELECT 1`         | 503 with `DATABASE_UNAVAILABLE`, no connection details |

Unknown API paths return a JSON 404. Error envelopes contain `code`, a safe `message`, optional validation `fieldErrors`, and a generated `requestId`; `x-request-id` is returned as a response header. Readiness does not cache results. Database connection/query timeouts are bounded.

The three identity endpoints are implemented: `POST /api/v1/auth/login`, `POST /api/v1/auth/logout`, and `GET /api/v1/auth/me`. Mutations require an exact matching Origin and `X-BookLeaf-Request: 1`; details are in [Identity and access](docs/identity.md). M03 implements protected `GET /api/v1/books` and `GET /api/v1/books/:id`. M04 implements the six manual ticket routes documented in [Ticket management](docs/tickets.md). M06 implements draft POST/GET and classification retry endpoints; see docs/api-examples.md for request examples. Health endpoints remain public; registered API routes are authenticated by default. Book and ticket queries enforce server-side ownership.

## Production serving

Build with development dependencies present:

```powershell
npm run build
$env:NODE_ENV='production'
$env:HOST='0.0.0.0'
$env:APP_ORIGIN='https://your-actual-host.example'
npm run start
```

Set `DATABASE_URL` through the hosting platform's secret settings. Provide HTTPS at the deployment edge. The production server validates the HTTPS application origin and requires `apps/web/dist/index.html` to exist. Keep `apps/api/dist`, `apps/web/dist`, `packages/contracts/dist`, workspace manifests, and production dependencies in the deployment artifact. Prisma 7 uses the PostgreSQL JavaScript driver adapter; the generated client is compiled into API output.

Fastify serves hashed Vite assets with long-lived caching and the HTML document without persistent caching. Browser navigation to client routes receives the SPA document. Missing `/api/*`, `/health/*`, and asset paths remain JSON 404s rather than falling back to HTML. The smoke command tests HTTP serving, not browser rendering.

## Contracts and fixtures

- `packages/contracts/src/index.ts`: enums, labels, request/response schemas, filters, validation, role-specific DTOs, endpoint metadata, and inferred types.
- `packages/contracts/src/fixtures.ts`: published/production books from the supplied dataset; synthetic users/tickets; queued/failed AI examples. These are fixture exports, not database seeds or live AI results.
- Incoming request objects reject unknown fields. Author output schemas strip admin-only fields when parsed; later endpoint implementations must actually use these projections.
- Money uses integer paise. Calendar dates retain YYYY-MM-DD. Production nulls are distinct from zero.
- AI draft output is a discriminated union: NOT_REQUESTED has only state; QUEUED/RUNNING have metadata; SUCCEEDED adds text; FAILED adds a safe reason.

See the [implementation guide](docs/README.md) for module prompts and progress. M01–M08 are implemented; M09 integration and hosted delivery is in progress.

## Framework references

The foundation follows [Vite's Node requirements](https://vite.dev/guide/) and [Prisma 7's explicit generation and driver-adapter setup](https://www.prisma.io/changelog/2025-11-19).
