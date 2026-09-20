import json

import pytest
from fastapi.testclient import TestClient

from app import discord_store, main
from app.schemas import DateMessage, Message, ScoreBreakdown, ScoreDimension, ScoreResponse
from tests.test_date_agent import make_persona

client = TestClient(main.app)


def test_personality_endpoint(monkeypatch):
    persona = make_persona("Maya")

    async def fake_build_persona(raw_text, name):
        assert "hello from my profile" in raw_text
        assert name == "Maya"
        return persona

    monkeypatch.setattr(main, "build_persona", fake_build_persona)

    response = client.post(
        "/personality",
        json={"name": "Maya", "raw_profile_text": "hello from my profile", "raw_whatsapp_text": ""},
    )

    assert response.status_code == 200
    assert response.json()["name"] == "Maya"


def test_personality_endpoint_requires_some_text():
    response = client.post(
        "/personality",
        json={"name": "Maya", "raw_profile_text": "", "raw_whatsapp_text": ""},
    )
    assert response.status_code == 400


def test_date_endpoint(monkeypatch):
    persona_a = make_persona("Maya")
    persona_b = make_persona("Leo")
    fake_transcript = [
        DateMessage(**{"from": "a", "text": "Hey!", "reaction": "Nervous but excited."}),
        DateMessage(**{"from": "b", "text": "Hi!", "reaction": "Oh, they seem warm."}),
    ]

    async def fake_run_date(pa, pb, num_turns):
        assert num_turns == 4
        return fake_transcript

    monkeypatch.setattr(main, "run_date", fake_run_date)

    response = client.post(
        "/date",
        json={
            "persona_a": persona_a.model_dump(),
            "persona_b": persona_b.model_dump(),
            "num_turns": 4,
        },
    )

    assert response.status_code == 200
    assert response.json()["messages"] == [
        {"from": "a", "text": "Hey!", "reaction": "Nervous but excited."},
        {"from": "b", "text": "Hi!", "reaction": "Oh, they seem warm."},
    ]


def test_score_endpoint(monkeypatch):
    persona_a = make_persona("Maya")
    persona_b = make_persona("Leo")
    fake_score = ScoreResponse(
        overall=87,
        breakdown=ScoreBreakdown(
            communication_fit=ScoreDimension(score=90, reason="r"),
            shared_preferences=ScoreDimension(score=85, reason="r"),
            emotional_compatibility=ScoreDimension(score=88, reason="r"),
            decision_style_compatibility=ScoreDimension(score=80, reason="r"),
        ),
    )

    async def fake_score_match(pa, pb, transcript):
        return fake_score

    monkeypatch.setattr(main, "score_match", fake_score_match)

    response = client.post(
        "/score",
        json={
            "persona_a": persona_a.model_dump(),
            "persona_b": persona_b.model_dump(),
            "transcript": [{"from": "a", "text": "Hey!"}, {"from": "b", "text": "Hi!"}],
        },
    )

    assert response.status_code == 200
    assert response.json()["overall"] == 87



@pytest.fixture
def raw_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(discord_store, "RAW_DIR", tmp_path)
    monkeypatch.delenv("INGEST_TOKEN", raising=False)
    return tmp_path


def _payload(*messages, user_id="123456789012345678"):
    return {
        "user_id": user_id,
        "source": "discord",
        "messages": [{"content": c, "timestamp": t} for c, t in messages],
    }


def test_ingest_discord_writes_file(raw_dir):
    response = client.post(
        "/ingest/discord",
        json=_payload(("hello", "2025-01-01T10:00:00+00:00"), ("world", "2025-01-01T10:01:00Z")),
    )
    assert response.status_code == 200
    assert response.json() == {"user_id": "123456789012345678", "added": 2, "total": 2}

    stored = json.loads((raw_dir / "123456789012345678_discord.json").read_text())
    assert stored["source"] == "discord"
    assert [m["content"] for m in stored["messages"]] == ["hello", "world"]


def test_ingest_discord_merges_dedupes_and_sorts(raw_dir):
    client.post("/ingest/discord", json=_payload(("b", "2025-01-01T10:01:00+00:00")))
    response = client.post(
        "/ingest/discord",
        json=_payload(
            ("a", "2025-01-01T10:00:00+00:00"),
            ("b", "2025-01-01T10:01:00Z"),  # same instant as stored, different spelling
            ("a", "2025-01-01T10:00:00+00:00"),  # duplicate within the payload
        ),
    )
    assert response.json()["added"] == 1
    assert response.json()["total"] == 2
    stored = json.loads((raw_dir / "123456789012345678_discord.json").read_text())
    assert [m["content"] for m in stored["messages"]] == ["a", "b"]


