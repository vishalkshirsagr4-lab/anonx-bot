# Telegram voice chat bot on an Ubuntu/Debian VPS

This deployment runs the Python userbot in [main.py](./main.py). It uses a Telegram **user account** session, Pyrogram and PyTgCalls. It does not provide voice streaming through the Cloudflare Worker. The existing Worker app remains separate.

## 1. Install system packages

Use Ubuntu 22.04/24.04 or a current Debian release. Keep the VPS updated and use a dedicated, non-root Linux account for the bot.

```bash
sudo apt update
sudo apt install -y python3 python3-venv python3-pip ffmpeg git
ffmpeg -version
```

Clone the repository (or copy the Python deployment files) and create an isolated environment:

```bash
git clone <your-repository-url> anonx-bot
cd anonx-bot
python3 -m venv .venv
. .venv/bin/activate
python -m pip install --upgrade pip
pip install -r requirements.txt
```

## 2. Generate the user account String Session

1. Sign in at [my.telegram.org](https://my.telegram.org) and create an application to obtain `API_ID` and `API_HASH`.
2. On the VPS, create a private environment file with those two values:

   ```bash
   cp .env.vps.example .env
   chmod 600 .env
   nano .env
   ```

3. Generate the session by signing into the **user account** that should join voice chats:

   ```bash
   .venv/bin/python generate_string_session.py
   ```

   Enter the phone number, Telegram login code, and two-step verification password if prompted. Copy the printed `STRING_SESSION` into `.env`, then restrict the file permissions again with `chmod 600 .env`.

`STRING_SESSION` is equivalent to account credentials. Never commit it, paste it into chat, or share it. If exposed, revoke the session from Telegram's **Settings → Devices** and generate another one. Do not set `BOT_TOKEN`; this application deliberately starts Pyrogram with `session_string`.

## 3. Configure the group and provider

- Add the signed-in user account to the target group and start a group voice chat/video chat.
- If the group limits voice chat participation, ask an admin to grant the account the permissions needed to join and speak. The bot cannot start a voice chat by itself.
- Put `API_ID`, `API_HASH`, `STRING_SESSION`, and `NAZRIYA_API_KEY` in `.env`. Use `NAZRIYA_API_BASE=https://nazriya.teamgod.online/api`; the application also normalizes a base URL without `/api`.
- The player calls the existing `/api/search`, `/api/audio`, and `/api/video` endpoints. Audio/video endpoints must return a media response or JSON containing a direct HTTPS media URL. The player checks that the downloaded response is an audio/video or binary media stream before passing it to FFmpeg through PyTgCalls.
- Only stream media you have permission to play. The player does not bypass DRM, paywalls, access controls, or copyright restrictions.

## 4. Run and check logs

```bash
.venv/bin/python main.py
```

Run `/play song name` in the group after the account is online. Use `Ctrl+C` to stop a foreground run.

### Run continuously with systemd

Replace `/opt/anonx-bot` with the checkout path and `telegrambot` with the Linux service account. Install this as `/etc/systemd/system/anonx-music.service`:

```ini
[Unit]
Description=Anonx Telegram voice chat music userbot
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=telegrambot
WorkingDirectory=/opt/anonx-bot
EnvironmentFile=/opt/anonx-bot/.env
ExecStart=/opt/anonx-bot/.venv/bin/python /opt/anonx-bot/main.py
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

Then enable and inspect it:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now anonx-music
sudo systemctl status anonx-music
sudo journalctl -u anonx-music -f
```

## Commands

| Command | Behavior |
| --- | --- |
| `/play <song>` | Find audio with Nazriya, download it, and queue/play it |
| `/song <song>` | Alias for `/play` |
| `/video <song>` | Find and play video in the voice chat |
| `/music <song>` | Choose audio or video |
| `/pause`, `/resume` | Pause or resume the current stream |
| `/skip` | Stop the current item and advance the queue |
| `/stop` | Stop playback and clear the queue |
| `/queue` | Show current item and queued tracks |
| `/volume <0-100>` | Set current stream volume |
| `/leave` | Leave the voice chat and clear the queue |
| `/search <song>` | Display matching titles without streaming |

Queue state is in memory and resets when the process restarts. Downloaded files are removed after playback ends or when playback is stopped/skipped. `MAX_DOWNLOAD_MB` defaults to 500 MB.
