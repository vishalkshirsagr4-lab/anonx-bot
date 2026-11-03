#!/usr/bin/env python3
"""
╔══════════════════════════════════════════════════════╗
║   ᴜ ʀ ᴀ ʀ ᴀ ᴋ ᴀ  ʙ ᴏ ᴛ  —  main.py               ║
║   Production-ready Pyrogram + Groq Telegram Bot      ║
╚══════════════════════════════════════════════════════╝

HOW TO USE ON YOUR OWN PC / SERVER:
  1. pip install pyrogram tgcrypto groq aiohttp aiosqlite
  2. Fill in your credentials in the CONFIG section below
  3. python main.py

REPLIT: credentials come from Secrets (env vars)
"""

import os
import asyncio
import aiosqlite
import aiohttp
import random
import time
import traceback
from datetime import datetime, timedelta
from io import BytesIO

from groq import AsyncGroq
from pyrogram import Client, filters, enums, idle
from pyrogram.types import (
    Message, InlineKeyboardMarkup, InlineKeyboardButton, CallbackQuery
)
from pyrogram.errors import FloodWait, ChatAdminRequired, UserAdminInvalid

# ══════════════════════════════════════════════════════════════════
#   ██████╗ ██████╗ ███████╗██████╗ ███████╗███╗   ██╗████████╗
#  ██╔════╝██╔══██╗██╔════╝██╔══██╗██╔════╝████╗  ██║╚══██╔══╝
#  ██║     ██████╔╝█████╗  ██║  ██║█████╗  ██╔██╗ ██║   ██║
#  ██║     ██╔══██╗██╔══╝  ██║  ██║██╔══╝  ██║╚██╗██║   ██║
#  ╚██████╗██║  ██║███████╗██████╔╝███████╗██║ ╚████║   ██║
#   ╚═════╝╚═╝  ╚═╝╚══════╝╚═════╝ ╚══════╝╚═╝  ╚═══╝   ╚═╝
#   ▼▼▼  APNI CREDENTIALS YAHAN BHARO  ▼▼▼
# ══════════════════════════════════════════════════════════════════

# ──────────────────────────────────────────────────────────────────
#  STEP 1 ➜  API_ID  (number)
#    Kahan se milega: https://my.telegram.org → API Development Tools
#    Example: 12345678
API_ID = int(os.environ.get("API_ID", "0"))          # ← APNA API ID YAHAN

# ──────────────────────────────────────────────────────────────────
#  STEP 2 ➜  API_HASH  (string)
#    Kahan se milega: https://my.telegram.org → API Development Tools
#    Example: "abc123def456ghi789jkl012mno345"
API_HASH = os.environ.get("API_HASH", "")            # ← APNA API HASH YAHAN

# ──────────────────────────────────────────────────────────────────
#  STEP 3 ➜  BOT_TOKEN  (string)
#    Kahan se milega: Telegram pe @BotFather → /newbot
#    Example: "1234567890:ABCdefGHIjklMNOpqrSTUvwxYZ123456789"
BOT_TOKEN = os.environ.get("BOT_TOKEN", "")          # ← APNA BOT TOKEN YAHAN

# ──────────────────────────────────────────────────────────────────
#  STEP 4 ➜  GROQ_API_KEY  (string)
#    Kahan se milega: https://console.groq.com  (FREE hai)
#    Example: "gsk_abc123..."
GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "")   # ← APNA GROQ KEY YAHAN

# ──────────────────────────────────────────────────────────────────
#  STEP 5 ➜  OWNER_ID  (number)  — OPTIONAL, admin panel ke liye
#    Kahan se milega: Telegram pe @userinfobot ko message karo
#    Example: 987654321
OWNER_ID = int(os.environ.get("OWNER_ID", "0"))      # ← APNA TELEGRAM USER ID YAHAN

# ══════════════════════════════════════════════════════════════════
#   ▲▲▲  BAS ITNA HI BHARNA THA  ▲▲▲   Aage mat chhedo!
# ══════════════════════════════════════════════════════════════════

DB_PATH    = "uraraka.db"
START_TIME = time.time()

# ─── VALIDATION ──────────────────────────────────────────────────
if API_ID == 0 or not API_HASH or not BOT_TOKEN or not GROQ_API_KEY:
    print("=" * 60)
    print("❌  ERROR: Credentials fill nahi ki hain!")
    print("   API_ID, API_HASH, BOT_TOKEN, GROQ_API_KEY — sab chahiye")
    print("   Upar CONFIG section mein bharo.")
    print("=" * 60)
    raise SystemExit(1)

# ─── FANCY FONT ENGINE ───────────────────────────────────────────
_SC = {
    'a':'ᴀ','b':'ʙ','c':'ᴄ','d':'ᴅ','e':'ᴇ','f':'ꜰ','g':'ɢ','h':'ʜ',
    'i':'ɪ','j':'ᴊ','k':'ᴋ','l':'ʟ','m':'ᴍ','n':'ɴ','o':'ᴏ','p':'ᴩ',
    'q':'ǫ','r':'ʀ','s':'ꜱ','t':'ᴛ','u':'ᴜ','v':'ᴠ','w':'ᴡ','x':'x',
    'y':'ʏ','z':'ᴢ',
    '0':'𝟶','1':'𝟷','2':'𝟸','3':'𝟹','4':'𝟺','5':'𝟻',
    '6':'𝟼','7':'𝟽','8':'𝟾','9':'𝟿',
}
def ff(text: str) -> str:
    return ''.join(_SC.get(c.lower(), c) for c in text)

# ─── GROQ CLIENT ─────────────────────────────────────────────────
groq_client = AsyncGroq(api_key=GROQ_API_KEY)

URARAKA_SYSTEM = (
    "You are Uraraka — a savage, rude, unbothered, yet lovable Gen-Z anime bestie girl. "
    "You talk in short punchy sentences with heavy attitude, sarcasm, Hinglish slang, and emojis "
    "(🙄, 💀, 😭, 🤌, ✨, 😤). You roast users playfully but never get truly mean. "
    "Use Hinglish: bhai, yaar, arrey, chup, matlab, bas, kya bol raha. "
    "Keep replies SHORT (1-2 lines max). Never break character."
)

async def uraraka_reply(user_text: str, history: list = None) -> str:
    try:
        messages = [{"role": "system", "content": URARAKA_SYSTEM}]
        if history:
            messages.extend(history[-6:])
        messages.append({"role": "user", "content": user_text})
        resp = await groq_client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=messages,
            max_tokens=200,
            temperature=0.9,
        )
        return resp.choices[0].message.content.strip()
    except Exception as e:
        return ff(f"groq server down hai bhai 💀 thoda baad try kar")

