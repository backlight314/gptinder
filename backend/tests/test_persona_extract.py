import asyncio
import json

import pytest

from app.schemas import (
    CommunicationProfile,
    DecisionsProfile,
    EmotionsProfile,
    PreferencesProfile,
)
from src.personas import extract

FAKES = {
    "CommunicationProfile": CommunicationProfile(
        tone="casual", humor_style="dry", typical_message_length="short",
        favorite_phrases=["for real"], emoji_usage="light",
    ),
    "PreferencesProfile": PreferencesProfile(
        interests=["film"], hobbies=["pottery"], values=["curiosity"], dislikes=["small talk"],
    ),
    "EmotionsProfile": EmotionsProfile(
        expressiveness="open", what_excites_them="travel", what_makes_them_guarded="being rushed",
        affection_style="teasing", conflict_style="direct",
    ),
    "DecisionsProfile": DecisionsProfile(
        spontaneous_vs_deliberate="spontaneous", risk_tolerance="high", planning_style="loose",
        how_they_handle_disagreement="talks it out",
    ),
}


@pytest.fixture
def data_dirs(tmp_path, monkeypatch):
    raw, processed = tmp_path / "raw", tmp_path / "processed"
    raw.mkdir()
    monkeypatch.setattr(extract, "RAW_DIR", raw)
    monkeypatch.setattr(extract, "PROCESSED_DIR", processed)
    return raw, processed


def write_raw(raw, name, payload):
    (raw / name).write_text(json.dumps(payload))


@pytest.fixture
def calls(monkeypatch):
    recorded = {}
    state = {"active": 0, "max_active": 0}

    async def fake_extract_structured(system, raw_text, output_model, model=None):
        state["active"] += 1
        state["max_active"] = max(state["max_active"], state["active"])
        await asyncio.sleep(0.01)
        state["active"] -= 1
        recorded[output_model.__name__] = {"system": system, "raw_text": raw_text}
        return FAKES[output_model.__name__]

    monkeypatch.setattr(extract, "extract_structured", fake_extract_structured)
    recorded["_state"] = state
    return recorded


async def test_build_persona_merges_sources_grounds_prompts_and_saves(data_dirs, calls):
    raw, processed = data_dirs
    write_raw(raw, "42_discord.json", {"user_id": "42", "source": "discord", "messages": [
        {"content": "Maybe we should go!", "timestamp": "2025-01-01T00:00:00+00:00"},
        {"content": "Definitely... let's do it \U0001F600", "timestamp": "2025-01-01T00:01:00+00:00"},
    ]})
    write_raw(raw, "42_whatsapp.json", ["ok", "  ", "not sure about that"])
    write_raw(raw, "420_discord.json", {"messages": [{"content": "SOMEONE ELSE", "timestamp": "x"}]})

    persona = await extract.build_persona("42", "Maya")

    assert list(persona) == [
        "user_id", "name", "stats", "communication", "preferences", "emotions", "decisions",
    ]
    assert persona["user_id"] == "42" and persona["name"] == "Maya"
    assert persona["stats"]["message_count"] == 4  # blank skipped, user 420 excluded
    assert persona["communication"] == FAKES["CommunicationProfile"].model_dump()

    saved = json.loads((processed / "42_persona.json").read_text())
    assert saved == persona

    # all four calls ran, concurrently, on the same merged text
    assert calls["_state"]["max_active"] == 4
    texts = {k: v["raw_text"] for k, v in calls.items() if k != "_state"}
    assert len(set(texts.values())) == 1
    blob = texts["CommunicationProfile"]
    assert "Maybe we should go!" in blob and "not sure about that" in blob
    assert "SOMEONE ELSE" not in blob

    s = persona["stats"]
    assert f"{s['avg_message_length']:.1f} words" in calls["CommunicationProfile"]["system"]
    assert "emoji roughly every" in calls["CommunicationProfile"]["system"]
    emotions = calls["EmotionsProfile"]["system"]
    assert f"{s['avg_sentiment']:.2f}" in emotions
    assert f"{s['sentiment_variance']:.3f}" in emotions
    assert f"{s['exclamation_frequency']:.2f}" in emotions
    decisions = calls["DecisionsProfile"]["system"]
    assert f"{s['hedge_word_ratio'] * 100:.2f} per 100 words" in decisions
    assert f"{s['decisive_word_ratio'] * 100:.2f} per 100" in decisions


async def test_missing_and_invalid_user(data_dirs, calls):
    with pytest.raises(FileNotFoundError):
        await extract.build_persona("999", "X")
    with pytest.raises(ValueError):
        await extract.build_persona("../etc", "X")


async def test_bad_message_shape_names_the_file(data_dirs, calls):
    raw, _ = data_dirs
    write_raw(raw, "7_scraped.json", {"messages": [{"text": "wrong key"}]})
    with pytest.raises(ValueError, match="7_scraped.json"):
        await extract.build_persona("7", "X")


def test_raw_text_cap_keeps_newest_messages(monkeypatch):
    monkeypatch.setattr(extract, "MAX_RAW_CHARS", 14)
    text = extract._build_raw_text(["oldest one", "middle", "newest"])
    assert text == "middle\nnewest"
