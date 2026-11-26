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

## Stickers

Telegram sticker messages cannot carry an inline keyboard. Piko therefore sends greeting flows as two messages in order: (1) the exact sticker, then (2) the text with its inline keyboard buttons.

### Get a sticker file_id

- Use @RawDataBot or @JsonDumpBot: forward the sticker and copy `message.sticker.file_id` from the returned data.
- Or temporarily add this Pyrogram handler:

  ```python
  @app.on_message(filters.sticker)
  async def _log(_, m): print(m.sticker.file_id)
  ```

  Send the sticker to your bot and copy the printed ID.
- Or, in the Worker webhook, temporarily log `message.sticker.file_id` from the incoming update payload.

### Where to paste file_ids

- Worker: paste IDs into the named fields in `src/stickers.js` (`STICKERS` object).
- Pyrogram: paste IDs into `STICKER_START`, `STICKER_WELCOME`, and `STICKER_HELP` in `baka.py`.

**Important:** Telegram file_ids are bot-specific. Obtain each file_id using YOUR bot; an ID received from a third-party bot will not work for your bot.

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
