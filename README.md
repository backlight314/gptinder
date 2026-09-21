# Hack the Heart

> A conference badge that introduces two people, then lets their agents do the talking.

[Live app](https://hacktheheart.vercel.app) · [Devpost](https://devpost.com/software/airos-ca5l9u)

## Demo

[![Watch the Hack the Heart demo](https://img.youtube.com/vi/4g8lUuXfFBc/maxresdefault.jpg)](https://www.youtube.com/watch?v=4g8lUuXfFBc)

## Gallery

<table>
  <tr>
    <td align="center" width="50%">
      <img src="docs/images/dating-lab.png" alt="The Hack the Heart dating lab" width="100%"><br>
      <sub>The dating lab where you can make AIs go on a date!</sub>
    </td>
    <td align="center" width="50%">
      <img src="docs/images/person-selection.png" alt="Selecting a person for an AI agent to represent" width="100%"><br>
      <sub>Selecting a person to have an AI agent represent.</sub>
    </td>
  </tr>
  <tr>
    <td align="center" colspan="2">
      <img src="docs/images/agent-profile.png" alt="A person's representation in Hack the Heart" width="70%"><br>
      <sub>Seeing how that person is represented through our code.</sub>
    </td>
  </tr>
</table>

## Project specifications

| Spec | Value |
| --- | ---: |
| Conversation length | 6 turns |
| Agent roles per person | 4 |
| Reply cap | 45 words |
| Contacts per badge import | 250 |
| Inputs to the compatibility score | 5 |

## Inspiration

Finding a soul mate is a challenge (especially for programmers like us).

At a hackathon you walk past hundreds of people in three days, and you never find out who you would have clicked with. We were already wearing a badge that quietly remembers everyone we bump into, so we wanted that badge to do something useful with those names.

## What it does

Hack the Heart turns a badge bump into an introduction.

You can upload all your stored badge contacts to our server. Each person gets a profile built from the answers they approve themselves, along with their public posts. Two digital personalities constructed by AI agents, one acting for each person, then hold a short private conversation.

You can read the whole conversation, see why each agent said what it said, and see a compatibility score built from the answers both people actually gave. If you meet up for real afterwards, you tell the app how it went, and each person's agent learns from that.

## How we built it

### The badge

We read the contact files the badge writes, one per badge id. The app accepts an owner profile plus up to 250 contacts in a single batch. A preview step tells you what each contact will do before anything is saved, marking each one as new, filling missing fields, already known, or in conflict. Every route is rate limited. Any contact can be analyzed on demand to produce a headline, a summary, a list of interests, and exactly three conversation starters.

### The profile

Every person has a frozen profile built only from their own approved form answers. Every field carries an evidence id pointing back to the answer it came from. Public LinkedIn, Instagram and X posts are imported separately, and a Discord bot lets someone export their own messages.

### The conversation

Four agent roles run on one model.

1. **Social Interpreter.** Reads an incoming message through four psychological lenses and returns structured analysis, including how warm and how dominant the message reads. It is never allowed to write the visible reply.
2. **Voice Prompt Builder.** Studies the person's own writing and produces instructions about surface style only, such as casing, sentence length and punctuation.
3. **Persona Speaker.** Picks one action from a fixed list and writes one reply under 45 words.
4. **Reaction Adaptation Builder.** Runs after a real date is reported.

Vercel Workflow runs a fixed six turn sequence as durable steps, so any single step can retry safely.

### Keeping it honest

Zod validates every model reply. Evidence ids are checked against the stored profile and quotes are checked against the stored messages, and the turn fails if either check fails. MongoDB holds schema validators and unique indexes so a retry cannot create a duplicate. The compatibility score is calculated in plain TypeScript from the form answers, and both agents are forbidden from producing a score themselves.

## The compatibility score

We did not want every digital date to end well just because a model knows how to be polite. The Compatibility Analyst therefore returns categories, and plain TypeScript applies the same arithmetic every time.

For each person's reading of the conversation, five signals are converted to numbers:

| Signal | How the categories become numbers | Weight |
| --- | --- | ---: |
| Compatibility, C | Weak = 0, mixed = 50, strong = 100 | 25% |
| Friction, F | High = 0, moderate = 35, low = 70, none = 100 | 20% |
| Reciprocity, R | Weak = 0, mixed = 50, strong = 100 | 20% |
| Pacing, P | Mismatched = 0, mixed = 50, aligned = 100 | 15% |
| Connection, N | Absent = 0, uncertain = 50, present = 100 | 20% |

The base score for person i is:

```text
bᵢ = round(clamp[0,100](0.25Cᵢ + 0.20Fᵢ + 0.20Rᵢ + 0.15Pᵢ + 0.20Nᵢ))
```

The weights add up to one, so the result stays on a 0 to 100 scale. Friction runs backwards because more friction should contribute less. Compatibility gets the largest share, pacing the smallest, and the other three signals get equal shares. This makes the rule easy to inspect and tune. These are hand-set application weights, not coefficients fitted to successful relationships, and the code does not establish that these exact weights are optimal.

For example, strong compatibility, low friction, mixed reciprocity, aligned pacing and uncertain connection give:

```text
bᵢ = round(25 + 14 + 10 + 15 + 10) = 74
```

There is also a shared-ground rule. If either analyst marks shared ground as `limited`, both scores become 50. This represents a neutral outcome: enough conversation to find little common ground, without treating that as a hard conflict. `Unclear` is a separate category and does not trigger this rule.

| Condition | Score nᵢ |
| --- | ---: |
| Either analyst reports limited shared ground | 50 |
| Otherwise | bᵢ |

If both analysts report an agreement to meet, the code also puts a floor of 1 on each score. That only changes a zero; it does not turn an agreement into a high score. The final number is the rounded average:

| Condition | Score sᵢ |
| --- | ---: |
| Both meeting intents are agreed | max(1, nᵢ) |
| Otherwise | nᵢ |

```text
S = round((sₐ + sᵦ) / 2)
```

Meeting intent is stored separately. Both sides must say `agreed` for a mutual agreement. Either side saying `declined` makes it a decline. Otherwise, an `interested` response makes it interested, and the remaining cases are unclear. This keeps being willing to meet separate from the numeric score.

The arithmetic is reproducible for the same analyst outputs. The model's interpretation can still vary between runs. If the final analysis fails, the conversation can finish with no score.

The repository also retains the earlier form-answer score. It compares children, relationship type, planning, communication and whether the two people share at least one explicitly entered personal value. If K is the set of known comparisons and aⱼ is 1 for agreement and 0 for difference:

| Condition | Profile score |
| --- | --- |
| At least one known comparison | round(100 × sum(aⱼ) / number of known comparisons) |
| No known comparisons | null |

An unsure or undisclosed answer is left out. Personal values count as one comparison only when both people have entered values. Three agreements out of four known comparisons give 75, with coverage of four. We used this simple proportion so missing information would not automatically become a disagreement. Current conversations display the conversation analysis score instead. Neither number is a probability that a relationship will work.

## The research

| Researchers | What we used | Where it lives in the code |
| --- | --- | --- |
| Villanova University and Rutgers University | Warmth and dominance as two measures of how someone acts toward another person | Every interpreter reply must rate the incoming message on both |
| University of Pittsburgh | Behaviour on one occasion is a state, and states move | Temporary readings are stored apart from permanent profiles |
| University of Utah, UC Davis and Northwestern University | Attraction to one specific person cannot be predicted before two people meet | A date report is treated as evidence about one situation |
| UC Davis, Northwestern University and the University of Minnesota | Matching people on stated preferences predicts very little | A date result never becomes a personality score |

## Challenges we ran into

We initially wanted to make a new app, but to do that there would be no Wifi compatibility. To get around this we decided on allowing badges to be directly connected to your computer, passing on data rather than automating the process from an onboarded level.

Stopping the system from always having digital dates that end well. We needed to make sure that at least sometimes when the matches seemed very poor, even from an almost objective standpoint, that the agents would not allow their represented users to have a high and positive score. We needed to be a lot stricter on model calls and instructions.

Keeping model output trustworthy. A reply can match a schema perfectly and still quote a message that was never sent, so every reply is checked twice.

Durable retries. A step can run more than once, so every single write needed a stable key.

## Accomplishments that we're proud of

- Four cooperating agent roles that each have one job, one schema, and one set of permissions.
- Messages that read like the person wrote them, because the voice instructions come from that person's own posts and exports.
- A compatibility score that is reproducible, explainable line by line, and honest about what it is not.
- A learning loop that improves how an agent reads messages without ever rewriting who someone is.
- A full conversation log, so nothing the system did is hidden from you.

## What we learned

Psychology papers give you structure and rules. They do not give you a personality detector. The most valuable thing we took from them was knowing what we were not allowed to claim.

Valid JSON is not the same as a true statement, so we validate the content as well as the shape.

Keeping permanent facts and temporary observations in separate places solved more problems than any prompt we wrote.

Letting code decide the control flow and letting the model decide only the content made the whole system much easier to trust.

## What's next for Hack the Heart

Wouldn't it be cool if any AI agent could be uploaded to Hack the Heart? That could be pretty cool in the future.

Beyond that, we want to fill in the parts we deliberately left empty. Real questionnaires would give us measured personality and attachment scores instead of blank fields. We already measure warmth and dominance on every message, so the next step is acting on them, since research on couples shows people tend to match a partner's warmth and answer dominance with its opposite. More writing sources would also make each voice sharper.

## Built with

`Apify` · `Discord` · `FastAPI` · `Instagram` · `LinkedIn` · `MongoDB` · `Next.js` · `OpenAI` · `Python` · `React` · `Twitter` · `TypeScript` · `Vercel` · `WhatsApp` · `X` · `Zod`

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
