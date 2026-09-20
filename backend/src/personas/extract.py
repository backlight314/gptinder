import asyncio
import json
import logging
import os
import re
import time
from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timezone

from app.discord_store import DATA_DIR
from app.llm import extract_structured
from app.schemas import (
    MAX_MESSAGES_PER_REQUEST,
    CommunicationProfile,
    DecisionsProfile,
    EmotionsProfile,
    PreferencesProfile,
)

from .stats import compute_stats

logger = logging.getLogger(__name__)

RAW_DIR = DATA_DIR / "raw"
PROCESSED_DIR = DATA_DIR / "processed"

# The stats always cover every message; only the text sent to the LLM is capped
# (newest messages kept) so a very large export can't blow the context window.
MAX_RAW_CHARS = int(os.environ.get("PERSONA_MAX_RAW_CHARS", "60000"))

# The persona is built from the newest N messages across all sources: what one ingest request can hold.
MAX_PERSONA_MESSAGES = int(os.environ.get("PERSONA_MAX_MESSAGES", str(MAX_MESSAGES_PER_REQUEST)))

_USER_ID_RE = re.compile(r"^[A-Za-z0-9-]{1,64}$")

_GROUNDING_NOTE = (
    "These numbers were counted automatically over all of this person's messages. "
    "Use them to calibrate your judgment, but base the content of your answer on the text itself."
)


# ---------- loading ----------

@dataclass(frozen=True)
class UserMessage:
    text: str
    source: str  # "discord", "whatsapp", ... from the file name
    when: datetime | None  # None for files that store no timestamps


def _parse_when(value) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        when = datetime.fromisoformat(value)
    except ValueError:
        return None
    return when if when.tzinfo else when.replace(tzinfo=timezone.utc)


def load_user_records(user_id: str) -> list[UserMessage]:
    """Messages from every data/raw/<user_id>_<source>.json, merged into one oldest-to-newest list.

    Each file may hold {"messages": [...]} or a bare list; items are strings or {"content": ...}
    objects (extra fields such as message_id are ignored). Files without timestamps sort first, in file
    order. Files are assumed to contain only this user's messages.
    """
    if not _USER_ID_RE.match(user_id):
        raise ValueError(f"Invalid user_id: {user_id!r}")
    paths = sorted(RAW_DIR.glob(f"{user_id}_*.json"))
    if not paths:
        raise FileNotFoundError(f"No raw data found for user {user_id} in {RAW_DIR}")

    records: list[UserMessage] = []
    for path in paths:
        source = path.stem[len(user_id) + 1 :]
        data = json.loads(path.read_text())
        items = data["messages"] if isinstance(data, dict) else data
        for item in items:
            text = item.get("content") if isinstance(item, dict) else item
            if not isinstance(text, str):
                raise ValueError(f"Unrecognized message format in {path.name}: {item!r}")
            if text.strip():
                when = _parse_when(item.get("timestamp")) if isinstance(item, dict) else None
                records.append(UserMessage(text.strip(), source, when))
    floor = datetime.min.replace(tzinfo=timezone.utc)
    order = sorted(range(len(records)), key=lambda i: (records[i].when or floor, i))
    return [records[i] for i in order]


def load_user_messages(user_id: str) -> list[str]:
    """Just the message texts of load_user_records, oldest to newest."""
    return [r.text for r in load_user_records(user_id)]


def _newest_within_char_cap(messages: list[str]) -> list[str]:
    kept: list[str] = []
    total = 0
    for message in reversed(messages):
        if kept and total + len(message) + 1 > MAX_RAW_CHARS:
            break
        kept.append(message)
        total += len(message) + 1
    if len(kept) < len(messages):
        logger.warning(
            "Sending the newest %d of %d messages to the LLM (PERSONA_MAX_RAW_CHARS=%d)",
            len(kept), len(messages), MAX_RAW_CHARS,
        )
    return kept[::-1]


def _build_raw_text(messages: list[str]) -> str:
    return "\n".join(_newest_within_char_cap(messages))


_SOURCE_DESCRIPTIONS = {
    "discord": "Discord chat messages",
    "whatsapp": "WhatsApp messages (personal chats and groups)",
}


def _source_note(sources: dict[str, int] | None) -> str:
    """Tells the model where the messages came from; empty when the source counts aren't known."""
    if not sources:
        return ""
    parts = ", ".join(
        f"{count} {_SOURCE_DESCRIPTIONS.get(name, f'{name} messages')}" for name, count in sorted(sources.items())
    )
    return (
        f"\nSource context: these are all the person's own messages - {parts}. Chat messages, direct "
        "messages especially, are casual and short and can mix languages; judge style and depth relative "
        "to that, and do not read brevity, slang or switching languages as coldness or lack of substance."
    )


# ---------- grounding text ----------

