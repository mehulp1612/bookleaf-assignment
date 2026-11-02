# M05 Knowledge base and AI assistance

Live diagnostic update (2026-11-02): the configured classification model `openai/gpt-4.1-nano:batch` returned CONFIGURATION failure through this chat-completions adapter. A diagnostic override using the already configured draft model `openai/gpt-4.1-nano` classified successfully. No model/key setting was changed automatically. Five requests total were made: one rejected configured classification, then classification/drafting before and after the prompt fix using a synthetic BK001 royalty query. The original draft used an invalid prefixed fact reference and unsupported payout advice and was rejected. With prompt v2, both classification and drafting passed; the draft correctly treated INR 3,570 as a snapshot, left payout timing unknown, and requested staff verification. This is one-case live evidence, not an all-category evaluation or browser end-to-end acceptance. Nineteen deterministic AI tests, API typechecking/build, and targeted lint passed.

M06 now integrates these services with the API worker and admin endpoints. See [Background execution](background-jobs.md) for deployment, scheduling, run/job associations and current integration status. The sections below retain the M05 service boundary and its original verification evidence; scheduling remains outside M05.

M05 provides server-side classification and draft services, a versioned assignment knowledge base, an OpenRouter/compatible chat-completions adapter, and persisted AI run records. It does not register routes, execute queued jobs, apply classification to tickets, retry calls, or send replies. M06 owns those orchestration steps. Manual ticket handling remains independent of AI configuration.

## Configuration

Use the ignored root `.env`. No credentials belong in source, browser variables, screenshots, or logs. Copy the AI settings from `.env.example`; do not overwrite your existing database/demo configuration.

| Setting                        | Meaning                                                                                                                                |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| `AI_PROVIDER`                  | `disabled` (default), `openrouter`, or `compatible`                                                                                    |
| `AI_BASE_URL`                  | HTTPS API base, without `/chat/completions`, query, fragment, or embedded credentials. OpenRouter uses `https://openrouter.ai/api/v1`. |
| `AI_API_KEY`                   | Server-only bearer credential; required when enabled                                                                                   |
| `AI_CLASSIFICATION_MODEL`      | Explicit model ID for category and priority in one call                                                                                |
| `AI_DRAFT_MODEL`               | Explicit model ID for response drafting; may match classification                                                                      |
| `AI_OUTPUT_MODE`               | `prompt` (default), `json_object`, or `json_schema`, depending on model capability                                                     |
| `AI_TIMEOUT_MS`                | Whole HTTP call/body deadline, default 20,000 ms                                                                                       |
| `AI_CLASSIFICATION_MAX_TOKENS` | Classification output cap, default 400                                                                                                 |
| `AI_DRAFT_MAX_TOKENS`          | Draft output cap, default 1,200                                                                                                        |

To switch quota/provider configurations, change the provider, base URL, key and both model IDs, then restart. Use `compatible` for another provider implementing the same chat-completions request/response protocol. This is not a universal adapter for unrelated APIs. HTTPS is required, redirects are rejected, and OpenRouter provider fallback is explicitly disabled. No automatic model substitution is configured. Different token parameter conventions require another adapter.

