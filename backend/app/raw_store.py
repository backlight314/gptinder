"""Shared read/merge/write for data/raw/<user_id>_<source>.json exports (Discord, WhatsApp)."""

import hashlib
import json
import os
from pathlib import Path


def dedupe_key(timestamp: str, content: str) -> str:
    """Identity of a message that has no id: a hash of its timestamp and text."""
    return hashlib.sha256(f"{timestamp}\n{content}".encode("utf-8")).hexdigest()


def read_messages(path: Path) -> list[dict]:
    if not path.exists():
        return []
    return json.loads(path.read_text())["messages"]


def merge_messages(existing: list[dict], incoming: list[dict]) -> tuple[list[dict], int]:
    """Merge `incoming` into `existing`. Returns (merged and sorted by time, number newly added).

    A message with a `message_id` is a duplicate if that id is already stored. A message without one
    is a duplicate if the same (timestamp, text) is already stored. An id-carrying message that matches
    a stored id-less one (same timestamp and text) attaches its id to it instead of adding a copy.
    """
    merged = list(existing)
    seen_ids = {m["message_id"] for m in merged if m.get("message_id")}
    seen_keys = {dedupe_key(m["timestamp"], m["content"]) for m in merged}
    unidentified = {dedupe_key(m["timestamp"], m["content"]): m for m in merged if not m.get("message_id")}
    added = 0
    for message in incoming:
        key = dedupe_key(message["timestamp"], message["content"])
        message_id = message.get("message_id")
        if message_id:
            if message_id in seen_ids:
                continue
            seen_ids.add(message_id)
            earlier_export = unidentified.pop(key, None)
            if earlier_export is not None:
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
    return merged, added


def write_messages(path: Path, user_id: str, source: str, messages: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps({"user_id": user_id, "source": source, "messages": messages}, indent=2))
    os.replace(tmp, path)