def _emoji_cadence(frequency: float) -> str:
    if frequency <= 0:
        return "essentially never include an emoji"
    if frequency >= 1:
        return f"include about {frequency:.1f} emoji per message"
    return f"include an emoji roughly every {1 / frequency:.1f} messages"


# ---------- the four extraction calls ----------

async def extract_communication(raw_text: str, stats: dict, sources: dict[str, int] | None = None) -> dict:
    system = f"""Analyze this person's texting/writing style from the messages below.
Return tone, humor_style, typical_message_length, favorite_phrases, and emoji_usage,
based only on evidence in the text.

Grounding context: this person's messages average {stats['avg_message_length']:.1f} words
and {_emoji_cadence(stats['emoji_frequency'])}. {_GROUNDING_NOTE}{_source_note(sources)}"""
    result = await extract_structured(system, raw_text, CommunicationProfile)
    return result.model_dump()


async def extract_preferences(raw_text: str, stats: dict, sources: dict[str, int] | None = None) -> dict:
    system = f"""Extract this person's interests, hobbies, and values from the messages below.
Return interests, hobbies, values, and dislikes as short, concrete lists grounded in
the text - avoid generic filler like "having fun" or "meeting new people".{_source_note(sources)}"""
    result = await extract_structured(system, raw_text, PreferencesProfile)
    return result.model_dump()


async def extract_emotions(raw_text: str, stats: dict, sources: dict[str, int] | None = None) -> dict:
    system = f"""Analyze this person's emotional patterns from the messages below.
Return expressiveness, what_excites_them, what_makes_them_guarded, affection_style,
and conflict_style, based only on evidence in the text.

Grounding context (VADER sentiment scores run from -1 very negative to +1 very positive):
- average sentiment per message: {stats['avg_sentiment']:.2f}. Well above 0 suggests a
  generally upbeat register; near 0 suggests neutral or matter-of-fact messaging.
- sentiment variance: {stats['sentiment_variance']:.3f}. Higher means mood swings noticeably
  from message to message (volatile); lower means a steady, even tone.
- exclamation marks: {stats['exclamation_frequency']:.2f} per message. Higher suggests
  outward enthusiasm; very low suggests a more reserved delivery.
{_GROUNDING_NOTE}{_source_note(sources)}"""
    result = await extract_structured(system, raw_text, EmotionsProfile)
    return result.model_dump()


async def extract_decisions(raw_text: str, stats: dict, sources: dict[str, int] | None = None) -> dict:
    hedge = stats["hedge_word_ratio"] * 100
    decisive = stats["decisive_word_ratio"] * 100
    system = f"""Analyze how this person makes decisions from the messages below.
Return spontaneous_vs_deliberate, risk_tolerance, planning_style, and
how_they_handle_disagreement, based only on evidence in the text.

Grounding context:
- hedge words ("maybe", "probably", "not sure", "I guess", ...): {hedge:.2f} per 100 words.
  Higher suggests tentative, deliberate, or non-committal decision-making.
- decisive words ("definitely", "always", "let's", "already", ...): {decisive:.2f} per 100
  words. Higher suggests firm, action-oriented, quick-to-commit decision-making.
Compare the two: hedging well above decisiveness leans deliberate and cautious; the reverse
leans spontaneous and decisive. {_GROUNDING_NOTE}{_source_note(sources)}"""
    result = await extract_structured(system, raw_text, DecisionsProfile)
    return result.model_dump()


# ---------- the pipeline ----------

async def build_persona(user_id: str, name: str) -> dict:
    started = time.perf_counter()
    records = load_user_records(user_id)
    if not records:
        raise ValueError(f"User {user_id} has raw data files but no message text")

    found = len(records)
    records = records[-MAX_PERSONA_MESSAGES:]  # the newest N across every source
    texts = [r.text for r in records]
    stats = compute_stats(texts)
    kept = _newest_within_char_cap(texts)
    sent = records[len(records) - len(kept):]
    raw_text = "\n".join(kept)
    sources = dict(Counter(r.source for r in sent))
    logger.info(
        "build_persona: %d messages found, %d used for stats, %d (%d chars) sent to the LLM; sources=%s",
        found, len(records), len(sent), len(raw_text), sources,
    )

    communication, preferences, emotions, decisions = await asyncio.gather(
        extract_communication(raw_text, stats, sources),
        extract_preferences(raw_text, stats, sources),
        extract_emotions(raw_text, stats, sources),
        extract_decisions(raw_text, stats, sources),
    )

    persona = {
        "user_id": user_id,
        "name": name,
        "stats": stats,
        "communication": communication,
        "preferences": preferences,
        "emotions": emotions,
        "decisions": decisions,
    }

    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    path = PROCESSED_DIR / f"{user_id}_persona.json"
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(persona, indent=2, ensure_ascii=False))
    os.replace(tmp, path)
    logger.info("build_persona: done in %.1fs", time.perf_counter() - started)
    return persona
