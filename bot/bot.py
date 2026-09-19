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


def main():
    token = os.environ.get("DISCORD_BOT_TOKEN")
    if not token:
        raise SystemExit("DISCORD_BOT_TOKEN is not set (see bot/.env.example)")
    bot.run(token)


if __name__ == "__main__":
    main()