@pytest.mark.parametrize("bad_id", ["../etc/passwd", "abc", "", "1" * 30])
def test_ingest_discord_rejects_bad_user_id(raw_dir, bad_id):
    response = client.post(
        "/ingest/discord", json=_payload(("x", "2025-01-01T10:00:00Z"), user_id=bad_id)
    )
    assert response.status_code == 422
    assert list(raw_dir.iterdir()) == []


def test_ingest_discord_enforces_token_when_configured(raw_dir, monkeypatch):
    monkeypatch.setenv("INGEST_TOKEN", "s3cret")
    body = _payload(("x", "2025-01-01T10:00:00Z"))
    assert client.post("/ingest/discord", json=body).status_code == 401
    assert (
        client.post("/ingest/discord", json=body, headers={"X-Ingest-Token": "wrong"}).status_code
        == 401
    )
    ok = client.post("/ingest/discord", json=body, headers={"X-Ingest-Token": "s3cret"})
    assert ok.status_code == 200


def test_personality_includes_ingested_discord_messages(raw_dir, monkeypatch):
    client.post(
        "/ingest/discord",
        json=_payload(("first discord msg", "2025-01-01T10:00:00Z"), ("second", "2025-01-01T10:01:00Z")),
    )

    async def fake_build_persona(raw_text, name):
        assert "--- Discord messages ---\nfirst discord msg\nsecond" in raw_text
        assert "profile text" in raw_text
        return make_persona(name)

    monkeypatch.setattr(main, "build_persona", fake_build_persona)

    response = client.post(
        "/personality",
        json={"name": "Maya", "raw_profile_text": "profile text", "discord_user_id": "123456789012345678"},
    )
    assert response.status_code == 200


def test_personality_404_when_discord_export_missing(raw_dir):
    response = client.post(
        "/personality",
        json={"name": "Maya", "raw_profile_text": "x", "discord_user_id": "999"},
    )
    assert response.status_code == 404


def test_date_endpoint_returns_502_when_model_keeps_returning_nothing(monkeypatch):
    from app.llm import EmptyModelReply

    async def failing_run_date(pa, pb, num_turns):
        raise EmptyModelReply("claude-opus-5 returned no text after 3 attempts")

    monkeypatch.setattr(main, "run_date", failing_run_date)
    persona = make_persona("Maya").model_dump()
    response = client.post("/date", json={"persona_a": persona, "persona_b": persona})
    assert response.status_code == 502
    assert "empty reply" in response.json()["detail"]


def test_score_endpoint_drops_reactions_from_a_full_date_transcript(monkeypatch):
    seen = {}

    async def fake_score_match(pa, pb, transcript):
        seen["transcript"] = transcript
        return ScoreResponse(
            overall=80,
            breakdown=ScoreBreakdown(
                communication_fit=ScoreDimension(score=80, reason="r"),
                shared_preferences=ScoreDimension(score=80, reason="r"),
                emotional_compatibility=ScoreDimension(score=80, reason="r"),
                decision_style_compatibility=ScoreDimension(score=80, reason="r"),
            ),
        )

    monkeypatch.setattr(main, "score_match", fake_score_match)
    persona = make_persona("Maya").model_dump()
    response = client.post(
        "/score",
        json={
            "persona_a": persona,
            "persona_b": persona,
            # exactly what /date returns, reactions included
            "transcript": [
                {"from": "a", "text": "Hey!", "reaction": "PRIVATE-A"},
                {"from": "b", "text": "Hi!", "reaction": "PRIVATE-B"},
            ],
        },
    )
    assert response.status_code == 200
    assert [m.text for m in seen["transcript"]] == ["Hey!", "Hi!"]
    assert all("reaction" not in m.model_dump() for m in seen["transcript"])


def _built_persona():
    p = make_persona("Maya").model_dump()
    p["user_id"] = "42"
    return p


def test_build_user_persona_endpoint(monkeypatch):
    async def fake_build(user_id, name):
        assert (user_id, name) == ("42", "Maya")
        return _built_persona()

    monkeypatch.setattr(main.persona_extract, "build_persona", fake_build)
    monkeypatch.setattr(main.mongo_store, "is_configured", lambda: True)
    monkeypatch.delenv("INGEST_TOKEN", raising=False)

    response = client.post("/personas/42/build", json={"name": "Maya"})

    assert response.status_code == 200
    assert response.json()["user_id"] == "42"
    assert response.json()["mongo_configured"] is True


def test_build_user_persona_requires_token_and_maps_errors(monkeypatch):
    monkeypatch.setenv("INGEST_TOKEN", "secret")
    assert client.post("/personas/42/build", json={"name": "Maya"}).status_code == 401

    async def missing(user_id, name):
        raise FileNotFoundError("No raw data found")

    monkeypatch.setattr(main.persona_extract, "build_persona", missing)
    headers = {"X-Ingest-Token": "secret"}
    assert client.post("/personas/42/build", json={"name": "Maya"}, headers=headers).status_code == 404
