"""Upsert already-built personas (data/processed/<user_id>_persona.json) into MongoDB without calling the LLM.

Usage (from backend/, with MONGODB_URI set in backend/.env):
    .venv/bin/python scripts/push_personas.py [user_id ...]

With no arguments every data/processed/*_persona.json is pushed. Prints counts only.
"""
import json
import logging
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.personas import extract, mongo_store  # noqa: E402  (after sys.path tweak)


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    if not mongo_store.is_configured():
        raise SystemExit("MONGODB_URI is not set in backend/.env")
    wanted = set(sys.argv[1:])
    paths = sorted(extract.PROCESSED_DIR.glob("*_persona.json"))
    saved = failed = 0
    for path in paths:
        persona = json.loads(path.read_text())
        user_id = persona["user_id"]
        if wanted and user_id not in wanted:
            continue
        sources = dict(Counter(r.source for r in extract.load_user_records(user_id)))
        if mongo_store.store_extracted_persona(persona, sources):
            saved += 1
        else:
            failed += 1
    print(f"Saved {saved}, failed {failed}")
    if failed:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
