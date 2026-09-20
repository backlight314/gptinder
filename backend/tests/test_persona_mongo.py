import json
import logging

import pytest

from src.personas import extract, mongo_store
from tests.test_persona_extract import FAKES, data_dirs, write_raw  # noqa: F401  (fixtures)

SECRET_TEXT = "my very private message about pottery"


class FakeCollection:
    def __init__(self):
        self.docs = {}
        self.indexes = []

    def create_index(self, keys, **kwargs):
        self.indexes.append((keys, kwargs))

    def update_one(self, filter, update, upsert=False):
        doc = self.docs.get(filter["user_id"])
        if doc is None:
            assert upsert
            doc = {"_id": len(self.docs) + 1, **update.get("$setOnInsert", {})}
            self.docs[filter["user_id"]] = doc
        doc.update(update["$set"])
        for key, by in update.get("$inc", {}).items():
            doc[key] = doc.get(key, 0) + by


@pytest.fixture
def fake_mongo(monkeypatch):
    collection = FakeCollection()
    monkeypatch.setenv("MONGODB_URI", "placeholder-not-a-real-uri")
    monkeypatch.setattr(mongo_store, "_collection", lambda: collection)
    monkeypatch.setattr(mongo_store, "_index_ready", False)
    return collection


@pytest.fixture
def fake_llm(monkeypatch):
    async def fake_extract_structured(system, raw_text, output_model, model=None):
        return FAKES[output_model.__name__]

    monkeypatch.setattr(extract, "extract_structured", fake_extract_structured)


def _write_messages(raw):
    write_raw(raw, "42_discord.json", {"user_id": "42", "source": "discord", "messages": [
        {"content": SECRET_TEXT, "message_id": "998877665544", "timestamp": "2025-01-01T00:00:00+00:00"},
    ]})
    write_raw(raw, "42_whatsapp.json", ["ok sounds good"])


async def test_first_save_creates_then_second_updates_and_bumps_revision(data_dirs, fake_llm, fake_mongo):
    raw, _ = data_dirs
    _write_messages(raw)

    await extract.build_persona("42", "Maya")
    doc = fake_mongo.docs["42"]
    assert doc["revision"] == 1
    assert doc["sources"] == {"discord": 1, "whatsapp": 1}
    created = doc["createdAt"]

    await extract.build_persona("42", "Maya")
    assert len(fake_mongo.docs) == 1
    assert fake_mongo.docs["42"]["revision"] == 2
    assert fake_mongo.docs["42"]["createdAt"] == created


async def test_stored_document_has_only_derived_fields(data_dirs, fake_llm, fake_mongo):
    raw, _ = data_dirs
    _write_messages(raw)

    await extract.build_persona("42", "Maya")
    doc = fake_mongo.docs["42"]

    assert set(doc) == {
        "_id", "user_id", "communication", "preferences", "emotions", "decisions",
        "stats", "sources", "revision", "createdAt", "updatedAt",
    }
    dumped = json.dumps(doc, default=str)
    assert SECRET_TEXT not in dumped
    assert "998877665544" not in dumped
    assert "message_id" not in dumped


async def test_unique_user_id_index_is_created_once(data_dirs, fake_llm, fake_mongo):
    raw, _ = data_dirs
    _write_messages(raw)

    await extract.build_persona("42", "Maya")
    await extract.build_persona("42", "Maya")

    assert len(fake_mongo.indexes) == 1
    keys, kwargs = fake_mongo.indexes[0]
    assert keys == [("user_id", 1)] and kwargs["unique"] is True


async def test_index_failure_does_not_block_the_save(data_dirs, fake_llm, fake_mongo, caplog):
    raw, _ = data_dirs
    _write_messages(raw)

    def broken_index(*args, **kwargs):
        raise RuntimeError("boom")

    fake_mongo.create_index = broken_index
    with caplog.at_level(logging.WARNING):
        await extract.build_persona("42", "Maya")

    assert fake_mongo.docs["42"]["revision"] == 1
    assert "RuntimeError" in caplog.text


async def test_unset_uri_skips_with_warning_and_still_writes_json(data_dirs, fake_llm, caplog):
    raw, processed = data_dirs
    _write_messages(raw)

    with caplog.at_level(logging.WARNING):
        persona = await extract.build_persona("42", "Maya")

    assert persona["user_id"] == "42"
    assert (processed / "42_persona.json").exists()
    assert "MONGODB_URI is not set" in caplog.text


async def test_mongo_failure_does_not_break_build_persona(data_dirs, fake_llm, monkeypatch, caplog):
    raw, processed = data_dirs
    _write_messages(raw)
    monkeypatch.setenv("MONGODB_URI", "placeholder-not-a-real-uri")

    def unreachable():
        raise ConnectionError("auth failed, password hunter2 rejected")

    monkeypatch.setattr(mongo_store, "_collection", unreachable)
    with caplog.at_level(logging.WARNING):
        persona = await extract.build_persona("42", "Maya")

    assert persona["name"] == "Maya"
    assert (processed / "42_persona.json").exists()
    assert "ConnectionError" in caplog.text
    assert "hunter2" not in caplog.text  # only the error type is logged


async def test_update_failure_does_not_break_build_persona(data_dirs, fake_llm, fake_mongo, caplog):
    raw, processed = data_dirs
    _write_messages(raw)

    def failing_update(*args, **kwargs):
        raise TimeoutError("slow")

    fake_mongo.update_one = failing_update
    with caplog.at_level(logging.WARNING):
        await extract.build_persona("42", "Maya")

    assert (processed / "42_persona.json").exists()
    assert "TimeoutError" in caplog.text
