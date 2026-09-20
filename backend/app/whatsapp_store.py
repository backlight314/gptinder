from pathlib import Path

from .discord_store import DATA_DIR
from .raw_store import merge_messages, read_messages, write_messages
from .schemas import MAX_MESSAGE_CHARS, MAX_MESSAGES_PER_REQUEST

RAW_DIR = DATA_DIR / "raw"
MAX_EXPORT_CHARS = 25_000_000  # raw export text accepted per import


def _path(user_id: str) -> Path:
    # user_id is validated by the request schema / script as [A-Za-z0-9-]{1,64}, so it is safe in a filename.
    return RAW_DIR / f"{user_id}_whatsapp.json"


def load_whatsapp_messages(user_id: str) -> list[dict]:
    return read_messages(_path(user_id))


def apply_size_caps(messages: list[dict]) -> tuple[list[dict], int, int]:
    """The same per-message and per-request limits /ingest/discord enforces, applied gracefully.

    Returns (messages, truncated_messages, dropped_oldest): over-long messages are shortened and only
    the newest MAX_MESSAGES_PER_REQUEST are kept, instead of rejecting a whole chat export.
    """
    dropped = max(0, len(messages) - MAX_MESSAGES_PER_REQUEST)
    kept = messages[dropped:]
    truncated = 0
    capped = []
    for m in kept:
        if len(m["content"]) > MAX_MESSAGE_CHARS:
            truncated += 1
            m = {**m, "content": m["content"][:MAX_MESSAGE_CHARS]}
        capped.append(m)
    return capped, truncated, dropped


def save_whatsapp_messages(user_id: str, incoming: list[dict]) -> tuple[int, int]:
    """Merge `incoming` ({content, timestamp[, message_id]}) into the stored export. Returns (added, total)."""
    merged, added = merge_messages(load_whatsapp_messages(user_id), incoming)
    write_messages(_path(user_id), user_id, "whatsapp", merged)
    return added, len(merged)