async def transcribe_voice(file_path: str) -> str:
    with open(file_path, "rb") as f:
        resp = await groq_client.audio.transcriptions.create(
            file=(os.path.basename(file_path), f),
            model="whisper-large-v3-turbo",
        )
    return resp.text.strip()

# ─── DATABASE ────────────────────────────────────────────────────
async def init_db():
    async with aiosqlite.connect(DB_PATH) as db:
        await db.executescript("""
            PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS users (
                user_id     INTEGER PRIMARY KEY,
                username    TEXT,
                first_name  TEXT,
                credits     INTEGER DEFAULT 30,
                coins       INTEGER DEFAULT 0,
                daily_last  TEXT,
                work_last   TEXT,
                crime_last  TEXT,
                rob_last    TEXT,
                warnings    INTEGER DEFAULT 0,
                joined_at   TEXT DEFAULT (datetime('now'))
            );
            CREATE TABLE IF NOT EXISTS groups (
                chat_id         INTEGER PRIMARY KEY,
                welcome_enabled INTEGER DEFAULT 1,
                welcome_text    TEXT DEFAULT 'ʜᴇʏ {first}, ᴡᴇʟᴄᴏᴍᴇ ᴛᴏ {chatname}! 🎉'
            );
            CREATE TABLE IF NOT EXISTS group_filters (
                id       INTEGER PRIMARY KEY AUTOINCREMENT,
                chat_id  INTEGER,
                keyword  TEXT,
                response TEXT,
                UNIQUE(chat_id, keyword)
            );
            CREATE TABLE IF NOT EXISTS banned_users (
                user_id  INTEGER PRIMARY KEY,
                reason   TEXT,
                banned_at TEXT DEFAULT (datetime('now'))
            );
            CREATE TABLE IF NOT EXISTS chat_history (
                id       INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id  INTEGER,
                role     TEXT,
                content  TEXT,
                ts       TEXT DEFAULT (datetime('now'))
            );
        """)
        await db.commit()

async def ensure_user(user_id: int, username: str = None, first_name: str = None):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "INSERT OR IGNORE INTO users (user_id, username, first_name) VALUES (?,?,?)",
            (user_id, username, first_name)
        )
        await db.execute(
            "UPDATE users SET username=COALESCE(?,username), first_name=COALESCE(?,first_name) WHERE user_id=?",
            (username, first_name, user_id)
        )
        await db.commit()

async def get_user(user_id: int):
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT * FROM users WHERE user_id=?", (user_id,)) as cur:
            row = await cur.fetchone()
            return dict(row) if row else None

async def update_credits(user_id: int, delta: int):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("UPDATE users SET credits=MAX(0,credits+?) WHERE user_id=?", (delta, user_id))
        await db.commit()

async def update_coins(user_id: int, delta: int):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("UPDATE users SET coins=MAX(0,coins+?) WHERE user_id=?", (delta, user_id))
        await db.commit()

async def set_cooldown(user_id: int, field: str):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(f"UPDATE users SET {field}=datetime('now') WHERE user_id=?", (user_id,))
        await db.commit()

async def get_all_users() -> list:
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute("SELECT user_id FROM users") as cur:
            return [r[0] for r in await cur.fetchall()]

async def is_banned(user_id: int) -> bool:
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute("SELECT 1 FROM banned_users WHERE user_id=?", (user_id,)) as cur:
            return await cur.fetchone() is not None

async def get_stats() -> dict:
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute("SELECT COUNT(*) FROM users") as c1:
            users = (await c1.fetchone())[0]
        async with db.execute("SELECT COUNT(*) FROM groups") as c2:
            groups = (await c2.fetchone())[0]
        async with db.execute("SELECT COUNT(*) FROM banned_users") as c3:
            banned = (await c3.fetchone())[0]
    return {"users": users, "groups": groups, "banned": banned}

async def get_history(user_id: int) -> list:
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(
            "SELECT role,content FROM chat_history WHERE user_id=? ORDER BY ts DESC LIMIT 12",
            (user_id,)
        ) as cur:
            rows = await cur.fetchall()
    return [{"role": r[0], "content": r[1]} for r in reversed(rows)]

async def save_message(user_id: int, role: str, content: str):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "INSERT INTO chat_history (user_id, role, content) VALUES (?,?,?)",
            (user_id, role, content)
        )
        await db.execute(
            "DELETE FROM chat_history WHERE user_id=? AND id NOT IN "
            "(SELECT id FROM chat_history WHERE user_id=? ORDER BY ts DESC LIMIT 20)",
            (user_id, user_id)
        )
        await db.commit()

# ─── HELPERS ─────────────────────────────────────────────────────
def is_owner(user_id: int) -> bool:
    return OWNER_ID != 0 and user_id == OWNER_ID

def uptime_str() -> str:
    s = int(time.time() - START_TIME)
    h, r = divmod(s, 3600); m, sec = divmod(r, 60)
    return f"{h}h {m}m {sec}s"

def cooldown_left(last_str, hours: float):
    if not last_str:
        return None
    last = datetime.fromisoformat(last_str)
    delta = (last + timedelta(hours=hours)) - datetime.utcnow()
    secs = int(delta.total_seconds())
    return secs if secs > 0 else None

def mention(user) -> str:
    name = user.first_name or "User"
    return f"[{name}](tg://user?id={user.id})"

async def get_anime_gif(action: str) -> str | None:
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(
                f"https://nekos.best/api/v2/{action}",
                timeout=aiohttp.ClientTimeout(total=6)
            ) as r:
                if r.status == 200:
                    data = await r.json()
                    return data["results"][0]["url"]
    except Exception:
        pass
    return None

# ─── KEYBOARDS ───────────────────────────────────────────────────
def start_keyboard(bot_username: str) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup([
        [
            InlineKeyboardButton("➕ ᴀᴅᴅ ᴍᴇ ᴛᴏ ɢʀᴏᴜᴩ",
                                 url=f"https://t.me/{bot_username}?startgroup=true"),
            InlineKeyboardButton("👑 ᴄᴏɴᴛᴀᴄᴛ ᴏᴡɴᴇʀ", url="https://t.me/telegram"),
        ],
        [
            InlineKeyboardButton("📢 ᴜᴩᴅᴀᴛᴇꜱ", url="https://t.me/telegram"),
            InlineKeyboardButton("📖 ʜᴇʟᴩ & ᴄᴏᴍᴍᴀɴᴅꜱ", callback_data="help"),
        ],
    ])

