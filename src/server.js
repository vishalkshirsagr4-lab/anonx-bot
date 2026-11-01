// src/server.js
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import worker from './worker.js';
import { state, applyEnv } from './config.js';
import { initDB } from './db.js';
import { detectMedia, formatMediaBadge, validateSubmissionForMode } from './media.js';

// Load .env file if present
function loadEnv() {
  const envPath = path.resolve(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    try {
      const content = fs.readFileSync(envPath, 'utf8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx !== -1) {
          const key = trimmed.slice(0, eqIdx).trim();
          let val = trimmed.slice(eqIdx + 1).trim();
          if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
          }
          if (process.env[key] === undefined) {
            process.env[key] = val;
          }
        }
      }
    } catch (e) {
      console.warn('Could not parse .env file:', e.message);
    }
  }

  // Set default secrets for development if not provided
  if (!process.env.WEBHOOK_SECRET) {
    process.env.WEBHOOK_SECRET = 'anonx_webhook_secret_key_32_chars';
  }
  if (!process.env.ADMIN_SECRET) {
    process.env.ADMIN_SECRET = 'anonx_admin_secret_key_32_characters_long';
  }
  if (!process.env.BOT_NAME) {
    process.env.BOT_NAME = 'AnonX';
  }

  applyEnv(process.env);
}

loadEnv();

const PORT = 3000;
const HOST = '0.0.0.0';

