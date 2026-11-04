"""Telegram group voice-chat music bot using a user account and PyTgCalls."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import secrets
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import aiohttp
from dotenv import load_dotenv
from pyrogram import Client, filters
from pyrogram.errors import ChatAdminRequired, UserNotParticipant
from pyrogram.types import InlineKeyboardButton, InlineKeyboardMarkup
from pytgcalls import PyTgCalls
from pytgcalls.types import AudioQuality, MediaStream, StreamEnded, VideoQuality

load_dotenv()
logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
log = logging.getLogger("anonx_music")


def required_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


API_ID = int(required_env("API_ID"))
API_HASH = required_env("API_HASH")
STRING_SESSION = required_env("STRING_SESSION")
_nazriya_base = os.getenv("NAZRIYA_API_BASE", "https://nazriya.teamgod.online/api").rstrip("/")
NAZRIYA_API_BASE = _nazriya_base if _nazriya_base.endswith("/api") else _nazriya_base + "/api"
NAZRIYA_API_KEY = required_env("NAZRIYA_API_KEY")
MAX_DOWNLOAD_MB = int(os.getenv("MAX_DOWNLOAD_MB", "500"))
DOWNLOAD_DIR = Path(os.getenv("MUSIC_DOWNLOAD_DIR", tempfile.gettempdir())) / "anonx-music"
DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)

app = Client("anonx-userbot", api_id=API_ID, api_hash=API_HASH, session_string=STRING_SESSION)
calls = PyTgCalls(app)


@dataclass
class Track:
    title: str
    url: str
    kind: str = "audio"
    path: Path | None = None


@dataclass
class ChatPlayback:
    queue: list[Track] = field(default_factory=list)
    current: Track | None = None
    paused: bool = False
    volume: int = 100
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)


playbacks: dict[int, ChatPlayback] = {}
pending_music_choices: dict[str, tuple[int, str]] = {}


def state_for(chat_id: int) -> ChatPlayback:
    return playbacks.setdefault(chat_id, ChatPlayback())


def find_urls(value: Any) -> list[str]:
    """Collect plausible media URLs from varied API response shapes."""
    found: list[str] = []
    if isinstance(value, dict):
        for key, item in value.items():
            if isinstance(item, str) and item.startswith(("http://", "https://")):
                if any(word in key.lower() for word in ("url", "audio", "video", "download", "stream", "file", "link")):
                    found.append(item)
            else:
                found.extend(find_urls(item))
    elif isinstance(value, list):
        for item in value:
            found.extend(find_urls(item))
    elif isinstance(value, str) and value.startswith(("http://", "https://")):
        found.append(value)
    return list(dict.fromkeys(found))


def find_title(value: Any, fallback: str) -> str:
    if isinstance(value, dict):
        for key in ("title", "name", "song", "track", "videoTitle"):
            if isinstance(value.get(key), str) and value[key].strip():
                return value[key].strip()
        for item in value.values():
            result = find_title(item, "")
            if result:
                return result
    elif isinstance(value, list):
        for item in value:
            result = find_title(item, "")
            if result:
                return result
    return fallback


def result_items(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, list):
        return [x for x in payload if isinstance(x, dict)]
    if isinstance(payload, dict):
        for key in ("results", "data", "songs", "tracks", "items", "videos", "result"):
            value = payload.get(key)
            if isinstance(value, list):
                return [x for x in value if isinstance(x, dict)]
            if isinstance(value, dict):
                nested = result_items(value)
                if nested:
                    return nested
    return []


async def api_request(kind: str, query: str) -> Any:
    endpoint = "search" if kind == "search" else ("video" if kind == "video" else "audio")
    timeout = aiohttp.ClientTimeout(total=45, connect=15)
    params = {"q": query}
    if NAZRIYA_API_KEY:
        params["key"] = NAZRIYA_API_KEY
    async with aiohttp.ClientSession(timeout=timeout, headers={"User-Agent": "AnonxMusicBot/1.0"}) as session:
        async with session.get(f"{NAZRIYA_API_BASE}/{endpoint}", params=params) as response:
            response.raise_for_status()
            content_type = response.headers.get("Content-Type", "")
            if "json" in content_type.lower():
                return await response.json(content_type=None)
            # Some API variants return the stream itself.
            return {"url": str(response.url), "title": query, "direct_response": True}


def tracks_from_payload(payload: Any, query: str, kind: str) -> list[Track]:
    items = result_items(payload)
    candidates = items if items else [payload]
    tracks: list[Track] = []
    for item in candidates:
        urls = find_urls(item)
        if not urls:
            continue
        title = find_title(item, query)
        tracks.append(Track(title=title, url=urls[0], kind=kind))
    return tracks


async def lookup(query: str, kind: str) -> list[Track]:
    payload = await api_request(kind, query)
    tracks = tracks_from_payload(payload, query, kind)
    if not tracks:
        raise ValueError("Nazriya returned no playable media URL for that search.")
    return tracks


async def download_track(track: Track) -> Path:
    parsed = urlparse(track.url)
    suffix = Path(parsed.path).suffix.lower()
    if suffix not in {".mp3", ".m4a", ".aac", ".ogg", ".opus", ".wav", ".mp4", ".mkv", ".webm", ".mov"}:
        suffix = ".mp4" if track.kind == "video" else ".audio"
    fd, raw_path = tempfile.mkstemp(prefix="track-", suffix=suffix, dir=DOWNLOAD_DIR)
    os.close(fd)
    path = Path(raw_path)
    timeout = aiohttp.ClientTimeout(total=900, connect=30, sock_read=120)
    try:
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.get(track.url) as response:
                response.raise_for_status()
                content_type = response.headers.get("Content-Type", "").lower()
                if not (content_type.startswith(("audio/", "video/")) or
                        "octet-stream" in content_type or "mpegurl" in content_type):
                    raise ValueError(f"Nazriya URL did not return an audio/video file (Content-Type: {content_type or 'unknown'}).")
                length = int(response.headers.get("Content-Length", "0"))
                if length and length > MAX_DOWNLOAD_MB * 1024 * 1024:
                    raise ValueError(f"Media exceeds the {MAX_DOWNLOAD_MB} MB download limit.")
                total = 0
                with path.open("wb") as output:
                    async for chunk in response.content.iter_chunked(256 * 1024):
                        total += len(chunk)
                        if total > MAX_DOWNLOAD_MB * 1024 * 1024:
                            raise ValueError(f"Media exceeds the {MAX_DOWNLOAD_MB} MB download limit.")
                        output.write(chunk)
        if not path.stat().st_size:
            raise ValueError("The media server returned an empty file.")
        return path
    except Exception:
        path.unlink(missing_ok=True)
        raise


async def set_chat_volume(chat_id: int, volume: int) -> None:
    """Apply playback volume with the PyTgCalls volume control API."""
    if state_for(chat_id).current:
        await calls.change_volume_call(chat_id, volume)


async def start_next(chat_id: int) -> bool:
    state = state_for(chat_id)
    async with state.lock:
        if not state.queue:
            state.current = None
            state.paused = False
            return False
        track = state.queue.pop(0)
        state.current = track
        state.paused = False
    try:
        path = await download_track(track)
        track.path = path
        if track.kind == "video":
            stream = MediaStream(str(path), audio_parameters=AudioQuality.HIGH, video_parameters=VideoQuality.HD_720p)
        else:
            stream = MediaStream(str(path), audio_parameters=AudioQuality.HIGH)
        await calls.play(chat_id, stream)
        await set_chat_volume(chat_id, state.volume)
        log.info("Streaming %s in chat %s", track.title, chat_id)
        return True
    except Exception as exc:
        log.exception("Unable to play %s in %s", track.title, chat_id)
        track.path.unlink(missing_ok=True) if track.path else None
        async with state.lock:
            state.current = None
        raise RuntimeError(f"Could not start **{track.title}**: {exc}") from exc


@calls.on_update()
async def on_stream_update(_, update: Any) -> None:
    if isinstance(update, StreamEnded):
        chat_id = getattr(update, "chat_id", None)
        if chat_id is None:
            return
        state = state_for(chat_id)
        # Manual skip/stop/leave clear current before leaving so their stream-end
        # event must not consume another queue item.
        if state.current is None:
            return
        if state.current and state.current.path:
            state.current.path.unlink(missing_ok=True)
        state.current = None
        try:
            await start_next(chat_id)
        except Exception:
            log.exception("Could not advance queue in chat %s", chat_id)


def chat_filter():
    return filters.group & filters.regex(r"^/(?:play|song|video|music|pause|resume|skip|stop|queue|volume|leave|search)(?:@[A-Za-z0-9_]+)?(?:\s|$)", flags=re.I)


async def status_message(message, text: str) -> None:
    await message.reply_text(text, quote=True, disable_web_page_preview=True)


async def enqueue(message, query: str, kind: str) -> None:
    query = query.strip()
    if not query:
        await status_message(message, "Give me a song or video name. Example: `/play Daft Punk One More Time`")
        return
    wait = await status_message(message, "Searching Nazriya…")
    try:
        tracks = await lookup(query, kind)
        track = tracks[0]
        state = state_for(message.chat.id)
        async with state.lock:
            state.queue.append(track)
            position = len(state.queue) + (1 if state.current else 0)
            should_start = state.current is None
        await wait.edit_text(f"Queued **{track.title}** at position {position}.")
        if should_start:
            try:
                await start_next(message.chat.id)
                await wait.edit_text(f"Now playing **{track.title}**.")
            except Exception as exc:
                await wait.edit_text(f"{exc}\n\nMake sure this group has an active voice chat and the account can join it.")
    except (aiohttp.ClientError, asyncio.TimeoutError, ValueError) as exc:
        await wait.edit_text(f"Search failed: {exc}")


@app.on_message(chat_filter())
async def command_handler(_, message):
    text = message.text or message.caption or ""
    command, _, args = text.partition(" ")
    command = command.split("@", 1)[0].lower()
    args = args.strip()
    chat_id = message.chat.id
    state = state_for(chat_id)

    if command in ("/play", "/song", "/video"):
        await enqueue(message, args, "video" if command == "/video" else "audio")
    elif command == "/music":
        if not args:
            await status_message(message, "Usage: `/music <song>`")
            return
        token = secrets.token_urlsafe(6)
        pending_music_choices[token] = (chat_id, args)
        keyboard = InlineKeyboardMarkup([[
            InlineKeyboardButton("Audio", callback_data=f"music:audio:{token}"),
            InlineKeyboardButton("Video", callback_data=f"music:video:{token}")
        ]])
        await message.reply_text(f"Choose a format for **{args}**:", reply_markup=keyboard, quote=True)
    elif command == "/search":
        if not args:
            await status_message(message, "Usage: `/search <song>`")
            return
        wait = await status_message(message, "Searching…")
        try:
            payload = await api_request("search", args)
            titles = [find_title(item, "") for item in result_items(payload)]
            titles = [title for title in titles if title]
            if not titles:
                titles = [track.title for track in tracks_from_payload(payload, args, "audio")]
            if not titles:
                await wait.edit_text("Nazriya returned no readable search results. Try another title.")
                return
            lines = [f"{i}. {title}" for i, title in enumerate(titles[:10], 1)]
            await wait.edit_text("**Search results**\n" + "\n".join(lines) +
                                 "\n\nUse /play or /video followed by the title to queue playback.")
        except Exception as exc:
            await wait.edit_text(f"Search failed: {exc}")
    elif command == "/pause":
        if not state.current:
            await status_message(message, "Nothing is playing.")
            return
        try:
            await calls.pause_stream(chat_id)
            state.paused = True
            await status_message(message, "Playback paused.")
        except Exception as exc:
            await status_message(message, f"Could not pause playback: {exc}")
    elif command == "/resume":
        if not state.current or not state.paused:
            await status_message(message, "Playback is not paused.")
            return
        try:
            await calls.resume_stream(chat_id)
            state.paused = False
            await status_message(message, "Playback resumed.")
        except Exception as exc:
            await status_message(message, f"Could not resume playback: {exc}")
    elif command == "/skip":
        if not state.current and not state.queue:
            await status_message(message, "The queue is empty.")
            return
        if state.current and state.current.path:
            state.current.path.unlink(missing_ok=True)
        state.current = None
        try:
            await calls.leave_call(chat_id)
        except Exception:
            pass
        try:
            await start_next(chat_id)
            await status_message(message, f"Skipped. Now playing **{state.current.title}**.")
        except Exception as exc:
            await status_message(message, f"Skipped. {exc}")
    elif command == "/stop":
        state.queue.clear()
        if state.current and state.current.path:
            state.current.path.unlink(missing_ok=True)
        state.current = None
        state.paused = False
        try:
            await calls.leave_call(chat_id)
        except Exception:
            pass
        await status_message(message, "Playback stopped and queue cleared.")
    elif command == "/queue":
        rows = ([f"▶️ **{state.current.title}**"] if state.current else []) + [f"{i}. {track.title}" for i, track in enumerate(state.queue, 1)]
        await status_message(message, "**Queue**\n" + ("\n".join(rows) if rows else "The queue is empty."))
    elif command == "/volume":
        if not args.isdecimal() or not 0 <= int(args) <= 100:
            await status_message(message, "Usage: `/volume 0-100`")
            return
        state.volume = int(args)
        try:
            await set_chat_volume(chat_id, state.volume)
        except Exception as exc:
            await status_message(message, f"Volume value saved, but could not apply it: {exc}")
            return
        await status_message(message, f"Volume set to {state.volume}%.")
    elif command == "/leave":
        state.queue.clear()
        if state.current and state.current.path:
            state.current.path.unlink(missing_ok=True)
        state.current = None
        state.paused = False
        try:
            await calls.leave_call(chat_id)
        except Exception:
            pass
        await status_message(message, "Left the voice chat and cleared the queue.")


@app.on_callback_query(filters.regex(r"^music:(audio|video):"))
async def music_choice(_, callback):
    if not callback.message or not callback.message.chat:
        await callback.answer("This button is no longer available.", show_alert=True)
        return
    _, kind, token = callback.data.split(":", 2)
    choice = pending_music_choices.pop(token, None)
    if not choice or choice[0] != callback.message.chat.id:
        await callback.answer("This music choice expired. Run /music again.", show_alert=True)
        return
    _, query = choice
    await callback.answer()
    await enqueue(callback.message, query, kind)


async def main() -> None:
    log.info("Starting Pyrogram user client")
    await app.start()
    await calls.start()
    log.info("Userbot is online")
    await asyncio.Event().wait()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except (KeyboardInterrupt, SystemExit):
        log.info("Shutting down")
