# Identity and access

M02 implements backend authentication and security boundaries. It adds no login screens, book APIs, ticket workflows, registration, or password recovery.

## Implemented endpoints

All paths use `/api/v1`. JSON errors use the shared error envelope and request ID.

| Endpoint          | Behavior                                                                                                                                                      |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST /auth/login  | Accepts email/password; returns `{ data: CurrentUser }` and a session cookie; 401 for wrong or unknown credentials, 400 for invalid input, 429 when throttled |
| GET /auth/me      | Returns the current persisted user projection; 401 for missing, invalid, revoked, or expired sessions                                                         |
| POST /auth/logout | Deletes the session and expires its cookie; 204 on success; an already expired/revoked session returns 401 and clears the cookie                              |

Email is trimmed and lowercased; password bytes are preserved. Author users include their original sample authorId. Admin users have authorId null. No password hashes or bearer tokens appear in JSON. All registered business API responses have `Cache-Control: no-store`, including failures.

## Browser and CSRF contract

Every API mutation, including login and logout, requires:

- An `Origin` exactly equal to configured `APP_ORIGIN`.
- `X-BookLeaf-Request: 1`.
- No `Sec-Fetch-Site: cross-site` indicator.

Missing, null, and mismatched origins are rejected. CORS is not enabled. This uses strict origin checking plus a non-simple custom request header; SameSite cookies add protection. The web shared API client adds the custom header to mutations automatically. The browser supplies Origin; JavaScript must not try to set it. JSON callers must set `Content-Type: application/json` and send the shared request shape. CLI/API clients must supply the Origin and custom header explicitly.

No separate CSRF token endpoint is needed for this pattern. Adding cross-origin frontend hosting later requires revisiting this design rather than enabling permissive CORS. The approach follows [OWASP CSRF guidance](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html).

## Passwords and sessions

Passwords use Node's asynchronous scrypt with a random 16-byte salt, a 64-byte derived key, and N=32768/r=8/p=3. This is one of [OWASP's recommended scrypt profiles](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html). Verification uses a constant-time comparison. Unknown accounts still run an expensive dummy-hash verification. Malformed or unsupported stored hash formats fail authentication.

Sessions use 32 random bytes, encoded as 64 hexadecimal characters. Only their SHA-256 digest is stored in PostgreSQL. Raw session tokens travel in the cookie and never in response JSON or logs. Every protected request reads the session and current user from storage, so role changes take effect without waiting for a token to expire.

Sessions have an absolute lifetime, default eight hours. `SESSION_TTL_SECONDS` accepts 60 through 604800 seconds. Reading a session does not extend it. Login issues a fresh token and transactionally removes any session supplied in that request. Logout deletes the session server-side. Expired sessions are rejected at the exact expiry boundary and removed; successful login also cleans expired sessions.

| Environment | Cookie                                                                           |
| ----------- | -------------------------------------------------------------------------------- |
| Development | `bookleaf_session`; Path=/; HttpOnly; SameSite=Lax; explicit Max-Age and Expires |
| Production  | `__Host-bookleaf_session`; same settings plus Secure; no Domain attribute        |

Production requires an HTTPS APP_ORIGIN. Cookie deletion uses the matching name/path/security attributes. Duplicate or malformed session cookies are rejected rather than choosing an ambiguous value. Login may be performed from multiple devices; logging out revokes the presented session, not all devices.

## Authorization for later modules

`src/index.ts` wires the Prisma auth store into `buildApp`. Registered `/api/v1/` routes require authentication by default, with only the login POST exempt. Health endpoints stay public; unknown routes retain JSON 404 behavior. A business route registered on an app without auth wiring returns 503 instead of silently becoming public.

Authenticated handlers receive `request.user`, containing the shared CurrentUser projection. Use `request.user.id` as the user ID and `request.user.authorId` for author ownership queries. Admin-only routes must use `preHandler: requireRole('ADMIN')` from `modules/auth/http.ts`. This checks the backend principal, not browser state. M03/M04 must still scope queries by authorId and verify ownership; a role guard alone does not provide record-level isolation.

## Login throttling

PostgreSQL stores atomic fixed-window counters for the connecting IP and normalized email, using hashed bucket keys rather than plaintext emails or IP addresses. Limits are 30 requests per IP and 10 per email per 15 minutes. Attempts count whether successful or failed; missing accounts use the same limits. IP counting occurs before login body parsing so invalid bodies also consume the IP budget. Rejections return 429 and Retry-After in seconds without checking the password.

