# Free demo deployment: Render + Neon

Use a Render Free Node web service for the React build/API/worker and Neon Free PostgreSQL for persistent data. No new application infrastructure is needed. No hosted service has been created or verified yet.

Render sleeps after 15 minutes without inbound traffic and takes about one minute to wake. The worker pauses too; jobs remain in PostgreSQL for recovery. Render's free PostgreSQL expires after 30 days, whereas Neon's free plan has no time limit, subject to quotas. Sources checked on 2026-11-02: [Render limits](https://render.com/docs/free), [Neon pricing](https://neon.com/pricing).

## Steps

1. Create a Neon Free project in a region close to the Render service. Use a dedicated demo database. Copy its direct PostgreSQL connection URL, retaining SSL settings. The app uses a small five-connection pool; a direct URL can serve runtime and migrations. Do not disable TLS verification.
2. Commit and push the intended repository changes first. No commit or push was performed by this agent. Connect `mehulp1612/bookleaf-assignment` to a new Render **Web Service**, choose **Free**, and leave Root Directory at the repository root.
3. Configure the settings below using Render's environment/secret settings. Do not paste secrets into build commands or source files.

| Setting                                      | Value                                                                    |
| -------------------------------------------- | ------------------------------------------------------------------------ |
| Runtime                                      | Node                                                                     |
| Build command                                | `npm ci --include=dev && npm run build`                                  |
| Start command                                | `npm run db:deploy && npm run db:seed -w @bookleaf/api && npm run start` |
| Health check                                 | `/health/ready`                                                          |
| `NODE_VERSION`                               | `22.16.0` (verified local runtime)                                       |
| `NODE_ENV`                                   | `production`                                                             |
| `HOST`                                       | `0.0.0.0`                                                                |
| `APP_ORIGIN`                                 | Exact assigned `https://YOUR-SERVICE.onrender.com`, no trailing slash    |
| `DATABASE_URL`                               | Neon direct connection URL, secret                                       |
| `DEMO_ADMIN_EMAIL`                           | Dedicated demo email, e.g. `admin@example.test`                          |
| `DEMO_ADMIN_PASSWORD`                        | New strong demo-only password                                            |
| `DEMO_AUTHOR_PASSWORD`                       | Different new strong demo-only password                                  |
| `DEMO_RESET_PASSWORDS`                       | `false`                                                                  |
| `AI_PROVIDER`                                | `openrouter`, or `disabled` during initial setup                         |
| `AI_BASE_URL`                                | `https://openrouter.ai/api/v1`                                           |
| `AI_API_KEY`                                 | Rotated dedicated provider key, secret                                   |
| `AI_CLASSIFICATION_MODEL` / `AI_DRAFT_MODEL` | Explicit supported model IDs; tested: `openai/gpt-4.1-nano`              |
| `AI_OUTPUT_MODE`                             | `prompt`                                                                 |
| `AI_WORKER_ENABLED`                          | `true`                                                                   |
| `AI_JOB_POLL_MS`                             | `5000` to reduce idle database polling                                   |
| `AI_CONCURRENCY` / `AI_REQUESTS_PER_MINUTE`  | `1` / `6`                                                                |

Let Render supply PORT. Migrations and the repeatable seed run before listening because free services lack shell/one-off-job access. The API is already built, so use the workspace seed command at startup rather than rebuilding. Development dependencies are retained for the Prisma CLI as a demo packaging tradeoff. Existing support data/passwords are preserved unless password rotation is explicitly enabled.

## Verify and submit

Test the assigned HTTPS URL with both roles: login, book/general ticket creation, automatic classification, draft generation, deliberate edit/send, private-note isolation and polling. Restart the service and confirm data survives. Verify Secure/HttpOnly session cookies and same-origin `/api` requests. Record the real URL and dedicated demo credentials only after these checks; no URL or passwords have been invented here.

Free hosting does not cover model inference charges. Use a dedicated demo key and provider spending limit before distributing public admin credentials. Frequent worker polling keeps Neon compute active while the web process is awake; free quotas still apply. Do not add artificial keep-alive traffic to disguise sleep behavior.

Delivery review found a provider key in `.env.example` and removed it. Rotate that key before publishing. The working tree and HEAD had no matching OpenRouter/OpenAI key patterns after removal; this is not proof against every possible secret. Keep the replacement only in ignored `.env` or hosting secrets.
