# Piko Telegram Bot

Piko runs on Cloudflare Workers with Turso (libSQL) storage. Existing anonymous messaging, contests, voting, wallet and games remain part of the project.

## Piko features

- Groq-powered AI chat in private messages
- Voice-message transcription with Groq Whisper\n- AI image generation (5 credits per image)
- Credits and coin economy: `/credits`, `/daily`, `/work`, `/crime`, `/rob`, `/pay`
- Fun commands: `/ship`, `/roll`, `/trivia`, `/hug`, `/slap`, `/punch`, `/kick`
- Group welcome messages and keyword replies
- Admin group moderation: `/ban`, `/unban`
- Owner tools: `/admin`, `/stats`, `/addcredits`, `/addcoins`, `/gban`, `/ungban`

## Stickers and chat greetings

Piko supports owner-managed Telegram sticker packs stored in the existing Turso key-value store. No Cloudflare logs, source edits, or manual file_id copying are needed.

In a private chat with Piko, the configured owner can:

1. Send the sticker you want to use.
2. Reply directly to that sticker with `/setsticker welcome` (replace `welcome` with a category).
3. Use `/teststicker welcome` to preview it.
4. Use `/stickers` to see configured categories.
5. Use `/removesticker welcome` to remove a category.

Supported categories: `welcome`, `start`, `help`, `success`, `error`, `contest`, `wallet`, `game`, `test`, and `general`.

The Worker uses saved stickers in the start screen, help navigation, new-member greetings, and matching Piko replies. Sticker messages appear immediately before the corresponding text or button message because Telegram does not allow stickers and inline keyboards in one message. If a category has no sticker, the original text and buttons still work normally. Existing buttons and callback data are preserved.

Only the configured bot owner can manage sticker packs. Sticker file IDs are saved in Turso, so they survive Worker redeployments. Telegram file IDs must belong to this bot.

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
- `GROQ_CHAT_MODEL` — optional; defaults to `openai/gpt-oss-20b`.

The GitHub Actions workflow runs JavaScript syntax checks and the build before deploying. The existing test suite requires a configured Turso database, so it is not run against production automatically.

## Group setup

Add Piko to your group and grant only the permissions it needs. Group admins can configure welcomes and keyword replies, and use moderation commands.

## Security

Never commit bot tokens, API keys, database URLs or database auth tokens. Rotate any credential that has appeared in a public commit; deleting it from the latest file does not erase it from Git history.

## AI chat and webhook setup

AI chat works in private messages. In groups, mention Piko or reply to one of its messages. After changing `WEBHOOK_SECRET`, call the protected `POST /setwebhook` endpoint again using the configured admin key so Telegram stores the matching secret. Check `GET /health` for a safe configuration summary and the protected `/config` endpoint for detailed diagnostics.
