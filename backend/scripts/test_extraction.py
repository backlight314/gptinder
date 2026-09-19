"""Run build_persona() on one real user and print everything for a sanity check.

Usage (from backend/, with ANTHROPIC_API_KEY set in backend/.env):
    .venv/bin/python scripts/test_extraction.py <user_id> [name]

Reads data/raw/<user_id>_*.json and writes data/processed/<user_id>_persona.json.
"""
import argparse
import asyncio
import json
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.personas import extract  # noqa: E402  (after sys.path tweak)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("user_id")
    parser.add_argument("name", nargs="?", default="Test User")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

    persona = asyncio.run(extract.build_persona(args.user_id, args.name))

    stats = dict(persona["stats"])
    scores = stats.pop("sentiment_scores")
    print("=== STATS ===")
    print(json.dumps(stats, indent=2))
    if scores:
        print(
            f"sentiment_scores: {len(scores)} values, min {min(scores)}, max {max(scores)}, "
            f"first 5 {scores[:5]}"
        )

    for section in ("communication", "preferences", "emotions", "decisions"):
        print(f"\n=== {section.upper()} ===")
        print(json.dumps(persona[section], indent=2, ensure_ascii=False))

    print(f"\nSaved to {extract.PROCESSED_DIR / (args.user_id + '_persona.json')}")


if __name__ == "__main__":
    main()
