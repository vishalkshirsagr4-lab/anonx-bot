
// src/worker.js
import { state, applyEnv, SOURCES } from './config.js';
import { initDB, q } from './db.js';
import { tg } from './telegram.js';
import { warmCards, imgBase } from './cards.js';
import { handleUpdate, setupCommands } from './handlers.js';
import { tick } from './scheduler.js';

export default {
  async fetch(request, env, ctx) {
    applyEnv(env);

    const url = new URL(request.url);

    const webhookSecret = String(env?.WEBHOOK_SECRET || state.WEBHOOK_SECRET || '').trim();
    const adminSecret = String(env?.ADMIN_SECRET || state.ADMIN_SECRET || '').trim();

    // Admin endpoints require a separate secret.
    const isAdmin = () => {
      const supplied = request.headers.get('X-Admin-Key') || url.searchParams.get('admin_key');

      return (
        typeof adminSecret === 'string' &&
        adminSecret.length >= 16 &&
        supplied !== null &&
        supplied === adminSecret
      );
    };

    // ─── Admin authentication ───
    const adminOnly = () => {
      if (!adminSecret) {
        return new Response('Admin secret is not configured.', { status: 503, headers: { 'Cache-Control': 'no-store' } });
      }
      if (!isAdmin()) {
        return new Response('Unauthorized', {
          status: 401,
          headers: {
            'Cache-Control': 'no-store'
          }
        });
      }

      return null;
    };

    // ─── /config ───
    if (url.pathname === '/config') {
      if (request.method !== 'GET') {
        return new Response('Method not allowed', {
          status: 405,
          headers: { Allow: 'GET' }
        });
      }

      const denied = adminOnly();
      if (denied) return denied;

      const required = [
        'BOT_TOKEN',
        'WEBHOOK_SECRET',
        'ADMIN_SECRET',
        'TURSO_DB_URL',
        'TURSO_AUTH_TOKEN',
        'OWNER_ID'
      ];

      const output = {
        sources: SOURCES,
        missing_required: required.filter(
          key => SOURCES[key] === 'MISSING'
        ),
        image_api: imgBase(env)
          ? 'configured'
          : 'not configured',
        ai_chat: String(env?.GROQ_API_KEY || '').trim() ? 'configured' : 'missing',
        ai_model: String(env?.GROQ_CHAT_MODEL || 'openai/gpt-oss-20b'),
        voice_transcription: String(env?.GROQ_API_KEY || '').trim() ? 'configured' : 'missing',
        bot_name: state.BOT_NAME
      };

      return new Response(
        JSON.stringify(output, null, 2),
        {
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store'
          }
        }
      );
    }

    // ─── /api/logs ───
    if (url.pathname === '/api/logs') {
      if (request.method !== 'GET') {
        return new Response('Method not allowed', {
          status: 405,
          headers: { Allow: 'GET' }
        });
      }

      const denied = adminOnly();
      if (denied) return denied;

      try {
        await initDB(env);

        const result = await q(
          env,
          `SELECT ts, user_id as id, name,
           username as user, text, action
           FROM logs
           ORDER BY id DESC
           LIMIT 50`
        );

        return new Response(
          JSON.stringify(result.rows),
          {
            headers: {
              'Content-Type': 'application/json',
              'Cache-Control': 'no-store'
            }
          }
        );
      } catch (error) {
        console.error('Logs endpoint error:', error);

        return new Response(
          JSON.stringify({
            error: 'Unable to retrieve logs.'
          }),
          {
            status: 500,
            headers: {
              'Content-Type': 'application/json',
              'Cache-Control': 'no-store'
            }
          }
        );
      }
    }

    // ─── /setwebhook ───
    if (url.pathname === '/setwebhook') {
      if (request.method !== 'POST') {
        return new Response('Method not allowed', {
          status: 405,
          headers: { Allow: 'POST' }
        });
      }

      const denied = adminOnly();
      if (denied) return denied;

      if (!webhookSecret) {
        return new Response('WEBHOOK_SECRET is not configured.', { status: 503, headers: { 'Cache-Control': 'no-store' } });
      }

      try {
        await initDB(env);

        const hook = `${url.origin}/webhook`;

        const result = await tg(env, 'setWebhook', {
          url: hook,
          secret_token: webhookSecret,
          allowed_updates: [
            'message',
            'callback_query',
            'my_chat_member'
          ]
        });

        if (!result?.ok) {
          console.error('Telegram rejected webhook setup:', result);

          return new Response(
            'Telegram webhook setup failed.',
            { status: 502 }
          );
        }

        const commandsResult = await setupCommands(env);

        if (commandsResult?.ok === false) {
          console.error('Telegram command setup failed.');

          return new Response(
            'Webhook configured, but command setup failed.',
            { status: 502 }
          );
        }

        return new Response(
          `Webhook configured successfully.\n${hook}`,
          {
            status: 200,
            headers: {
              'Content-Type': 'text/plain',
              'Cache-Control': 'no-store'
            }
          }
        );
      } catch (error) {
        console.error('Webhook setup error:', error);

        return new Response('Webhook setup failed.', {
          status: 500
        });
      }
    }

    // ─── /cron ───
    if (url.pathname === '/cron') {
      if (request.method !== 'POST') {
        return new Response('Method not allowed', {
          status: 405,
          headers: { Allow: 'POST' }
        });
      }

      const denied = adminOnly();
      if (denied) return denied;

      try {
        await initDB(env);
        await tick(env);

        return new Response('Tick completed.', {
          headers: {
            'Cache-Control': 'no-store'
          }
        });
      } catch (error) {
        console.error('Manual cron error:', error);

        return new Response('Scheduler failed.', {
          status: 500
        });
      }
    }

    // ─── Telegram webhook ───
    if (
      url.pathname !== '/webhook' ||
      request.method !== 'POST'
    ) {
      return new Response('Not found', {
        status: 404
      });
    }

    if (!webhookSecret) {
      return new Response('Webhook secret is not configured.', { status: 503 });
    }

    if (
      request.headers.get(
        'X-Telegram-Bot-Api-Secret-Token'
      ) !== webhookSecret
    ) {
      return new Response('Unauthorized', {
        status: 401
      });
    }

    let update;

    try {
      update = await request.json();
    } catch {
      return new Response('Bad JSON', {
        status: 400
      });
    }

    ctx.waitUntil((async () => {
      try {
        await initDB(env);
        await handleUpdate(update, env, ctx);
      } catch (error) {
        console.error('Update Error:', error);
      }
    })());

    return new Response('OK');
  },

  // ─── Cloudflare scheduled event ───
  async scheduled(event, env, ctx) {
    applyEnv(env);

    ctx.waitUntil((async () => {
      try {
        await initDB(env);
        await tick(env);
        await warmCards(env);
      } catch (error) {
        console.error('Scheduled task error:', error);
      }
    })());
  }
};
