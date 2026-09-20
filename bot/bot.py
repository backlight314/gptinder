import asyncio
import os

import aiohttp
import discord
from discord.ext import commands
from dotenv import load_dotenv

load_dotenv()

BACKEND_URL = os.environ.get("BACKEND_URL", "http://localhost:8000").rstrip("/")
INGEST_TOKEN = os.environ.get("INGEST_TOKEN", "")
HISTORY_LIMIT = int(os.environ.get("HISTORY_LIMIT", "500"))


async def collect_messages(channel, user_id: int, limit: int) -> list[dict]:
    """Scan the last `limit` messages in `channel`; keep the text messages sent by `user_id`."""
    messages = []
    async for msg in channel.history(limit=limit):
        if msg.author.id == user_id and msg.content.strip():
            messages.append(
                {"content": msg.content, "timestamp": msg.created_at.isoformat(), "message_id": str(msg.id)}
            )
    messages.reverse()  # history() is newest-first
    return messages


async def post_messages(user_id: int, messages: list[dict]) -> dict:
    payload = {"user_id": str(user_id), "source": "discord", "messages": messages}
    headers = {"X-Ingest-Token": INGEST_TOKEN} if INGEST_TOKEN else {}
    async with aiohttp.ClientSession() as session:
        async with session.post(
            f"{BACKEND_URL}/ingest/discord",
            json=payload,
            headers=headers,
            timeout=aiohttp.ClientTimeout(total=30),
        ) as resp:
            resp.raise_for_status()
            return await resp.json()


async def build_persona(user_id: int, name: str) -> dict:
    headers = {"X-Ingest-Token": INGEST_TOKEN} if INGEST_TOKEN else {}
    async with aiohttp.ClientSession() as session:
        async with session.post(
            f"{BACKEND_URL}/personas/{user_id}/build",
            json={"name": name},
            headers=headers,
            timeout=aiohttp.ClientTimeout(total=180),  # four LLM calls run behind this
        ) as resp:
            resp.raise_for_status()
            return await resp.json()


def persona_summary(persona: dict) -> str:
    comm, prefs, emo = persona["communication"], persona["preferences"], persona["emotions"]
    lines = [
        f"**Your persona, {persona['name']}**",
        f"Tone: {comm['tone']} | Emoji: {comm['emoji_usage']} | Expressiveness: {emo['expressiveness']}",
        f"Humor: {comm['humor_style']}",
        f"Interests: {', '.join(prefs['interests'][:6]) or 'n/a'}",
        f"Values: {', '.join(prefs['values'][:6]) or 'n/a'}",
        f"Decisions: {persona['decisions']['spontaneous_vs_deliberate']}",
    ]
    if not persona.get("mongo_configured"):
        lines.append("_Note: MongoDB isn't configured on the backend, so this wasn't saved there._")
    return "\n".join(lines)[:1900]


intents = discord.Intents.default()
intents.message_content = True
bot = commands.Bot(command_prefix="!", intents=intents)


@bot.command(name="export")
async def export(ctx: commands.Context):
    """Send your own messages from this channel to gptinder. Only ever exports the caller."""
    async with ctx.typing():
        messages = await collect_messages(ctx.channel, ctx.author.id, HISTORY_LIMIT)
        if not messages:
            await ctx.reply(f"I didn't find any of your messages in the last {HISTORY_LIMIT} here.")
            return
        try:
            result = await post_messages(ctx.author.id, messages)
        except (aiohttp.ClientError, asyncio.TimeoutError) as e:
            await ctx.reply(f"Couldn't reach the gptinder backend: {e}")
            return
    await ctx.reply(
        f"Sent {len(messages)} messages to gptinder ({result['added']} new, {result['total']} total)."
    )


@bot.command(name="persona")
async def persona(ctx: commands.Context):
    """Refresh your export from this channel, build your persona, and DM you the summary."""
    async with ctx.typing():
        try:
            messages = await collect_messages(ctx.channel, ctx.author.id, HISTORY_LIMIT)
            if messages:
                await post_messages(ctx.author.id, messages)
            result = await build_persona(ctx.author.id, ctx.author.display_name)
        except aiohttp.ClientResponseError as e:
            if e.status == 404:
                await ctx.reply("I have no messages from you yet. Chat a bit here, then try `!persona` again.")
            else:
                await ctx.reply(f"The gptinder backend returned an error ({e.status}).")
            return
        except (aiohttp.ClientError, asyncio.TimeoutError) as e:
            await ctx.reply(f"Couldn't reach the gptinder backend: {e}")
            return
    # Personas describe emotions and decision style, so the details go to DMs, not the channel.
    try:
        await ctx.author.send(persona_summary(result))
    except discord.Forbidden:
        await ctx.reply("Your persona is built, but I can't DM you. Enable DMs from server members and retry.")
        return
    await ctx.reply("Your persona is built - check your DMs.")


def main():
    token = os.environ.get("DISCORD_BOT_TOKEN")
    if not token:
        raise SystemExit("DISCORD_BOT_TOKEN is not set (see bot/.env.example)")
    bot.run(token)


if __name__ == "__main__":
    main()
