import asyncio
import logging
import os
import time
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


class ExtractionFailed(RuntimeError):
    """A structured extraction call produced no usable output on every attempt."""


class _EmptyStructuredOutput(Exception):
    pass


EXTRACT_TIMEOUT_S = 120
MAX_EXTRACT_RETRIES = 2
# Timeouts (an APIConnectionError subclass), empty output and parse failures (ValueError covers pydantic's
# ValidationError and JSON errors) are retried, as are rate limits and 5xx now that the SDK's own retries are off.
_RETRYABLE = (
    anthropic.APIConnectionError,
    anthropic.RateLimitError,
    anthropic.InternalServerError,
    _EmptyStructuredOutput,
    ValueError,
)


async def extract_structured(
    system: str, raw_text: str, output_model: type[T], model: str = EXTRACTION_MODEL
) -> T:
    """One narrow extraction call, constrained to output_model's JSON schema.

    Each attempt has a 120s timeout; up to 2 more attempts follow a timeout, an empty response or an
    unparseable one. Logs carry timings, sizes and error type names only - never message text or model output.
    """
    attempts = 1 + MAX_EXTRACT_RETRIES
    last_error = "unknown"
    input_chars = len(system) + len(raw_text)
    for attempt in range(1, attempts + 1):
        started = time.perf_counter()
        try:
            # max_retries=0: this loop owns retrying, so the timeout budget isn't multiplied by the SDK's.
            response = await client.with_options(timeout=EXTRACT_TIMEOUT_S, max_retries=0).messages.parse(
                model=model,
                max_tokens=2048,
                system=system,
                messages=[{"role": "user", "content": raw_text}],
                output_format=output_model,
            )
            parsed = response.parsed_output
            if parsed is None:
                raise _EmptyStructuredOutput()
        except _RETRYABLE as e:
            last_error = type(e).__name__
            logger.warning(
                "extract_structured %s failed (%s) on attempt %d/%d after %.1fs; input_chars=%d",
                output_model.__name__, last_error, attempt, attempts, time.perf_counter() - started, input_chars,
            )
            if attempt < attempts and isinstance(e, (anthropic.RateLimitError, anthropic.InternalServerError)):
                await asyncio.sleep(attempt)
            continue
        logger.info(
            "extract_structured %s ok on attempt %d/%d in %.1fs; input_chars=%d",
            output_model.__name__, attempt, attempts, time.perf_counter() - started, input_chars,
        )
        return parsed
    raise ExtractionFailed(
        f"{output_model.__name__} extraction failed after {attempts} attempts (last error: {last_error})"
    )


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