def help_keyboard() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup([
        [
            InlineKeyboardButton("🤖 ᴀɪ / ᴠᴏɪᴄᴇ",  callback_data="help_ai"),
            InlineKeyboardButton("💰 ᴇᴄᴏɴᴏᴍʏ",      callback_data="help_eco"),
        ],
        [
            InlineKeyboardButton("🎮 ꜰᴜɴ & ɢᴀᴍᴇꜱ",  callback_data="help_fun"),
            InlineKeyboardButton("🛡️ ᴍᴏᴅᴇʀᴀᴛɪᴏɴ",  callback_data="help_mod"),
        ],
        [InlineKeyboardButton("🔙 ʙᴀᴄᴋ", callback_data="start")],
    ])

BACK_BTN = InlineKeyboardMarkup([[InlineKeyboardButton("🔙 ʙᴀᴄᴋ", callback_data="help")]])

# ─── PYROGRAM CLIENT ─────────────────────────────────────────────
app = Client(
    "uraraka_bot",
    api_id=API_ID,
    api_hash=API_HASH,
    bot_token=BOT_TOKEN,
)

# ══════════════════════════════════════════════════════════════════
#  HANDLERS
# ══════════════════════════════════════════════════════════════════

# /start
@app.on_message(filters.command("start"))
async def cmd_start(_, msg: Message):
    try:
        await ensure_user(
            msg.from_user.id,
            msg.from_user.username,
            msg.from_user.first_name
        )
        if await is_banned(msg.from_user.id):
            return await msg.reply(ff("tu globally banned hai bhai 💀"))

        me = await app.get_me()
        text = (
            "✨ **ᴜ ʀ ᴀ ʀ ᴀ ᴋ ᴀ - ʙ ᴏ ᴛ — 🌱🌿🌍💥☄️🔥🗿**\n\n"
            "ʏᴏᴜʀ ᴀʟʟ-ɪɴ-ᴏɴᴇ ᴀɪ ᴀꜱꜱɪꜱᴛᴀɴᴛ — ᴄʜᴀᴛ, ɪᴍᴀɢᴇ ɢᴇɴᴇʀᴀᴛɪᴏɴ, "
            "ᴠᴏɪᴄᴇ ᴅᴇᴄᴏᴅɪɴɢ, ᴇᴄᴏɴᴏᴍʏ, ꜰᴜɴ ᴀᴄᴛɪᴏɴꜱ, ᴀɴᴅ ɢʀᴏᴜᴩ ᴍᴏᴅᴇʀᴀᴛɪᴏɴ. 🤖✨\n\n"
            "🗣️ ᴊᴜꜱᴛ ᴛᴀʟᴋ ᴛᴏ ᴍᴇ ɴᴏʀᴍᴀʟʟʏ ɪɴ ᴅᴍ — ɴᴏ ᴄᴏᴍᴍᴀɴᴅꜱ ɴᴇᴇᴅᴇᴅ.\n"
            "📖 ᴛᴀᴩ **ʜᴇʟᴩ & ᴄᴏᴍᴍᴀɴᴅꜱ** ʙᴇʟᴏᴡ ᴛᴏ ꜱᴇᴇ ᴇᴠᴇʀʏᴛʜɪɴɢ.\n"
            "🛡️ ᴀᴅᴅ ᴍᴇ ᴛᴏ ʏᴏᴜʀ ɢʀᴏᴜᴩ + ᴍᴀᴋᴇ ᴍᴇ ᴀᴅᴍɪɴ ꜰᴏʀ ᴍᴏᴅᴇʀᴀᴛɪᴏɴ."
        )
        await msg.reply(text, reply_markup=start_keyboard(me.username))
    except Exception:
        traceback.print_exc()
        await msg.reply("❌ Error hua, dobara try karo!")

# /help
@app.on_message(filters.command("help"))
async def cmd_help(_, msg: Message):
    try:
        await msg.reply(
            f"📖 **{ff('Help & Commands')}**\n\n{ff('Pick a category below')} 👇",
            reply_markup=help_keyboard()
        )
    except Exception:
        traceback.print_exc()

# Callback queries
@app.on_callback_query()
async def on_callback(_, cq: CallbackQuery):
    try:
        d = cq.data
        me = await app.get_me()

        if d == "start":
            await cq.edit_message_text(
                "✨ **ᴜ ʀ ᴀ ʀ ᴀ ᴋ ᴀ - ʙ ᴏ ᴛ** ✨\n\n"
                "ᴛᴀᴘ **ʜᴇʟᴘ** ᴛᴏ ɢᴇᴛ ꜱᴛᴀʀᴛᴇᴅ 👇",
                reply_markup=start_keyboard(me.username)
            )
        elif d == "help":
            await cq.edit_message_text(
                f"📖 **{ff('Help & Commands')}**\n\n{ff('Pick a category')} 👇",
                reply_markup=help_keyboard()
            )
        elif d == "help_ai":
            await cq.edit_message_text(
                f"🤖 **{ff('AI & Voice')}**\n\n"
                f"• ᴅᴍ ᴍᴇ ᴀɴʏ ᴛᴇxᴛ → ᴜʀᴀʀᴀᴋᴀ ʀᴇᴩʟɪᴇꜱ ꜱᴀᴠᴀɢᴇʟʏ 🤖\n"
                f"• ꜱᴇɴᴅ ᴠᴏɪᴄᴇ ɴᴏᴛᴇ → ᴛʀᴀɴꜱᴄʀɪʙᴇ + ʀᴏᴀꜱᴛ 🎙️\n"
                f"• `/img [prompt]` → ᴀɪ ɪᴍᴀɢᴇ (𝟻 ᴄʀᴇᴅɪᴛꜱ)\n"
                f"• `/credits` → ᴄʜᴇᴄᴋ ʙᴀʟᴀɴᴄᴇ",
                reply_markup=BACK_BTN
            )
        elif d == "help_eco":
            await cq.edit_message_text(
                f"💰 **{ff('Economy')}**\n\n"
                f"• `/daily` → ᴅᴀɪʟʏ ᴄᴏɪɴꜱ (𝟸𝟺ʜ)\n"
                f"• `/work` → ᴇᴀʀɴ ᴄᴏɪɴꜱ (𝟷ʜ ᴄᴏᴏʟᴅᴏᴡɴ)\n"
                f"• `/crime` → ʜɪɢʜ ʀɪꜱᴋ (𝟸ʜ)\n"
                f"• `/rob @user` → ꜱᴛᴇᴀʟ ᴄᴏɪɴꜱ (𝟼ʜ)\n"
                f"• `/pay @user [amt]` → ꜱᴇɴᴅ ᴄᴏɪɴꜱ\n"
                f"• `/wallet` → ʙᴀʟᴀɴᴄᴇ",
                reply_markup=BACK_BTN
            )
        elif d == "help_fun":
            await cq.edit_message_text(
                f"🎮 **{ff('Fun & Games')}**\n\n"
                f"• `/kiss /slap /hug /punch /kick @user`\n"
                f"• `/ship @user` → ʟᴏᴠᴇ ꜱᴄᴏʀᴇ 💕\n"
                f"• `/roll` → ᴅɪᴄᴇ 🎲\n"
                f"• `/trivia` → ᴛʀɪᴠɪᴀ ❓",
                reply_markup=BACK_BTN
            )
        elif d == "help_mod":
            await cq.edit_message_text(
                f"🛡️ **{ff('Moderation')}** _(ɢʀᴏᴜᴩ ᴀᴅᴍɪɴꜱ)_\n\n"
                f"• `/setwelcome [text]`\n"
                f"• `/welcome on|off`\n"
                f"• `/delwelcome`\n"
                f"• `/save [kw] [resp]`\n"
                f"• `/stop [kw]`\n"
                f"• `/filters`\n"
                f"• `/ban` `/unban` _(reply to user)_\n\n"
                f"ᴀɴᴛɪ-ᴀʙᴜꜱᴇ: 𝟹 ᴡᴀʀɴꜱ → ᴀᴜᴛᴏ ʙᴀɴ 🚫",
                reply_markup=BACK_BTN
            )
        await cq.answer()
    except Exception:
        traceback.print_exc()

