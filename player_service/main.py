import asyncio
import hmac
import ipaddress
import os
import re
import socket
from collections import defaultdict
from contextlib import asynccontextmanager
from urllib.parse import urlencode, urlparse

import aiohttp
from fastapi import FastAPI, Header, HTTPException, Query
from pydantic import BaseModel, Field
from pyrogram import Client
from pytgcalls import PyTgCalls
from pytgcalls import filters as call_filters
from pytgcalls.types import StreamEnded

API_BASE = "https://nazriya.teamgod.online/api"
API_KEY = os.environ.get("NAZRIYA_API_KEY", "").strip()
API_SECRET = os.environ.get("PLAYER_API_SECRET", "").strip()
API_ID = int(os.environ.get("TG_API_ID", "0") or "0")
API_HASH = os.environ.get("TG_API_HASH", "").strip()
SESSION_STRING = os.environ.get("TG_SESSION_STRING", "").strip()
MAX_QUEUE = 30
MAX_QUERY = 120

telegram = None
calls = None
queues = defaultdict(list)
current = {}
paused = set()
locks = defaultdict(asyncio.Lock)


class PlayRequest(BaseModel):
    chat_id: int
    query: str = Field(min_length=1, max_length=MAX_QUERY)
    kind: str = Field(pattern="^(audio|video)$")
    requested_by: str = Field(default="group member", max_length=80)


class ControlRequest(BaseModel):
    chat_id: int
    action: str = Field(pattern="^(pause|resume|skip|stop|leave|volume)$")
    volume: int | None = Field(default=None, ge=1, le=200)


def _authorized(item):
    if not isinstance(item, dict):
        return False
    if item.get("authorized") is True or item.get("rights_cleared") is True or item.get("user_owned") is True:
        return True
    license_name = str(item.get("license") or item.get("licence") or item.get("rights") or "").lower()
    return any(term in license_name for term in (
        "public domain", "creative commons", "cc-by", "cc0",
        "royalty-free", "licensed", "permission granted", "user-owned"
    ))


def _items(payload):
    if isinstance(payload, list):
        return payload
    if not isinstance(payload, dict):
        return []
    for key in ("results", "data", "songs", "tracks", "items", "result"):
        value = payload.get(key)
        if isinstance(value, list):
            return value
        if isinstance(value, dict):
            for nested in ("results", "songs", "tracks", "items"):
                if isinstance(value.get(nested), list):
                    return value[nested]
    return [payload.get("data")] if isinstance(payload.get("data"), dict) else []


def _media_url(payload):
    candidates = [payload]
    if isinstance(payload, dict):
        candidates.extend(payload.get(k) for k in ("data", "result", "media"))
        for parent in (payload.get("data"), payload.get("result")):
            if isinstance(parent, dict):
                candidates.append(parent.get("media"))
    keys = ("audio_url", "video_url", "stream_url", "media_url", "download_url",
            "download_link", "downloadLink", "file_url", "url", "link")
    for candidate in candidates:
        if not isinstance(candidate, dict):
            continue
        for key in keys:
            raw = candidate.get(key)
            if isinstance(raw, str):
                parsed = urlparse(raw.strip())
                if parsed.scheme == "https" and parsed.hostname and _public_host(parsed.hostname):
                    return raw.strip()
    return ""


def _public_host(host):
    if host.lower() in {"localhost", "localhost.localdomain"}:
        return False
    try:
        ip = ipaddress.ip_address(host)
        return ip.is_global
    except ValueError:
        return True


async def _provider_json(session, url):
    async with session.get(url, headers={"Accept": "application/json"}) as response:
        if response.status >= 400:
            raise HTTPException(502, f"Music provider returned HTTP {response.status}.")
        try:
            payload = await response.json(content_type=None)
        except Exception:
            raise HTTPException(422, "Provider did not return verifiable media metadata.")
        if not isinstance(payload, dict) or payload.get("status") == "error" or payload.get("success") is False:
            raise HTTPException(502, "Music provider could not resolve this request.")
        return payload


async def _resolve_media(query, kind):
    if not API_KEY:
        raise HTTPException(503, "NAZRIYA_API_KEY is not configured on the playback service.")
    timeout = aiohttp.ClientTimeout(total=35, connect=10)
    async with aiohttp.ClientSession(timeout=timeout) as session:
        search_url = f"{API_BASE}/search"
        async with session.get(search_url, params={"q": query, "key": API_KEY},
                               headers={"Accept": "application/json"}) as response:
            if response.status >= 400:
                raise HTTPException(502, "Music search provider is unavailable.")
            try:
                search_payload = await response.json(content_type=None)
            except Exception:
                raise HTTPException(502, "Music search returned an invalid response.")
        matches = _items(search_payload)
        if not matches:
            raise HTTPException(404, "No matching song was found.")
        selected = matches[0]
        if not _authorized(selected):
            raise HTTPException(403, "This result has no verifiable permission for group playback.")
        endpoint = f"{API_BASE}/{kind}"
        media_payload = await _provider_json(
            session, endpoint + "?" + urlencode({"q": query, "key": API_KEY})
        )
        if not _authorized(media_payload) and not any(_authorized(x) for x in _items(media_payload)):
            raise HTTPException(403, "The media response does not confirm playback rights.")
        url = _media_url(media_payload)
        if not url:
            raise HTTPException(422, "Provider did not return a safe HTTPS media stream URL.")
        title = str(selected.get("title") or selected.get("name") or selected.get("song") or query)[:140]
        return {"title": title, "url": url, "kind": kind}