OpenRouter is supported because the user already has an account and requires interchangeable model/provider settings. No model is silently selected or claimed to have passed evaluation. Choose an explicit available model using your account, then evaluate it. `prompt` sends the JSON schema in instructions without requiring native schema support; JSON modes add the corresponding response-format parameter. Every mode parses and validates output with Zod; malformed JSON, fences, extra fields, wrong enums, truncation, and refusals fail. Native output support is model-specific: [OpenRouter structured output documentation](https://openrouter.ai/docs/guides/features/structured-outputs).

## Knowledge base and grounding

`apps/api/src/modules/ai/knowledge-base.v1.ts` transcribes the assignment's company, royalty, ISBN, printing, distribution, production, tone and seven sample-response entries. Line wrapping, arrows, soft hyphens and INR notation are normalized. The metadata policy is extracted from the final sample, not invented. Increment the resource and prompt versions when meaning changes.

Deterministic topic matching plus the effective category select policy sections. Company and communication guidance are always present. Prompt v2 retains the original sample guidance in the versioned resource but does not insert the action-confirming examples into model requests; instead it supplies a safe acknowledge/explain/request-review pattern. Exact policy/fact reference allowlists appear in both the prompt and generation schema. Classification gets no book/account facts or public history. Drafts get one owned book, or account royalty totals for account-level royalty questions, with only relevant fields. Money is converted from integer paise to exact decimal INR strings. Nulls remain null. Up to the last three supplied public replies are included, at most 1,500 characters each. The caller must supply replies in chronological order and fetch bounded history. Names, emails, phone numbers, addresses, private notes, author IDs and book IDs are excluded from provider messages. Ticket subject/description may themselves contain user-entered personal information; they are sent as the query, not logged separately.

Only trusted server orchestration may construct `AiContext`. M06 must load the ticket, use its persisted author/book IDs, and call M03's authorized catalog context helpers; this service is not an authorization endpoint. Runtime parsing strips undeclared fields and rejects a mismatched book/account author. It cannot independently verify a fabricated internal object.

The prompt separates untrusted query/history/catalog text from system policy. It explicitly prohibits treating instructions in those fields as authority. There are no tools, cross-author lookups, or operational capabilities. Model references must identify supplied policy sections and non-null fact keys. Additional checks reject common completed-action claims, invented numeric values, unsupported bank/overdue/delay claims, and HTML/URLs. Reported ISBN errors cannot pass classification with a low/medium priority or unrelated category.

The original examples mention confirming escalations/re-syncs, checking bank linkage, confirming payout dates, and platform breakdowns. They remain faithfully preserved in the resource. Runtime safety instructions explain that these actions/facts are unavailable here: request staff investigation, acknowledge uncertainty, and frame policy timelines conditionally. Pending royalties or an old payout date never establish overdue payment. No draft is sent automatically.

These checks are defense in depth, not proof of semantic truth or immunity to prompt injection. A model can still use supported numbers in the wrong context or invent an unrecognized nonnumeric claim. Human review is mandatory. Deterministic fixtures demonstrate validation behavior, not live model quality.

## Internal contracts and persistence

`createConfiguredAiService(client, environment)` creates the production adapter/store without making a call. It expects environment values already loaded by the application. `classifyTicket(context, signal?)` and `draftResponse(context, signal?)` each attempt exactly one provider call and return a discriminated `SUCCEEDED`/`FAILED` outcome with run ID, fingerprint, context revision, usage and latency. Invalid internal context fails before recording/calling; persistence failure throws safe `AiFailure('PERSISTENCE')`. A success is never returned before it has been saved.

The `AiRun` migration adds a ticket FK, task, state, fingerprint, prompt/KB versions, safe provider identity, model, validated JSON result, fixed failure metadata, timestamps, latency, and optional token counts. It stores neither API keys, full prompts, raw output, upstream errors, nor full context. Validated drafts/rationales may contain author query or book information and are admin-only data; M06 must not expose run records to authors. Finishing a run uses `WHERE state = RUNNING`, preventing duplicate completion. Interrupted `RUNNING` records and stale successful records are for M06 to reconcile. No cache lookup, job deduplication or retry loop is implemented here.

Fingerprints canonicalize task, ticket/author identity, selected query/facts/history/policies, effective draft category, prompt/KB version, provider endpoint hash/output mode, model and output cap. Private notes, irrelevant fields, credentials, and manual classification overrides do not change classification fingerprints. A changed effective category affects the draft fingerprint. Credential rotation alone does not invalidate a valid result; M06 must separately reset a paused provider configuration after configuration changes.

Before applying any result, M06 must recheck current fingerprint/context revision and job generation/lease, then use the ticket service's override-preserving method. Never hold a DB transaction open during the provider call. Keep the draft as an editable suggestion; the existing public-reply API is the sole send path.

## Failures and cost

Fixed error codes are `DISABLED`, `AUTHENTICATION`, `QUOTA`, `RATE_LIMIT`, `TIMEOUT`, `CANCELLED`, `UPSTREAM`, `INVALID_OUTPUT`, `UNSAFE_OUTPUT`, `CONFIGURATION`, and `PERSISTENCE`. Every failure has a safe message, `retryable`, `pauseConfiguration`, and nullable `retryAfterMs`. HTTP 402 and recognized quota codes pause configuration; 401/403 reject credentials/permissions; 429 is retryable; timeouts/network/5xx are transient. Unknown 4xx require configuration review. Numeric and HTTP-date Retry-After are supported, capped at one day. Raw error messages are discarded. See [OpenRouter error reference](https://openrouter.ai/docs/api/reference/errors-and-debugging).

M06 owns retry scheduling, concurrency, budgets, exhausted-provider pauses and deliberate retries. This adapter makes no repair call after malformed output and never retries internally. HTTP bodies are capped at 128 KB and model content at 32,000 characters; output tokens and timeouts are configurable. Prompt history and input fields are bounded. The explicit fake provider has deterministic scripted results/failures, is injectable only, and cannot be enabled by production environment configuration.

## Setup and verification

```powershell
npm run db:generate
npm run db:deploy
npm run typecheck
npm run ai:evaluate
```

The evaluation command makes at most two sequential calls: one classification and, only on success, one draft for a synthetic royalty question using sample BK001. It writes no application records, sends no contact details, does not retry, and prints only validated results/safe errors/usage. Review the result for correct policy, INR 3,570 pending as a snapshot, no invented payout date, and no claim of completed action. This narrow smoke check does not establish all-category quality.

No AI key was present during implementation. Live AI remains unverified; no paid/free provider request was made. Automated fixtures cover all six categories plus metadata updates, production nulls, ownership mismatch, minimal context, fingerprints, malformed outputs, unsafe references/actions, provider modes, quotas/auth/rate limits, timeout/cancellation, and storage failures. Real PostgreSQL testing uses an isolated temporary schema and applies the migration sequence there.

Verification results: **55 API tests passed, zero failures/skips**, including 19 M05 tests (18 deterministic tests plus one real PostgreSQL test), and the existing identity/catalog/ticket regressions with real PostgreSQL and HTTP. Tests were bundled using the installed esbuild executable and run directly with Node because this environment restricts the standard launcher's subprocesses. Workspace typechecking, contracts/API builds, Prisma generation/schema validation, ESLint, Prettier and diff whitespace checks passed. `npm run ai:evaluate` reported disabled and made zero requests. No frontend implementation changed in M05; no new browser or Vite-build claim is made.

Application migration deployment remains pending: this agent environment rejects Prisma's migration-engine child process (`EPERM`). Run `npm run db:deploy` in a normal terminal before M06 uses the store. This migration does not alter existing ticket data. M05 does not enable the admin draft endpoints or consume the existing classification queue; those remain M06 integration work.
