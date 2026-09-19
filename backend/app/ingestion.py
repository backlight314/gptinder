"""Normalizes the two raw text sources into one blob for the extraction calls.

This does not fetch or scrape anything itself - it expects `profile_text` and
`whatsapp_text` to already be plain text the caller has (e.g. text pasted from a
public profile, or the contents of a WhatsApp "Export Chat" .txt file). Actually
retrieving that text (scraping a live profile page, parsing a WhatsApp export
file's timestamp/sender format) is a separate, source-specific concern left out
of this pass - wire it in here once you've picked how each source will actually
be fetched.
"""

MAX_CHARS_PER_SOURCE = 20_000


def _clean(text: str) -> str:
    lines = [line.strip() for line in text.splitlines()]
    return "\n".join(line for line in lines if line)


def normalize_raw_text(profile_text: str, whatsapp_text: str, discord_text: str = "") -> str:
    sections = []
    profile = _clean(profile_text)[:MAX_CHARS_PER_SOURCE]
    whatsapp = _clean(whatsapp_text)[:MAX_CHARS_PER_SOURCE]
    discord = _clean(discord_text)[:MAX_CHARS_PER_SOURCE]

    if profile:
        sections.append(f"--- Public profile content ---\n{profile}")
    if whatsapp:
        sections.append(f"--- WhatsApp export ---\n{whatsapp}")
    if discord:
        sections.append(f"--- Discord messages ---\n{discord}")

    if not sections:
        raise ValueError("At least one text source must be non-empty")

    return "\n\n".join(sections)
