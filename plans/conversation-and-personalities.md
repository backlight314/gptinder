# Conversation and personality implementation plan

## Goal

Create a private compatibility simulation in which two LLM agents converse from
two explicit personality profiles. The simulation helps a user explore tone,
shared interests, and conversational fit. It does not connect to, scrape, or
send messages through any dating platform.

## Guiding constraints

- Each personality is supplied or reviewed by its owner.
- The agents may only use details supplied in their profile and the current
  conversation transcript.
- The simulation is clearly labeled AI-to-AI and is never represented as a
  real conversation.
- A single server-side `OPENAI_API_KEY` powers both agents. It is never sent to
  the browser or stored in the database.
- Imported public posts may provide a compact, server-side voice reference.
  They calibrate tone and pacing only; the reviewed persona remains the source
  of truth for facts.
- Each agent may also have its own OpenAI Vector Store of approved persona
  material.
- The current MVP retains no conversation after its HTTP request completes;
  imported social posts remain in MongoDB and are read as bounded references.

## Persona model

Every participant begins with a compact, structured snapshot:

```ts
type Persona = {
  name: string
  bio: string
  traits: string[]
  interests: string[]
  style: string
}
```

### Meaning of each field

| Field | Purpose | Example |
| --- | --- | --- |
| `name` | Identifies the simulated speaker in the transcript. | `Maya` |
| `bio` | Grounds the agent in a concise self-description. | `Ceramicist who loves small adventures.` |
| `traits` | Sets interpersonal energy and decision tendencies. | `Warm`, `Curious`, `Direct` |
| `interests` | Supplies concrete conversation material. | `street food`, `indie films` |
| `style` | Directs language, pacing, humor, and message length. | `Informal, playful, concise` |

Profiles must describe present, user-confirmed information. The agent should
not invent history, location, preferences, or real-world commitments that are
not in the snapshot.

## Conversation loop

```text
Profile A + Profile B
          |
          v
Browser posts both snapshots to /api/match/conversation
          |
          v
Server builds Agent A's instructions + empty transcript
          |
          v
Agent A generates one short message
          |
          v
Server appends it to the transcript
          |
          v
Agent B receives its own instructions + updated transcript
          |
          v
Repeat, alternating speakers for the requested number of turns
          |
          v
Return transcript to browser for display
```

The server rebuilds the appropriate agent instruction set on every turn. That
keeps the personality boundary explicit and means neither agent inherits
unrelated hidden state.

## Compatibility verdict

After the final conversation turn, each agent independently reflects on the
same finished transcript. This is a simulated assessment—not a prediction of
a real relationship, a recommendation to contact someone, or a message for
sending.

```text
Completed shared transcript
          |
          +--> Agent A: A's snapshot + A's Vector Store context + transcript
          |        --> A's structured verdict and score
          |
          +--> Agent B: B's snapshot + B's Vector Store context + transcript
                   --> B's structured verdict and score
          |
          v
Server validates both verdicts and calculates their rounded arithmetic mean
          |
          v
Browser renders the conversation, then both verdicts and the combined score
```

### Verdict contract

Each verdict uses this server-validated shape:

```ts
type CompatibilityVerdict = {
  score: number // integer from 0 through 100
  summary: string // at most 60 words
  strengths: string[] // 1–3 grounded observations
  considerations: string[] // 0–2 grounded observations
}
```

The end-of-conversation UI will show each agent's perspective and score, plus
a **combined compatibility score** calculated by the server as
`Math.round((a.score + b.score) / 2)`. A third model must not generate that
combined score. Label it as an AI simulation based on one short conversation,
not an objective measure or real-world promise.

### Implementation requirements

1. Retrieve fresh context separately for each speaker using only that
   speaker's configured Vector Store. Never include one agent's retrieved
   material in the other agent's verdict prompt.
2. Supply the completed transcript and the current speaker's five-field
   snapshot. A verdict may cite only evidence from those inputs.
