import logging
import os
from typing import TypeVar

import anthropic
from pydantic import BaseModel

logger = logging.getLogger(__name__)

client = anthropic.AsyncAnthropic()

EXTRACTION_MODEL = os.environ.get("EXTRACTION_MODEL", "claude-haiku-4-5")
DATE_MODEL = os.environ.get("DATE_MODEL", "claude-opus-5")
REACTION_MODEL = os.environ.get("REACTION_MODEL") or DATE_MODEL
SCORE_MODEL = os.environ.get("SCORE_MODEL", "claude-sonnet-5")

T = TypeVar("T", bound=BaseModel)


async def extract_structured(
    system: str, raw_text: str, output_model: type[T], model: str = EXTRACTION_MODEL
) -> T:
    """One narrow extraction call, constrained to output_model's JSON schema."""
    response = await client.messages.parse(
        model=model,
        max_tokens=2048,
        system=system,
        messages=[{"role": "user", "content": raw_text}],
        output_format=output_model,
    )
    return response.parsed_output


class EmptyModelReply(RuntimeError):
    """The model produced no non-empty text on every attempt."""


MAX_EMPTY_RETRIES = 2


async def generate_reply(system: str, messages: list[dict], model: str = DATE_MODEL) -> str:
    """One free-text turn for the date agent (short, in-character message).

    Some responses (e.g. claude-opus-5 ending its turn after only a thinking block) carry
    no text. Those are retried; if every attempt is empty this raises rather than returning
    "", so an empty string can never reach the transcript or the conversation history.
    """
    attempts = 1 + MAX_EMPTY_RETRIES
    last = None
    for attempt in range(1, attempts + 1):
        response = await client.messages.create(
            model=model,
            max_tokens=300,
            system=system,
            messages=messages,
        )
        text = "".join(b.text for b in response.content if b.type == "text").strip()
        if text:
            return text
        last = response
        logger.warning(
            "Empty reply from %s (attempt %d/%d, stop_reason=%s, blocks=%s)",
            model, attempt, attempts, response.stop_reason, [b.type for b in response.content],
        )
    raise EmptyModelReply(
        f"{model} returned no text after {attempts} attempts "
        f"(last stop_reason={last.stop_reason}, blocks={[b.type for b in last.content]})"
    )
