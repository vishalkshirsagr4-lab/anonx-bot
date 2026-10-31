// src/worker.js
import { state, applyEnv, SOURCES } from './config.js';
import { initDB, q } from './db.js';
import { tg } from './telegram.js';
import { send, warmCards, imgBase } from './cards.js';
import { handleUpdate, setupCommands } from './handlers.js';
import { tick } from './scheduler.js';

export default {
  async fetch(request, env, ctx) {
    applyEnv(env);
    const url = new URL(request.url);
    const secret = state.WEBHOOK_SECRET;

    if (!secret) return new Response('❌ WEBHOOK_SECRET missing', { status: 500 });

    // /config — debug
    if (url.pathname === '/config' && request.method === 'GET') {
      if (url.searchParams.get('key') !== secret) return new Response('Unauthorized', { status: 401 });
      const required = ['BOT_TOKEN', 'WEBHOOK_SECRET', 'TURSO_DB_URL', 'TURSO_AUTH_TOKEN', 'OWNER_ID'];
      const out = {
        sources: SOURCES,
        missing_required: required.filter(k => SOURCES[k] === 'MISSING'),
        image_api: imgBase(env) ? 'configured' : 'not configured',
        bot_name: state.BOT_NAME
      };
      return new Response(JSON.stringify(out, null, 2), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // /api/logs — debug
    if (url.pathname === '/api/logs' && request.method === 'GET') {
      if ((url.searchParams.get('key') || request.headers.get('X-Logs-Key')) !== secret)
        return new Response('Unauthorized', { status: 401 });
      try {
        await initDB(env);
        const res = await q(env, `SELECT ts, user_id as id, name, username as user, text, action FROM logs ORDER BY id ASC LIMIT 50`);
        return new Response(JSON.stringify(res.rows), {
          headers: { 'Content-Type': 'application/json' }
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    // /setwebhook — one-time setup
    // /setwebhook — protected one-time setup
if (url.pathname === '/setwebhook') {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', {
      status: 405,
      headers: { Allow: 'POST' }
    });
  }

  if (request.headers.get('X-Admin-Key') !== secret) {
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    await initDB(env);

    const hook = `${url.origin}/webhook`;

    const res = await tg(env, 'setWebhook', {
      url: hook,
      secret_token: secret,
      allowed_updates: [
        'message',
        'callback_query',
        'my_chat_member'
      ]
    });

    if (!res || !res.ok) {
      return new Response('Telegram webhook setup failed.', {
        status: 502
      });
    }

    await setupCommands(env);

    return new Response(
      `Webhook configured successfully.\n${hook}`,
      { status: 200 }
    );
  } catch (e) {
    console.error('Webhook setup error:', e);

    return new Response('Webhook setup failed.', {
      status: 500
    });
  }
}

    // /health — cron/manual tick
    if (url.pathname === '/cron' && request.method === 'GET') {
      if (url.searchParams.get('key') !== secret) return new Response('Unauthorized', { status: 401 });
      try { await initDB(env); await tick(env); return new Response('✅ Tick done'); }
      catch (e) { return new Response(`❌ ${e.message}`, { status: 500 }); }
    }

    if (url.pathname !== '/webhook') return new Response('Not found', { status: 404 });

    if (request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== secret)
      return new Response('Unauthorized', { status: 401 });

    let update;
    try { update = await request.json(); }
    catch { return new Response('Bad JSON', { status: 400 }); }

    ctx.waitUntil((async () => {
      try {
        await initDB(env);
        await handleUpdate(update, env, ctx);
      } catch (e) {
        console.error('Update Error:', e);
      }
    })());

    return new Response('OK');
  },

  async scheduled(event, env, ctx) {
    applyEnv(env);
    ctx.waitUntil((async () => {
      try {
        await initDB(env);
        await tick(env);
        await warmCards(env);
      } catch (e) {
        console.error('Tick Error:', e);
      }
    })());
  }
};
