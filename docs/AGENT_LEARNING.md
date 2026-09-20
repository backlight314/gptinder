# Agent conversations and feedback

Ported from `feature/reaction-and-response-agents-per-user` (483acd4) onto main's existing services. The current `jeremy` checkout and its local changes were preserved.

Each participant has a frozen, evidence-linked psychology profile from the saved initial form. A Voice Prompt Builder reads owner-scoped MongoDB writing samples and produces system instructions. Those exact instructions are passed to the Persona Speaker. A separate Social Interpreter analyzes incoming messages through behavior, interpersonal, attachment/regulation, and values lenses before the speaker responds. Unmeasured psychological scores remain unknown.

The existing `OPENAI_API_KEY`, `OPENAI_MODEL_A`, `OPENAI_MODEL_B`, `OPENAI_REACTION_MODEL`, and vector-store connections remain supported. `OPENAI_MODEL` is a fallback. MongoDB connection settings and the Python import services are unchanged. Workflows make conversation and feedback processing durable on Vercel; `withWorkflow` is added around the existing Next configuration.

The AI Lab's Conversation log is shared, paginated, and independent of browser-local profile IDs. It includes all conversations persisted by this implementation. Earlier ephemeral conversations cannot be reconstructed. The existing shared badge directory remains unchanged.

After a completed conversation, “Did you go on a date?” → No hides the choices and makes no request; clicking the question reopens them. Yes reveals the quality question. A quality answer records one encounter-level report and runs separate adaptation calls for the two participants, as a shared demo report. This does not establish that both people independently reported the same experience. A production per-person feedback system would need authenticated attribution.

Learning is versioned prompt memory, not model-weight training. Only cues quoted from the other participant's messages can be learned. Good/bad reports set the cue direction; confidence remains low, conflicting evidence increases uncertainty, and unrelated messages should retain their baseline interpretation. Up to six recent cues are carried forward. The base profile is never rewritten. Unique keys prevent duplicate reports, repeated learning, and silent concurrent version overwrites. Failed updates can be retried; in-progress conversations retain their original adaptation versions.

Voice sources: `social_posts`, `discord_messages`, `whatsapp_messages`, `user_text_samples`, and owner profile text. Samples retain casing and punctuation. The existing Python Discord/WhatsApp ingest stores raw files; it is not silently changed into a MongoDB writer. For an owner-exported Discord file, run `node --env-file=.env.local scripts/import-discord-voice.mjs <application-user-id> <export.json>` to bridge its messages into the voice collection. MongoDB WhatsApp documents should have `userId`, `text`/`content`, and timestamps.

Research informs the representation and uncertainty limits; it does not validate these agents as psychological assessments or prove that changing prompts improves real dates. The compatibility display is an application rule over declared preferences, not a probability of relationship success.

References:

- OpenAI structured outputs: https://developers.openai.com/api/docs/guides/structured-outputs
- OpenAI evaluations and task-specific regression testing: https://developers.openai.com/api/docs/guides/evaluation-best-practices
- OpenAI prompt engineering and versioned prompts: https://developers.openai.com/api/docs/guides/prompt-engineering
- MongoDB atomic writes and unique constraints: https://www.mongodb.com/docs/manual/core/write-operations-atomicity/
- Joel, Eastwick & Finkel (2017), limits of pre-date prediction: https://doi.org/10.1177/0956797617714580
- Ringwald et al. (2022), measurement of personality states: https://doi.org/10.1177/10731911211008254
- The source implementation's remaining psychology references are retained beside the profile fields they informed.

Verification: `pnpm typecheck`, `pnpm test:run`, and `pnpm build`. Database tests use a temporary local MongoDB and mocked model outputs. An opt-in live test (`RUN_LIVE_AGENTS=1`, with API credentials, running `tests/agents.live.test.ts`) exercises real structured outputs with synthetic profiles; it is a smoke check, not a predictive-validity study. Track held-out, user-rated reaction/voice quality before claiming learned prompts improve fidelity.
