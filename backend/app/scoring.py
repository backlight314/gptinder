import json

from .llm import SCORE_MODEL, extract_structured
from .schemas import Message, Persona, ScoreResponse

SCORE_SYSTEM = """Given these two people's profiles and their date transcript,
score compatibility 0-100 on each: communication_fit, shared_preferences,
emotional_compatibility, decision_style_compatibility. Then give an overall
score and a one-sentence reason for each dimension. Base every score on
concrete evidence from the profiles and transcript, not vibes."""


def _format_input(persona_a: Persona, persona_b: Persona, transcript: list[Message]) -> str:
    lines = [
        f"Person A ({persona_a.name}):",
        json.dumps(persona_a.model_dump(exclude={"name"}), indent=2),
        "",
        f"Person B ({persona_b.name}):",
        json.dumps(persona_b.model_dump(exclude={"name"}), indent=2),
        "",
        "Date transcript:",
    ]
    for message in transcript:
        speaker = persona_a.name if message.from_ == "a" else persona_b.name
        lines.append(f"{speaker}: {message.text}")
    return "\n".join(lines)


async def score_match(
    persona_a: Persona, persona_b: Persona, transcript: list[Message]
) -> ScoreResponse:
    raw_text = _format_input(persona_a, persona_b, transcript)
    return await extract_structured(SCORE_SYSTEM, raw_text, ScoreResponse, model=SCORE_MODEL)
