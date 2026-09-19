import hmac
import os

from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .extraction import build_persona
from .date_agent import run_date
from .discord_store import load_discord_messages, save_discord_messages
from .ingestion import normalize_raw_text
from .llm import EmptyModelReply
from .schemas import (
    DateRequest,
    DateResponse,
    DiscordIngestRequest,
    DiscordIngestResponse,
    Persona,
    PersonalityRequest,
    ScoreRequest,
    ScoreResponse,
)
from .scoring import score_match

app = FastAPI(title="gptinder backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["POST"],
    allow_headers=["*"],
)


@app.post("/ingest/discord", response_model=DiscordIngestResponse)
def ingest_discord(
    req: DiscordIngestRequest, x_ingest_token: str | None = Header(default=None)
) -> DiscordIngestResponse:
    expected = os.environ.get("INGEST_TOKEN")
    if expected and not hmac.compare_digest(x_ingest_token or "", expected):
        raise HTTPException(status_code=401, detail="Invalid ingest token")
    added, total = save_discord_messages(req.user_id, req.messages)
    return DiscordIngestResponse(user_id=req.user_id, added=added, total=total)


@app.post("/personality", response_model=Persona)
async def personality(req: PersonalityRequest) -> Persona:
    discord_text = ""
    if req.discord_user_id:
        messages = load_discord_messages(req.discord_user_id)
        if not messages:
            raise HTTPException(
                status_code=404, detail=f"No Discord export found for user {req.discord_user_id}"
            )
        discord_text = "\n".join(m["content"] for m in messages)

    try:
        raw_text = normalize_raw_text(req.raw_profile_text, req.raw_whatsapp_text, discord_text)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return await build_persona(raw_text, req.name)


@app.post("/date", response_model=DateResponse)
async def date(req: DateRequest) -> DateResponse:
    try:
        messages = await run_date(req.persona_a, req.persona_b, req.num_turns)
    except EmptyModelReply as e:
        raise HTTPException(status_code=502, detail=f"Model returned an empty reply: {e}")
    return DateResponse(messages=messages)


@app.post("/score", response_model=ScoreResponse)
async def score(req: ScoreRequest) -> ScoreResponse:
    return await score_match(req.persona_a, req.persona_b, req.transcript)
