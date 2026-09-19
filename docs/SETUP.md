# Your setup: Vercel, Atlas, OpenAI, and the demo

The physical profile-import implementation is on branch `feature/physical-component-implementation`. Deployment and real badge testing still require your accounts and hardware. The two handoff guides are this file and [BADGE.md](./BADGE.md).

## 1. Create the services

1. Create a MongoDB Atlas replica-set cluster. Transactions are required; a standalone local MongoDB server is insufficient. Choose a region near Vercel's function region. This repository selects `iad1` (Northern Virginia) in `vercel.json`; change that if your Atlas cluster is elsewhere.
2. Create a database user scoped to the application database, with permission to read/write and create indexes. Configure Atlas network access for your Vercel project's actual outbound networking arrangement. If you use a broad public allowlist for the demo, use strong isolated credentials and remove it after the event. Use Vercel static egress/private connectivity if available for your plan.
3. Create a server-side OpenAI project API key with billing and model access. The example uses `OPENAI_MODEL=gpt-4.1-mini`; change it to an available model supporting Responses structured outputs. Each call uses the official SDK, Zod validation, `store: false`, a timeout and bounded retries. Check project spend limits and quotas before rehearsing.
4. Create a Browserbase project and server-side API key for public profile extraction. Check concurrent-session limits because the encounter imports both profiles together.
5. Set up a Resend account and verify a sending domain (DNS records), then create a send-only API key. Set `EMAIL_FROM` to an address on that verified domain. Email is used only to verify identity and recover access, not to read a mailbox.
6. Import this Git repository into Vercel as a Next.js project. Select Node.js 24 and the `feature/physical-component-implementation` branch for your demo deployment. Deploy this branch after configuring the services; local checks do not provision your Vercel project.

