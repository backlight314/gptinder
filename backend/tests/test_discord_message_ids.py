import json

import pytest
from fastapi.testclient import TestClient

from app import discord_store, main
from src.personas import extract
from src.personas.stats import compute_stats
from tests.test_date_agent import make_persona
from tests.test_extraction import FAKE_COMM, FAKE_DECISIONS, FAKE_EMOTIONS, FAKE_PREFS

client = TestClient(main.app)
UID = "123456789012345678"


@pytest.fixture
def raw_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(discord_store, "RAW_DIR", tmp_path)
    monkeypatch.setattr(extract, "RAW_DIR", tmp_path)
    monkeypatch.setattr(extract, "PROCESSED_DIR", tmp_path / "processed")
    monkeypatch.delenv("INGEST_TOKEN", raising=False)
    return tmp_path


def msg(content, minute, message_id=None):
    doc = {"content": content, "timestamp": f"2025-02-01T09:{minute:02d}:00+00:00"}
    if message_id is not None:
        doc["message_id"] = message_id
    return doc


def post(*messages, user_id=UID):
    return client.post(
        "/ingest/discord", json={"user_id": user_id, "source": "discord", "messages": list(messages)}
    )


def stored(raw_dir, user_id=UID):
    return json.loads((raw_dir / f"{user_id}_discord.json").read_text())["messages"]


def write_old_export(raw_dir, user_id=UID):
    """An export written before message ids existed: only content + timestamp."""
    old = {"user_id": user_id, "source": "discord", "messages": [msg("alpha one", 1), msg("beta two", 2)]}
    (raw_dir / f"{user_id}_discord.json").write_text(json.dumps(old))


BATCH = [
    msg("alpha one", 1, "900000000000000001"),
    msg("beta two", 2, "900000000000000002"),
    msg("gamma three", 3, "900000000000000003"),
]


# ---- ingest with ids ----

def test_ingest_with_ids_keeps_the_id_in_the_stored_file(raw_dir):
    response = post(*BATCH)
    assert response.status_code == 200
    assert response.json() == {"user_id": UID, "added": 3, "total": 3}
    docs = stored(raw_dir)
    assert [d["message_id"] for d in docs] == ["900000000000000001", "900000000000000002", "900000000000000003"]
    assert all(isinstance(d["message_id"], str) for d in docs)
    assert [d["content"] for d in docs] == ["alpha one", "beta two", "gamma three"]


def test_resending_the_same_history_creates_no_duplicates(raw_dir):
    post(*BATCH)
    before = (raw_dir / f"{UID}_discord.json").read_text()
    again = post(*BATCH)
    assert again.json() == {"user_id": UID, "added": 0, "total": 3}
    assert (raw_dir / f"{UID}_discord.json").read_text() == before


def test_only_unseen_ids_are_added(raw_dir):
    post(BATCH[0], BATCH[1])
    response = post(BATCH[1], BATCH[2])
    assert response.json() == {"user_id": UID, "added": 1, "total": 3}
    assert {d["message_id"] for d in stored(raw_dir)} == {b["message_id"] for b in BATCH}


def test_duplicate_ids_inside_one_batch_are_added_once(raw_dir):
    response = post(BATCH[0], BATCH[0])
    assert response.json()["added"] == 1 and response.json()["total"] == 1


def test_the_id_is_the_identity_so_an_edited_message_is_not_added_again(raw_dir):
    post(msg("first draft", 1, "900000000000000009"))
    response = post(msg("edited text", 1, "900000000000000009"))
    assert response.json() == {"user_id": UID, "added": 0, "total": 1}
    assert stored(raw_dir)[0]["content"] == "first draft"


def test_same_text_and_time_with_different_ids_are_both_kept(raw_dir):
    response = post(msg("ok", 5, "900000000000000011"), msg("ok", 5, "900000000000000012"))
    assert response.json() == {"user_id": UID, "added": 2, "total": 2}


# ---- ingest without ids: unchanged behaviour ----

def test_ingest_without_ids_still_works_and_stores_no_id(raw_dir):
    response = post(msg("alpha one", 1), msg("beta two", 2))
    assert response.json() == {"user_id": UID, "added": 2, "total": 2}
    assert all("message_id" not in d for d in stored(raw_dir))
    again = post(msg("alpha one", 1), msg("gamma three", 3))
    assert again.json() == {"user_id": UID, "added": 1, "total": 3}  # deduped by (timestamp, text)


