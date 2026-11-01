# M07 Author interface

The author portal is implemented using React, React Router, TanStack Query, and the shared runtime API contracts. It connects directly to the M02–M04 endpoints. There are no mocked integrations in the running application. Interactive browser acceptance and the standard Vite production build remain unverified because of this agent environment's process restrictions.

## Run locally

The existing PostgreSQL container, all three migrations, and demo identities/catalog are required. The application database's identity, catalog, and ticket migrations were verified as applied during M07. No new migration or seed is needed.

```powershell
npm run dev
```

Open `http://localhost:5173` and use a sample author's email with the configured DEMO_AUTHOR_PASSWORD. Vite proxies API requests to Fastify on port 3000; cookies and CSRF requests remain same-origin. No credentials or provider configuration are embedded in the web code. Admin logins receive a clear author-portal message and a sign-out button; no admin screens are included.

## Screens and behavior

| Path         | Behavior                                                                                                           |
| ------------ | ------------------------------------------------------------------------------------------------------------------ |
| / or /login  | Signed-out users see login; authenticated authors go to their books                                                |
| /books       | Paginated owned books with every supplied metadata/royalty field and links to ask about a book                     |
| /tickets/new | General/account-level or owned-book question, subject/description validation, optional preview-only file selection |
| /tickets     | Paginated author questions with status filtering and oldest/newest ordering                                        |
| /tickets/:id | Original question, current status, and public replies                                                              |

Authentication is checked with `/auth/me`. Backend sessions and ownership remain authoritative. A 401 removes private query data and returns to sign-in with a session-ended message. Login/logout replaces session data without detaching the active session observer. Cached author data is removed on account changes/logout. Failed logout reports an error rather than claiming the server session was revoked.

An unsent question is held only in React memory, scoped to the user's ID. It survives navigation and session expiry within the same tab, is restored only for the same account, and is cleared on success, explicit logout, or a different login. Reloading/closing the tab discards it. Files are never read, uploaded, or included in the submitted JSON; their names are only shown as a local preview and selection is not retained across reauthentication.

Submitting disables duplicate clicks and is never automatically retried. Network, timeout, malformed-success, or server-error responses can be ambiguous because creation has no idempotency key. The form keeps its text and asks the author to check My questions in a new tab before explicitly enabling another attempt. Validation errors keep the form editable and point to the affected fields. Sign-out is disabled while a mutation is pending.

Money uses exact integer paise formatting with Indian grouping and two decimal places; null displays “Not available” and zero displays ₹0.00. Date-only values render in UTC to prevent day shifts. Reply/ticket timestamps use the browser's local time. Placeholder ISBNs and production statuses are preserved. Snapshots do not imply payment dates or fabricated sales history.

Ticket list/detail queries refresh every five seconds while visible. Hidden/unfocused views pause interval fetches through TanStack Query's focus manager. Failed requests back off to 30 seconds (capped at 60 seconds); successful requests restore five-second updates. Validation/access/not-found errors stop automatic polling. Reconnection/focus can refresh stale queries. GET requests are cancellable and have a 15-second timeout. Inactive route observers stop polling; no AI endpoint is called by rendering or polling.

Accessibility includes labels and described validation messages, invalid-field focus after submission, a skip link, visible keyboard focus, route focus handling, loading/status announcements, public-reply count/status announcements, and explicit empty/error states. Public text is escaped by React, never injected as HTML. Layouts adapt to narrow screens, but actual mobile visual/keyboard verification is still outstanding.

## Verification results

- Six automated web tests passed, none skipped: money/date fidelity; same-origin API behavior, field errors, malformed responses, cancellation; session observer/cache isolation; polling focus/backoff and refreshed data; server-rendered book coverage; private-data exclusion, escaped text, and truthful attachment labels.
- Workspace typechecking passed, including the new web tests. Lint and formatting passed.
- The web entry point successfully bundled with the installed esbuild executable invoked directly. This is a diagnostic bundle, **not** a successful Vite production build.
- `npm run build -w @bookleaf/web` passed TypeScript but failed while Vite spawned esbuild (`EPERM`).
- The in-app browser failed to initialize because its runtime tool rejected the environment metadata. Standalone Chromium also exited with an access-denied platform-channel error. Therefore login → books → submit → polling updates → logout has **not been verified in a browser** here. The browser harness initialized real PostgreSQL test data and cleaned it up after browser connection failed; that is not a journey pass.
- Fixtures, a controlled fetch implementation, and simulated focus/timers are used only in automated tests. They are not application fallbacks and do not establish real browser behavior.

### Repeatable checks

In a normal terminal:

```powershell
npm run typecheck
npm run test -w @bookleaf/web
npm run build
```

An optional real-browser integration script is included at `scripts/test-author-browser.mjs`. It requires Playwright locally; it was unavailable in this repository and installation was blocked by an offline cache miss, so no dependency or lockfile change was made for it. Install temporarily and run after building:

```powershell
npm install --no-save --package-lock=false playwright
npx playwright install chromium
# Set TEST_DATABASE_URL to a disposable local development PostgreSQL connection.
# Keep its credentials out of tracked files and terminal output.
node scripts/test-author-browser.mjs
```

The script uses TEST_DATABASE_URL explicitly, creates a random isolated schema, applies all migrations, generates temporary test passwords, starts the real API on 127.0.0.1:3187, serves the built web app, and cleans up its own schema/server/browser context. It never edits existing application tickets. The role needs schema-creation rights. Optional BOOKLEAF_TEST_PORT changes the port, BOOKLEAF_TEST_WEB_ROOT selects a test artifact, BOOKLEAF_PLAYWRIGHT_MODULE points to a locally installed Playwright module, and BOOKLEAF_BROWSER_CDP connects to a dedicated local test browser instead of launching one.

The scripted journey covers invalid/valid login, owned-book validation, preview attachments excluded from POST bodies, general tickets, replies/status arriving without refresh, private-note exclusion, session-expiry draft recovery, interrupted submission recovery, logout/account isolation, production nulls, empty lists, and a mobile overflow check. It writes screenshots under ignored `.tmp/m07-evidence` when it reaches those steps. The script remains unverified beyond setup in this environment; use a normal terminal for its acceptance run.

For a manual acceptance run, sign in as an author, open a book, submit a question, and keep its detail visible. Use the existing admin API from a separate session to add a note, public reply, and status change. Confirm only the public reply/status appears within roughly five seconds, then test hidden-tab pause, offline recovery, session expiry, keyboard operation, and a narrow screen. M08 will provide the admin UI.

Next module: **M08 Admin interface**. M05 AI and M06 job execution remain separate backend modules. M07 adds neither admin screens nor provider/worker infrastructure.
