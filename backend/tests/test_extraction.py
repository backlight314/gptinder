import pytest

from app import extraction
from app.schemas import (
    CommunicationProfile,
    DecisionsProfile,
    EmotionsProfile,
    PreferencesProfile,
)

FAKE_COMM = CommunicationProfile(
    tone="casual",
    humor_style="dry",
    typical_message_length="short",
    favorite_phrases=["lol", "for real"],
    emoji_usage="light",
)
FAKE_PREFS = PreferencesProfile(
    interests=["ceramics"], hobbies=["pottery"], values=["curiosity"], dislikes=["small talk"]
)
FAKE_EMOTIONS = EmotionsProfile(
    expressiveness="open",
    what_excites_them="new cities",
    what_makes_them_guarded="being rushed",
    affection_style="words of affirmation",
    conflict_style="direct but kind",
)
FAKE_DECISIONS = DecisionsProfile(
    spontaneous_vs_deliberate="spontaneous",
    risk_tolerance="high",
    planning_style="loose",
    how_they_handle_disagreement="talks it out immediately",
)


@pytest.mark.asyncio
async def test_build_persona_runs_all_four_extractions_in_parallel(monkeypatch):
    calls: list[str] = []

    async def fake_extract_structured(system, raw_text, output_model, model=None):
        calls.append(output_model.__name__)
        return {
            "CommunicationProfile": FAKE_COMM,
            "PreferencesProfile": FAKE_PREFS,
            "EmotionsProfile": FAKE_EMOTIONS,
            "DecisionsProfile": FAKE_DECISIONS,
        }[output_model.__name__]

    monkeypatch.setattr(extraction, "extract_structured", fake_extract_structured)

    persona = await extraction.build_persona("some raw text", name="Maya")

    assert persona.name == "Maya"
    assert persona.communication == FAKE_COMM
    assert persona.preferences == FAKE_PREFS
    assert persona.emotions == FAKE_EMOTIONS
    assert persona.decisions == FAKE_DECISIONS
    assert sorted(calls) == sorted(
        ["CommunicationProfile", "PreferencesProfile", "EmotionsProfile", "DecisionsProfile"]
    )
