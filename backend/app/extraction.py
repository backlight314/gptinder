import asyncio

from .llm import extract_structured
from .schemas import (
    CommunicationProfile,
    DecisionsProfile,
    EmotionsProfile,
    Persona,
    PreferencesProfile,
)

COMMUNICATION_SYSTEM = """Analyze this person's texting/writing style from the text below.
Return tone, humor_style, typical_message_length, favorite_phrases, and emoji_usage,
based only on evidence in the text. If something isn't evident, make a reasonable
inference and say so briefly in that field rather than leaving it generic."""

PREFERENCES_SYSTEM = """Extract this person's interests, hobbies, and values from the text below.
Return interests, hobbies, values, and dislikes as short, concrete lists grounded in
the text - avoid generic filler like "having fun" or "meeting new people"."""

EMOTIONS_SYSTEM = """Analyze this person's emotional patterns from the text below.
Return expressiveness, what_excites_them, what_makes_them_guarded, affection_style,
and conflict_style, based only on evidence in the text."""

DECISIONS_SYSTEM = """Analyze how this person makes decisions from the text below.
Return spontaneous_vs_deliberate, risk_tolerance, planning_style, and
how_they_handle_disagreement, based only on evidence in the text."""


async def extract_communication(raw_text: str) -> CommunicationProfile:
    return await extract_structured(COMMUNICATION_SYSTEM, raw_text, CommunicationProfile)


async def extract_preferences(raw_text: str) -> PreferencesProfile:
    return await extract_structured(PREFERENCES_SYSTEM, raw_text, PreferencesProfile)


async def extract_emotions(raw_text: str) -> EmotionsProfile:
    return await extract_structured(EMOTIONS_SYSTEM, raw_text, EmotionsProfile)


async def extract_decisions(raw_text: str) -> DecisionsProfile:
    return await extract_structured(DECISIONS_SYSTEM, raw_text, DecisionsProfile)


async def build_persona(raw_text: str, name: str) -> Persona:
    communication, preferences, emotions, decisions = await asyncio.gather(
        extract_communication(raw_text),
        extract_preferences(raw_text),
        extract_emotions(raw_text),
        extract_decisions(raw_text),
    )
    return Persona(
        name=name,
        communication=communication,
        preferences=preferences,
        emotions=emotions,
        decisions=decisions,
    )
