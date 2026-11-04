# Piko Telegram Bot

Piko runs on Cloudflare Workers with Turso (libSQL) storage. Existing anonymous messaging, contests, voting, wallet and games remain part of the project.

## Piko features

- Groq-powered AI chat in private messages
- Voice-message transcription with Groq Whisper\n- Music discovery: `/search`, `/music`, `/play` (song metadata and supported official listening links; no media downloading)
- AI image generation (5 credits per image)
- Credits and coin economy: `/credits`, `/daily`, `/work`, `/crime`, `/rob`, `/pay`
- Fun commands: `/ship`, `/roll`, `/trivia`, `/hug`, `/slap`, `/punch`, `/kick`
- Group welcome messages and keyword replies
- Admin group moderation: `/ban`, `/unban`
- Owner tools: `/admin`, `/stats`, `/addcredits`, `/addcoins`, `/gban`, `/ungban`

## Required Cloudflare / GitHub Actions secrets

Keep all credentials out of source files. Configure these as GitHub Actions secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `BOT_TOKEN` (rotate any token that was previously exposed)
- `WEBHOOK_SECRET`
- `ADMIN_SECRET`
- `TURSO_DB_URL`
- `TURSO_AUTH_TOKEN`
- `OWNER_ID` (and optionally `OWNER_IDS`)
- `DELDB_PASSWORD` — optional 4–20 digit password for the owner-only database wipe command; no public default is used

Optional:
- `GROQ_API_KEY` — enables AI chat and voice transcription. Without it, those features explain that setup is required.
- `GROQ_CHAT_MODEL` — optional; defaults to `openai/gpt-oss-20b`.\n- `NAZRIYA_API_KEY` — enables Piko music search. Set it as a Cloudflare Worker secret; never put it in `wrangler.toml` or source code.

The GitHub Actions workflow runs JavaScript syntax checks and the build before deploying. The existing test suite requires a configured Turso database, so it is not run against production automatically.

## Group setup

Add Piko to your group and grant only the permissions it needs. Group admins can configure welcomes and keyword replies, and use moderation commands.

## Security

Never commit bot tokens, API keys, database URLs or database auth tokens. Rotate any credential that has appeared in a public commit; deleting it from the latest file does not erase it from Git history.

## VPS voice chat streaming

AI chat works in private messages by default. In groups, mention Piko or reply to one of its messages; it does not answer every group message automatically. The protected `/config` endpoint reports whether the Groq key is present and which chat model is selected.

The Worker music commands do not stream into Telegram voice chats. For real-time group voice/video chat playback, use the separate Python user-account deployment in [VPS_DEPLOYMENT.md](./VPS_DEPLOYMENT.md), with [main.py](./main.py), [requirements.txt](./requirements.txt), and [generate_string_session.py](./generate_string_session.py). That service requires Linux, FFmpeg, `API_ID`, `API_HASH`, and a Pyrogram `STRING_SESSION`; it does not use a Bot Token.
