import logging
from types import SimpleNamespace

import anthropic
import httpx2 as httpx
import pytest
from fastapi.testclient import TestClient

from app import llm, main
from app.schemas import CommunicationProfile

GOOD = CommunicationProfile(
    tone="casual", humor_style="dry", typical_message_length="short", favorite_phrases=[], emoji_usage="none"
)
SECRET = "SECRET-MESSAGE-TEXT-XYZ"


def timeout_error():
    return anthropic.APITimeoutError(request=httpx.Request("POST", "https://example.invalid/v1/messages"))


def parse_failure():
    try:
        CommunicationProfile.model_validate({"tone": "not-a-tone"})
    except ValueError as e:  # pydantic.ValidationError
        return e


class FakeClient:
    def __init__(self, outcomes):
        self.outcomes = list(outcomes)
        self.calls, self.options = [], []
        self.messages = self

    def with_options(self, **options):
        self.options.append(options)
        return self

    async def parse(self, **kwargs):
        self.calls.append(kwargs)
        outcome = self.outcomes[len(self.calls) - 1]
        if isinstance(outcome, BaseException):
            raise outcome
        return SimpleNamespace(parsed_output=outcome)


def install(monkeypatch, *outcomes):
    fake = FakeClient(outcomes)
    monkeypatch.setattr(llm, "client", fake)
    return fake


async def call():
    return await llm.extract_structured("system prompt", SECRET, CommunicationProfile)


async def test_each_attempt_has_a_120s_timeout_and_the_sdks_own_retries_are_off(monkeypatch):
    fake = install(monkeypatch, GOOD)
    assert await call() == GOOD
    assert fake.options == [{"timeout": 120, "max_retries": 0}]


@pytest.mark.parametrize("failure", [timeout_error, lambda: None, parse_failure], ids=["timeout", "empty", "parse"])
async def test_a_timeout_empty_output_or_parse_failure_is_retried(monkeypatch, failure):
    fake = install(monkeypatch, failure(), failure(), GOOD)  # two failures, success on the last allowed attempt
    assert await call() == GOOD
    assert len(fake.calls) == 3


async def test_it_gives_up_after_three_attempts_with_a_clear_error(monkeypatch):
    fake = install(monkeypatch, timeout_error(), None, parse_failure())
    with pytest.raises(llm.ExtractionFailed, match="failed after 3 attempts") as exc:
        await call()
    assert len(fake.calls) == 3
    assert "ValidationError" in str(exc.value)  # the last error's type only


async def test_other_errors_are_not_retried(monkeypatch):
    fake = install(monkeypatch, RuntimeError("boom"), GOOD)
    with pytest.raises(RuntimeError, match="boom"):
        await call()
    assert len(fake.calls) == 1


async def test_logs_hold_timings_sizes_and_error_types_only(monkeypatch, caplog):
    install(monkeypatch, timeout_error(), parse_failure(), GOOD)
    with caplog.at_level(logging.INFO, logger="app.llm"):
        await call()
    assert "APITimeoutError" in caplog.text and "ValidationError" in caplog.text
    assert "input_chars=" in caplog.text and "attempt 3/3" in caplog.text
    assert SECRET not in caplog.text and "system prompt" not in caplog.text and "not-a-tone" not in caplog.text


async def test_the_failure_message_never_contains_the_input(monkeypatch):
    install(monkeypatch, None, None, None)
    with pytest.raises(llm.ExtractionFailed) as exc:
        await call()
    assert SECRET not in str(exc.value)


def test_personality_returns_502_when_extraction_is_exhausted(monkeypatch):
    async def failing(raw_text, name):
        # main.ExtractionFailed: other tests reload app.llm, so llm.ExtractionFailed can be a different class object
        raise main.ExtractionFailed("CommunicationProfile extraction failed after 3 attempts (last error: APITimeoutError)")

    monkeypatch.setattr(main, "build_persona", failing)
    response = TestClient(main.app).post("/personality", json={"name": "Maya", "raw_profile_text": "some profile text"})
    assert response.status_code == 502 and "failed after 3 attempts" in response.json()["detail"]