3. Request structured JSON using the Responses API JSON-schema output mode,
   then validate score bounds, item counts, word limits, and strings before
   returning it.
4. Instruct both agents to avoid invented preferences, diagnoses, real-world
   plans, certainty claims, or pressure to either participant.
5. Run verdict calls only after every requested conversation turn succeeds. If
   either verdict is unavailable, return the transcript and display a clear
   “verdict unavailable” state rather than fabricating a score.
6. Account for the two extra model calls in loading UI, latency, and cost
   evaluation. This MVP still persists neither transcript nor verdict.

## Current implementation

`app/api/match/conversation/route.ts` implements this loop.

1. The UI sends two persona snapshots and a turn count (six by default).
2. The API accepts between two and ten turns.
3. Before every turn, the API loads the current speaker's recent imported
   posts from MongoDB as a bounded voice-and-pacing reference. If configured,
   it also semantically searches that speaker's Vector Store.
4. It passes the bounded social samples, retrieved text chunks, snapshot, and
   transcript to that speaker's Responses API request.
5. The prompt requires one respectful message of at most 35 words and forbids
   claims outside the snapshot or retrieved material.
6. The transcript is returned as JSON and rendered by the date screen.
7. After the final turn, the API returns both grounded assessments and a
   server-calculated combined compatibility score as described above. The
   verdict rubric scores reciprocal substance and conversational fit, not
   generic politeness or agreement, and requires at least one concrete
   consideration. If a verdict cannot be produced, it still returns the
   transcript and marks the verdict unavailable.

## Retrieval setup

Persona documents may be indexed in two OpenAI Vector Stores: one for Agent A
and one for Agent B. This application does not create stores or upload files.
Social-post voice memory works without them; add existing IDs to the local
ignored environment file when available:

```bash
OPENAI_VECTOR_STORE_ID_A=vs_...
OPENAI_VECTOR_STORE_ID_B=vs_...
```

The server queries the appropriate store on every turn with
`rewrite_query=true`, receives up to three semantic-search results, and limits
the included context to 6,000 characters. Keep personal data out of the other
agent's store: Agent A's retrieved material is never included in Agent B's
prompt, and vice versa.

## Personality onboarding plan

### Phase 1 — explicit profile editor

Replace the existing sample-only profile flow with editable fields for the
five persona attributes above. Show a preview of the exact profile the agent
will receive before allowing a simulation.

### Phase 2 — style calibration

Let the user add a small set of their own example messages and label each with
context such as `opening`, `playful`, `curious`, or `making plans`. Extract a
short, editable style summary rather than copying raw message history into
every prompt.

### Phase 3 — preferences and boundaries

Add user-reviewed preferences, values, conversation boundaries, and topics to
avoid. Include only relevant items in a simulation prompt.

### Phase 4 — evaluation

Create a test set of persona pairs and review generated conversations for:

- factual grounding in each supplied profile;
- recognizable but non-caricatured communication style;
- reciprocal curiosity and respect;
- no fabricated facts, promises, or real-world arrangements; and
- evidence-backed verdict scores with appropriately cautious language; and
- acceptable latency and per-simulation cost.

Improve profile quality and prompt design from these results before adding
long-term memory or fine-tuning.

## Future data model

When persistence is needed, use user-owned records rather than a single raw
data dump:

```text
personas
  id, owner_id, name, bio, style_summary, updated_at

persona_traits
  persona_id, trait, confidence

persona_interests
  persona_id, interest, importance

style_examples
  persona_id, context, example_text, approved_at

conversation_runs
  id, persona_a_id, persona_b_id, created_at, retention_until

conversation_messages
  run_id, speaker, text, turn_number
```

Encrypt any future application-owned content, make deletion straightforward,
and apply a retention period. Retrieval is already provided by the two
pre-populated, user-approved Vector Stores; future work only needs to expose
retrieved context for review in the UI.
