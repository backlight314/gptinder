from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class CommunicationProfile(BaseModel):
    tone: Literal["casual", "formal", "mixed"]
    humor_style: str
    typical_message_length: str
    favorite_phrases: list[str]
    emoji_usage: Literal["none", "light", "heavy"]


class PreferencesProfile(BaseModel):
    interests: list[str]
    hobbies: list[str]
    values: list[str]
    dislikes: list[str]


class EmotionsProfile(BaseModel):
    expressiveness: Literal["reserved", "open"]
    what_excites_them: str
    what_makes_them_guarded: str
    affection_style: str
    conflict_style: str


class DecisionsProfile(BaseModel):
    spontaneous_vs_deliberate: str
    risk_tolerance: str
    planning_style: str
    how_they_handle_disagreement: str


class Persona(BaseModel):
    name: str
    communication: CommunicationProfile
    preferences: PreferencesProfile
    emotions: EmotionsProfile
    decisions: DecisionsProfile


class PersonalityRequest(BaseModel):
    name: str
    raw_profile_text: str = ""
    raw_whatsapp_text: str = ""
    # Discord snowflake IDs exceed JS's safe integer range, so they travel as strings.
    discord_user_id: str | None = Field(default=None, pattern=r"^\d{1,25}$")


class Message(BaseModel):
    from_: Literal["a", "b"] = Field(alias="from")
    text: str

    model_config = {"populate_by_name": True}


class DateMessage(Message):
    reaction: str | None = None


class DateRequest(BaseModel):
    persona_a: Persona
    persona_b: Persona
    num_turns: int = 6


class DateResponse(BaseModel):
    messages: list[DateMessage]


class ScoreDimension(BaseModel):
    score: int = Field(ge=0, le=100)
    reason: str


class ScoreBreakdown(BaseModel):
    communication_fit: ScoreDimension
    shared_preferences: ScoreDimension
    emotional_compatibility: ScoreDimension
    decision_style_compatibility: ScoreDimension


class ScoreRequest(BaseModel):
    persona_a: Persona
    persona_b: Persona
    transcript: list[Message]


class ScoreResponse(BaseModel):
    overall: int = Field(ge=0, le=100)
    breakdown: ScoreBreakdown


# Caps shared by every raw-message source (Discord, WhatsApp).
MAX_MESSAGE_CHARS = 4000
MAX_MESSAGES_PER_REQUEST = 10_000


class DiscordMessage(BaseModel):
    content: str = Field(max_length=MAX_MESSAGE_CHARS)
    timestamp: datetime
    message_id: str | None = Field(default=None, min_length=1, max_length=128)


class DiscordIngestRequest(BaseModel):
    user_id: str = Field(pattern=r"^\d{1,25}$")
    source: Literal["discord"]
    messages: list[DiscordMessage] = Field(max_length=MAX_MESSAGES_PER_REQUEST)


class DiscordIngestResponse(BaseModel):
    user_id: str
    added: int
    total: int


class WhatsAppIngestRequest(BaseModel):
    user_id: str = Field(pattern=r"^[A-Za-z0-9-]{1,64}$")
    display_name: str = Field(min_length=1, max_length=100)
    export_text: str  # size is checked in the route so a 422 never echoes the whole export back
    date_order: Literal["dmy", "mdy"] | None = None


class WhatsAppIngestResponse(BaseModel):
    user_id: str
    added: int
    total: int
    parsed: int  # the user's own messages found in the export
    date_order: Literal["dmy", "mdy"]
    date_order_guessed: bool
    truncated_messages: int  # over-long messages shortened to MAX_MESSAGE_CHARS
    dropped_oldest: int  # own messages beyond MAX_MESSAGES_PER_REQUEST (the oldest are dropped)


class PersonaBuildRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)


class PersonaBuildResponse(BaseModel):
    user_id: str
    name: str
    communication: CommunicationProfile
    preferences: PreferencesProfile
    emotions: EmotionsProfile
    decisions: DecisionsProfile
    mongo_configured: bool  # False means the persona was only written to data/processed/