References: [MongoDB connection pools](https://www.mongodb.com/docs/drivers/node/current/connect/connection-options/connection-pools/), [MongoDB transactions](https://www.mongodb.com/docs/drivers/node/current/crud/transactions/), [Workflow Next.js setup](https://useworkflow.dev/docs/getting-started/next), [OpenAI structured output](https://developers.openai.com/api/docs/guides/structured-outputs).

## 2. Configure environment variables

Copy `.env.example` to `.env.local` for local development. Set the same variables in the appropriate Vercel environment, then redeploy. Never use `NEXT_PUBLIC_` for these values.

| Variable                   | Value                                                                                        |
| -------------------------- | -------------------------------------------------------------------------------------------- |
| `MONGODB_URI`              | Atlas driver connection string, including database-user credentials                          |
| `MONGODB_DB`               | Database name, e.g. `gptinder_demo`                                                          |
| `OPENAI_API_KEY`           | Server-side OpenAI API key                                                                   |
| `OPENAI_MODEL`             | Exact supported model ID for your account                                                    |
| `AUTH_SECRET`              | At least 32 random characters; keep stable for this database                                 |
| `APP_URL`                  | Exact browser origin, e.g. `https://your-demo.vercel.app`, or `http://localhost:3000`        |
| `BROWSERBASE_API_KEY`      | Server-side Browserbase API key used to extract both public profiles                         |
| `BROWSERBASE_PROJECT_ID`   | Browserbase project containing the extraction sessions                                       |
| `PROFILE_IMPORT_MAX_POSTS` | Maximum discovered posts to inspect per profile, from 1 to 30                                |
| `RESEND_API_KEY`           | Server-side, send-only Resend API key                                                        |
| `EMAIL_FROM`               | Sender on a verified Resend domain, e.g. `GPTinder <signin@example.com>`                     |
| `ALLOW_DEMO_AUTH`          | Leave `false`; `true` enables anonymous key registration for isolated test environments only |
| `CRON_SECRET`              | At least 32 random characters; required for scheduled recovery and import expiry             |

Generate independent secrets with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`. Store them privately. Changing `AUTH_SECRET` invalidates sessions, account-key hashes, and badge bindings; do not rotate it casually against a populated demo database.

Use a separate `MONGODB_DB`, `AUTH_SECRET`, `CRON_SECRET`, and preferably database credentials for Preview and Production. Set `APP_URL` to the actual preview URL you are testing; browser mutations deliberately reject other origins. A stable preview branch domain is convenient. Do not point preview deployments at live participant data.

## 3. Install, initialize, and verify

Use Node.js 24 and pnpm 12.3.4, as pinned in `package.json`.

```sh
npm install --global pnpm@12.3.4
pnpm install --frozen-lockfile
pnpm db:indexes
pnpm db:check
pnpm ai:check
pnpm typecheck
pnpm test
pnpm test:integration
pnpm build
pnpm test:http
pnpm dev
```

`db:check` writes and reloads an expiring test record and verifies a transaction. `test:integration` uses a disposable local MongoDB replica set, not your Atlas database; its first run may download a MongoDB binary. Normal API requests reuse a cached driver connection pool with a maximum of five connections per function instance. Index creation is an explicit setup operation, not work repeated on every request.

On Vercel, use `pnpm install --frozen-lockfile` and `pnpm build`. The `withWorkflow` Next.js integration generates `/.well-known/workflow/` handlers. Keep those paths available to the Workflow runtime. There is no separate worker process to deploy. Confirm Workflow runs appear in the Vercel project after starting an encounter. For local inspection, use `pnpm exec workflow inspect runs` or `pnpm exec workflow web`.

`ai:check` makes one live, minimal structured-output request with no participant data. It requires your configured OpenAI key/model and may incur a small API charge. It is not run by CI. Email delivery and physical hardware are likewise verified during your rehearsal, not by mock tests.

The project includes CI for formatting, type checking, unit tests, replica-set integration tests, and a production build. The Workflow transitive `nanoid` and `undici` dependencies are pinned to patched compatible versions through package-manager overrides.

## 4. Rehearse onboarding and imports

1. Enter your email, display name, and adult confirmation in the web app. Paste the 64-character, single-use code from your email. It expires after 15 minutes. The same flow restores the same account later, including after losing a browser session. Email addresses are verified before account creation; token hashes expire through a MongoDB TTL index. Use separate browser profiles for simultaneous accounts. Seeded fictional accounts retain private-key login and do not require email.
2. Review consent, explicit partner preferences, and all ten TIPI items. Use **Save progress** before leaving an unfinished survey. The wording, order, reverse scoring, and published pairs follow the [TIPI source](https://gosling.psy.utexas.edu/scales-weve-developed/ten-item-personality-measure-tipi/).
3. Optional: enable imported-information consent and submit the survey. Open **Help your AI sound like you** before generating the first adaptive question, or skip imports. Select a WhatsApp `.txt` export without media, choose the sender who is you, and choose only your own messages. Parsing happens in the browser. The raw export is never sent to Vercel.
4. Review/redact the selected text. Known participant names, email addresses, links and phone-like numbers get a first-pass redaction; review for other private names and events yourself. Upload up to 200 distinct excerpts, at most 600 characters each and 80,000 total. Fifty to 200 is a possible demo selection, not a validated measurement minimum; small rehearsals may use three. For writing imports, reserve at least one distinct sample; keep at least two as training samples. Choose the date order explicitly when the parser cannot infer it unambiguously. Mixed/invalid dates and malformed headers are rejected. Detectable quoted/forwarded messages, media placeholders, system events and duplicates are excluded.
5. Wait for extraction, then approve only supported claims, edit communication-style settings, and choose at most five examples from that source for broad style. Reserved samples are withheld from extraction and representative generation. Up to three active imports are supported per user.
   Alternatively choose **Paste my own writing samples** or **Professional background / résumé text**. Paste text or open your own plain-text `.txt` file, review/redact the local excerpts, and upload only the selection. PDF/DOCX/LinkedIn archive decoding is not implemented: export or copy the relevant plain text first. Professional imports need at least one excerpt and support approved facts/interests only; they cannot supply writing examples, overwrite style or change scoring features. LinkedIn OIDC is not a dependency or an implemented sign-in provider; there is no LinkedIn scraper, WhatsApp inbox access, Gmail ingestion or email-enrichment service.
6. Answer the five adaptive questions. Approved imports' unresolved questions help the interviewer clarify context without rewriting survey scores. Saved questions and answers survive refreshes. If generation fails, use the visible retry action. Imports approved after a profile draft exists cause the draft to be regenerated.
7. In profile review, compare responses across all three preview scenarios, including a changed meeting time. Rate both responses 1–5, select/edit the one that sounds more like you, and record attribution, unsupported claims, and any copying/disclosure you noticed. Save each evaluation.
8. Review and edit the personality summary, interests, own features, partner preferences, communication style, and avatar. Explicitly approve the profile. The saved profile references its approved evidence and immutable style version.

Automated evaluation reports suspected unsupported claims, disclosure, five-word passage copying, and a simple held-out style distance based on length/emoji/punctuation. These checks are fallible and do not establish scientific personality accuracy. User resemblance ratings and attribution checks are stored separately. Style does not enter the numerical compatibility formula.

The representative receives its own approved personality, explicit preferences, approved interests, settings, and a few approved writing examples. It receives only the other person's shareable profile and the generated conversation. Raw archives and private samples are never returned to the other participant's API response. Imported-style turns are audited before they are persisted in the shared transcript.

## 5. Prepare the Alex / Blair / Casey demonstration

Run `pnpm demo:seed` against the isolated demo database. It creates three fictional, pre-approved accounts and prints their private sign-in keys once. Keep that output private. Re-running preserves existing accounts, keys, and versions; it does not reset history. Use a fresh database for a completely fresh rehearsal.

Sign into each account and use **Download my badge app**. Install that person's file on their own badge using [BADGE.md](./BADGE.md). Do not copy Alex's personalized file onto Blair's badge. The seed contains no real TIPI assessments or private archives; imported-style onboarding is a separate demonstration using an ordinary account.

Each participant enters and consents to importing their own public Instagram, LinkedIn, or X URL while downloading the badge app. Set `BROWSERBASE_API_KEY` and `BROWSERBASE_PROJECT_ID` in Vercel. A bump imports both URLs in one elected-sender encounter request and stores normalized profiles, visible posts, comments, sections, available media, and an encounter-linked import record in MongoDB.

1. Arm Alex and Blair's badges and bump them. Connect the badge whose screen says **Elected API sender**, then sign into that badge owner's account in the USB browser session. One encounter and two imported profiles should appear despite repeated packets or B-button replay.
2. Wait for six real OpenAI-generated turns and the result. Alex → Blair should score **76**, with full feature coverage.
3. Submit: “The last-minute changes stressed me out. I want someone who makes plans ahead of time.”
4. Review the actual AI proposal. The expected lesson is planning importance **1 → 2**, with the desired value unchanged. Confirm it. If the model asks a clarification or proposes something else, clarify the feedback; the application does not substitute a hardcoded proposal.
5. Bump Casey. Blair and Casey have identical approved scoring features. With only that importance update, Alex → Casey is **67** rounded.
6. Show **Same person, updated preferences** on Casey's result: **76 under version 1 → 67 under version 2**. Reopen Blair's result and confirm it is still **76**.

The deterministic fit values are 0.2, 0.9, 0.9, 0.9, 0.9. Equal weights yield 76; changing only planning weight to 2 yields 66.67, rounded to 67. The opposite directional score is calculated independently. Unknown dimensions are omitted and coverage is displayed; no eligible features produces no score.

## 6. Recovery, retention, and deletion

`pending_start` is a persisted outbox state. A one-minute dispatch lease and workflow ownership claim tolerate the save/start gap and duplicate starts. Opening a pending encounter/import retries dispatch. Failed encounters resume from existing turns using the UI retry action. Do not replace these awaited dispatches with fire-and-forget promises.

`vercel.json` schedules `/api/internal/recover` daily at 06:00 UTC. Set `CRON_SECRET` in Vercel. The endpoint also accepts an authenticated POST from an external scheduler using `Authorization: Bearer <CRON_SECRET>`. For more frequent unattended recovery, use a cadence supported by your Vercel plan or an external scheduler. The daily default is deliberately modest; the interactive demo recovers immediately through its screens.

The job processes bounded batches: five pending encounters, five running encounters, five imports and five expired sources per call. Monitor `failedChecks` and schedule more often if there is a backlog. Imports become eligible for cascading deletion after seven days and are processed on the next scheduled run; this is not an exact seven-day deletion guarantee. Manual deletion is immediate. Deleted-source tombstones expire after 30 days.

Source deletion clears selected excerpts and review drafts, removes derived claims/retrieval records, invalidates dependent styles/previews/profiles, clears affected preview text, and removes affected conversations/results. It resets derived interview content so the owner can approve a fresh profile. A concurrent or late extraction cannot resurrect a deleted source. This privacy deletion is intentionally different from ordinary preference updates, which preserve historical results.

Workflow orchestration passes record IDs and small control values. Model calls and private database reads happen inside steps, which do not return raw samples or generated drafts to orchestration. Routine logs contain error classes, not prompts/messages. `store: false` disables persisted Responses application state; it is not a blanket zero-retention guarantee. Separately review your Vercel Workflow execution-history retention, function logs, Atlas backups, Resend delivery logs (which contain authentication emails), and [OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data). Deleting a MongoDB source does not retroactively erase provider logs or backup snapshots. Do not export private workflow data into analytics.

## 7. Acceptance checks on your deployment

- Atlas write/read and transactions pass; Preview and Production use different databases.
- Two browser sessions cannot read each other's interviews, imports, previews, or unrelated encounters.
- Refresh restores the saved survey, five-question progress, and current generated question.
- Imports upload only reviewed selections; held-out messages never enter extraction/generation context.
- Both profiles are approved before pairing. Duplicate USB/radio events produce one encounter and six unique visible turns.
- A retried confirmation creates one preference version. A stale proposal is rejected rather than overwriting a newer preference.
- The 76 → 67 comparison works with a specific confirmed lesson; historical results remain unchanged during normal learning.
- Deleting an imported source removes samples and prevents dependent styles/conversations from being reused.
- Real OpenAI, Vercel Workflow execution, physical badge timing/radio, and USB behavior are rehearsed on your equipment. Automated local tests are not substitutes for these deployment checks.

## Code map and API

`lib/domain.ts`, `lib/import-domain.ts`: schemas and records. `lib/scoring.ts`: deterministic arithmetic. `lib/server/`: services, access control, transactions and AI calls. `workflows/`: encounter and import orchestration. `components/matchmaker/`: UI. `public/badge/gptinder.lua`: complete badge template. `tests/`: domain, Lua protocol and replica-set integration tests.

| API                                                        | Purpose                                                |
| ---------------------------------------------------------- | ------------------------------------------------------ |
| `POST /api/auth`, `DELETE /api/auth`, `GET /api/me`        | Seeded key login, logout, own state                    |
| `POST/PATCH /api/auth/email`                               | Send verification/recovery email; redeem one-use code  |
| `PUT/PATCH/POST /api/interview`                            | Save survey, save answer, generate next question/draft |
| `POST /api/profile`                                        | Approve the reviewed profile                           |
| `POST/GET /api/imports`                                    | Create/list bounded reviewed imports                   |
| `GET/POST/DELETE /api/imports/:id`                         | Read own draft, retry extraction, cascade deletion     |
| `POST /api/imports/:id/approve`                            | Approve selected claims, settings and examples         |
| `POST/GET /api/persona-preview`                            | Generate/review previews; list own evaluation records  |
| `POST/DELETE /api/badges`                                  | Issue/revoke an expiring badge binding                 |
| `POST/GET /api/encounters`, `GET/POST /api/encounters/:id` | Create/list/read/resume encounters                     |
| `POST/PATCH/GET /api/feedback`                             | Save, analyze, restore own feedback                    |
| `POST/GET/PATCH /api/preferences`                          | Confirm lesson, list versions, create a revert version |
| `GET/POST /api/internal/recover`                           | Authenticated recovery and source-retention batches    |

All application routes run in Node.js. Browser mutations require a signed HttpOnly session (except registration/login) and the configured origin. Badge tokens identify bindings; they are not account keys or cryptographic proof of physical proximity. This is a consent-based hackathon demo, with short-range pairing and authenticated encounter submission.

## Storage and operational notes

The import pipeline uses `source_imports` (owner, source type, consent, parser version, descriptive statistics and review state), `writing_samples` (private selected text and local timestamps when available), `evidence` (approved facts/interests/style claims and cited source IDs), and `style_profile_versions` (immutable approved settings/examples). These are separate from personality and preference versions. Draft claims remain pending review on their source; approval records their status and allowed use. The model sees at most 50 evenly selected training samples per extraction; all reserved samples are excluded. Human review is required: a genuine quote does not itself prove the model's interpretation.

Initialize a fresh database for this branch. This repository has not performed a migration against any existing live database. Do not point it at records created by an earlier development schema without a backup and explicit migration review.

For email delivery setup, see [Resend's send-email API](https://resend.com/docs/api-reference/emails/send-email). Verify domain ownership and actual delivery on your deployment. No live email, OpenAI request or Atlas connectivity is exercised by the mocked automated suite. The HTTP smoke test starts the production build against a disposable replica set and tests pages, authentication, authorization, origin checks and badge download. It keeps demo registration disabled and verifies email-code redemption, replay rejection, session restoration and cross-account isolation using fixture tokens in that isolated database.

Ask the badge organizers whether a separate authorized account-linking API exists. Until confirmed, use website binding: the personalized Lua app contains an expiring device token linked to the signed-in account. The documented badge APIs cannot expose email, phone or social accounts; no such access is assumed.
