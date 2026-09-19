import pytest

from app import scoring
from app.schemas import Message, ScoreBreakdown, ScoreDimension, ScoreResponse
from tests.test_date_agent import make_persona

FAKE_SCORE = ScoreResponse(
    overall=87,
    breakdown=ScoreBreakdown(
        communication_fit=ScoreDimension(score=90, reason="Both text in short, playful bursts."),
        shared_preferences=ScoreDimension(score=85, reason="Overlap on food and live music."),
        emotional_compatibility=ScoreDimension(score=88, reason="Both are emotionally open."),
        decision_style_compatibility=ScoreDimension(score=80, reason="Both lean spontaneous."),
    ),
)


@pytest.mark.asyncio
async def test_score_match_passes_personas_and_transcript_to_the_model(monkeypatch):
    captured = {}

    async def fake_extract_structured(system, raw_text, output_model, model=None):
        captured["raw_text"] = raw_text
        captured["model"] = model
        return FAKE_SCORE

    monkeypatch.setattr(scoring, "extract_structured", fake_extract_structured)

    persona_a = make_persona("Maya")
    persona_b = make_persona("Leo")
    transcript = [
        Message(**{"from": "a", "text": "Hey!"}),
        Message(**{"from": "b", "text": "Hi there!"}),
    ]

    result = await scoring.score_match(persona_a, persona_b, transcript)

    assert result == FAKE_SCORE
    assert "Maya" in captured["raw_text"]
    assert "Leo" in captured["raw_text"]
    assert "Hey!" in captured["raw_text"]
    assert captured["model"] == scoring.SCORE_MODEL


@pytest.mark.asyncio
async def test_score_input_never_contains_reactions(monkeypatch):
    from app.schemas import DateMessage

    captured = {}

    async def fake_extract_structured(system, raw_text, output_model, model=None):
        captured["raw_text"] = raw_text
        return FAKE_SCORE

    monkeypatch.setattr(scoring, "extract_structured", fake_extract_structured)
    # DateMessage subclasses Message, so a full /date transcript (with reactions) can be passed straight in
    transcript = [
        DateMessage(**{"from": "a", "text": "Hey!", "reaction": "PRIVATE-REACTION-A"}),
        DateMessage(**{"from": "b", "text": "Hi there!", "reaction": "PRIVATE-REACTION-B"}),
    ]
    await scoring.score_match(make_persona("Maya"), make_persona("Leo"), transcript)

    assert "Hey!" in captured["raw_text"] and "Hi there!" in captured["raw_text"]
    assert "PRIVATE-REACTION" not in captured["raw_text"]
