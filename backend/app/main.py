import hmac
import os

from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .extraction import build_persona
from .date_agent import run_date
from . import whatsapp_store
from .discord_store import load_discord_messages, save_discord_messages
from .ingestion import normalize_raw_text
from .llm import EmptyModelReply, ExtractionFailed
from .schemas import (
    DateRequest,
    DateResponse,
    DiscordIngestRequest,
    DiscordIngestResponse,
    Persona,
    PersonaBuildRequest,
    PersonaBuildResponse,
    PersonalityRequest,
    ScoreRequest,
    ScoreResponse,
    WhatsAppIngestRequest,
    WhatsAppIngestResponse,
)
from .scoring import score_match
from .whatsapp_parser import WhatsAppParseError, parse_whatsapp_export
from src.personas import extract as persona_extract, mongo_store

app = FastAPI(title="gptinder backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["POST"],
    allow_headers=["*"],
)


def _check_ingest_token(x_ingest_token: str | None) -> None:
    expected = os.environ.get("INGEST_TOKEN")
    if expected and not hmac.compare_digest(x_ingest_token or "", expected):
        raise HTTPException(status_code=401, detail="Invalid ingest token")


@app.post("/ingest/discord", response_model=DiscordIngestResponse)
def ingest_discord(
    req: DiscordIngestRequest, x_ingest_token: str | None = Header(default=None)
) -> DiscordIngestResponse:
    _check_ingest_token(x_ingest_token)
    added, total = save_discord_messages(req.user_id, req.messages)
    return DiscordIngestResponse(user_id=req.user_id, added=added, total=total)


@app.post("/ingest/whatsapp", response_model=WhatsAppIngestResponse)
def ingest_whatsapp(
    req: WhatsAppIngestRequest, x_ingest_token: str | None = Header(default=None)
) -> WhatsAppIngestResponse:
    """Parse a WhatsApp "Export chat" text, keep only `display_name`'s own messages, and store them."""
    _check_ingest_token(x_ingest_token)
    if len(req.export_text) > whatsapp_store.MAX_EXPORT_CHARS:
        raise HTTPException(status_code=413, detail="The export is too large to import in one request.")
    try:
        parsed = parse_whatsapp_export(req.export_text, req.display_name, req.date_order)
    except WhatsAppParseError as e:
        raise HTTPException(status_code=422, detail=str(e))
    messages, truncated, dropped = whatsapp_store.apply_size_caps(parsed.messages)
    added, total = whatsapp_store.save_whatsapp_messages(req.user_id, messages)
    return WhatsAppIngestResponse(
        user_id=req.user_id,
        added=added,
        total=total,
        parsed=len(parsed.messages),
        date_order=parsed.date_order,
        date_order_guessed=parsed.date_order_guessed,
        truncated_messages=truncated,
        dropped_oldest=dropped,
    )


@app.post("/personas/{user_id}/build", response_model=PersonaBuildResponse)
async def build_user_persona(
    user_id: str, req: PersonaBuildRequest, x_ingest_token: str | None = Header(default=None)
) -> PersonaBuildResponse:
    """Build a persona from every ingested source (Discord + WhatsApp) for user_id and upsert it into MongoDB."""
    _check_ingest_token(x_ingest_token)  # this spends LLM credits, so it is gated like ingestion
    try:
        persona = await persona_extract.build_persona(user_id, req.name)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except ExtractionFailed as e:
        raise HTTPException(status_code=502, detail=str(e))
    return PersonaBuildResponse(**persona, mongo_configured=mongo_store.is_configured())


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
    try:
        return await build_persona(raw_text, req.name)
    except ExtractionFailed as e:
        raise HTTPException(status_code=502, detail=str(e))


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
