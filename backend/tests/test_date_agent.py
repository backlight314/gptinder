import asyncio

import pytest

from app import date_agent
from app.schemas import (
    CommunicationProfile,
    DecisionsProfile,
    EmotionsProfile,
    Persona,
    PreferencesProfile,
)


def make_persona(name: str) -> Persona:
    return Persona(
        name=name,
        communication=CommunicationProfile(
            tone="casual",
            humor_style="playful",
            typical_message_length="short",
            favorite_phrases=[],
            emoji_usage="light",
        ),
        preferences=PreferencesProfile(interests=[], hobbies=[], values=[], dislikes=[]),
        emotions=EmotionsProfile(
            expressiveness="open",
            what_excites_them="",
            what_makes_them_guarded="",
            affection_style="",
            conflict_style="",
        ),
        decisions=DecisionsProfile(
            spontaneous_vs_deliberate="",
            risk_tolerance="",
            planning_style="",
            how_they_handle_disagreement="",
        ),
    )


def persona_dict(name: str = "Maya") -> dict:
    d = make_persona(name).model_dump()
    d["communication"]["humor_style"] = "COMM-MARKER"
    d["preferences"]["interests"] = ["PREFS-MARKER"]
    d["emotions"]["what_excites_them"] = "EMOTIONS-MARKER"
    d["decisions"]["planning_style"] = "DECISIONS-MARKER"
    return d


def is_response_call(system: str) -> bool:
    return "Write your next message" in system


@pytest.mark.asyncio
async def test_reaction_agent_uses_emotions_and_decisions_only(monkeypatch):
    seen = {}

    async def fake_generate_reply(system, messages, model=None):
        seen.update(system=system, messages=messages)
        return "Aw, that's sweet."

    monkeypatch.setattr(date_agent, "generate_reply", fake_generate_reply)

    reaction = await date_agent.run_reaction_agent(persona_dict(), "I love your laugh")

    assert reaction == "Aw, that's sweet."
    assert "EMOTIONS-MARKER" in seen["system"] and "DECISIONS-MARKER" in seen["system"]
    assert "COMM-MARKER" not in seen["system"] and "PREFS-MARKER" not in seen["system"]
    assert "NOT what you say out loud" in seen["system"]
    assert seen["messages"] == [{"role": "user", "content": 'Your date just said: "I love your laugh"'}]


@pytest.mark.asyncio
async def test_reaction_agent_handles_opening_turn(monkeypatch):
    seen = {}

    async def fake_generate_reply(system, messages, model=None):
        seen["messages"] = messages
        return "Nervous but excited."

    monkeypatch.setattr(date_agent, "generate_reply", fake_generate_reply)
    await date_agent.run_reaction_agent(persona_dict(), "")
    assert "opening message" in seen["messages"][0]["content"]
    assert 'just said: ""' not in seen["messages"][0]["content"]


@pytest.mark.asyncio
async def test_response_agent_uses_communication_preferences_and_reaction(monkeypatch):
    seen = {}

    async def fake_generate_reply(system, messages, model=None):
        seen.update(system=system, messages=messages)
        return "haha thanks"

    monkeypatch.setattr(date_agent, "generate_reply", fake_generate_reply)
    history = [
        {"role": "user", "content": date_agent.KICKOFF},
        {"role": "assistant", "content": "hey!"},
    ]

    reply = await date_agent.run_response_agent(
        persona_dict(), "REACTION-TEXT", "I love your laugh", history
    )

    assert reply == "haha thanks"
    system = seen["system"]
    assert "COMM-MARKER" in system and "PREFS-MARKER" in system and "REACTION-TEXT" in system
    assert "EMOTIONS-MARKER" not in system and "DECISIONS-MARKER" not in system
    assert "soften, deflect, or only partially express" in system
    assert seen["messages"] == [*history, {"role": "user", "content": "I love your laugh"}]


@pytest.mark.asyncio
async def test_response_agent_opening_turn_uses_kickoff(monkeypatch):
    seen = {}

    async def fake_generate_reply(system, messages, model=None):
        seen["messages"] = messages
        return "hi"

    monkeypatch.setattr(date_agent, "generate_reply", fake_generate_reply)
    await date_agent.run_response_agent(persona_dict(), "r", "", [])
    assert seen["messages"] == [{"role": "user", "content": date_agent.KICKOFF}]


@pytest.mark.asyncio
async def test_generate_turn_runs_response_after_reaction_and_feeds_it_in(monkeypatch):
    events = []

    async def fake_generate_reply(system, messages, model=None):
        kind = "response" if is_response_call(system) else "reaction"
        events.append(f"{kind}_start")
        await asyncio.sleep(0.01)
        events.append(f"{kind}_end")
        if kind == "response":
            assert "the-reaction" in system  # reaction is available to the response prompt
        return "the-reaction" if kind == "reaction" else "the-reply"

    monkeypatch.setattr(date_agent, "generate_reply", fake_generate_reply)

    turn = await date_agent.generate_turn(persona_dict(), "hello", [])

    assert turn == {"reaction": "the-reaction", "message": "the-reply"}
    assert events == ["reaction_start", "reaction_end", "response_start", "response_end"]


