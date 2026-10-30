# BookLeaf Author Support

React and TypeScript web application, Fastify REST API, PostgreSQL and Prisma, and a shared Zod contracts package. This checkpoint implements M01 foundations only. Authentication, catalog import, ticket workflows, and AI calls are not implemented or simulated as working features.

## Current verification status

Dependencies are installed and `package-lock.json` records their resolution. Full typechecking, Prisma validation/generation, API compilation, lint, formatting, and all 12 foundation tests pass. Tests were compiled and executed directly because this environment blocks the standard test launcher's child processes. A real HTTP smoke check verified liveness, safe database-unavailable handling, and JSON API 404s. The Vite build is blocked by the same process restriction; browser verification and a successful live database connection remain outstanding. See [M01 verification](docs/m01-verification.md).

Run the remaining checks below in a normal local terminal before marking M01 complete. Do not interpret the scaffold as a deployed or functional support portal.

## Prerequisites

- Node.js 22.12 or newer in the 22.x line, or a supported 24+ release; npm 10+.
- A PostgreSQL database you can access. M01 creates no application tables.
- npm registry access for the initial install.

The lockfile resolves Fastify 5.12.7, Prisma 7.10.1, Vite 7.3.7, React 19.3.1, and Zod 4.6.7. Use `npm ci` for clean reproducible installs and retain `package-lock.json` with the source.

## Local setup

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

The Prisma schema deliberately has no business models. Its generated client is used for a read-only `SELECT 1` readiness probe. Models and migrations begin in M02; sample-data import follows in M03. Do not add a placeholder application table just to initialize Prisma.

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

Pass Prisma arguments directly to its workspace script: `npm run db:migrate -w @bookleaf/api -- --name identity`. No migration or seed command needs to run for M01.

## Implemented HTTP endpoints

| Endpoint            | Success                               | Failure                                                |
| ------------------- | ------------------------------------- | ------------------------------------------------------ |
| `GET /health/live`  | 200, `{ "data": { "status": "ok" } }` | Process must be available                              |
| `GET /health/ready` | 200 after database `SELECT 1`         | 503 with `DATABASE_UNAVAILABLE`, no connection details |

Unknown API paths return a JSON 404. Error envelopes contain `code`, a safe `message`, optional validation `fieldErrors`, and a generated `requestId`; `x-request-id` is returned as a response header. Readiness does not cache results. Database connection/query timeouts are bounded.

All other documented endpoints exist only as shared schemas and route metadata in `packages/contracts`; they do not have handlers yet. Health endpoints are intentionally public. Role and ownership checks begin in M02/M03.

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

See the [implementation guide](docs/README.md) for module prompts and the next step, **M02 Identity and access**.

## Framework references

The foundation follows [Vite's Node requirements](https://vite.dev/guide/) and [Prisma 7's explicit generation and driver-adapter setup](https://www.prisma.io/changelog/2025-11-19).