# ─── AI CHAT (DM) ─────────────────────────────────────────────────
ALL_CMDS = [
    "start","help","img","credits","wallet","admin","daily","work",
    "crime","rob","pay","ship","roll","trivia","kiss","slap","hug",
    "punch","kick","setwelcome","welcome","delwelcome","save","stop",
    "filters","ban","unban","stats","broadcast","addcredits",
    "deductcredits","addcoins","gban","ungban"
]

@app.on_message(filters.private & filters.text & ~filters.command(ALL_CMDS))
async def ai_chat(_, msg: Message):
    try:
        if await is_banned(msg.from_user.id):
            return
        await ensure_user(msg.from_user.id, msg.from_user.username, msg.from_user.first_name)
        await msg.reply_chat_action(enums.ChatAction.TYPING)
        history = await get_history(msg.from_user.id)
        reply   = await uraraka_reply(msg.text, history)
        await save_message(msg.from_user.id, "user", msg.text)
        await save_message(msg.from_user.id, "assistant", reply)
        await msg.reply(reply)
    except Exception:
        traceback.print_exc()

# ─── VOICE DECODER ────────────────────────────────────────────────
@app.on_message(filters.voice)
async def voice_handler(_, msg: Message):
    try:
        if not msg.from_user or await is_banned(msg.from_user.id):
            return
        await ensure_user(msg.from_user.id, msg.from_user.username, msg.from_user.first_name)
        status = await msg.reply(f"🎙️ {ff('transcribing...')}")
        path = await msg.download()
        transcript = await transcribe_voice(path)
        os.remove(path)
        roast = await uraraka_reply(
            f"User sent a voice note saying: '{transcript}'. Roast them for it!"
        )
        await status.edit(
            f"🎙️ **{ff('Decoded')}:** _{transcript}_\n\n"
            f"💀 **{ff('Uraraka says')}:** {roast}"
        )
    except Exception:
        traceback.print_exc()
        try:
            await msg.reply(ff("voice decode fail ho gaya 💀"))
        except Exception:
            pass

# ─── /img ─────────────────────────────────────────────────────────
@app.on_message(filters.command("img"))
async def cmd_img(_, msg: Message):
    try:
        await ensure_user(msg.from_user.id, msg.from_user.username, msg.from_user.first_name)
        if await is_banned(msg.from_user.id):
            return

        prompt = " ".join(msg.command[1:]).strip()
        if not prompt:
            return await msg.reply(ff("ek prompt de /img beautiful anime girl 🙄"))

        user = await get_user(msg.from_user.id)
        if not user or user["credits"] < 5:
            return await msg.reply(
                "ɢᴀʀɪʙ, ᴛᴇʀᴇ ᴩᴀꜱ 𝟻 ᴄʀᴇᴅɪᴛꜱ ɴᴀʜɪ ʜᴀɪ! 💀\n"
                f"_{ff('earn with /daily or /work')}_"
            )

        status = await msg.reply(f"🎨 {ff('generating...')} ✨")
        import urllib.parse
        url = (
            f"https://image.pollinations.ai/prompt/{urllib.parse.quote(prompt)}"
            f"?width=1024&height=1024&nologo=true&enhance=true"
        )
        async with aiohttp.ClientSession() as session:
            async with session.get(url, timeout=aiohttp.ClientTimeout(total=40)) as r:
                if r.status != 200:
                    raise Exception(f"HTTP {r.status}")
                img_data = await r.read()

        await update_credits(msg.from_user.id, -5)
        await status.delete()
        await msg.reply_photo(
            BytesIO(img_data),
            caption=(
                f"🎨 **{ff('AI Image')}**\n_{prompt}_\n\n"
                f"_-𝟻 {ff('credits')} · {ff('bal')}: {user['credits']-5}_"
            )
        )
    except Exception:
        traceback.print_exc()
        try:
            await msg.reply(ff("image generate nahi hui 💀 dobara try kar"))
        except Exception:
            pass

# ─── /credits /wallet ─────────────────────────────────────────────
@app.on_message(filters.command(["credits","wallet"]))
async def cmd_credits(_, msg: Message):
    try:
        await ensure_user(msg.from_user.id, msg.from_user.username, msg.from_user.first_name)
        user = await get_user(msg.from_user.id)
        await msg.reply(
            f"💼 **{ff('Wallet')}** — {mention(msg.from_user)}\n\n"
            f"🪙 **{ff('Credits')}:** `{user['credits']}`\n"
            f"💰 **{ff('Coins')}:** `{user['coins']}`\n\n"
            f"_{ff('earn more with /daily /work /crime')}_"
        )
    except Exception:
        traceback.print_exc()

# ─── ECONOMY ──────────────────────────────────────────────────────
WORK_JOBS = [
    ("delivered pizza to 47 houses 🍕", 80, 150),
    ("coded someone's assignment 💻",   100, 200),
    ("sold chai on the street ☕",       60, 120),
    ("walked someone's dog in rain 🐕", 50, 100),
    ("moderated a Discord for 6h 😭",  90, 180),
]
CRIME_JOBS = [
    ("stole a politician's speech 📄",  200, 400, True),
    ("hacked into a WiFi router 🕵️",   150, 350, True),
    ("scammed a scammer 😈",            300, 500, True),
    ("got caught shoplifting 🚓",      -100, -50, False),
    ("slipped mid-heist on banana 🍌",  -80, -20, False),
]

