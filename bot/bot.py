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
BUILD_CONCURRENCY = 2  # each build is four LLM calls, so don't fan out across a whole channel at once


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


async def collect_all_messages(channel, limit: int) -> dict[int, list[dict]]:
    """Scan the last `limit` messages; group the text messages by human author id (bots and commands skipped)."""
    by_author: dict[int, list[dict]] = {}
    async for msg in channel.history(limit=limit):
        if msg.author.bot or not msg.content.strip() or msg.content.startswith(bot.command_prefix):
            continue
        by_author.setdefault(msg.author.id, []).append(
            {"content": msg.content, "timestamp": msg.created_at.isoformat(), "message_id": str(msg.id)}
        )
    for messages in by_author.values():
        messages.reverse()  # history() is newest-first
    return by_author


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


async def export_everyone(channel) -> tuple[dict[int, list[dict]], list[int], int]:
    """Scan the channel and post each person's messages under their own id. Returns (by_author, sent ids, failures)."""
    by_author = await collect_all_messages(channel, HISTORY_LIMIT)
    sent: list[int] = []
    failed = 0
    for author_id, messages in by_author.items():
        try:
            await post_messages(author_id, messages)
            sent.append(author_id)
        except (aiohttp.ClientError, asyncio.TimeoutError):
            failed += 1
    return by_author, sent, failed


@bot.command(name="exportall")
@commands.guild_only()
@commands.has_guild_permissions(manage_guild=True)
async def export_all(ctx: commands.Context):
    """Export everyone's messages from this channel, each stored under their own Discord id (needs Manage Server)."""
    async with ctx.typing():
        by_author, sent, failed = await export_everyone(ctx.channel)
    if not by_author:
        await ctx.reply(f"I didn't find any messages from people in the last {HISTORY_LIMIT} here.")
        return
    people = ", ".join(f"<@{author_id}> ({len(by_author[author_id])})" for author_id in sent)
    note = f" {failed} failed to send." if failed else ""
    await ctx.reply(
        f"Exported messages for {len(sent)} people, each saved under their own id: {people}.{note}",
        allowed_mentions=discord.AllowedMentions.none(),
    )


@bot.command(name="personaall")
@commands.guild_only()
@commands.has_guild_permissions(manage_guild=True)
async def persona_all(ctx: commands.Context):
    """Export everyone's messages here and build each person's persona under their own id (needs Manage Server)."""
    async with ctx.typing():
        by_author, sent, failed = await export_everyone(ctx.channel)
        if not by_author:
            await ctx.reply(f"I didn't find any messages from people in the last {HISTORY_LIMIT} here.")
            return
        eligible = sent
        gate = asyncio.Semaphore(BUILD_CONCURRENCY)

        async def build(author_id: int) -> bool:
            member = ctx.guild.get_member(author_id)
            name = (member.display_name if member else f"user-{author_id}")[:100]
            async with gate:
                try:
                    await build_persona(author_id, name)
                    return True
                except (aiohttp.ClientError, asyncio.TimeoutError):
                    return False

        results = await asyncio.gather(*(build(a) for a in eligible))
    built = sum(results)
    parts = [f"Built {built} personas, each saved under its own id."]
    if built < len(eligible):
        parts.append(f"{len(eligible) - built} failed to build.")
    if failed:
        parts.append(f"{failed} exports failed.")
    await ctx.reply(" ".join(parts))


@persona_all.error
async def persona_all_error(ctx: commands.Context, error: commands.CommandError):
    if isinstance(error, (commands.MissingPermissions, commands.NoPrivateMessage)):
        await ctx.reply("`!personaall` needs the Manage Server permission and only works in a server channel.")
    else:
        raise error


@export_all.error
async def export_all_error(ctx: commands.Context, error: commands.CommandError):
    if isinstance(error, (commands.MissingPermissions, commands.NoPrivateMessage)):
        await ctx.reply("`!exportall` needs the Manage Server permission and only works in a server channel.")
    else:
        raise error


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
