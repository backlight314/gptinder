import json
import re

from .llm import REACTION_MODEL, generate_reply
from .schemas import DateMessage, Persona

KICKOFF = "You're meeting for the first time on this date. Send the first message to break the ice."


_PLACEHOLDER_NAME = re.compile(
    r"^(?:test[\s_-]*user\s*\d*|user\s*\d*|test|unknown|anonymous|placeholder|n/?a|none|null|undefined"
    r"|(?:person|persona)\s*(?:one|two|a|b|1|2))$",
    re.IGNORECASE,
)


def is_placeholder_name(name: str | None) -> bool:
    """True for an empty name or a stand-in like "Test User" that shouldn't be used as a real name."""
    return not name or not name.strip() or bool(_PLACEHOLDER_NAME.match(name.strip()))


def _dump(value) -> str:
    return json.dumps(value, ensure_ascii=False)


async def run_reaction_agent(
    persona: dict,
    incoming_message: str,
    date_name: str | None = None,
    earlier_reactions: list[str] | None = None,
) -> str:
    """Private 1-2 sentence inner reaction to the message just received (never shown to the date).

    An empty `incoming_message` means this persona is opening the date. `date_name` is the
    other person's name, used so the reaction never has to guess their gender; an empty or
    placeholder name (e.g. "Test User") is replaced by "your date". `earlier_reactions` are
    this same speaker's earlier reactions on this date, given only so the wording doesn't repeat.
    """
    if is_placeholder_name(date_name):
        who = 'Refer to your date as "your date" or "they"'
    else:
        who = f'Your date is {date_name}. Refer to them by name or as "they"'
    if is_placeholder_name(persona.get("name")):
        intro = "You are on a first date."
    else:
        intro = f"You are {persona['name']} on a first date."
    if earlier_reactions:
        listed = "\n".join(f"- {r}" for r in earlier_reactions)
        variety = f"""
Your earlier private reactions on this date (oldest first):
{listed}
Do not reuse their openings, phrases or imagery: start differently and use fresh wording and a different angle.
"""
    else:
        variety = ""
    system = f"""{intro} Stay fully in character.

Emotional tendencies: {_dump(persona['emotions'])}
Decision-making style: {_dump(persona['decisions'])}

Write your private, internal reaction to what your date just said: what you feel and
think in this moment, in 1-2 sentences, in first person. This is a thought only you
can hear - it is NOT what you say out loud, so do not write dialogue or a reply.
{who} - never guess or assume their gender, and do not use "he", "she", "him" or "her" for them.
{variety}Reply with just the reaction."""
    if incoming_message:
        content = f'Your date just said: "{incoming_message}"'
    else:
        content = "You are about to meet your date for the first time and send the opening message."
    return await generate_reply(
        system, [{"role": "user", "content": content}], model=REACTION_MODEL
    )


async def run_response_agent(
    persona: dict, reaction: str, incoming_message: str, history: list[dict]
) -> str:
    """The reply actually sent, shaped by the persona's voice and the private reaction.

    `history` is the earlier conversation from this persona's point of view, as chat
    messages ("assistant" = things they said, "user" = things their date said), not
    including `incoming_message`. An empty `incoming_message` means they are opening.
    """
    system = f"""You are {persona['name']} on a first date. Stay fully in character.

Communication style: {_dump(persona['communication'])}
Interests and values: {_dump(persona['preferences'])}

Your private reaction to what your date just said (they cannot see this): "{reaction}"

Write your next message. Talk like a real person on a date, not an assistant. Keep it
short and natural, like texting. Your reply does not have to fully reveal that reaction:
people often soften, deflect, or only partially express what they feel.
Reply with just the message text."""
    messages = [*history, {"role": "user", "content": incoming_message or KICKOFF}]
    return await generate_reply(system, messages)


async def generate_turn(
    persona: dict,
    incoming_message: str,
    history: list[dict],
    date_name: str | None = None,
    earlier_reactions: list[str] | None = None,
) -> dict:
    # Sequential on purpose: the reply is written with the reaction in hand.
    reaction = await run_reaction_agent(persona, incoming_message, date_name, earlier_reactions)
    message = await run_response_agent(persona, reaction, incoming_message, history)
    return {"reaction": reaction, "message": message}


async def run_date(persona_a: Persona, persona_b: Persona, num_turns: int = 6) -> list[DateMessage]:
    personas = {"a": persona_a.model_dump(), "b": persona_b.model_dump()}
    histories: dict[str, list[dict]] = {"a": [], "b": []}
    # Each speaker's own earlier reactions, kept apart from `histories` and `transcript` so they
    # can only ever reach that speaker's next reaction call.
    reactions: dict[str, list[str]] = {"a": [], "b": []}
    transcript: list[DateMessage] = []
    incoming = ""

    for i in range(num_turns):
        speaker = "a" if i % 2 == 0 else "b"
        other = "b" if speaker == "a" else "a"
        turn = await generate_turn(
            personas[speaker],
            incoming,
            histories[speaker],
            personas[other]["name"],
            list(reactions[speaker]),
        )
        reactions[speaker].append(turn["reaction"])

        histories[speaker] += [
            {"role": "user", "content": incoming or KICKOFF},
            {"role": "assistant", "content": turn["message"]},
        ]
        transcript.append(
            DateMessage(**{"from": speaker, "text": turn["message"], "reaction": turn["reaction"]})
        )
        incoming = turn["message"]

    return transcript