async def _start_next(chat_id):
    async with locks[chat_id]:
        if chat_id in current:
            return current[chat_id]
        if not queues[chat_id]:
            return None
        item = queues[chat_id].pop(0)
        try:
            await calls.play(chat_id, item["url"])
        except Exception as exc:
            print(f"[player] start failed for {chat_id}: {exc}")
            if queues[chat_id]:
                return await _start_next_unlocked(chat_id)
            raise HTTPException(502, "Could not join or stream in this group's voice chat. Check that a call is active and the player account can join.")
        current[chat_id] = item
        paused.discard(chat_id)
        return item


async def _start_next_unlocked(chat_id):
    item = queues[chat_id].pop(0)
    await calls.play(chat_id, item["url"])
    current[chat_id] = item
    paused.discard(chat_id)
    return item


async def _on_stream_end(_: PyTgCalls, update: StreamEnded):
    chat_id = int(update.chat_id)
    current.pop(chat_id, None)
    try:
        await _start_next(chat_id)
    except Exception as exc:
        print(f"[player] queue advance failed for {chat_id}: {exc}")


@asynccontextmanager
async def lifespan(_: FastAPI):
    global telegram, calls
    if not API_SECRET or not API_ID or not API_HASH or not SESSION_STRING:
        raise RuntimeError("Set PLAYER_API_SECRET, TG_API_ID, TG_API_HASH and TG_SESSION_STRING.")
    telegram = Client("piko-player", api_id=API_ID, api_hash=API_HASH,
                      session_string=SESSION_STRING, in_memory=True)
    await telegram.start()
    calls = PyTgCalls(telegram)
    calls.on_update(call_filters.stream_end())(_on_stream_end)
    calls.start()
    print("[player] Telegram group-call service is ready.")
    yield
    try:
        await calls.stop()
    except Exception:
        pass
    await telegram.stop()


app = FastAPI(title="Piko Group Call Player", version="1.0.0", lifespan=lifespan)


def _auth(authorization):
    expected = f"Bearer {API_SECRET}"
    if not API_SECRET or not authorization or not hmac.compare_digest(authorization, expected):
        raise HTTPException(401, "Unauthorized.")


@app.get("/health")
async def health():
    return {"ok": True, "service": "piko-group-call-player", "ready": calls is not None}


@app.post("/v1/play")
async def play(request: PlayRequest, authorization: str | None = Header(default=None)):
    _auth(authorization)
    query = request.query.strip()
    if not query or not re.search(r"[^\s]", query):
        raise HTTPException(400, "A song title is required.")
    media = await _resolve_media(query, request.kind)
    chat_id = int(request.chat_id)
    if len(queues[chat_id]) >= MAX_QUEUE:
        raise HTTPException(429, f"Queue is full (maximum {MAX_QUEUE} upcoming items).")
    item = {"title": media["title"], "kind": media["kind"],
            "requested_by": request.requested_by, "url": media["url"]}
    async with locks[chat_id]:
        if chat_id in current:
            queues[chat_id].append(item)
            position = len(queues[chat_id])
            return {"ok": True, "queued": True, "position": position, "title": item["title"]}
        queues[chat_id].append(item)
    started = await _start_next(chat_id)
    return {"ok": True, "queued": False, "playing": started["title"], "kind": started["kind"]}


@app.post("/v1/control")
async def control(request: ControlRequest, authorization: str | None = Header(default=None)):
    _auth(authorization)
    chat_id = int(request.chat_id)
    action = request.action
    async with locks[chat_id]:
        if action == "pause":
            if chat_id not in current:
                raise HTTPException(409, "Nothing is currently playing.")
            await calls.pause(chat_id)
            paused.add(chat_id)
            return {"ok": True, "message": "Playback paused."}
        if action == "resume":
            if chat_id not in current or chat_id not in paused:
                raise HTTPException(409, "There is no paused track to resume.")
            await calls.resume(chat_id)
            paused.discard(chat_id)
            return {"ok": True, "message": "Playback resumed."}
        if action == "volume":
            await calls.change_volume_call(chat_id, request.volume)
            return {"ok": True, "message": f"Volume set to {request.volume}%."}
        if action == "stop":
            queues[chat_id].clear()
            if chat_id in current:
                await calls.pause(chat_id)
            paused.add(chat_id)
            current.pop(chat_id, None)
            return {"ok": True, "message": "Playback stopped; player remains in the voice chat."}
        if action == "skip":
            queues[chat_id] = queues[chat_id]
            current.pop(chat_id, None)
            if queues[chat_id]:
                next_item = queues[chat_id].pop(0)
                await calls.play(chat_id, next_item["url"])
                current[chat_id] = next_item
                paused.discard(chat_id)
                return {"ok": True, "message": f"Now playing: {next_item['title']}"}
            if chat_id in paused:
                paused.discard(chat_id)
            await calls.pause(chat_id)
            return {"ok": True, "message": "Queue is empty; playback paused."}
        if action == "leave":
            queues[chat_id].clear()
            current.pop(chat_id, None)
            paused.discard(chat_id)
            await calls.leave_call(chat_id)
            return {"ok": True, "message": "Left the group call and cleared the queue."}
    raise HTTPException(400, "Unsupported player action.")


@app.get("/v1/queue")
async def queue(chat_id: int = Query(...), authorization: str | None = Header(default=None)):
    _auth(authorization)
    return {"ok": True, "current": current.get(chat_id),
            "paused": chat_id in paused, "upcoming": [
                {k: v for k, v in item.items() if k != "url"} for item in queues[chat_id]
            ]}


@app.get("/v1/status")
async def status(authorization: str | None = Header(default=None)):
    _auth(authorization)
    return {"ok": True, "ready": calls is not None, "active_groups": len(current)}
