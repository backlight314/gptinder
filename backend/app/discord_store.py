import os
from datetime import timezone
from pathlib import Path

from .raw_store import merge_messages, read_messages, write_messages
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
    return read_messages(_path(user_id))


def save_discord_messages(user_id: str, incoming: list[DiscordMessage]) -> tuple[int, int]:
    """Merge `incoming` into the stored export. Returns (newly_added, total_stored).

    A message with a `message_id` is a duplicate if that id is already stored for the user.
    A message without one is a duplicate if the same (timestamp, content) is already stored.
    """
    merged, added = merge_messages(load_discord_messages(user_id), [_normalize(m) for m in incoming])
    write_messages(_path(user_id), user_id, "discord", merged)
    return added, len(merged)
