import pytest
from types import SimpleNamespace

from app import llm


def response(*blocks, stop_reason="end_turn"):
    return SimpleNamespace(
        content=[SimpleNamespace(type=t, text=text) for t, text in blocks], stop_reason=stop_reason
    )


THINKING_ONLY = response(("thinking", ""))


def install(monkeypatch, replies):
    calls = []

    async def fake_create(**kwargs):
        calls.append(kwargs)
        return replies[len(calls) - 1]

    monkeypatch.setattr(llm.client.messages, "create", fake_create)
    return calls


async def test_returns_text_without_retrying(monkeypatch):
    calls = install(monkeypatch, [response(("thinking", ""), ("text", "  hello  "))])
    assert await llm.generate_reply("sys", []) == "hello"
    assert len(calls) == 1


async def test_retries_a_thinking_only_response(monkeypatch):
    calls = install(monkeypatch, [THINKING_ONLY, response(("text", "second try"))])
    assert await llm.generate_reply("sys", []) == "second try"
    assert len(calls) == 2


async def test_succeeds_on_the_last_allowed_retry(monkeypatch):
    calls = install(monkeypatch, [THINKING_ONLY, THINKING_ONLY, response(("text", "third"))])
    assert await llm.generate_reply("sys", []) == "third"
    assert len(calls) == 3


async def test_raises_after_three_empty_attempts_and_never_returns_empty(monkeypatch):
    calls = install(monkeypatch, [THINKING_ONLY, response(("text", "   ")), THINKING_ONLY])
    with pytest.raises(llm.EmptyModelReply, match="3 attempts"):
        await llm.generate_reply("sys", [])
    assert len(calls) == 3
