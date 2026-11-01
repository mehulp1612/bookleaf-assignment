# M03 Author and book catalog

M03 implements PostgreSQL catalog storage, sample import, demo identity linking, authenticated book reads, and internal ownership/context helpers. Ticket workflows, catalog editing screens, and AI calls remain outside this module.

## Setup and repeatable import

From the repository root, with DATABASE_URL in the ignored `.env`:

```powershell
npm run db:deploy
npm run db:import
```

`db:import` imports the supplied JSON's 10 author profiles and 18 books without requiring demo passwords or changing login accounts. To create/link all ten author accounts and the admin as well, configure the dedicated demo variables described in [Identity and access](identity.md), then run `npm run db:seed`. The combined seed imports catalog and identities in one transaction. It validates inputs and hashes passwords before opening the transaction.

Both commands upsert by the original sample IDs. Reruns refresh supplied catalog fields, preserve records absent from the input, and never delete support records. Existing passwords and sessions remain unchanged unless the explicit identity password-reset option is enabled. An existing book cannot be transferred to another author by import. A failure rolls back the whole import or combined seed; simultaneous conflicting imports may need a retry.

The migration extends the existing Author table in place and adds Book with an author foreign key and an author/ID index. Profile columns remain nullable so M02's identity-only anchors remain valid; catalog import requires every profile field and fills all ten sample profiles. This replaces the earlier plan to enforce NOT NULL after backfill: unknown profile values are never fabricated. Money is stored in BIGINT columns with nonnegative JavaScript-safe-range checks; DTOs expose integer numbers.

## Data fidelity

- Original author/book IDs, ISBN strings (including placeholders), status strings, platform arrays, and print partners are preserved.
- Calendar dates use PostgreSQL DATE and API `YYYY-MM-DD`, without local-time conversion.
- Rupees are parsed as decimal digits into integer paise, without floating-point multiplication or rounding. Negative, unsafe, and more-than-two-decimal amounts are rejected.
- The sample has 16 published books and two production books, BK013 and BK015. Missing publication dates, MRP, royalty rate, payout date, and print partner remain null. Zero snapshot totals remain zero.
- Sales and royalty values are supplied snapshots. No transaction history, bank details, or payout promises are generated.

## API and module boundaries

`GET /api/v1/books` returns the shared paginated Book contract, ordered by ID ascending. Authors receive only their own books. An explicit matching authorId is accepted; another authorId returns 403. Admins can list all books or filter by authorId. Invalid query fields or excessive pagination offsets return 400.

`GET /api/v1/books/:id` returns the shared detail envelope. Missing and inaccessible books both return 404. Both endpoints require the persisted M02 session and use its server-resolved principal; unauthenticated requests return 401. No profile contact details are exposed through these endpoints.

`createCatalogService` exposes internal integration helpers:

- `assertBookOwnership(principal, authorId, bookId)` returns the verified book. M04 must pass the ticket author's ID, including for an admin viewer; admin access does not waive the book/author relationship check.
- `getBookContext(principal, authorId, bookId)` returns `{ source: 'catalog_snapshot', currency: 'INR', book }` after the same check.
- `getAccountContext(principal, authorId)` returns source/currency, authorId, bookCount, and summed earned/paid/pending paise. An existing author with no books gets zero totals; absent/inaccessible authors return 404. Unsafe aggregate totals fail validation rather than silently losing precision.

These helpers require a trusted server principal, never a principal assembled from request-body fields. They are internal APIs, not additional HTTP routes. M05 must select only relevant verified facts for its prompt; these snapshots cannot establish sales history or payment deadlines.

## Verification and limitations

Focused unit tests check sample counts, production/null cases, placeholder ISBNs, exact money conversion, and invalid imports. PostgreSQL integration tests apply both migrations in an isolated generated schema, including an existing M02 author anchor, and exercise a live Fastify HTTP server. They compare every field on all 18 books, log in all ten authors, check admin pagination/filtering, reject cross-author access, verify context totals, and test atomic rollback. Repeated seeds preserve hashes, sessions, unrelated authors/books/users, and a test-only dependent support record. That sentinel verifies preservation without implementing tickets.

Set TEST_DATABASE_URL to a disposable development PostgreSQL database before `npm test` to enable the database tests; they require schema creation rights and clean up only their generated schemas. Without that variable, database tests are explicitly skipped. Do not use a production database.

The application database still needs the new catalog migration and import commands above. Agent-side `db:deploy` is blocked by schema-engine subprocess EPERM; migrations and queries were verified against real PostgreSQL in isolated test schemas. No migration ledger was modified manually. See the implementation guide for current regression results. Next module: **M04 Ticket management**, using these ownership helpers and the existing principal.
