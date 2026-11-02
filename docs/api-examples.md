# API usage examples

See [Shared contracts](contracts.md) for every endpoint, role, enum, bound, filter and transition. Paths below follow `/api/v1`. Use a cookie jar. All POST/PATCH calls send JSON, an Origin matching APP_ORIGIN and `X-BookLeaf-Request: 1`. Login at `POST /auth/login` with `{ "email": "<demo-email>", "password": "<demo-password>" }`; retain the HttpOnly cookie. `GET /auth/me` returns the current user and `POST /auth/logout` returns 204 after revocation.

| Operation            | Example                                                                                                                                                  |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Books                | `GET /books?page=1&pageSize=20`; admin may add `authorId=AUTH001`                                                                                        |
| Book detail          | `GET /books/BK001`                                                                                                                                       |
| Submit (author)      | `POST /tickets`: `{ "bookId": "BK001", "subject": "Royalty query", "description": "Please explain my pending royalties." }`; use null bookId for General |
| Queue                | `GET /tickets?status=OPEN&category=ROYALTY_PAYMENTS&priority=HIGH&createdFrom=2026-11-01&createdTo=2026-11-30&sort=queue` (category/priority admin-only) |
| Detail               | `GET /tickets/<id>` returns a role-specific DTO                                                                                                          |
| Status/assignment    | `PATCH /tickets/<id>`: `{ "expectedRevision": 2, "status": "IN_PROGRESS", "assignmentAction": "SELF" }`; use UNASSIGN to remove assignment               |
| Override             | Same PATCH: `{ "expectedRevision": 3, "category": "GENERAL_INQUIRY", "priority": "LOW" }`                                                                |
| Public reply         | `POST /tickets/<id>/replies`: `{ "body": "Reviewed response", "expectedRevision": 4 }` with a unique `Idempotency-Key` header                            |
| Private note         | `POST /tickets/<id>/notes`: `{ "body": "Internal investigation note" }`                                                                                  |
| Draft request        | `POST /tickets/<id>/ai-drafts`: `{ "regenerate": false }`; true requests deliberate regeneration                                                         |
| Draft lookup         | `GET /tickets/<id>/ai-drafts/latest`; no provider call or work creation                                                                                  |
| Classification retry | `POST /tickets/<id>/ai-classification`: `{}`                                                                                                             |

All management/reply/note/AI operations require admin access. Fetch the actual revision before edits; numbers above are illustrative. A conflict requires reloading and reviewing the edit. An uncertain reply retry must preserve the exact original body, revision and idempotency key. Replies do not implicitly resolve tickets; closed tickets require reopening. Notes increment revision but need no expectedRevision.

Responses use `{ "data": ... }`, with `meta: {page,pageSize,total}` on lists. Errors use `{ "error": { "code", "message", "requestId", "fieldErrors"? } }`: 400 validation, 401 session, 403 role/CSRF, 404 absent/inaccessible, 409 conflict, 429 throttling. AI requests return 202 pending or 200 cached; draft states include NOT_REQUESTED, QUEUED, RUNNING, SUCCEEDED and FAILED, with staleness metadata where applicable. AI output is never sent implicitly.

Public health endpoints are `/health/live` (200) and `/health/ready` (200 or safe 503). Unknown API paths return JSON rather than SPA HTML. Credentials and cookie values must never be copied into source/logs.
