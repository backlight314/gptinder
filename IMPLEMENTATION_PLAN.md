# Two-agent conversation plan

The product should be a private, transparent dating copilot and compatibility
simulator—not an autonomous messaging integration. Both persona Vector Stores
are assumed to already contain approved, complete persona material. The
implementation in this change is deliberately limited to the two-agent
simulation layer.

## Delivery phases

1. **Runtime configuration.** Configure one server-side API key and the IDs of
   the two already-populated persona Vector Stores. Do not scrape or automate
   a dating service.
2. **Persona review.** Let users review the compact profile shown in the UI:
   identity, interests, values, boundaries, and conversation style. This is a
   search anchor and display summary; persona facts remain in the Vector Store.
3. **Private knowledge layer.** Query only the current speaker's existing
   Vector Store for relevant facts. Do not embed an entire history in every
   request or build ingestion into this application.
4. **Two-agent simulator and verdict (implemented).** Keep credentials server-side; give
   each agent its own persona and the shared transcript; alternate turns;
   then let each agent independently assess the completed conversation. Display
   both perspectives and their server-calculated average score. The simulator
   supports a natural scenario and a civil built-in-friction scenario so poor
   chemistry, disagreement, and failure to connect are represented as valid
   outcomes. It is a contained simulation and cannot send messages externally.
5. **Evaluation.** Build a small review set of persona prompts and assess
   faithfulness, factuality, tone, safety, and cost. Improve prompt/context
   retrieval before considering fine-tuning.
6. **User-controlled copilot.** If added later, generate candidate replies
   from user-provided conversation text for the user to edit and send
   themselves. Do not build direct or automatic messages to dating platforms.

## Implemented request flow

1. The date screen posts the two profile snapshots to
   `/api/match/conversation`.
2. The server alternates exactly six Responses API calls, passing the transcript
   to the next speaker on each turn.
3. After the final turn, each agent retrieves only its own persona context and
   returns a structured, grounded analysis of compatibility, friction,
   reciprocity, pacing, and connection. The analysis then produces one of four
   meeting-intent states: `agreed`, `interested`, `declined`, or `unclear`.
4. The server averages the two model scores, preserves the analyzed signals,
   and guarantees that mutual explicit agreement cannot produce a zero score.
5. The server returns the transcript, verdicts, meeting intent, and combined score for the UI
   to render. If either verdict fails, it returns the transcript and an
   unavailable-verdict state instead. No external message is sent or stored.

## Configuration

Create `.env.local` (never commit it):

```bash
OPENAI_API_KEY=your_server_side_key
# Optional model overrides; both agents use the one key above.
OPENAI_MODEL_A=gpt-5
OPENAI_MODEL_B=gpt-5
```

Both agents use `OPENAI_API_KEY`; the browser never receives it.
