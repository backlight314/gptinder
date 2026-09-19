# Hack the Heart

Hack the Heart is a public directory built from official Hack the North Connect contacts. A participant can connect a compatible badge to desktop Chrome, Brave, or Edge, preview its owner and saved contacts, and explicitly import them into a shared MongoDB directory. No account or sign-in is required.

## Badge import

Open `/import` over HTTPS and connect the badge with a USB data cable. The browser requests the Espressif serial device (`VID 0x303A`, `PID 0x1001`) at 115200 baud and issues only these read commands:

```text
cat /littlefs/identity.json
ls /littlefs/config/contacts
cat /littlefs/config/contacts/<validated-file>.cfg
```

The importer drains boot output, handles fragmented serial reads, waits for the `badge>` prompt, retries one incomplete command, limits output, and releases all locks before closing the port. It never flashes, reboots, configures, or writes to the badge.

After reading, `/api/airos/imports/preview` classifies each record as new, fills missing fields, unchanged, or conflicting. Nothing is uploaded until the user chooses **Import all**. Imports can fill empty fields but never replace a different established value. Re-importing the same badge ID does not create a second profile or directory card.

## Public product

- `/` — searchable, paginated badge directory
- `/people/[badgeId]` — public profile with contact and social fields; requests `noindex`
- `/import` — Web Serial preview/import workflow
- `/lab` — the existing separate AI compatibility lab
- `/airos` — redirects to `/`

Email and phone are intentionally public in this product configuration. Profiles are labelled `badge imported`; stock badge records are not cryptographically signed.

On a profile page, **Analyze profile** imports supported LinkedIn, Instagram, and X/Twitter data through the server-side Apify pipeline and produces a cached structured analysis through OpenAI. Scraped text is treated as untrusted reference material, sensitive traits are not inferred, and the profile remains available when enrichment fails.

## Persistence

The directory uses `airos_profiles`, `airos_connections`, `airos_profile_observations`, `airos_imports`, `airos_profile_analyses`, and TTL-backed `airos_rate_limits`. The retired `airos_registrations` data is not migrated or published.

Copy `.env.example` to `.env.local` and configure server-only credentials:

```dotenv
MONGODB_URI="mongodb+srv://..."
MONGODB_DB="gptinder"
OPENAI_API_KEY="sk-..."
OPENAI_MODEL_A="gpt-5.6-luna"
OPENAI_MODEL_B="gpt-5.6-luna"
AIROS_ANALYSIS_MODEL="gpt-5.6-luna"
APIFY_TOKEN="apify_api_..."
AIROS_RATE_LIMIT_SALT="long-random-value"
```

## Development

```bash
pnpm install
pnpm dev
pnpm test:run
pnpm typecheck
pnpm build
```

Open [http://localhost:3000](http://localhost:3000). Web Serial works on localhost for development; deployment requires HTTPS.

## Discord data source

A small Discord bot (`bot/`) lets people send their own message history to the
FastAPI backend (`backend/`), where it becomes input for persona generation.

**Run it locally**

```bash
# 1. Backend
cd backend
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
cp .env.example .env            # set ANTHROPIC_API_KEY and INGEST_TOKEN
.venv/bin/uvicorn app.main:app --reload

# 2. Bot (separate terminal)
cd bot
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
cp .env.example .env            # set DISCORD_BOT_TOKEN; INGEST_TOKEN must match the backend's
.venv/bin/python bot.py
```

Bot setup: create an application at discord.com/developers/applications, add a
Bot, enable the **Message Content Intent**, and invite it with the `bot` scope
plus View Channels and Read Message History. Tokens live only in `.env` files,
which are gitignored.

**Trigger an export:** in any channel the bot can read, a user types `!export`.
The bot scans the last `HISTORY_LIMIT` (default 500) messages in that channel and
sends only the caller's own text messages, so nobody's history is exported
without them asking.

**How it flows**

1. The bot POSTs `{"user_id", "source": "discord", "messages": [{"content", "timestamp", "message_id"}]}`
   to `POST /ingest/discord` (with `X-Ingest-Token` when `INGEST_TOKEN` is set).
2. The backend merges the messages into `data/raw/<user_id>_discord.json`
   (deduplicated by Discord `message_id`, or by timestamp and text for exports without ids; sorted by time). `data/raw/` is gitignored; set `DATA_DIR` to
   change the location. Running `!export` repeatedly, or in several channels,
   keeps adding to the same file.
3. `POST /personality` with `"discord_user_id": "<id>"` appends that file's
   messages, as a `--- Discord messages ---` section, to the text (alongside any
   profile or WhatsApp text in the request) that feeds the four extraction calls.
   It returns 404 if that user has no export yet.