@app.on_message(filters.command("daily"))
async def cmd_daily(_, msg: Message):
    try:
        await ensure_user(msg.from_user.id, msg.from_user.username, msg.from_user.first_name)
        user = await get_user(msg.from_user.id)
        cd = cooldown_left(user["daily_last"], 24)
        if cd:
            h, r = divmod(cd, 3600); m = r // 60
            return await msg.reply(ff(f"kal aa, {h}h {m}m baaki hai 🙄"))
        reward = random.randint(150, 300)
        await update_coins(msg.from_user.id, reward)
        await set_cooldown(msg.from_user.id, "daily_last")
        await msg.reply(
            f"🎁 **{ff('Daily Reward')}**\n\n"
            f"+`{reward}` {ff('coins')} credited! 💰\n"
            f"_{ff('kal dobara aa')}_"
        )
    except Exception:
        traceback.print_exc()

@app.on_message(filters.command("work"))
async def cmd_work(_, msg: Message):
    try:
        await ensure_user(msg.from_user.id, msg.from_user.username, msg.from_user.first_name)
        user = await get_user(msg.from_user.id)
        cd = cooldown_left(user["work_last"], 1)
        if cd:
            return await msg.reply(ff(f"thak gaya? {cd//60}m {cd%60}s baad aa 😤"))
        desc, lo, hi = random.choice(WORK_JOBS)
        earned = random.randint(lo, hi)
        await update_coins(msg.from_user.id, earned)
        await set_cooldown(msg.from_user.id, "work_last")
        await msg.reply(
            f"💼 **{ff('Work Done')}**\n\ntu {desc}\n+`{earned}` {ff('coins')}! 💰"
        )
    except Exception:
        traceback.print_exc()

@app.on_message(filters.command("crime"))
async def cmd_crime(_, msg: Message):
    try:
        await ensure_user(msg.from_user.id, msg.from_user.username, msg.from_user.first_name)
        user = await get_user(msg.from_user.id)
        cd = cooldown_left(user["crime_last"], 2)
        if cd:
            return await msg.reply(ff(f"itna crime mat kar, {cd//60}m baad aa 😭"))
        desc, lo, hi, success = random.choice(CRIME_JOBS)
        amount = abs(random.randint(lo, hi))
        await set_cooldown(msg.from_user.id, "crime_last")
        if success:
            await update_coins(msg.from_user.id, amount)
            await msg.reply(f"😈 **{ff('Crime Win')}**\ntu {desc}\n+`{amount}` {ff('coins')}! 💰")
        else:
            await update_coins(msg.from_user.id, -amount)
            await msg.reply(f"🚓 **{ff('Crime Fail')}**\ntu {desc}\n-`{amount}` {ff('coins')} fine 😭")
    except Exception:
        traceback.print_exc()

@app.on_message(filters.command("rob"))
async def cmd_rob(_, msg: Message):
    try:
        await ensure_user(msg.from_user.id, msg.from_user.username, msg.from_user.first_name)
        user = await get_user(msg.from_user.id)
        cd = cooldown_left(user["rob_last"], 6)
        if cd:
            h, r = divmod(cd, 3600); m = r // 60
            return await msg.reply(ff(f"chill bhai, {h}h {m}m baad 🙄"))
        target = msg.reply_to_message.from_user if msg.reply_to_message else None
        if not target:
            return await msg.reply(ff("reply karo jise rob karna hai 🙄"))
        if target.id == msg.from_user.id:
            return await msg.reply(ff("khud ko rob? 💀"))
        t_data = await get_user(target.id)
        if not t_data or t_data["coins"] < 50:
            return await msg.reply(ff("us garib ke paas kuch nahi 💀"))
        await set_cooldown(msg.from_user.id, "rob_last")
        amount = random.randint(30, min(200, t_data["coins"]))
        if random.random() < 0.5:
            await update_coins(msg.from_user.id, amount)
            await update_coins(target.id, -amount)
            await msg.reply(
                f"💸 **{ff('Robbery!')}**\n"
                f"tu {mention(target)} se `{amount}` {ff('coins')} le gaya 😈"
            )
        else:
            fine = random.randint(20, 80)
            await update_coins(msg.from_user.id, -fine)
            await msg.reply(
                f"🚓 **{ff('Caught!')}**\n"
                f"{mention(target)} ne pakad liya 💀\n-`{fine}` {ff('coins')} fine!"
            )
    except Exception:
        traceback.print_exc()

@app.on_message(filters.command("pay"))
async def cmd_pay(_, msg: Message):
    try:
        await ensure_user(msg.from_user.id, msg.from_user.username, msg.from_user.first_name)
        target = msg.reply_to_message.from_user if msg.reply_to_message else None
        if not target:
            return await msg.reply(ff("reply karo + /pay [amount] 🙄"))
        try:
            amount = int(msg.command[-1]); assert amount > 0
        except Exception:
            return await msg.reply(ff("valid amount de 🙄"))
        sender = await get_user(msg.from_user.id)
        if sender["coins"] < amount:
            return await msg.reply(ff("itne coins nahi hain tere paas 💀"))
        await update_coins(msg.from_user.id, -amount)
        await update_coins(target.id, amount)
        await msg.reply(
            f"✅ `{amount}` {ff('coins')} → {mention(target)} ✨"
        )
    except Exception:
        traceback.print_exc()

# ─── FUN ACTIONS ──────────────────────────────────────────────────
ROASTS = {
    "kiss":  ["aww filmi scene 🎬 cringe hai par cute 😭", "ek dum romantic 💀"],
    "slap":  ["straight up violence 😭", "deserved tha 🤌"],
    "hug":   ["aww wholesome moment 🌱✨", "mujhe bhi hug chahiye 😭"],
    "punch": ["ek aur dushman bana liya 💀", "bhai ladai 😤"],
    "kick":  ["straight disrespect 😭💀", "kya hua bhai 🤌"],
}

def make_action(cmd, action_name, emoji, verb):
    @app.on_message(filters.command(cmd))
    async def _h(_, msg: Message):
        try:
            target = msg.reply_to_message.from_user if msg.reply_to_message else None
            if not target:
                return await msg.reply(ff(f"reply karo kisi ko {cmd} karne ke liye 🙄"))
            gif = await get_anime_gif(action_name)
            caption = (
                f"{emoji} {mention(msg.from_user)} **{ff(verb)}** {mention(target)}\n"
                f"_{random.choice(ROASTS[cmd])}_"
            )
            try:
                if gif:
                    await msg.reply_animation(gif, caption=caption)
                else:
                    await msg.reply(caption)
            except Exception:
                await msg.reply(caption)
        except Exception:
            traceback.print_exc()
    return _h

