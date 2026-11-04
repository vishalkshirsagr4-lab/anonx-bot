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

Optional:
- `GROQ_API_KEY` — enables AI chat and voice transcription. Without it, those features explain that setup is required.\n- `NAZRIYA_API_KEY` — enables Piko music search. Set it as a Cloudflare Worker secret; never put it in `wrangler.toml` or source code.\n- `PLAYER_API_URL` and `PLAYER_API_SECRET` — connect the Worker to the separate group-call player service.

The GitHub Actions workflow runs JavaScript syntax checks and the build before deploying. The existing test suite requires a configured Turso database, so it is not run against production automatically.

## Group setup

Add Piko to your group and grant only the permissions it needs. Group admins can configure welcomes and keyword replies, and use moderation commands.

## Security

Never commit bot tokens, API keys, database URLs or database auth tokens. Rotate any credential that has appeared in a public commit; deleting it from the latest file does not erase it from Git history.


## Group-call music player

Piko's Telegram Bot API worker cannot itself join a group voice chat. The separate `player_service/` runs a persistent MTProto user client with PyTgCalls and exposes a small authenticated HTTP bridge to the Worker.

Deploy `player_service/` as a persistent Docker web service (the included Render blueprint uses a paid always-on instance). Configure these secrets in the player host:

- `PLAYER_API_SECRET` — long random shared secret; also set the same value as a Cloudflare Worker secret.
- `TG_API_ID` and `TG_API_HASH` — Telegram application credentials for the player account.
- `TG_SESSION_STRING` — private MTProto session for a dedicated player account. Never share or commit it.
- `NAZRIYA_API_KEY` — same music-provider key, set privately on the player service.

Set these Cloudflare Worker secrets:

- `PLAYER_API_URL` — base HTTPS URL of the deployed player service (no trailing slash).
- `PLAYER_API_SECRET` — same shared secret as the player host.
- Keep `NAZRIYA_API_KEY` configured for `/search`.

Add the player account to each group and ensure it is allowed to join the group's active voice/video chat. If it must create a new group call, grant the required group-call management permission. The host must stay running; sleeping/free web instances will interrupt playback.

Commands:
- `/search song` — search metadata and supported official links.
- `/play song` or `/song song` — queue audio.
- `/video song` — queue video.
- `/music song` — show audio/video command choices.
- `/pause`, `/resume`, `/skip`, `/stop`, `/queue`, `/volume 50`, `/leave`.

The playback service intentionally requires the provider to explicitly mark media as authorized, rights-cleared, user-owned, public-domain, Creative Commons or otherwise licensed. It rejects unverified media metadata rather than assuming a search API key grants redistribution rights. The service queues media by group, so activity in one group does not overwrite another group's queue.

The player service is an additional deployment and is not live until its environment secrets are configured and the player account is authorized in a group call.
