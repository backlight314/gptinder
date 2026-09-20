"""Parses a WhatsApp "Export chat" text file into Discord-shaped messages.

Only the requesting user's own messages are ever kept. Every other participant's text is
discarded line by line while parsing: it is never stored, returned, logged, put in an error
message, or sent to an LLM. WhatsApp exports carry no timezone, so times are kept as written
and labelled UTC (ordering within the chat is exact; interleaving with other sources can be off
by the exporter's UTC offset).
"""

import re
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Literal

DateOrder = Literal["dmy", "mdy"]


class WhatsAppParseError(ValueError):
    """The export could not be parsed. Messages never contain chat text or other people's names."""


@dataclass(frozen=True)
class ParsedExport:
    messages: list[dict]  # {"content", "timestamp"} - the user's own messages only, no message_id
    date_order: DateOrder
    date_order_guessed: bool  # True: no day above 12 in the file and no override, so dd/mm was assumed


# Zero-width marks and bidi isolates WhatsApp wraps around names and system lines; narrow/no-break
# spaces newer clients put before AM/PM.
_INVISIBLE = dict.fromkeys(map(ord, "‎‏‪‫‬‭‮⁦⁧⁨⁩﻿"))
_SPACES = str.maketrans({" ": " ", " ": " ", " ": " "})

_DATE = r"\d{1,4}[/.\-]\d{1,2}[/.\-]\d{1,4}"
_TIME = r"\d{1,2}[:.]\d{2}(?:[:.]\d{2})?(?:\s?[AaPp]\.?\s?[Mm]\.?)?"
_IPHONE = re.compile(rf"^\[(?P<date>{_DATE}),?\s+(?P<time>{_TIME})\]\s?(?P<rest>.*)$")
_ANDROID = re.compile(rf"^(?P<date>{_DATE}),?\s+(?P<time>{_TIME})\s+-\s+(?P<rest>.*)$")

_EDITED = re.compile(r"\s*<This message was edited>\s*$", re.IGNORECASE)
_OMITTED = re.compile(
    r"^<?\s*(?:media|image|video|audio|sticker|gif|document|contact card|voice message|video note)s?"
    r"\s+omitted\s*>?\.?$",
    re.IGNORECASE,
)
_ATTACHED = re.compile(r"^<attached:.*>$|\(file attached\)$", re.IGNORECASE)
_NOT_TEXT = {  # exact (casefolded, trailing period removed): deleted notices, pending placeholders, translations
    "this message was deleted", "you deleted this message", "waiting for this message. this may take a while",
    "waiting for this message",
    "<multimedia omitido>", "se eliminó este mensaje", "eliminaste este mensaje",
    "<media omesso>", "questo messaggio è stato eliminato", "hai eliminato questo messaggio",
    "<mídia oculta>", "esta mensagem foi apagada", "você apagou esta mensagem",
    "<médias omis>", "ce message a été supprimé", "vous avez supprimé ce message",
    "<medien ausgeschlossen>", "diese nachricht wurde gelöscht", "du hast diese nachricht gelöscht",
}


def _clean(line: str) -> str:
    return line.translate(_SPACES).translate(_INVISIBLE)


def _match_header(line: str):
    return _IPHONE.match(line) or _ANDROID.match(line)


def _date_numbers(raw: str) -> tuple[bool, int, int, int, int] | None:
    """(year_first, first, second, year, year_digits) or None when this isn't a plausible date."""
    a, b, c = re.split(r"[/.\-]", raw)
    if len(a) == 4:  # yyyy-mm-dd
        return True, int(b), int(c), int(a), 4
    if len(c) not in (2, 4):
        return None
    year = int(c) if len(c) == 4 else 2000 + int(c)
    return False, int(a), int(b), year, len(c)


