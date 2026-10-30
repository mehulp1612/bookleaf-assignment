# Delivery checklist

## Required end-to-end checks

- [ ] A clean checkout installs, migrates, seeds, builds, and starts using documented commands.
- [ ] Seed contains the supplied 10 authors and 18 books with original IDs and values.
- [ ] Rerunning seed does not duplicate records or delete support activity.
- [ ] Author and admin demo logins work; invalid credentials and expired sessions fail cleanly.
- [ ] Changing book/ticket IDs cannot expose another author's records.
- [ ] Admin-only mutations reject author requests even when called directly.
- [ ] Production books show unavailable fields correctly; zero royalty is distinct from null.
- [ ] Author submits book-specific and general tickets successfully.
- [ ] Attachment UI clearly explains that uploads are not implemented.
- [ ] Author can view original query, status, and public responses.
- [ ] Admin filters work individually and together; urgent/old unresolved tickets are visible.
- [ ] Status transitions, assignment, overrides, and internal notes work.
- [ ] Internal notes, drafts, and admin events do not appear in author API payloads.
- [ ] New tickets automatically receive category/priority when AI is available.
- [ ] Admin opens ticket, receives a grounded draft, edits it, and sends the reviewed text.
- [ ] Reopening/polling does not spend another model request unnecessarily.
- [ ] Polling does not overwrite unsent admin edits.
- [ ] Author sees a new response/status without manual browser refresh.
- [ ] Stale edits produce conflicts; repeated send retries do not duplicate replies.
- [ ] Manual overrides survive delayed AI results.
- [ ] Slow/down/rate-limited/quota-exhausted AI does not prevent manual workflows.
- [ ] Worker restart recovers jobs without duplicate effective changes.
- [ ] Supported provider/model/key settings can be changed without modifying ticket logic.
- [ ] AI evaluates the six required categories and handles absent bank/ledger/deadline facts honestly.
- [ ] Required UI journeys have loading, empty, validation, and failure states.
- [ ] Production deployment preserves database state across application restarts.
- [ ] Live URL is tested with both roles and the required AI flow.

## Verification strategy

Use focused service tests for authorization, state transitions, concurrency, cache/retry behavior, and input/output validation. Use integration tests with PostgreSQL for transactions, ownership queries, and durable jobs. Use a small set of browser tests for author submission, admin response, private-note isolation, and updates without refresh. Test failure modes with a fake provider so reliability checks do not consume the live quota.

A small live evaluation should record provider/model, date, tested cases, and observed limitations. Passing fake-provider tests does not establish real classification or response quality. Do not claim a quality percentage from a handful of examples.

## Submission artifacts

- [ ] Public GitHub/GitLab source repository with no credentials or keys.
- [ ] Add the evaluator as collaborator once the assignment contact supplies the address and the user authorizes that action.
- [ ] Working live demo URL, seeded with the exact dataset.
- [ ] README includes author/admin test login credentials suitable for the public demo.
- [ ] README explains local setup, environment variables, migrations, seeding, development, build, and production start.
- [ ] README explains architecture, module boundaries, AI provider/model rationale, grounding, retries, quota control, caching, and limitations.
- [ ] API documentation covers every endpoint, authentication, request/response examples, errors, filters, and role restrictions.
- [ ] Provider-switch guide distinguishes configuration-compatible endpoints from providers needing a new adapter.
- [ ] Maximum one-page write-up covers priorities, tradeoffs, and future production improvements.
- [ ] Final report separates verified functionality, test-only behavior, and remaining limitations.

## Scope if time becomes tight

Protect the required ticket flow, real AI integration, ownership checks, private-note isolation, live deployment, and clear documentation. Defer actual file upload, author follow-up messages, email notifications, reporting charts, advanced search, additional LLM adapters, and operational integrations.

## Production evolution for the write-up

Discuss moving the runner into a separate process, operational monitoring, stronger AI evaluation, richer audit trails, real attachment storage/scanning, notifications, and verified royalty/production integrations. These are future improvements, not prerequisites for completing this assignment.
