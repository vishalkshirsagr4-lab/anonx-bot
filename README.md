# Piko Telegram Bot

Piko runs on Cloudflare Workers with Turso (libSQL) storage. Existing anonymous messaging, contests, voting, wallet and games remain part of the project.

## Piko features

- Groq-powered AI chat in private messages
- Voice-message transcription with Groq Whisper\n- Group-call music player: `/search`, `/play`, `/song`, `/video`, `/music`, `/pause`, `/resume`, `/skip`, `/stop`, `/queue`, `/volume`, `/leave` (separate Python user-account service)
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

Optional:
- `GROQ_API_KEY` — enables AI chat and voice transcription. Without it, those features explain that setup is required.

## Group-call player secrets

Configure these on the separate always-on Linux player host (not as Cloudflare Worker secrets): `API_ID`, `API_HASH`, `STRING_SESSION`, `NAZRIYA_API_KEY`, and optionally `NAZRIYA_API_BASE=https://nazriya.teamgod.online/api`. Put them in the host environment or a private `.env` file with restricted permissions. Never commit `.env` or share `STRING_SESSION`.

The GitHub Actions workflow runs JavaScript syntax checks and the build before deploying. The existing test suite requires a configured Turso database, so it is not run against production automatically.

## Group setup

Add Piko to your group and grant only the permissions it needs. Group admins can configure welcomes and keyword replies, and use moderation commands.

## Security

Never commit bot tokens, API keys, database URLs or database auth tokens. Rotate any credential that has appeared in a public commit; deleting it from the latest file does not erase it from Git history.

## VPS voice chat streaming

The group-call commands are handled by the separate Python user-account deployment in [VPS_DEPLOYMENT.md](./VPS_DEPLOYMENT.md). Keep the Cloudflare Worker deployed for Piko's existing bot features, and run the Python player continuously on an always-on Linux host. The player requires FFmpeg, `API_ID`, `API_HASH`, `STRING_SESSION`, and `NAZRIYA_API_KEY`; it does not use the Bot Token.
