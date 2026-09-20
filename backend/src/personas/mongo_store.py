"""Best-effort persistence of extracted personas (built from Discord/WhatsApp messages) to MongoDB.

Uses the same MONGODB_URI / MONGODB_DB as the Next.js app. Stored in the `extracted_personas`
collection, one document per user_id; the hand-written personas stay in `personas`.

The stored document holds only derived data: the four profiles, numeric stats, per-source message
counts, a revision and timestamps. Never raw message text or message ids.
"""
import logging
import os
from datetime import datetime, timezone

from pymongo import ASCENDING, MongoClient

logger = logging.getLogger(__name__)

COLLECTION = "extracted_personas"
SERVER_SELECTION_TIMEOUT_MS = 3000

# The only persona fields that may be written to MongoDB.
STORED_FIELDS = ("communication", "preferences", "emotions", "decisions", "stats")

_client: MongoClient | None = None
_index_ready = False


def _collection():
    global _client
    if _client is None:
        _client = MongoClient(
            os.environ["MONGODB_URI"],
            appName="gptinder-backend",
            serverSelectionTimeoutMS=SERVER_SELECTION_TIMEOUT_MS,
        )
    return _client[os.environ.get("MONGODB_DB", "gptinder")][COLLECTION]


def is_configured() -> bool:
    return bool(os.environ.get("MONGODB_URI"))


def _ensure_index(collection) -> None:
    """Unique index on user_id; created once per process, and a failure never blocks the save."""
    global _index_ready
    if _index_ready:
        return
    try:
        collection.create_index([("user_id", ASCENDING)], unique=True, name="user_id_unique")
        _index_ready = True
    except Exception as e:
        logger.warning("Could not create the extracted_personas index (%s)", type(e).__name__)


def _document(persona: dict, sources: dict[str, int]) -> dict:
    doc = {key: persona[key] for key in STORED_FIELDS}
    doc["user_id"] = persona["user_id"]
    doc["sources"] = dict(sources)
    return doc


def store_extracted_persona(persona: dict, sources: dict[str, int]) -> bool:
    """Upsert the persona keyed by user_id, bumping `revision` on every rebuild.

    Best effort: returns False (after logging the error type only, since driver messages can
    contain connection details) when Mongo is unset, unreachable or failing. Never raises.
    """
    if not is_configured():
        logger.warning("MONGODB_URI is not set; persona for %s was not saved to MongoDB", persona.get("user_id"))
        return False
    try:
        now = datetime.now(timezone.utc)
        collection = _collection()
        _ensure_index(collection)
        collection.update_one(
            {"user_id": persona["user_id"]},
            {
                "$set": {**_document(persona, sources), "updatedAt": now},
                "$setOnInsert": {"createdAt": now},
                "$inc": {"revision": 1},
            },
            upsert=True,
        )
        return True
    except Exception as e:
        logger.warning("MongoDB persona save failed (%s); the JSON file was still written", type(e).__name__)
        return False