def detect_date_order(text: str) -> DateOrder | None:
    """dd/mm if any first number is above 12, mm/dd if any second number is; None if the file can't say."""
    day_first = month_first = False
    for line in text.splitlines():
        header = _match_header(_clean(line))
        parts = _date_numbers(header["date"]) if header else None
        if parts and not parts[0]:
            day_first |= parts[1] > 12
            month_first |= parts[2] > 12
    if day_first and month_first:
        raise WhatsAppParseError(
            "This export mixes day-first and month-first dates. Pass date_order to choose one."
        )
    return "dmy" if day_first else "mdy" if month_first else None


def _timestamp(date: str, time: str, order: DateOrder) -> str | None:
    parts = _date_numbers(date)
    if parts is None:
        return None
    year_first, first, second, year, _ = parts
    month, day = (first, second) if year_first else ((second, first) if order == "dmy" else (first, second))
    m = re.match(r"(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?(?:\s?([AaPp]))?", time)
    hour, minute, sec, meridiem = int(m[1]), int(m[2]), int(m[3] or 0), (m[4] or "").lower()
    if meridiem:
        if not 1 <= hour <= 12:
            return None
        hour = hour % 12 + (12 if meridiem == "p" else 0)
    try:
        return datetime(year, month, day, hour, minute, sec, tzinfo=timezone.utc).isoformat()
    except ValueError:
        return None


def _normalize_name(name: str) -> str:
    name = re.sub(r"\s+", " ", name.strip().lstrip("~").strip()).casefold()
    if re.fullmatch(r"[+\d\s()\-]+", name):  # a phone number shown instead of a saved contact name
        return re.sub(r"[^\d+]", "", name)
    return name


def _usable_text(lines: list[str]) -> str:
    text = _EDITED.sub("", "\n".join(lines).strip()).strip()
    folded = text.casefold().rstrip(".")
    if not text or _OMITTED.match(text) or _ATTACHED.search(text) or folded in _NOT_TEXT:
        return ""
    return text


def parse_whatsapp_export(
    text: str, display_name: str, date_order: DateOrder | None = None
) -> ParsedExport:
    if date_order not in (None, "dmy", "mdy"):
        raise WhatsAppParseError("date_order must be 'dmy' or 'mdy'.")
    if not display_name.strip():
        raise WhatsAppParseError("A display name is required to pick out your own messages.")

    guessed = False
    if date_order is None:
        date_order = detect_date_order(text)
        if date_order is None:
            date_order, guessed = "dmy", True

    wanted = _normalize_name(display_name)
    own: list[tuple[str, list[str]]] = []  # (timestamp, lines) - own messages only
    current: list[str] | None = None  # lines of the own message being read; None = someone else / system
    saw_headers = False
    senders: set[str] = set()  # kept only to know whether anyone else exists; never exposed

    for raw in text.splitlines():
        line = _clean(raw)
        header = _match_header(line)
        stamp = _timestamp(header["date"], header["time"], date_order) if header else None
        if stamp is None:  # not a header (or an impossible date): a continuation of the current message
            if current is not None:
                current.append(line)
            continue
        saw_headers = True
        sender, sep, body = header["rest"].partition(": ")
        if not sep:  # system line, e.g. "Messages are end-to-end encrypted" or "X changed the subject"
            current = None
            continue
        senders.add(_normalize_name(sender))
        if _normalize_name(sender) == wanted:
            current = [body]
            own.append((stamp, current))
        else:
            current = None  # someone else's text is dropped here, including its continuation lines

    if not saw_headers:
        raise WhatsAppParseError(
            "No WhatsApp messages were found in this text. Use the .txt from WhatsApp's "
            "'Export chat' (Without media)."
        )
    if wanted not in senders:
        raise WhatsAppParseError(
            f"No messages from {display_name.strip()!r} were found in this export. Use your name exactly as "
            "WhatsApp shows it in the chat (or your phone number if you are not saved as a contact)."
        )

    messages = []
    for stamp, lines in own:
        content = _usable_text(lines)
        if content:
            messages.append({"content": content, "timestamp": stamp})
    if not messages:
        raise WhatsAppParseError(
            "Found your name but no text messages from you (only media, deleted or system lines)."
        )
    return ParsedExport(messages=messages, date_order=date_order, date_order_guessed=guessed)