def test_an_id_less_resend_of_a_message_stored_with_an_id_is_skipped(raw_dir):
    post(BATCH[0])
    assert post(msg("alpha one", 1)).json() == {"user_id": UID, "added": 0, "total": 1}


# ---- old exports ----

def test_an_old_export_without_ids_still_loads(raw_dir, monkeypatch):
    write_old_export(raw_dir)
    assert [m["content"] for m in discord_store.load_discord_messages(UID)] == ["alpha one", "beta two"]
    assert extract.load_user_messages(UID) == ["alpha one", "beta two"]

    seen = {}

    async def fake_build_persona(raw_text, name):
        seen["raw_text"] = raw_text
        return make_persona(name)

    monkeypatch.setattr(main, "build_persona", fake_build_persona)
    response = client.post("/personality", json={"name": "Maya", "discord_user_id": UID})
    assert response.status_code == 200
    assert "alpha one\nbeta two" in seen["raw_text"]


def test_resending_an_old_export_with_ids_attaches_ids_without_duplicating(raw_dir):
    write_old_export(raw_dir)
    response = post(
        msg("alpha one", 1, "900000000000000021"),
        msg("beta two", 2, "900000000000000022"),
        msg("new three", 3, "900000000000000023"),
    )
    assert response.json() == {"user_id": UID, "added": 1, "total": 3}
    docs = stored(raw_dir)
    assert [(d["content"], d["message_id"]) for d in docs] == [
        ("alpha one", "900000000000000021"),
        ("beta two", "900000000000000022"),
        ("new three", "900000000000000023"),
    ]
    assert post(msg("alpha one", 1, "900000000000000021")).json()["added"] == 0  # now deduped by id


# ---- validation ----

@pytest.mark.parametrize("bad", ["", "x" * 129, 900000000000000001, ["1"]])
def test_message_id_must_be_a_non_empty_string_up_to_128_chars(raw_dir, bad):
    assert post({"content": "hi", "timestamp": "2025-02-01T09:00:00Z", "message_id": bad}).status_code == 422
    assert not (raw_dir / f"{UID}_discord.json").exists()


def test_message_id_accepts_non_numeric_ids_up_to_the_limit(raw_dir):
    assert post(msg("hi", 1, "wamid." + "A" * 100)).status_code == 200


# ---- ids never reach a prompt, the stats, or the saved persona ----

def test_personality_endpoint_builds_its_text_from_content_only(raw_dir, monkeypatch):
    post(*BATCH)
    seen = {}

    async def fake_build_persona(raw_text, name):
        seen["raw_text"] = raw_text
        return make_persona(name)

    monkeypatch.setattr(main, "build_persona", fake_build_persona)
    assert client.post("/personality", json={"name": "Maya", "discord_user_id": UID}).status_code == 200
    assert "alpha one\nbeta two\ngamma three" in seen["raw_text"]
    assert not any(b["message_id"] in seen["raw_text"] for b in BATCH)


async def test_no_message_id_reaches_any_extraction_prompt_or_the_saved_persona(raw_dir, monkeypatch):
    post(*BATCH)
    prompts = []
    fakes = {
        "CommunicationProfile": FAKE_COMM,
        "PreferencesProfile": FAKE_PREFS,
        "EmotionsProfile": FAKE_EMOTIONS,
        "DecisionsProfile": FAKE_DECISIONS,
    }

    async def fake_extract_structured(system, raw_text, output_model, model=None):
        prompts.append(system + "\n" + raw_text)
        return fakes[output_model.__name__]

    monkeypatch.setattr(extract, "extract_structured", fake_extract_structured)
    persona = await extract.build_persona(UID, "Maya")

    assert len(prompts) == 4
    ids = [b["message_id"] for b in BATCH]
    assert not any(i in p for i in ids for p in prompts)
    assert not any(i in json.dumps(persona) for i in ids)
    saved = (raw_dir / "processed" / f"{UID}_persona.json").read_text()
    assert not any(i in saved for i in ids)
    assert persona["stats"]["message_count"] == 3


def test_loader_and_stats_ignore_the_id_field(raw_dir):
    post(*BATCH, user_id="111")  # with ids
    post(*[msg(b["content"], int(b["timestamp"][14:16])) for b in BATCH], user_id="222")  # same text, no ids
    with_ids, without_ids = extract.load_user_messages("111"), extract.load_user_messages("222")
    assert with_ids == without_ids == ["alpha one", "beta two", "gamma three"]
    assert all(isinstance(x, str) for x in with_ids)
    assert compute_stats(with_ids) == compute_stats(without_ids)