// Dashboard HTML generator
function renderDashboard(host) {
  const isBotConfigured = Boolean(process.env.BOT_TOKEN && process.env.BOT_TOKEN.length > 10);
  const isTursoConfigured = Boolean(process.env.TURSO_DB_URL && process.env.TURSO_AUTH_TOKEN);
  const botName = process.env.BOT_NAME || 'AnonX';
  const adminSecret = process.env.ADMIN_SECRET || 'anonx_admin_secret_key_32_characters_long';
  const webhookUrl = `https://${host}/webhook`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${botName} Bot - Server Console</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #090d16;
      --card-bg: #111827;
      --card-border: #1f293d;
      --card-hover: #192237;
      --accent: #6366f1;
      --accent-hover: #4f46e5;
      --accent-light: #818cf8;
      --accent-glow: rgba(99, 102, 241, 0.2);
      --success: #10b981;
      --success-glow: rgba(16, 185, 129, 0.2);
      --warn: #f59e0b;
      --warn-glow: rgba(245, 158, 11, 0.2);
      --text: #f3f4f6;
      --text-muted: #9ca3af;
      --code-bg: #0d121f;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Plus Jakarta Sans', system-ui, -apple-system, sans-serif;
      background: radial-gradient(circle at 50% 0%, #171d33 0%, var(--bg) 70%);
      color: var(--text);
      min-height: 100vh;
      padding: 2.5rem 1.25rem;
      line-height: 1.5;
    }
    .container {
      max-width: 1020px;
      margin: 0 auto;
    }
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 2.5rem;
      flex-wrap: wrap;
      gap: 1.25rem;
      border-bottom: 1px solid var(--card-border);
      padding-bottom: 1.5rem;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 1rem;
    }
    .logo-badge {
      width: 48px;
      height: 48px;
      border-radius: 14px;
      background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 50%, #ec4899 100%);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 24px;
      box-shadow: 0 10px 25px -5px var(--accent-glow);
    }
    h1 {
      font-size: 1.625rem;
      font-weight: 800;
      letter-spacing: -0.025em;
    }
    .subtitle {
      font-size: 0.875rem;
      color: var(--text-muted);
    }
    .status-badge {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.45rem 0.95rem;
      border-radius: 9999px;
      font-size: 0.8125rem;
      font-weight: 600;
      background: rgba(16, 185, 129, 0.12);
      border: 1px solid rgba(16, 185, 129, 0.3);
      color: var(--success);
    }
    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--success);
      box-shadow: 0 0 10px var(--success);
      animation: pulse 2s infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.6; transform: scale(0.85); }
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 1.25rem;
      margin-bottom: 2rem;
    }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 16px;
      padding: 1.5rem;
      transition: all 0.2s ease;
    }
    .card:hover {
      border-color: rgba(99, 102, 241, 0.4);
    }
    .card-title {
      font-size: 0.8125rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-muted);
      font-weight: 700;
      margin-bottom: 0.75rem;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .card-value {
      font-size: 1.15rem;
      font-weight: 700;
      color: #fff;
      display: flex;
      align-items: center;
      gap: 0.5rem;
      word-break: break-all;
    }
    .card-desc {
      font-size: 0.8125rem;
      color: var(--text-muted);
      margin-top: 0.5rem;
    }
    .pill {
      font-size: 0.75rem;
      padding: 0.2rem 0.55rem;
      border-radius: 6px;
      font-weight: 600;
    }
    .pill-green {
      background: rgba(16, 185, 129, 0.15);
      color: #34d399;
      border: 1px solid rgba(16, 185, 129, 0.3);
    }
    .pill-amber {
      background: rgba(245, 158, 11, 0.15);
      color: #fbbf24;
      border: 1px solid rgba(245, 158, 11, 0.3);
    }
    .actions-section {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 16px;
      padding: 1.75rem;
      margin-bottom: 2rem;
    }
    .section-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 1.25rem;
      flex-wrap: wrap;
      gap: 0.75rem;
    }
    h2 {
      font-size: 1.125rem;
      font-weight: 700;
    }
    .btn-row {
      display: flex;
      flex-wrap: wrap;
      gap: 0.75rem;
    }
    button, .btn {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.625rem 1.125rem;
      border-radius: 10px;
      font-size: 0.875rem;
      font-weight: 600;
      cursor: pointer;
      border: none;
      transition: all 0.15s ease;
      text-decoration: none;
      font-family: inherit;
    }
    .btn-primary {
      background: var(--accent);
      color: white;
    }
    .btn-primary:hover {
      background: var(--accent-hover);
      box-shadow: 0 4px 15px var(--accent-glow);
    }
    .btn-secondary {
      background: #1f293d;
      color: var(--text);
      border: 1px solid #2d3b55;
    }
    .btn-secondary:hover {
      background: #28354f;
      color: white;
    }
    .code-box {
      background: var(--code-bg);
      border: 1px solid #1a2235;
      border-radius: 10px;
      padding: 0.875rem 1rem;
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.8125rem;
      color: #93c5fd;
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-top: 0.75rem;
      overflow-x: auto;
    }
    .copy-btn {
      background: #1f293d;
      color: #cbd5e1;
      padding: 0.25rem 0.6rem;
      border-radius: 6px;
      font-size: 0.75rem;
      border: 1px solid #334155;
    }
    .copy-btn:hover { background: #334155; color: #fff; }
    #console-output {
      background: var(--code-bg);
      border: 1px solid #1a2235;
      border-radius: 12px;
      padding: 1rem;
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.8125rem;
      color: #cbd5e1;
      max-height: 280px;
      overflow-y: auto;
      white-space: pre-wrap;
      word-break: break-word;
      margin-top: 1rem;
      display: none;
    }
    .guide-card {
      background: #0f1626;
      border: 1px dashed #26334d;
      border-radius: 16px;
      padding: 1.5rem;
    }
    .step-list {
      display: flex;
      flex-direction: column;
      gap: 1rem;
      margin-top: 1rem;
    }
    .step {
      display: flex;
      gap: 1rem;
      align-items: flex-start;
    }
    .step-num {
      width: 28px;
      height: 28px;
      border-radius: 50%;
      background: rgba(99, 102, 241, 0.2);
      color: var(--accent-light);
      border: 1px solid rgba(99, 102, 241, 0.4);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 0.8125rem;
      font-weight: 700;
      flex-shrink: 0;
    }
    .step-text {
      font-size: 0.875rem;
      color: #cbd5e1;
    }
    code {
      font-family: 'JetBrains Mono', monospace;
      background: rgba(255, 255, 255, 0.08);
      padding: 0.15rem 0.4rem;
      border-radius: 4px;
      font-size: 0.8125rem;
      color: #a5b4fc;
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div class="brand">
        <div class="logo-badge">🤖</div>
        <div>
          <h1>${botName} Bot Console</h1>
          <p class="subtitle">Cloudflare Worker &amp; Node.js Telegram Bot • Port 3000</p>
        </div>
      </div>
      <div class="status-badge">
        <span class="status-dot"></span> Server Online
      </div>
    </header>

    <div class="grid">
      <div class="card">
        <div class="card-title">
          <span>Telegram Bot Token</span>
          <span class="pill ${isBotConfigured ? 'pill-green' : 'pill-amber'}">
            ${isBotConfigured ? 'Connected' : 'Missing'}
          </span>
        </div>
        <div class="card-value">
          ${isBotConfigured ? '●●●●●●●●' + (process.env.BOT_TOKEN.slice(-5)) : 'Not Configured'}
        </div>
        <div class="card-desc">
          ${isBotConfigured ? 'Token loaded from environment' : 'Set BOT_TOKEN in .env to connect to Telegram'}
        </div>
      </div>

      <div class="card">
        <div class="card-title">
          <span>Database Engine</span>
          <span class="pill pill-green">
            ${isTursoConfigured ? 'Turso libSQL' : 'SQLite In-Memory'}
          </span>
        </div>
        <div class="card-value">
          ${isTursoConfigured ? 'Remote Turso' : 'Local SQLite 3'}
        </div>
        <div class="card-desc">
          ${isTursoConfigured ? 'Synchronized with Turso cloud' : 'Native in-memory SQLite schema active & initialized'}
        </div>
      </div>

      <div class="card">
        <div class="card-title">
          <span>Scheduler &amp; Crons</span>
          <span class="pill pill-green">Running</span>
        </div>
        <div class="card-value">Every 60 Seconds</div>
        <div class="card-desc">Automated contest cycles, rankings, cards warming &amp; cleanup</div>
      </div>

      <div class="card">
        <div class="card-title">
          <span>Universal Media Engine</span>
          <span class="pill pill-green">Enabled</span>
        </div>
        <div class="card-value">12+ Media Formats</div>
        <div class="card-desc">Photos, stickers, video, audio, voice, docs, contacts &amp; locations</div>
      </div>
    </div>

    <div class="actions-section">
      <div class="section-header">
        <div>
          <h2>Operations &amp; Admin Tools</h2>
          <p class="subtitle">Interact directly with the bot API endpoints</p>
        </div>
        <div class="btn-row">
          <button class="btn btn-primary" onclick="setupWebhook()">🚀 Register Webhook</button>
          <button class="btn btn-secondary" onclick="runCron()">⏰ Trigger Cron</button>
          <button class="btn btn-secondary" onclick="fetchLogs()">📜 View Logs</button>
          <button class="btn btn-secondary" onclick="fetchConfig()">⚙️ View Config</button>
          <button class="btn btn-secondary" onclick="testMediaSupport()">🧪 Test Media Parser</button>
        </div>
      </div>

      <div style="margin-top: 1rem;">
        <label style="font-size: 0.8125rem; color: var(--text-muted); font-weight: 600;">Telegram Webhook Endpoint</label>
        <div class="code-box">
          <span id="webhook-url">${webhookUrl}</span>
          <button class="copy-btn" onclick="copyText('webhook-url')">Copy URL</button>
        </div>
      </div>

      <div style="margin-top: 0.75rem;">
        <label style="font-size: 0.8125rem; color: var(--text-muted); font-weight: 600;">Admin Secret Key (X-Admin-Key)</label>
        <div class="code-box">
          <span id="admin-secret">${adminSecret}</span>
          <button class="copy-btn" onclick="copyText('admin-secret')">Copy Secret</button>
        </div>
      </div>

      <div id="console-output"></div>
    </div>

    <div class="guide-card">
      <h2>Quick Telegram Setup Guide</h2>
      <div class="step-list">
        <div class="step">
          <div class="step-num">1</div>
          <div class="step-text">
            Open Telegram and message <code>@BotFather</code>. Send <code>/newbot</code>, choose a name and username, and copy the provided API token.
          </div>
        </div>
        <div class="step">
          <div class="step-num">2</div>
          <div class="step-text">
            Add your token to <code>.env</code> as <code>BOT_TOKEN=your_token_here</code>.
          </div>
        </div>
        <div class="step">
          <div class="step-num">3</div>
          <div class="step-text">
            Click <strong>Register Webhook</strong> above (or send a POST to <code>/setwebhook</code>) to link Telegram directly to this server URL.
          </div>
        </div>
        <div class="step">
          <div class="step-num">4</div>
          <div class="step-text">
            Add your bot to any Telegram chat group or DM. Send <code>/start</code>, <code>/help</code>, <code>/anon</code>, or <code>/contest</code>!
          </div>
        </div>
      </div>
    </div>
  </div>

  <script>
    const adminKey = "${adminSecret}";

    function showOutput(title, data) {
      const box = document.getElementById('console-output');
      box.style.display = 'block';
      box.textContent = \`[\${new Date().toLocaleTimeString()}] \${title}:\\n\` + 
        (typeof data === 'string' ? data : JSON.stringify(data, null, 2));
    }

    async function setupWebhook() {
      showOutput('Registering Webhook', 'Sending POST /setwebhook...');
      try {
        const res = await fetch('/setwebhook', {
          method: 'POST',
          headers: { 'X-Admin-Key': adminKey }
        });
        const txt = await res.text();
        showOutput(\`POST /setwebhook (HTTP \${res.status})\`, txt);
      } catch (err) {
        showOutput('Error', err.message);
      }
    }

    async function runCron() {
      showOutput('Triggering Cron', 'Sending POST /cron...');
      try {
        const res = await fetch('/cron', {
          method: 'POST',
          headers: { 'X-Admin-Key': adminKey }
        });
        const txt = await res.text();
        showOutput(\`POST /cron (HTTP \${res.status})\`, txt);
      } catch (err) {
        showOutput('Error', err.message);
      }
    }

    async function fetchLogs() {
      showOutput('Fetching Logs', 'GET /api/logs...');
      try {
        const res = await fetch('/api/logs', {
          headers: { 'X-Admin-Key': adminKey }
        });
        const json = await res.json();
        showOutput('Activity Logs', json);
      } catch (err) {
        showOutput('Error', err.message);
      }
    }

    async function fetchConfig() {
      showOutput('Fetching Config', 'GET /config...');
      try {
        const res = await fetch('/config', {
          headers: { 'X-Admin-Key': adminKey }
        });
        const json = await res.json();
        showOutput('Bot Configuration', json);
      } catch (err) {
        showOutput('Error', err.message);
      }
    }

    async function testMediaSupport() {
      showOutput('Testing Media Detection Engine', 'Running media test suite...');
      try {
        const res = await fetch('/api/test-media');
        const json = await res.json();
        showOutput('Universal Media Engine Test Suite', json);
      } catch (err) {
        showOutput('Error', err.message);
      }
    }

    function copyText(id) {
      const text = document.getElementById(id).textContent;
      navigator.clipboard.writeText(text);
      alert('Copied to clipboard: ' + text);
    }
  </script>
</body>
</html>`;
}

// Convert Node incoming message to Web Standard Request
async function nodeToWebRequest(req, host) {
  const fullUrl = `http://${host}${req.url}`;
  const headers = new Headers();
  for (const [key, val] of Object.entries(req.headers)) {
    if (val !== undefined) {
      if (Array.isArray(val)) {
        for (const v of val) headers.append(key, v);
      } else {
        headers.set(key, val);
      }
    }
  }

  let body = null;
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    body = Buffer.concat(chunks);
  }

  return new Request(fullUrl, {
    method: req.method,
    headers,
    body: body && body.length > 0 ? body : undefined,
    duplex: 'half'
  });
}

