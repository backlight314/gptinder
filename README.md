# gptinder

This is a [Next.js](https://nextjs.org) project bootstrapped with [v0](https://v0.app).

## Built with v0

This repository is linked to a [v0](https://v0.app) project. You can continue developing by visiting the link below -- start new chats to make changes, and v0 will push commits directly to this repo. Every merge to `main` will automatically deploy.

[Continue working on v0 →](https://v0.app/chat/projects/prj_x5RUpsvNaKjJVpiyoM6I9Qvh5g9a)

## Public profile imports

The profile form uses Apify for LinkedIn, Instagram, and X. It captures profile fields, posts, comments/replies, and
sections such as experience, education, certifications, projects, and skills,
then stores queryable records plus the complete raw social data in MongoDB.
Credentials never reach the browser client.

Copy `.env.example` to `.env.local` and set:

```bash
MONGODB_URI="mongodb+srv://..."
MONGODB_DB="gptinder"
APIFY_TOKEN="apify_api_..."
PROFILE_IMPORT_MAX_POSTS="12"
```

For Vercel, add the same values under Project Settings → Environment Variables.
Use a MongoDB Atlas database user scoped to this application and allow network
access from Vercel. The primary schema has seven collections:

- `users`: personalized string `_id` and display name
- `personas`: user-authored name, bio, traits, interests, and conversation style, keyed by `userId` and slot (`a` or `b`)
- `linkedin_profiles`: raw LinkedIn profile fields, including embedded profile sections
- `instagram_profiles`: raw Instagram profile fields
- `x_profiles`: raw X profile fields
- `social_posts`: posts from every platform with `userId`, `profileId`, and raw data
- `social_comments`: comments/replies with `userId`, `profileId`, `postId`, and raw data

The importer accepts Instagram person profiles, LinkedIn `/in/` person profiles,
and X profile URLs. With `APIFY_TOKEN` configured, these imports do not depend
on personal browser logins. Scraper/provider metadata is not written to the
primary profile collections.

The profile form stores entered social links first, then saves the manual
persona snapshot using the returned canonical `userId`. Re-saving the same
`userId` and slot updates the existing document and increments its revision;
it does not create a duplicate. Exact external profile IDs also take priority
over a stale UI `userId`, so a retry cannot move one social identity to a new
user record.

The one-time `npm run migrate:social-schema` command migrates the original
schema without deleting it. Original documents and GridFS media are preserved
under `legacy_*` collections.

## Getting Started

Create a local environment file from the example and fill in the server-only
credentials for the two already-populated persona Vector Stores:

```bash
cp .env.example .env.local
```

`OPENAI_API_KEY`, `OPENAI_VECTOR_STORE_ID_A`, and
`OPENAI_VECTOR_STORE_ID_B` must remain in `.env.local`; they are never sent to
the browser. The app does not create Vector Stores, upload persona material,
or connect to a dating platform.

First, run the development server:

```bash
# This project uses the NVM default configured in ~/.zshrc (currently Node 22).
nvm use default
npm run dev
# or
yarn dev
# or
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

## Learn More

To learn more, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.
- [v0 Documentation](https://v0.app/docs) - learn about v0 and how to use it.

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

## WhatsApp data source

You can add your side of a WhatsApp chat as a second source for persona building. Nothing talks to
WhatsApp or Meta: you export a chat yourself and import the file.

**Export a chat**
- iPhone: open the chat, tap the contact or group name, then **Export Chat** and **Without Media**.
  Save the `.zip` (or `.txt`).
- Android: open the chat, then ⋮ → **More** → **Export chat** → **Without media**. Save the `.txt`.

**Import it** (from `backend/`):

```bash
.venv/bin/python scripts/import_whatsapp.py "<path to .txt or .zip>" <user_id> "<your name in the chat>"
```

- `<your name in the chat>` must be your name exactly as WhatsApp shows it in that chat (or your phone
  number if you aren't saved as a contact). Only your own messages are kept; everyone else's text is
  discarded while the file is parsed, and system, media and deleted-message lines are skipped.
- Use the same `<user_id>` as your Discord id to build one persona from both sources. The messages go to
  `data/raw/<user_id>_whatsapp.json`, next to `<user_id>_discord.json`.
- The date order (dd/mm or mm/dd) is inferred from the file (any day above 12). If the file can't tell,
  dd/mm is assumed and the script says so; rerun with `--date-order mdy` if that was wrong.
- Importing the same export again, or a newer one, only adds the new messages. Caps match Discord: 4,000
  characters per message and the newest 10,000 messages per import.
- Exports carry no timezone, so times are stored as written and labelled UTC.

The same import is available over HTTP: `POST /ingest/whatsapp` with
`{"user_id", "display_name", "export_text", "date_order"?}` and the `X-Ingest-Token` header when
`INGEST_TOKEN` is set.

`scripts/test_extraction.py <user_id>` then reads both files, merges them by time, uses the newest 10,000
messages (`PERSONA_MAX_MESSAGES`) and tells the model which sources they came from. Logs contain counts
and timings only, never message text.
