import json
import os
from datetime import timezone
from pathlib import Path

from .schemas import DiscordMessage

DATA_DIR = Path(os.environ.get("DATA_DIR") or Path(__file__).resolve().parents[2] / "data")
RAW_DIR = DATA_DIR / "raw"


def _path(user_id: str) -> Path:
    # user_id is validated as digits-only by the request schemas, so it is safe in a filename.
    return RAW_DIR / f"{user_id}_discord.json"


def _normalize(message: DiscordMessage) -> dict:
    ts = message.timestamp
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)
    doc = {"content": message.content, "timestamp": ts.astimezone(timezone.utc).isoformat()}
    if message.message_id:
        doc["message_id"] = message.message_id
    return doc


def load_discord_messages(user_id: str) -> list[dict]:
    path = _path(user_id)
    if not path.exists():
        return []
    return json.loads(path.read_text())["messages"]


def save_discord_messages(user_id: str, incoming: list[DiscordMessage]) -> tuple[int, int]:
    """Merge `incoming` into the stored export. Returns (newly_added, total_stored).

    A message with a `message_id` is a duplicate if that id is already stored for the user.
    A message without one is a duplicate if the same (timestamp, content) is already stored.
    """
    merged = load_discord_messages(user_id)
    seen_ids = {m["message_id"] for m in merged if m.get("message_id")}
    seen_keys = {(m["timestamp"], m["content"]) for m in merged}
    unidentified = {(m["timestamp"], m["content"]): m for m in merged if not m.get("message_id")}
    added = 0
    for message in map(_normalize, incoming):
        key = (message["timestamp"], message["content"])
        message_id = message.get("message_id")
        if message_id:
            if message_id in seen_ids:
                continue
            seen_ids.add(message_id)
            earlier_export = unidentified.pop(key, None)
            if earlier_export is not None:
                # Stored before ids existed: attach the id instead of adding a second copy.
                earlier_export["message_id"] = message_id
                continue
        else:
            if key in seen_keys:
                continue
            unidentified[key] = message
        seen_keys.add(key)
        merged.append(message)
        added += 1
    merged.sort(key=lambda m: m["timestamp"])

    RAW_DIR.mkdir(parents=True, exist_ok=True)
    path = _path(user_id)
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps({"user_id": user_id, "source": "discord", "messages": merged}, indent=2))
    os.replace(tmp, path)
    return added, len(merged)
