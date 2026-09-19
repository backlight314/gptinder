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
    return {"content": message.content, "timestamp": ts.astimezone(timezone.utc).isoformat()}


def load_discord_messages(user_id: str) -> list[dict]:
    path = _path(user_id)
    if not path.exists():
        return []
    return json.loads(path.read_text())["messages"]


def save_discord_messages(user_id: str, incoming: list[DiscordMessage]) -> tuple[int, int]:
    """Merge `incoming` into the stored export. Returns (newly_added, total_stored)."""
    merged = load_discord_messages(user_id)
    seen = {(m["timestamp"], m["content"]) for m in merged}
    added = 0
    for message in map(_normalize, incoming):
        key = (message["timestamp"], message["content"])
        if key not in seen:
            seen.add(key)
            merged.append(message)
            added += 1
    merged.sort(key=lambda m: m["timestamp"])

    RAW_DIR.mkdir(parents=True, exist_ok=True)
    path = _path(user_id)
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps({"user_id": user_id, "source": "discord", "messages": merged}, indent=2))
    os.replace(tmp, path)
    return added, len(merged)
