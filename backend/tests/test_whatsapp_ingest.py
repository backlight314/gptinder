import importlib.util
import json
import sys
import zipfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import discord_store, main, whatsapp_store
from tests.test_whatsapp_parser import IPHONE, LEAK, OTHER, THIRD, USER

client = TestClient(main.app)
UID = "wa-user-1"
BACKEND_DIR = Path(__file__).resolve().parents[1]

spec = importlib.util.spec_from_file_location("import_whatsapp", BACKEND_DIR / "scripts" / "import_whatsapp.py")
import_whatsapp = importlib.util.module_from_spec(spec)
spec.loader.exec_module(import_whatsapp)

EXPECTED = [
    "hey are we still on for saturday?",
    "great\nsecond line of mine\n\nthird line after a blank line",
    "see you then",
]


@pytest.fixture
def raw_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(whatsapp_store, "RAW_DIR", tmp_path)
    monkeypatch.setattr(discord_store, "RAW_DIR", tmp_path)
    monkeypatch.delenv("INGEST_TOKEN", raising=False)
    return tmp_path


def post(export_text=IPHONE, display_name=USER, user_id=UID, headers=None, **extra):
    body = {"user_id": user_id, "display_name": display_name, "export_text": export_text, **extra}
    return client.post("/ingest/whatsapp", json=body, headers=headers or {})


def stored(raw_dir, user_id=UID):
    return json.loads((raw_dir / f"{user_id}_whatsapp.json").read_text())


# ---- the route ----

def test_ingest_writes_a_discord_shaped_file_with_only_the_users_messages(raw_dir):
    response = post()
    assert response.status_code == 200
    assert response.json() == {
        "user_id": UID, "added": 3, "total": 3, "parsed": 3, "date_order": "dmy",
        "date_order_guessed": False, "truncated_messages": 0, "dropped_oldest": 0,
    }
    data = stored(raw_dir)
    assert set(data) == {"user_id", "source", "messages"} and data["source"] == "whatsapp" and data["user_id"] == UID
    assert [m["content"] for m in data["messages"]] == EXPECTED
    assert all(set(m) == {"content", "timestamp"} for m in data["messages"])  # exports carry no message_id
    on_disk = (raw_dir / f"{UID}_whatsapp.json").read_text()
    assert LEAK not in on_disk and OTHER not in on_disk and THIRD not in on_disk and LEAK not in response.text


def test_reimporting_the_same_export_creates_no_duplicates(raw_dir):
    post()
    before = (raw_dir / f"{UID}_whatsapp.json").read_text()
    again = post()
    assert again.json()["added"] == 0 and again.json()["total"] == 3
    assert (raw_dir / f"{UID}_whatsapp.json").read_text() == before


def test_a_longer_later_export_adds_only_the_new_messages(raw_dir):
    post()
    later = IPHONE + "\n[25/02/2024, 19:00:00] Sam Rivera: one more\n"
    response = post(later)
    assert response.json()["added"] == 1 and response.json()["total"] == 4
    assert stored(raw_dir)["messages"][-1]["content"] == "one more"


def test_the_same_text_at_a_different_time_is_a_different_message(raw_dir):
    text = "[25/02/2024, 10:00:00] Sam Rivera: ok\n[25/02/2024, 10:05:00] Sam Rivera: ok\n"
    assert post(text).json()["total"] == 2


def test_whatsapp_and_discord_exports_for_one_user_live_in_separate_files(raw_dir):
    client.post("/ingest/discord", json={"user_id": "123456789012345678", "source": "discord", "messages": [{"content": "hi", "timestamp": "2025-01-01T00:00:00Z"}]})
    post(user_id="123456789012345678")
    assert sorted(p.name for p in raw_dir.iterdir()) == ["123456789012345678_discord.json", "123456789012345678_whatsapp.json"]


def test_ambiguous_dates_are_flagged_and_the_override_is_honoured(raw_dir):
    text = "[03/04/2024, 10:00:00] Sam Rivera: x\n"
    flagged = post(text).json()
    assert flagged["date_order"] == "dmy" and flagged["date_order_guessed"] is True
    forced = post(text, user_id="wa-user-2", date_order="mdy").json()
    assert forced["date_order"] == "mdy" and forced["date_order_guessed"] is False
    assert stored(raw_dir, "wa-user-2")["messages"][0]["timestamp"][:10] == "2024-03-04"


def test_token_is_enforced_when_configured_and_open_when_not(raw_dir, monkeypatch):
    assert post().status_code == 200  # INGEST_TOKEN unset in this fixture
    monkeypatch.setenv("INGEST_TOKEN", "s3cret")
    assert post(user_id="wa-t1").status_code == 401
    assert post(user_id="wa-t1", headers={"X-Ingest-Token": "wrong"}).status_code == 401
    assert post(user_id="wa-t1", headers={"X-Ingest-Token": "s3cret"}).status_code == 200
    assert [m["content"] for m in stored(raw_dir, "wa-t1")["messages"]] == EXPECTED  # only the valid-token call stored anything


def test_a_rejected_token_stores_nothing(raw_dir, monkeypatch):
    monkeypatch.setenv("INGEST_TOKEN", "s3cret")
    assert post().status_code == 401
    assert list(raw_dir.iterdir()) == []


def test_unknown_name_is_a_422_that_names_no_one_else(raw_dir):
    response = post(display_name="Nobody Here")
    assert response.status_code == 422
    detail = response.json()["detail"]
    assert "Nobody Here" in detail and not any(x in detail for x in (OTHER, THIRD, LEAK))
    assert list(raw_dir.iterdir()) == []


def test_text_that_is_not_an_export_is_a_422(raw_dir):
    assert post("hello there, this is not an export").status_code == 422