// HTTP Server
const server = http.createServer(async (req, res) => {
  const host = req.headers.host || `localhost:${PORT}`;
  const parsedUrl = new URL(req.url, `http://${host}`);

  // Root Dashboard Route
  if (parsedUrl.pathname === '/' && req.method === 'GET') {
    const html = renderDashboard(host);
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-cache'
    });
    return res.end(html);
  }

  // Health check endpoint
  if (parsedUrl.pathname === '/health' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ status: 'ok', bot: state.BOT_NAME }));
  }

  // Universal Media Test Route
  if (parsedUrl.pathname === '/api/test-media' && req.method === 'GET') {
    const samples = [
      {
        name: 'Photo Submission',
        msg: {
          photo: [
            { file_id: 'p1_small' },
            { file_id: 'p1_full_hd', file_unique_id: 'u_p1', width: 1280, height: 720, file_size: 154000 }
          ],
          caption: 'Beautiful sunset entry'
        }
      },
      {
        name: 'Animated Sticker Submission',
        msg: {
          sticker: {
            file_id: 'st_tgs_123',
            file_unique_id: 'u_st1',
            is_animated: true,
            is_video: false,
            emoji: '🔥',
            set_name: 'HotStickers',
            file_size: 45000
          }
        }
      },
      {
        name: 'Video Note (Round Video)',
        msg: {
          video_note: {
            file_id: 'vn_circle_789',
            file_unique_id: 'u_vn1',
            duration: 8,
            length: 360,
            file_size: 980000
          }
        }
      },
      {
        name: 'Voice Note Submission',
        msg: {
          voice: {
            file_id: 'vc_456',
            file_unique_id: 'u_vc1',
            duration: 15,
            mime_type: 'audio/ogg',
            file_size: 24000
          },
          caption: 'My sung voice note'
        }
      },
      {
        name: 'Music Audio File Submission',
        msg: {
          audio: {
            file_id: 'au_999',
            file_unique_id: 'u_au1',
            title: 'Midnight Beats',
            performer: 'LoFi Artist',
            duration: 180,
            mime_type: 'audio/mpeg',
            file_size: 4200000
          }
        }
      },
      {
        name: 'Contact Card Submission',
        msg: {
          contact: {
            phone_number: '+1234567890',
            first_name: 'Alex',
            last_name: 'Rivera',
            user_id: 123456
          }
        }
      },
      {
        name: 'Location Pin Submission',
        msg: {
          location: {
            latitude: 37.7749,
            longitude: -122.4194,
            horizontal_accuracy: 5
          }
        }
      }
    ];

    const results = samples.map(s => {
      const detected = detectMedia(s.msg);
      return {
        test: s.name,
        detected_kind: detected.kind,
        badge: formatMediaBadge(detected),
        file_id: detected.file_id,
        caption: detected.caption,
        metadata: detected.metadata,
        valid_for_media_contest: validateSubmissionForMode(detected, 'media').ok,
        valid_for_image_contest: validateSubmissionForMode(detected, 'image').ok,
        valid_for_text_contest: validateSubmissionForMode(detected, 'text').ok
      };
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(
      JSON.stringify(
        {
          status: 'ok',
          engine: 'Universal Telegram Media & Raw Data Detection',
          total_tested: results.length,
          results
        },
        null,
        2
      )
    );
  }

  // Pass all other endpoints to Worker
  try {
    const webReq = await nodeToWebRequest(req, host);
    const ctx = {
      waitUntil: (promise) => {
        Promise.resolve(promise).catch(err => {
          console.error('[ctx.waitUntil error]:', err);
        });
      }
    };

    const webRes = await worker.fetch(webReq, process.env, ctx);

    // Convert Web Response back to Node HTTP response
    const resHeaders = {};
    for (const [key, val] of webRes.headers.entries()) {
      resHeaders[key] = val;
    }

    res.writeHead(webRes.status, resHeaders);

    if (webRes.body) {
      const reader = webRes.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
    }
    res.end();
  } catch (error) {
    console.error('Request handling error:', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: error.message || 'Internal Server Error' }));
  }
});

// Initialize DB schema & start server
server.listen(PORT, HOST, async () => {
  console.log(`🚀 AnonX Bot Server running at http://${HOST}:${PORT}`);
  try {
    await initDB(process.env);
    console.log('✅ Database schema initialized successfully');
  } catch (err) {
    console.warn('⚠️ Database init warning:', err.message);
  }

  // Start background scheduler tick every 60 seconds (replicates Cloudflare Cron Trigger)
  const ctx = {
    waitUntil: (promise) => {
      Promise.resolve(promise).catch(err => console.error('[Scheduled Task Error]:', err));
    }
  };

  setInterval(() => {
    worker.scheduled({ scheduledTime: Date.now(), cron: '* * * * *' }, process.env, ctx)
      .catch(err => console.error('[Scheduled Tick Error]:', err));
  }, 60000);
});