@pytest.mark.asyncio
async def test_run_date_alternates_and_stores_reaction_and_text(monkeypatch):
    response_history_lengths = []
    reaction_inputs = []
    counter = {"n": 0}

    async def fake_generate_reply(system, messages, model=None):
        counter["n"] += 1
        if is_response_call(system):
            response_history_lengths.append(len(messages))
            return f"reply{counter['n']}"
        reaction_inputs.append(messages[0]["content"])
        return f"reaction{counter['n']}"

    monkeypatch.setattr(date_agent, "generate_reply", fake_generate_reply)

    transcript = await date_agent.run_date(make_persona("Maya"), make_persona("Leo"), num_turns=4)

    assert [m.from_ for m in transcript] == ["a", "b", "a", "b"]
    assert [(m.reaction, m.text) for m in transcript] == [
        ("reaction1", "reply2"),
        ("reaction3", "reply4"),
        ("reaction5", "reply6"),
        ("reaction7", "reply8"),
    ]
    # each speaker sees the other's previous reply as the incoming message
    assert reaction_inputs[1] == 'Your date just said: "reply2"'
    assert reaction_inputs[2] == 'Your date just said: "reply4"'
    # history grows per persona: a: [], then kickoff+a1 -> 3 with the new incoming; b likewise
    assert response_history_lengths == [1, 1, 3, 3]


@pytest.mark.asyncio
async def test_reaction_prompt_names_the_date_and_forbids_guessing_gender(monkeypatch):
    seen = {}

    async def fake_generate_reply(system, messages, model=None):
        seen.update(system=system, model=model)
        return "ok"

    monkeypatch.setattr(date_agent, "generate_reply", fake_generate_reply)

    await date_agent.run_reaction_agent(persona_dict(), "hi", date_name="Leo")
    assert 'Your date is Leo. Refer to them by name or as "they"' in seen["system"]
    assert "never guess or assume their gender" in seen["system"]

    await date_agent.run_reaction_agent(persona_dict(), "hi")
    assert "Your date is" not in seen["system"]
    assert 'Refer to your date as "your date" or "they"' in seen["system"]


@pytest.mark.asyncio
async def test_run_date_tells_each_reaction_agent_the_other_persons_name(monkeypatch):
    systems = []

    async def fake_generate_reply(system, messages, model=None):
        if not is_response_call(system):
            systems.append(system)
        return "ok"

    monkeypatch.setattr(date_agent, "generate_reply", fake_generate_reply)
    await date_agent.run_date(make_persona("Maya"), make_persona("Leo"), num_turns=2)

    assert "You are Maya" in systems[0] and "Your date is Leo" in systems[0]
    assert "You are Leo" in systems[1] and "Your date is Maya" in systems[1]


@pytest.mark.asyncio
async def test_reaction_call_uses_reaction_model_and_response_call_does_not(monkeypatch):
    models = {}

    async def fake_generate_reply(system, messages, model=None):
        models["response" if is_response_call(system) else "reaction"] = model
        return "ok"

    monkeypatch.setattr(date_agent, "generate_reply", fake_generate_reply)
    monkeypatch.setattr(date_agent, "REACTION_MODEL", "cheap-model")
    await date_agent.generate_turn(persona_dict(), "hi", [], "Leo")

    assert models == {"reaction": "cheap-model", "response": None}  # response uses generate_reply's DATE_MODEL default


def test_reaction_model_defaults_to_date_model(monkeypatch):
    import importlib

    from app import llm

    monkeypatch.delenv("REACTION_MODEL", raising=False)
    monkeypatch.setenv("DATE_MODEL", "date-x")
    assert importlib.reload(llm).REACTION_MODEL == "date-x"
    monkeypatch.setenv("REACTION_MODEL", "")  # empty (e.g. blank line copied from .env.example)
    assert importlib.reload(llm).REACTION_MODEL == "date-x"
    monkeypatch.setenv("REACTION_MODEL", "claude-haiku-4-5")
    assert importlib.reload(llm).REACTION_MODEL == "claude-haiku-4-5"
    monkeypatch.undo()
    importlib.reload(llm)


# ---- earlier reactions: same speaker's reaction prompt only ----

def _record_calls(monkeypatch):
    """Fake LLM with unique reaction/reply text. Returns lists of recorded calls."""
    reaction_calls, response_calls = [], []
    counter = {"n": 0}

    async def fake_generate_reply(system, messages, model=None):
        counter["n"] += 1
        n = counter["n"]
        if is_response_call(system):
            response_calls.append({"system": system, "messages": messages})
            return f"REPLY<{n}>"
        reaction_calls.append({"system": system, "messages": messages})
        return f"REACTION<{n}>"

    monkeypatch.setattr(date_agent, "generate_reply", fake_generate_reply)
    return reaction_calls, response_calls