Counters survive process restarts and work across instances sharing PostgreSQL. Old throttle records are cleaned during login attempts. The server does not trust arbitrary X-Forwarded-For headers. Behind a reverse proxy, callers can therefore share the proxy's IP budget; production deployment should configure explicitly trusted proxy addresses or edge rate limits before broader use. Do not enable unconditional proxy trust.

## Migration and demo seed

The migration creates User, Session, LoginThrottle, Role, and a minimal Author table containing only the original author ID. It enforces unique normalized emails, unique author links, foreign keys, and the role/author-link invariant. Author deletion is restricted while linked to a user; deleting a user removes their sessions.

This identity anchor is intentional coordination with M03. M03 extends the existing Author table and imports its profiles. Profile columns remain nullable to preserve identity-only anchors; catalog import requires complete profiles. It must not recreate authors or replace their IDs. No books or catalog profiles are imported by M02.

Set these in the ignored root `.env` or deployment secret settings:

| Variable             | Meaning                                                                                 |
| -------------------- | --------------------------------------------------------------------------------------- |
| DATABASE_URL         | PostgreSQL connection for the application                                               |
| DEMO_ADMIN_EMAIL     | Dedicated demo administrator email; example in .env.example                             |
| DEMO_ADMIN_PASSWORD  | Explicit demo-only password, 16–128 characters                                          |
| DEMO_AUTHOR_PASSWORD | Different demo-only password, 16–128 characters, shared by the ten sample author logins |
| DEMO_RESET_PASSWORDS | Defaults false; true explicitly rotates demo hashes and revokes their sessions          |

No usable password is hardcoded. Use dedicated demo credentials, not personal credentials. Seed passwords are not required to run the API after seeding.

```powershell
npm run db:deploy
npm run db:seed
```

The seed reads the supplied sample JSON, creates ten author ID anchors and their user accounts, and creates one admin. Author emails match the dataset. Stable demo user IDs make reruns repeatable. Existing password hashes and sessions are preserved by default; changing environment passwords alone does not reset existing users. With explicit reset enabled, updated hashes and session revocation commit together. Other support data is untouched. Conflicting identities or emails cause rollback rather than account takeover. CLI success output includes counts only.

## Verification and remaining dependencies

PostgreSQL runs from `compose.yaml` on localhost port 5433. The user applied the migration; its completed record was verified in `_prisma_migrations`. Driver/Prisma connection checks and the live database integration test passed.

On 2026-11-01, 11 identity tests and 2 seed-validation tests passed using real scrypt and Fastify with an in-memory AuthStore. Existing M01 API/configuration tests also passed. Strict typechecking, Prisma generation/schema validation, API compilation, lint, and formatting were checked. See `test/auth.test.ts`, `test/seed.test.ts`, and `test/identity-db.test.ts`.

Final combined run: 26 tests passed, 0 failed, 0 skipped, including the live PostgreSQL/HTTP test. The applied migration checksum matches the repository SQL, and no temporary test schemas remain. The application schema currently has zero users: tests seeded only isolated schemas. Configure the dedicated demo passwords and run `npm run db:seed` when you want persistent demo logins.

The opt-in PostgreSQL test now passes against the Docker database. It creates a random isolated schema, applies the SQL migration, seeds twice, verifies password-reset revocation and cross-client session persistence, checks the database role constraint, and issues concurrent throttle updates. It also starts a real HTTP server and verifies readiness, login/me, author/admin access, cross-origin logout rejection, logout/replay rejection, and expiry using persisted sessions. It drops only that generated schema afterward. Use a dedicated test database account allowed to create schemas; the test never truncates existing application tables.

Set TEST_DATABASE_URL in your local process environment, then run `npm test`. It is deliberately not inferred from DATABASE_URL or automatically loaded from `.env`. For this verification, the runner explicitly loaded `.env` and assigned its DATABASE_URL to TEST_DATABASE_URL without printing credentials. Seed repeatability and session persistence across independent database clients are verified; process-kill recovery was not separately tested. The normal Prisma migration CLI remains environment-restricted, so the user applied the application migration from their terminal.

The normal test launcher remains subject to this environment's subprocess restriction. Direct execution used:

```powershell
node node_modules/typescript/bin/tsc -p apps/api/tsconfig.check.json --noEmit false --outDir .tmp/m02-api-check
node .tmp/m02-api-check/test/auth.test.js
node .tmp/m02-api-check/test/seed.test.js
node .tmp/m02-api-check/test/identity-db.test.js
```

M03 now adds catalog import to the combined db:seed command; see [Catalog](catalog.md). M04 is the next implementation module. M07/M08 will supply the sign-in interface; this checkpoint does not provide browser login screens.
