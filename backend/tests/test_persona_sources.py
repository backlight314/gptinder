import json
import logging

import pytest

from app import whatsapp_store
from src.personas import extract
from tests.test_extraction import FAKE_COMM, FAKE_DECISIONS, FAKE_EMOTIONS, FAKE_PREFS
from tests.test_whatsapp_parser import IPHONE, LEAK, OTHER, THIRD, USER

UID = "777"
FAKES = {
    "CommunicationProfile": FAKE_COMM,
    "PreferencesProfile": FAKE_PREFS,
    "EmotionsProfile": FAKE_EMOTIONS,
    "DecisionsProfile": FAKE_DECISIONS,
}


@pytest.fixture
def raw_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(extract, "RAW_DIR", tmp_path)
    monkeypatch.setattr(extract, "PROCESSED_DIR", tmp_path / "processed")
    monkeypatch.setattr(whatsapp_store, "RAW_DIR", tmp_path)
    return tmp_path


@pytest.fixture
def prompts(monkeypatch):
    seen = []

    async def fake_extract_structured(system, raw_text, output_model, model=None):
        seen.append({"system": system, "raw_text": raw_text})
        return FAKES[output_model.__name__]

    monkeypatch.setattr(extract, "extract_structured", fake_extract_structured)
    return seen


def write(raw_dir, source, messages, user_id=UID):
    (raw_dir / f"{user_id}_{source}.json").write_text(
        json.dumps({"user_id": user_id, "source": source, "messages": messages})
    )


def msg(text, minute, message_id=None):
    doc = {"content": text, "timestamp": f"2025-03-01T10:{minute:02d}:00+00:00"}
    if message_id:
        doc["message_id"] = message_id
    return doc


def write_both(raw_dir):
    write(raw_dir, "discord", [msg("discord one", 1, "900000000000000001"), msg("discord two", 5, "900000000000000002")])
    write(raw_dir, "whatsapp", [msg("whatsapp one", 2), msg("whatsapp two", 3), msg("whatsapp three", 9)])


async def test_both_sources_are_read_together_and_merged_by_timestamp(raw_dir, prompts):
    write_both(raw_dir)
    persona = await extract.build_persona(UID, "Maya")
    assert len(prompts) == 4
    assert {p["raw_text"] for p in prompts} == {"discord one\nwhatsapp one\nwhatsapp two\ndiscord two\nwhatsapp three"}
    assert persona["stats"]["message_count"] == 5
    assert not any("900000000000000001" in p["raw_text"] + p["system"] for p in prompts)  # ids never reach a prompt


async def test_every_prompt_says_which_sources_the_messages_came_from(raw_dir, prompts):
    write_both(raw_dir)
    await extract.build_persona(UID, "Maya")
    for p in prompts:
        assert "Source context" in p["system"]
        assert "2 Discord chat messages" in p["system"] and "3 WhatsApp messages" in p["system"]
        assert "casual and short and can mix languages" in p["system"]


async def test_a_discord_only_persona_still_works_and_names_only_discord(raw_dir, prompts):
    write(raw_dir, "discord", [msg("alpha", 1), msg("beta", 2)])
    persona = await extract.build_persona(UID, "Maya")
    assert list(persona) == ["user_id", "name", "stats", "communication", "preferences", "emotions", "decisions"]
    assert persona["stats"]["message_count"] == 2
    for p in prompts:
        assert "2 Discord chat messages" in p["system"] and "WhatsApp" not in p["system"]
        assert p["raw_text"] == "alpha\nbeta"


async def test_a_whatsapp_only_persona_works_too(raw_dir, prompts):
    write(raw_dir, "whatsapp", [msg("gamma", 1), msg("delta", 2), msg("epsilon", 3)])
    await extract.build_persona(UID, "Maya")
    for p in prompts:
        assert "3 WhatsApp messages" in p["system"] and "Discord" not in p["system"]


async def test_the_persona_uses_only_the_newest_n_messages_across_sources(raw_dir, prompts, monkeypatch):
    write_both(raw_dir)
    monkeypatch.setattr(extract, "MAX_PERSONA_MESSAGES", 3)
    persona = await extract.build_persona(UID, "Maya")
    assert prompts[0]["raw_text"] == "whatsapp two\ndiscord two\nwhatsapp three"
    assert persona["stats"]["message_count"] == 3
    assert "1 Discord chat messages" in prompts[0]["system"] and "2 WhatsApp messages" in prompts[0]["system"]


async def test_the_default_message_cap_is_what_one_ingest_request_can_hold(raw_dir):
    assert extract.MAX_PERSONA_MESSAGES == 10_000


async def test_source_counts_describe_what_was_actually_sent_after_the_character_cap(raw_dir, prompts, monkeypatch):
    write_both(raw_dir)
    monkeypatch.setattr(extract, "MAX_RAW_CHARS", 30)  # room for the newest two messages only
    await extract.build_persona(UID, "Maya")
    assert prompts[0]["raw_text"] == "discord two\nwhatsapp three"
    assert "1 Discord chat messages" in prompts[0]["system"] and "1 WhatsApp messages" in prompts[0]["system"]


async def test_files_without_timestamps_sort_first_and_do_not_break_merging(raw_dir, prompts):
    (raw_dir / f"{UID}_whatsapp.json").write_text(json.dumps(["legacy one", "legacy two"]))  # old bare-list format
    write(raw_dir, "discord", [msg("dated", 1)])
    await extract.build_persona(UID, "Maya")
    assert prompts[0]["raw_text"] == "legacy one\nlegacy two\ndated"


async def test_a_real_whatsapp_import_never_puts_other_peoples_text_in_a_prompt_or_the_saved_persona(raw_dir, prompts, caplog):
    from app.whatsapp_parser import parse_whatsapp_export

    whatsapp_store.save_whatsapp_messages(UID, parse_whatsapp_export(IPHONE, USER).messages)
    write(raw_dir, "discord", [msg("a discord line", 0)])
    with caplog.at_level(logging.DEBUG):
        await extract.build_persona(UID, "Maya")
    seen = "".join(p["system"] + p["raw_text"] for p in prompts)
    saved = (raw_dir / "processed" / f"{UID}_persona.json").read_text()
    for text in (seen, saved, caplog.text):
        assert LEAK not in text and OTHER not in text and THIRD not in text
    assert "see you then" in seen  # the user's own WhatsApp text is there


async def test_logs_carry_counts_and_timings_but_never_message_text(raw_dir, prompts, caplog):
    write_both(raw_dir)
    with caplog.at_level(logging.INFO):
        await extract.build_persona(UID, "Maya")
    assert "5 messages found" in caplog.text and "sources=" in caplog.text
    assert not any(t in caplog.text for t in ("discord one", "whatsapp two"))