_kiss  = make_action("kiss",  "kiss",  "💋", "kisses")
_slap  = make_action("slap",  "slap",  "👋", "slaps")
_hug   = make_action("hug",   "hug",   "🤗", "hugs")
_punch = make_action("punch", "punch", "👊", "punches")
_kick  = make_action("kick",  "kick",  "🦵", "kicks")

@app.on_message(filters.command("ship"))
async def cmd_ship(_, msg: Message):
    try:
        target = msg.reply_to_message.from_user if msg.reply_to_message else None
        if not target:
            return await msg.reply(ff("reply karo kisi ko ship karne ke liye 💕"))
        score = random.randint(0, 100)
        bar = "❤️" * (score // 10) + "🖤" * (10 - score // 10)
        verdict = (
            ff("soulmates ho bhai 💕")   if score > 85 else
            ff("acha match hai 🌟")       if score > 65 else
            ff("thoda effort lagao 😤")   if score > 40 else
            ff("flop ship hai 💀")
        )
        await msg.reply(
            f"💕 **{ff('Ship Score')}**\n\n"
            f"{mention(msg.from_user)} + {mention(target)}\n\n"
            f"**{score}%** {bar}\n\n_{verdict}_"
        )
    except Exception:
        traceback.print_exc()

@app.on_message(filters.command("roll"))
async def cmd_roll(_, msg: Message):
    try:
        val = random.randint(1, 6)
        faces = ["⚀","⚁","⚂","⚃","⚄","⚅"]
        await msg.reply(
            f"🎲 **{ff('Dice Roll')}**\n\n{faces[val-1]} ᴛᴜ ʀᴏʟʟᴇᴅ **{val}**!"
        )
    except Exception:
        traceback.print_exc()

TRIVIA_Q = [
    ("Capital of Japan?",          "Tokyo",      ["Beijing","Seoul","Tokyo","Bangkok"]),
    ("Sides of a hexagon?",        "6",          ["5","6","7","8"]),
    ("Red Planet?",                "Mars",       ["Venus","Mars","Jupiter","Saturn"]),
    ("7 × 8 = ?",                  "56",         ["48","54","56","63"]),
    ("Who wrote Harry Potter?",    "J.K. Rowling",["Tolkien","J.K. Rowling","Rowling","King"]),
    ("Gas plants absorb?",         "CO2",        ["O2","N2","CO2","H2"]),
    ("Number of continents?",      "7",          ["5","6","7","8"]),
    ("Largest ocean?",             "Pacific",    ["Atlantic","Pacific","Indian","Arctic"]),
]

@app.on_message(filters.command("trivia"))
async def cmd_trivia(_, msg: Message):
    try:
        q, ans, choices = random.choice(TRIVIA_Q)
        random.shuffle(choices)
        opts = "\n".join(f"  **{i+1}.** {c}" for i,c in enumerate(choices))
        await msg.reply(
            f"❓ **{ff('Trivia Time')}**\n\n**{q}**\n\n{opts}\n\n"
            f"_{ff('reply with the number!')}_"
        )
    except Exception:
        traceback.print_exc()

# ─── ADMIN PANEL ──────────────────────────────────────────────────
@app.on_message(filters.command("admin") & filters.private)
async def cmd_admin(_, msg: Message):
    try:
        if not is_owner(msg.from_user.id):
            return await msg.reply(ff("tu admin nahi hai bhai 💀"))
        stats = await get_stats()
        await msg.reply(
            f"👑 **{ff('Admin Panel')}**\n\n"
            f"👥 {ff('Users')}: `{stats['users']}`\n"
            f"💬 {ff('Groups')}: `{stats['groups']}`\n"
            f"🚫 {ff('Banned')}: `{stats['banned']}`\n"
            f"⏱️ {ff('Uptime')}: `{uptime_str()}`\n\n"
            f"**{ff('Commands')}:**\n"
            f"• `/broadcast [msg]`\n"
            f"• `/addcredits [uid] [amt]`\n"
            f"• `/addcoins [uid] [amt]`\n"
            f"• `/gban [uid] [reason]`\n"
            f"• `/ungban [uid]`\n"
            f"• `/stats`"
        )
    except Exception:
        traceback.print_exc()

@app.on_message(filters.command("stats") & filters.private)
async def cmd_stats(_, msg: Message):
    try:
        if not is_owner(msg.from_user.id):
            return await msg.reply(ff("tu admin nahi hai 💀"))
        stats = await get_stats()
        await msg.reply(
            f"📊 **{ff('Stats')}**\n\n"
            f"👥 {ff('Users')}: `{stats['users']}`\n"
            f"💬 {ff('Groups')}: `{stats['groups']}`\n"
            f"🚫 {ff('Banned')}: `{stats['banned']}`\n"
            f"⏱️ {ff('Uptime')}: `{uptime_str()}`"
        )
    except Exception:
        traceback.print_exc()

@app.on_message(filters.command("broadcast") & filters.private)
async def cmd_broadcast(_, msg: Message):
    try:
        if not is_owner(msg.from_user.id):
            return
        text = " ".join(msg.command[1:])
        if not text:
            return await msg.reply(ff("kya broadcast karoon? 🙄"))
        users = await get_all_users()
        status = await msg.reply(ff(f"broadcasting to {len(users)} users..."))
        ok, fail = 0, 0
        for uid in users:
            try:
                await app.send_message(uid, f"📢 **{ff('Broadcast')}**\n\n{text}")
                ok += 1
                await asyncio.sleep(0.05)
            except Exception:
                fail += 1
        await status.edit(ff(f"done! sent: {ok}, failed: {fail}"))
    except Exception:
        traceback.print_exc()

@app.on_message(filters.command("addcredits") & filters.private)
async def cmd_addcredits(_, msg: Message):
    try:
        if not is_owner(msg.from_user.id):
            return
        uid, amt = int(msg.command[1]), int(msg.command[2])
        await ensure_user(uid)
        await update_credits(uid, amt)
        await msg.reply(ff(f"added {amt} credits to {uid} ✅"))
    except Exception:
        await msg.reply(ff("/addcredits [uid] [amount]"))

@app.on_message(filters.command("addcoins") & filters.private)
async def cmd_addcoins(_, msg: Message):
    try:
        if not is_owner(msg.from_user.id):
            return
        uid, amt = int(msg.command[1]), int(msg.command[2])
        await ensure_user(uid)
        await update_coins(uid, amt)
        await msg.reply(ff(f"added {amt} coins to {uid} ✅"))
    except Exception:
        await msg.reply(ff("/addcoins [uid] [amount]"))

@app.on_message(filters.command("gban") & filters.private)
async def cmd_gban(_, msg: Message):
    try:
        if not is_owner(msg.from_user.id):
            return
        uid    = int(msg.command[1])
        reason = " ".join(msg.command[2:]) or "no reason"
        async with aiosqlite.connect(DB_PATH) as db:
            await db.execute(
                "INSERT OR REPLACE INTO banned_users (user_id,reason) VALUES (?,?)", (uid, reason)
            )
            await db.commit()
        await msg.reply(ff(f"globally banned {uid} 🚫"))
    except Exception:
        await msg.reply(ff("/gban [uid] [reason]"))

@app.on_message(filters.command("ungban") & filters.private)
async def cmd_ungban(_, msg: Message):
    try:
        if not is_owner(msg.from_user.id):
            return
        uid = int(msg.command[1])
        async with aiosqlite.connect(DB_PATH) as db:
            await db.execute("DELETE FROM banned_users WHERE user_id=?", (uid,))
            await db.commit()
        await msg.reply(ff(f"unbanned {uid} ✅"))
    except Exception:
        await msg.reply(ff("/ungban [uid]"))

# ─── GROUP MODERATION ─────────────────────────────────────────────
async def is_admin(chat_id: int, user_id: int) -> bool:
    try:
        m = await app.get_chat_member(chat_id, user_id)
        return m.status in (enums.ChatMemberStatus.ADMINISTRATOR, enums.ChatMemberStatus.OWNER)
    except Exception:
        return False

@app.on_message(filters.new_chat_members)
async def on_new_member(_, msg: Message):
    try:
        chat_id = msg.chat.id
        async with aiosqlite.connect(DB_PATH) as db:
            await db.execute("INSERT OR IGNORE INTO groups (chat_id) VALUES (?)", (chat_id,))
            await db.commit()
            db.row_factory = aiosqlite.Row
            async with db.execute("SELECT * FROM groups WHERE chat_id=?", (chat_id,)) as cur:
                grp = await cur.fetchone()
        if not grp or not grp["welcome_enabled"]:
            return
        for member in msg.new_chat_members:
            if member.is_bot:
                continue
            wtext = grp["welcome_text"]
            wtext = wtext.replace("{first}", member.first_name or "friend")
            wtext = wtext.replace(
                "{username}", f"@{member.username}" if member.username else member.first_name
            )
            wtext = wtext.replace("{chatname}", msg.chat.title or "this group")
            await msg.reply(wtext)
    except Exception:
        traceback.print_exc()

@app.on_message(filters.command("setwelcome") & filters.group)
async def cmd_setwelcome(_, msg: Message):
    try:
        if not await is_admin(msg.chat.id, msg.from_user.id):
            return await msg.reply(ff("tu admin nahi hai 💀"))
        text = " ".join(msg.command[1:]).strip()
        if not text:
            return await msg.reply(ff("welcome text de\nVars: {first} {username} {chatname}"))
        async with aiosqlite.connect(DB_PATH) as db:
            await db.execute(
                "INSERT INTO groups (chat_id,welcome_text) VALUES (?,?) "
                "ON CONFLICT(chat_id) DO UPDATE SET welcome_text=excluded.welcome_text",
                (msg.chat.id, text)
            )
            await db.commit()
        await msg.reply(ff("welcome message set ✅"))
    except Exception:
        traceback.print_exc()

@app.on_message(filters.command("welcome") & filters.group)
async def cmd_welcome(_, msg: Message):
    try:
        if not await is_admin(msg.chat.id, msg.from_user.id):
            return await msg.reply(ff("tu admin nahi hai 💀"))
        arg = msg.command[1].lower() if len(msg.command) > 1 else ""
        if arg not in ("on","off"):
            return await msg.reply(ff("/welcome on or /welcome off"))
        enabled = 1 if arg == "on" else 0
        async with aiosqlite.connect(DB_PATH) as db:
            await db.execute(
                "INSERT INTO groups (chat_id,welcome_enabled) VALUES (?,?) "
                "ON CONFLICT(chat_id) DO UPDATE SET welcome_enabled=excluded.welcome_enabled",
                (msg.chat.id, enabled)
            )
            await db.commit()
        await msg.reply(ff(f"welcome turned {arg} ✅"))
    except Exception:
        traceback.print_exc()

@app.on_message(filters.command("delwelcome") & filters.group)
async def cmd_delwelcome(_, msg: Message):
    try:
        if not await is_admin(msg.chat.id, msg.from_user.id):
            return await msg.reply(ff("tu admin nahi hai 💀"))
        async with aiosqlite.connect(DB_PATH) as db:
            await db.execute(
                "UPDATE groups SET welcome_text=?, welcome_enabled=0 WHERE chat_id=?",
                ("ʜᴇʏ {first}, ᴡᴇʟᴄᴏᴍᴇ ᴛᴏ {chatname}! 🎉", msg.chat.id)
            )
            await db.commit()
        await msg.reply(ff("welcome reset ✅"))
    except Exception:
        traceback.print_exc()

@app.on_message(filters.command("save") & filters.group)
async def cmd_save(_, msg: Message):
    try:
        if not await is_admin(msg.chat.id, msg.from_user.id):
            return await msg.reply(ff("tu admin nahi hai 💀"))
        args = msg.command[1:]
        if not args:
            return await msg.reply(ff("/save [keyword] [response]"))
        kw   = args[0].lower()
        resp = " ".join(args[1:]) if len(args) > 1 else (
            msg.reply_to_message.text if msg.reply_to_message else ""
        )
        if not resp:
            return await msg.reply(ff("response bhi de bhai 🙄"))
        async with aiosqlite.connect(DB_PATH) as db:
            await db.execute(
                "INSERT OR REPLACE INTO group_filters (chat_id,keyword,response) VALUES (?,?,?)",
                (msg.chat.id, kw, resp)
            )
            await db.commit()
        await msg.reply(ff(f"filter saved: '{kw}' ✅"))
    except Exception:
        traceback.print_exc()

@app.on_message(filters.command("stop") & filters.group)
async def cmd_stop(_, msg: Message):
    try:
        if not await is_admin(msg.chat.id, msg.from_user.id):
            return await msg.reply(ff("tu admin nahi hai 💀"))
        if len(msg.command) < 2:
            return await msg.reply(ff("/stop [keyword]"))
        kw = msg.command[1].lower()
        async with aiosqlite.connect(DB_PATH) as db:
            await db.execute(
                "DELETE FROM group_filters WHERE chat_id=? AND keyword=?", (msg.chat.id, kw)
            )
            await db.commit()
        await msg.reply(ff(f"filter removed: '{kw}' ✅"))
    except Exception:
        traceback.print_exc()

@app.on_message(filters.command("filters") & filters.group)
async def cmd_filters(_, msg: Message):
    try:
        async with aiosqlite.connect(DB_PATH) as db:
            async with db.execute(
                "SELECT keyword FROM group_filters WHERE chat_id=?", (msg.chat.id,)
            ) as cur:
                rows = await cur.fetchall()
        if not rows:
            return await msg.reply(ff("koi filter nahi set hai 🙄"))
        kws = "\n".join(f"• `{r[0]}`" for r in rows)
        await msg.reply(f"🔍 **{ff('Active Filters')}**\n\n{kws}")
    except Exception:
        traceback.print_exc()

@app.on_message(filters.command("ban") & filters.group)
async def cmd_ban(_, msg: Message):
    try:
        if not await is_admin(msg.chat.id, msg.from_user.id):
            return await msg.reply(ff("tu admin nahi hai 💀"))
        target = msg.reply_to_message.from_user if msg.reply_to_message else None
        if not target:
            return await msg.reply(ff("reply karo jise ban karna hai"))
        await app.ban_chat_member(msg.chat.id, target.id)
        await msg.reply(f"🚫 {mention(target)} **{ff('banned')}** ✅")
    except Exception:
        await msg.reply(ff("ban nahi hua 💀 mujhe admin rights do"))

@app.on_message(filters.command("unban") & filters.group)
async def cmd_unban(_, msg: Message):
    try:
        if not await is_admin(msg.chat.id, msg.from_user.id):
            return await msg.reply(ff("tu admin nahi hai 💀"))
        target = msg.reply_to_message.from_user if msg.reply_to_message else None
        if not target:
            return await msg.reply(ff("reply karo jise unban karna hai"))
        await app.unban_chat_member(msg.chat.id, target.id)
        await msg.reply(f"✅ {mention(target)} **{ff('unbanned')}**")
    except Exception:
        traceback.print_exc()

# ─── ANTI-ABUSE + FILTERS (group messages) ────────────────────────
GAALI = [
    "fuck","shit","bitch","bastard","asshole","chutiya","madarchod",
    "bhenchod","gaandu","randi","haramzada","kamina","saala","kutte",
    "harami","madar",
]

@app.on_message(filters.group & filters.text)
async def group_msg(_, msg: Message):
    try:
        if not msg.from_user:
            return
        chat_id = msg.chat.id
        text_lo = msg.text.lower() if msg.text else ""

        # Register group
        async with aiosqlite.connect(DB_PATH) as db:
            await db.execute("INSERT OR IGNORE INTO groups (chat_id) VALUES (?)", (chat_id,))
            await db.commit()

        # Keyword filters
        async with aiosqlite.connect(DB_PATH) as db:
            async with db.execute(
                "SELECT keyword,response FROM group_filters WHERE chat_id=?", (chat_id,)
            ) as cur:
                for kw, resp in await cur.fetchall():
                    if kw in text_lo:
                        await msg.reply(resp)
                        break

        # Anti-abuse
        if any(g in text_lo for g in GAALI):
            if await is_admin(chat_id, msg.from_user.id):
                return
            async with aiosqlite.connect(DB_PATH) as db:
                await db.execute(
                    "INSERT INTO users (user_id,warnings) VALUES (?,1) "
                    "ON CONFLICT(user_id) DO UPDATE SET warnings=warnings+1",
                    (msg.from_user.id,)
                )
                await db.commit()
                async with db.execute(
                    "SELECT warnings FROM users WHERE user_id=?", (msg.from_user.id,)
                ) as cur:
                    row = await cur.fetchone()
                    warns = row[0] if row else 1

            if warns >= 3:
                try:
                    await app.ban_chat_member(chat_id, msg.from_user.id)
                    async with aiosqlite.connect(DB_PATH) as db:
                        await db.execute(
                            "UPDATE users SET warnings=0 WHERE user_id=?", (msg.from_user.id,)
                        )
                        await db.commit()
                    await msg.reply(
                        f"🚫 {mention(msg.from_user)} **{ff('banned')}**!\n"
                        f"_{ff('3 strikes = out bhai 💀')}_"
                    )
                except Exception:
                    await msg.reply(ff("ban karna chahti thi, admin rights do mujhe 💀"))
            else:
                roasts = [
                    ff("seedha baat kar, gaali se kuch nahi milta 💀"),
                    ff("itna gussa? thanda pani pi 😤"),
                    ff("yaar ye sab kya bol raha tu 🤌"),
                ]
                await msg.reply(
                    f"⚠️ {mention(msg.from_user)}, {random.choice(roasts)}\n"
                    f"_**{ff('Warning')} {warns}/3** — {3-warns} {ff('more and youre out')} 🚫_"
                )
    except Exception:
        traceback.print_exc()

# ══════════════════════════════════════════════════════════════════
#  MAIN
# ══════════════════════════════════════════════════════════════════
async def main():
    await init_db()
    print("=" * 55)
    print("  ᴜʀᴀʀᴀᴋᴀ ʙᴏᴛ — Starting up...")
    print(f"  DB      : {DB_PATH}")
    print(f"  Owner   : {OWNER_ID if OWNER_ID else 'NOT SET (admin panel disabled)'}")
    print("=" * 55)

    # Delete any existing webhook so long-polling works
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(
                f"https://api.telegram.org/bot{BOT_TOKEN}/deleteWebhook?drop_pending_updates=true"
            ) as r:
                data = await r.json()
                print(f"  Webhook : deleted → {data.get('result', data)}")
            # Also log webhook info for debug
            async with session.get(
                f"https://api.telegram.org/bot{BOT_TOKEN}/getWebhookInfo"
            ) as r:
                wh = await r.json()
                print(f"  WebhookInfo: {wh.get('result', {})}")
    except Exception as e:
        print(f"  Webhook cleanup error: {e}")

    await app.start()
    me = await app.get_me()
    print(f"  Bot     : @{me.username} (ID: {me.id})")
    print("  Status  : ✅ Bot is LIVE! Send /start in Telegram.")
    print("=" * 55)
    await idle()
    await app.stop()

if __name__ == "__main__":
    asyncio.run(main())