@pytest.mark.parametrize("bad_id", ["../etc", "has space", "", "x" * 65])
def test_bad_user_ids_are_rejected(raw_dir, bad_id):
    assert post(user_id=bad_id).status_code == 422
    assert list(raw_dir.iterdir()) == []


def test_an_oversized_export_is_a_413_that_does_not_echo_it(raw_dir, monkeypatch):
    monkeypatch.setattr(whatsapp_store, "MAX_EXPORT_CHARS", 100)
    response = post()
    assert response.status_code == 413 and LEAK not in response.text and USER not in response.text


# ---- size caps: the limits /ingest/discord uses, applied gracefully ----

def test_the_caps_match_discords(raw_dir):
    from app.schemas import DiscordIngestRequest, DiscordMessage

    assert whatsapp_store.MAX_MESSAGES_PER_REQUEST == 10_000 == DiscordIngestRequest.model_fields["messages"].metadata[0].max_length
    assert whatsapp_store.MAX_MESSAGE_CHARS == 4000 == DiscordMessage.model_fields["content"].metadata[0].max_length


def test_only_the_newest_messages_are_kept_and_long_ones_are_shortened(raw_dir, monkeypatch):
    monkeypatch.setattr(whatsapp_store, "MAX_MESSAGES_PER_REQUEST", 3)
    monkeypatch.setattr(whatsapp_store, "MAX_MESSAGE_CHARS", 10)
    lines = [f"[25/02/2024, 10:0{i}:00] Sam Rivera: message number {i}" for i in range(5)]
    response = post("\n".join(lines))
    body = response.json()
    assert (body["parsed"], body["dropped_oldest"], body["truncated_messages"], body["total"]) == (5, 2, 3, 3)
    assert [m["content"] for m in stored(raw_dir)["messages"]] == ["message nu"] * 3
    assert [m["timestamp"][14:16] for m in stored(raw_dir)["messages"]] == ["02", "03", "04"]


# ---- scripts/import_whatsapp.py ----

def _write(path, text=IPHONE):
    path.write_text(text, encoding="utf-8")
    return path


def test_the_script_imports_a_txt_export_without_http(raw_dir, tmp_path):
    export = _write(tmp_path / "chat.txt")
    result = import_whatsapp.import_export(export, UID, USER)
    assert (result["parsed"], result["added"], result["total"]) == (3, 3, 3)
    assert [m["content"] for m in stored(raw_dir)["messages"]] == EXPECTED
    assert import_whatsapp.import_export(export, UID, USER)["added"] == 0  # re-import: no duplicates


def test_the_script_matches_the_route_byte_for_byte(raw_dir, tmp_path):
    post(user_id="via-route")
    import_whatsapp.import_export(_write(tmp_path / "chat.txt"), "via-script", USER)
    assert stored(raw_dir, "via-route")["messages"] == stored(raw_dir, "via-script")["messages"]


def test_the_script_reads_chat_txt_from_an_iphone_zip(raw_dir, tmp_path):
    archive = tmp_path / "WhatsApp Chat - Jordan.zip"
    with zipfile.ZipFile(archive, "w") as z:
        z.writestr("_chat.txt", IPHONE.encode("utf-8"))
        z.writestr("notes.txt", "unrelated")
    assert import_whatsapp.import_export(archive, UID, USER)["parsed"] == 3


def test_the_script_accepts_a_zip_with_one_txt_of_any_name(raw_dir, tmp_path):
    archive = tmp_path / "export.zip"
    with zipfile.ZipFile(archive, "w") as z:
        z.writestr("WhatsApp Chat with Jordan.txt", IPHONE.encode("utf-8"))
    assert import_whatsapp.import_export(archive, UID, USER)["parsed"] == 3


@pytest.mark.parametrize("members", [[], ["a.txt", "b.txt"], ["photo.jpg"]])
def test_the_script_rejects_a_zip_without_a_clear_chat_file(raw_dir, tmp_path, members):
    archive = tmp_path / "bad.zip"
    with zipfile.ZipFile(archive, "w") as z:
        for name in members:
            z.writestr(name, "x")
    with pytest.raises(ValueError, match="_chat.txt"):
        import_whatsapp.import_export(archive, UID, USER)


def test_the_script_validates_the_user_id_and_supports_a_date_order(raw_dir, tmp_path):
    export = _write(tmp_path / "c.txt", "[03/04/2024, 10:00:00] Sam Rivera: x\n")
    with pytest.raises(ValueError, match="user_id"):
        import_whatsapp.import_export(export, "../evil", USER)
    assert import_whatsapp.import_export(export, UID, USER, "mdy")["date_order"] == "mdy"
    assert stored(raw_dir)["messages"][0]["timestamp"][:10] == "2024-03-04"


def test_the_script_cli_prints_counts_only_never_chat_text(raw_dir, tmp_path, monkeypatch, capsys):
    export = _write(tmp_path / "chat.txt")
    monkeypatch.setattr(sys, "argv", ["import_whatsapp.py", str(export), UID, USER])
    import_whatsapp.main()
    out = capsys.readouterr().out
    assert "your messages found: 3" in out and "newly added: 3" in out
    assert not any(x in out for x in (LEAK, OTHER, THIRD, "saturday", "see you then"))


def test_the_script_cli_fails_cleanly_and_leaks_nothing(raw_dir, tmp_path, monkeypatch):
    export = _write(tmp_path / "chat.txt")
    monkeypatch.setattr(sys, "argv", ["import_whatsapp.py", str(export), UID, "Nobody Here"])
    with pytest.raises(SystemExit) as exc:
        import_whatsapp.main()
    assert "Import failed" in str(exc.value) and not any(x in str(exc.value) for x in (OTHER, THIRD, LEAK))