@pytest.mark.asyncio
async def test_earlier_reactions_reach_only_the_same_speakers_reaction_prompt(monkeypatch):
    reaction_calls, _ = _record_calls(monkeypatch)
    transcript = await date_agent.run_date(make_persona("Maya"), make_persona("Leo"), num_turns=6)

    # a speaks on turns 1,3,5 (reaction calls 0,2,4); b on turns 2,4,6 (calls 1,3,5)
    a_reactions = [m.reaction for m in transcript if m.from_ == "a"]
    b_reactions = [m.reaction for m in transcript if m.from_ == "b"]
    systems = [c["system"] for c in reaction_calls]

    assert "earlier private reactions" not in systems[0] and "earlier private reactions" not in systems[1]
    assert "Do not reuse their openings, phrases or imagery" in systems[2]
    assert a_reactions[0] in systems[2] and not any(r in systems[2] for r in b_reactions)
    assert b_reactions[0] in systems[3] and not any(r in systems[3] for r in a_reactions)
    # third turn for a sees both of a's earlier reactions, oldest first, and still none of b's
    assert systems[4].index(a_reactions[0]) < systems[4].index(a_reactions[1])
    assert a_reactions[2] not in systems[4]  # its own current reaction doesn't exist yet
    assert not any(r in systems[4] for r in b_reactions)


@pytest.mark.asyncio
async def test_reactions_never_leak_into_transcript_history_or_later_reply_prompts(monkeypatch):
    reaction_calls, response_calls = _record_calls(monkeypatch)
    transcript = await date_agent.run_date(make_persona("Maya"), make_persona("Leo"), num_turns=6)
    all_reactions = [m.reaction for m in transcript]

    # the visible text is never a reaction, and the two are stored as separate fields
    for m in transcript:
        assert m.text.startswith("REPLY<") and m.reaction.startswith("REACTION<")
        assert not any(r in m.text for r in all_reactions)

    for i, call in enumerate(response_calls):
        # chat history sent to the reply agent contains only spoken text, never a reaction
        assert not any(r in msg["content"] for msg in call["messages"] for r in all_reactions)
        # the reply prompt carries this turn's reaction only, not earlier ones
        assert all_reactions[i] in call["system"]
        assert not any(r in call["system"] for j, r in enumerate(all_reactions) if j != i)

    # reaction prompts' user content is the date's spoken line only
    for call in reaction_calls:
        assert not any(r in call["messages"][0]["content"] for r in all_reactions)


@pytest.mark.parametrize("name", ["", "   ", None, "Test User", "test user", "TEST_USER", "Test User 2", "User", "Unknown", "N/A", "Person one", "persona b"])
def test_placeholder_names_are_detected(name):
    assert date_agent.is_placeholder_name(name)


@pytest.mark.parametrize("name", ["Maya", "Leo", "Delia", "Testa", "Tess Userman", "Anna"])
def test_real_names_are_not_placeholders(name):
    assert not date_agent.is_placeholder_name(name)


@pytest.mark.asyncio
async def test_placeholder_names_become_your_date_in_reaction_prompts(monkeypatch):
    seen = {}

    async def fake_generate_reply(system, messages, model=None):
        seen["system"] = system
        return "ok"

    monkeypatch.setattr(date_agent, "generate_reply", fake_generate_reply)
    speaker = persona_dict("Maya")

    await date_agent.run_reaction_agent(speaker, "hi", date_name="Test User")
    assert 'Refer to your date as "your date" or "they"' in seen["system"]
    assert "Test User" not in seen["system"]

    await date_agent.run_reaction_agent(speaker, "hi", date_name="")
    assert 'Refer to your date as "your date" or "they"' in seen["system"]

    # the speaker's own placeholder name is not used either
    await date_agent.run_reaction_agent(persona_dict("Test User"), "hi", date_name="Leo")
    assert seen["system"].startswith("You are on a first date.")
    assert "Test User" not in seen["system"] and "Your date is Leo" in seen["system"]


@pytest.mark.asyncio
async def test_run_date_uses_your_date_when_the_other_persona_is_a_placeholder(monkeypatch):
    reaction_calls, _ = _record_calls(monkeypatch)
    await date_agent.run_date(make_persona("Maya"), make_persona("Test User"), num_turns=2)
    a_prompt, b_prompt = (c["system"] for c in reaction_calls)
    assert 'Refer to your date as "your date" or "they"' in a_prompt and "Test User" not in a_prompt
    assert b_prompt.startswith("You are on a first date.") and "Your date is Maya" in b_prompt


def test_reaction_is_optional_so_messages_without_one_still_load():
    from app.schemas import DateMessage

    old = DateMessage.model_validate({"from": "a", "text": "hey"})
    assert old.reaction is None
    new = DateMessage.model_validate({"from": "b", "text": "hi", "reaction": "warm"})
    assert new.model_dump(by_alias=True) == {"from": "b", "text": "hi", "reaction": "warm"}
