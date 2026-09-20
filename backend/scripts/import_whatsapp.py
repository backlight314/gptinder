"""Import a WhatsApp chat export straight into data/raw/<user_id>_whatsapp.json (no HTTP).

Usage (from backend/):
    .venv/bin/python scripts/import_whatsapp.py <path to .txt or .zip> <user_id> "<your name in the chat>" \
        [--date-order dmy|mdy]

Only the messages sent by <your name in the chat> are kept; everyone else's text is discarded while
parsing. Re-running the same export adds nothing. Prints counts only, never message text.
"""
import argparse
import re
import sys
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import whatsapp_store  # noqa: E402  (after sys.path tweak)
from app.whatsapp_parser import WhatsAppParseError, parse_whatsapp_export  # noqa: E402

_USER_ID_RE = re.compile(r"^[A-Za-z0-9-]{1,64}$")
MAX_EXPORT_BYTES = 100_000_000  # refuse absurdly large files/zip members before reading them


def read_export(path: Path) -> str:
    """The chat text from a .txt export, or from the chat file inside an iPhone/Android .zip."""
    if path.suffix.lower() == ".zip":
        with zipfile.ZipFile(path) as archive:
            members = [i for i in archive.infolist() if not i.is_dir() and i.filename.lower().endswith(".txt")]
            named = [i for i in members if Path(i.filename).name.lower() == "_chat.txt"]
            chosen = named or (members if len(members) == 1 else [])
            if len(chosen) != 1:
                raise ValueError("Expected _chat.txt (or exactly one .txt file) inside the zip.")
            if chosen[0].file_size > MAX_EXPORT_BYTES:
                raise ValueError("The chat file inside the zip is too large.")
            data = archive.read(chosen[0])
    else:
        if path.stat().st_size > MAX_EXPORT_BYTES:
            raise ValueError("The export file is too large.")
        data = path.read_bytes()
    return data.decode("utf-8-sig", errors="replace")


def import_export(path: Path, user_id: str, display_name: str, date_order: str | None = None) -> dict:
    if not _USER_ID_RE.match(user_id):
        raise ValueError("user_id may only contain letters, digits and dashes (max 64 characters).")
    text = read_export(path)
    if len(text) > whatsapp_store.MAX_EXPORT_CHARS:
        raise ValueError("The export is too large to import.")
    parsed = parse_whatsapp_export(text, display_name, date_order)
    messages, truncated, dropped = whatsapp_store.apply_size_caps(parsed.messages)
    added, total = whatsapp_store.save_whatsapp_messages(user_id, messages)
    return {
        "parsed": len(parsed.messages), "added": added, "total": total, "date_order": parsed.date_order,
        "date_order_guessed": parsed.date_order_guessed, "truncated_messages": truncated, "dropped_oldest": dropped,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("path", type=Path)
    parser.add_argument("user_id")
    parser.add_argument("display_name")
    parser.add_argument("--date-order", choices=["dmy", "mdy"], default=None)
    args = parser.parse_args()
    try:
        result = import_export(args.path, args.user_id, args.display_name, args.date_order)
    except (WhatsAppParseError, ValueError, OSError, zipfile.BadZipFile) as e:
        raise SystemExit(f"Import failed: {e}")
    print(f"Imported into {whatsapp_store._path(args.user_id).name}")
    print(f"  your messages found: {result['parsed']} | newly added: {result['added']} | total stored: {result['total']}")
    print(f"  date order: {result['date_order']}" + (" (GUESSED: no day above 12 in the file; use --date-order if wrong)" if result["date_order_guessed"] else ""))
    if result["truncated_messages"] or result["dropped_oldest"]:
        print(f"  caps applied: {result['truncated_messages']} long messages shortened, {result['dropped_oldest']} oldest dropped")


if __name__ == "__main__":
    main()
