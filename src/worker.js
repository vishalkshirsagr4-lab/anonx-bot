
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

    // Public, secret-free health summary for diagnosing webhook-wide failures.
    if (url.pathname === '/health' && request.method === 'GET') {
      const configured = {
        bot_token: Boolean(String(env?.BOT_TOKEN || '').trim()),
        webhook_secret: Boolean(String(env?.WEBHOOK_SECRET || '').trim()),
        admin_secret: Boolean(String(env?.ADMIN_SECRET || '').trim()),
        turso_db_url: Boolean(String(env?.TURSO_DB_URL || '').trim()),
        turso_auth_token: Boolean(String(env?.TURSO_AUTH_TOKEN || '').trim()),
        groq_api_key: Boolean(String(env?.GROQ_API_KEY || '').trim()),
        workers_ai_binding: Boolean(env?.AI && typeof env.AI.run === 'function')
      };
      const requiredReady = ['bot_token', 'webhook_secret', 'admin_secret', 'turso_db_url', 'turso_auth_token']
        .every(key => configured[key]);
      return new Response(JSON.stringify({
        status: requiredReady ? 'ready' : 'configuration_required',
        worker: 'ok',
        webhook_endpoint: '/webhook',
        webhook_setup_endpoint: '/setwebhook',
        webhook_status_endpoint: '/webhook-status',
        required: {
          bot_token: configured.bot_token,
          webhook_secret: configured.webhook_secret,
          admin_secret: configured.admin_secret,
          turso_db_url: configured.turso_db_url,
          turso_auth_token: configured.turso_auth_token
        },
        ai: {
          groq_api_key: configured.groq_api_key,
          model: String(env?.GROQ_CHAT_MODEL || 'openai/gpt-oss-20b'),
          image_generation: configured.workers_ai_binding ? 'cloudflare_workers_ai_configured' : 'workers_ai_binding_missing',
          image_model: '@cf/black-forest-labs/flux-1-schnell'
        }
      }, null, 2), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
    }

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
        image_generation: env?.AI && typeof env.AI.run === 'function'
          ? 'Cloudflare Workers AI configured'
          : 'Workers AI binding AI missing',
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

    // ─── Protected Telegram webhook diagnostics ───
    if (url.pathname === '/webhook-status') {
      if (request.method !== 'GET') {
        return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET' } });
      }

      const denied = adminOnly();
      if (denied) return denied;

      if (!String(env?.BOT_TOKEN || state.BOT_TOKEN || '').trim()) {
        return new Response(JSON.stringify({ ok: false, error: 'BOT_TOKEN is not configured.' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
        });
      }

      try {
        const result = await tg(env, 'getWebhookInfo', {});
        if (!result?.ok) {
          console.error('Telegram getWebhookInfo failed:', result?.description || 'Unknown Telegram API error');
          return new Response(JSON.stringify({
            ok: false,
            error: 'Telegram rejected getWebhookInfo.',
            telegram_error: String(result?.description || 'Unknown Telegram API error').slice(0, 300)
          }), {
            status: 502,
            headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
          });
        }

        const info = result.result || {};
        const expectedUrl = url.origin + '/webhook';
        const registeredUrl = String(info.url || '');
        return new Response(JSON.stringify({
          ok: true,
          webhook_registered: Boolean(registeredUrl),
          points_to_this_worker: registeredUrl === expectedUrl,
          expected_path: '/webhook',
          registered_url_matches: registeredUrl === expectedUrl,
          pending_update_count: Number(info.pending_update_count || 0),
          last_error_date: info.last_error_date || null,
          last_error_message: String(info.last_error_message || '').slice(0, 300) || null,
          max_connections: info.max_connections || null,
          allowed_updates: info.allowed_updates || []
        }, null, 2), {
          headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
        });
      } catch (error) {
        console.error('Webhook status check failed:', error?.message || String(error));
        return new Response(JSON.stringify({ ok: false, error: 'Unable to check Telegram webhook status.' }), {
          status: 502,
          headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
        });
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
        // Webhook registration is a Telegram API operation and must not depend
        // on Turso being reachable. Database health is checked by /health and
        // normal update processing, separately.
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
          const description = String(result?.description || result?.error || 'Unknown Telegram API error').slice(0, 300);
          const errorCode = Number.isFinite(Number(result?.error_code)) ? Number(result.error_code) : null;
          console.error('Telegram rejected webhook setup:', { error_code: errorCode, description });

          return new Response(JSON.stringify({
            ok: false,
            error: 'Telegram rejected webhook setup.',
            telegram_error_code: errorCode,
            telegram_description: description
          }, null, 2), {
            status: 502,
            headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
          });
        }

        // Command-menu setup is supplementary. Do not report webhook failure
        // after Telegram has already accepted the webhook.
        let commandsConfigured = false;
        let commandsWarning = null;
        try {
          const commandsResult = await setupCommands(env);
          commandsConfigured = commandsResult?.ok !== false;
          if (!commandsConfigured) {
            commandsWarning = String(commandsResult?.description || 'Telegram did not accept the command menu.').slice(0, 250);
          }
        } catch (commandsError) {
          commandsWarning = String(commandsError?.message || commandsError || 'Command menu setup failed.').slice(0, 250);
          console.error('Telegram command setup failed:', commandsWarning);
        }

        // Read back Telegram's registration so the response confirms the
        // actual URL, not only the setWebhook acknowledgement.
        const verification = await tg(env, 'getWebhookInfo', {});
        const registeredUrl = verification?.ok ? String(verification.result?.url || '') : '';
        const urlMatches = registeredUrl === hook;

        return new Response(JSON.stringify({
          ok: true,
          webhook_configured: true,
          expected_url: hook,
          registered_url_matches: verification?.ok ? urlMatches : null,
          verification_error: verification?.ok ? null : String(verification?.description || 'Could not verify webhook URL.').slice(0, 250),
          commands_configured: commandsConfigured,
          commands_warning: commandsWarning
        }, null, 2), {
          status: 200,
          headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
        });
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
      console.error('Webhook authentication failed: Telegram secret token does not match WEBHOOK_SECRET. Re-run the protected /setwebhook endpoint after changing the secret.');
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
        console.error('Update Error:', { update_id: update?.update_id, chat_id: update?.message?.chat?.id, message: error?.message || String(error) });
        if (update?.message?.chat?.id) {
          const token = env?.BOT_TOKEN || state.BOT_TOKEN;
          if (token) {
            try {
              await tg(env, 'sendMessage', { chat_id: update.message.chat.id, text: '⚠️ Piko is temporarily unable to process this message. The owner should check /health and Worker logs.' });
            } catch (sendError) {
              console.error('Update error notification failed:', sendError?.message || String(sendError));
            }
          }
        }
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
