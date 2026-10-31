
// src/callbacks.js
import { state, isOwner } from './config.js';
import { tg } from './telegram.js';
import { q } from './db.js';
import { editCq, deleteCq } from './cards.js';
import { getHelp } from './help.js';
import { handleSettingsCb } from './settings.js';
import { handleVote } from './contest.js';
import {
  handleDeldbDigit,
  handleDeldbBackspace,
  handleDeldbConfirm,
  handleDeldbCancel,
  delContestFromBag
} from './owner.js';
import { getBotInfo, esc } from './helpers.js';

export async function handleCallback(cq, env) {
  const data = cq.data || '';
  const userId = cq.from.id;

  try {
    // ─── Help navigation ───
    if (data.startsWith('help_')) {
      const [action, callbackOrigin] = data.split(':');

      const section = action === 'help_main_start'
        ? 'main'
        : action.slice('help_'.length);

      const origin = callbackOrigin ||
        (action === 'help_main_start' ? 'start' : 'help');

      const H = getHelp();

      if (section === 'close') {
        await deleteCq(env, cq);
        return;
      }

      if (section === 'main') {
        const rows = [
          [{ text: H.ask.title, callback_data: `help_ask:${origin}` }],
          [{ text: H.contest.title, callback_data: `help_contest:${origin}` }],
          [{ text: H.wallet.title, callback_data: `help_wallet:${origin}` }],
          [{ text: H.setting.title, callback_data: `help_setting:${origin}` }]
        ];

        if (isOwner(userId)) {
          rows.push([
            { text: H.owner.title, callback_data: `help_owner:${origin}` }
          ]);
        }

        rows.push([
          {
            text: '👨‍💻 Developer',
            url: `tg://user?id=${state.OWNER_ID}`
          },
          {
            text: '🆘 Support',
            url: state.SUPPORT_GROUP
          }
        ]);

        rows.push([
          origin === 'start'
            ? { text: '🔙 Back', callback_data: 'back_start' }
            : { text: '✖️ Close', callback_data: 'help_close' }
        ]);

        return editCq(
          env,
          cq,
          `📚 <b>Help Menu</b>\n\nChoose a section:`,
          { inline_keyboard: rows }
        );
      }

      const sectionData = H[section];

      if (sectionData) {
        // Owner help must only be visible to the configured owner.
        if (section === 'owner' && !isOwner(userId)) {
          return tg(env, 'answerCallbackQuery', {
            callback_query_id: cq.id,
            text: '⛔ Owner only.',
            show_alert: true
          });
        }

        const rows = [[
          {
            text: '🔙 Back',
            callback_data: `help_main:${origin}`
          }
        ]];

        const messageText =
          `${sectionData.title}\n\n${sectionData.cmds}\n\n${sectionData.rules}`;

        return editCq(env, cq, messageText, {
          inline_keyboard: rows
        });
      }

      return;
    }

    if (data === 'help_close') {
      await deleteCq(env, cq);
      return;
    }

    // ─── Back to start ───
    if (data === 'back_start') {
      const welcome =
        `Hello ${esc(cq.from.first_name)} 👋\n\n` +
        `I am <b>${esc(state.BOT_NAME)}</b> — the ` +
        `<b>Anonymous Q&amp;A Bot</b>. Post and reply anonymously, ` +
        `join daily contests.\n\nSelect an option below:`;

      return editCq(env, cq, welcome, {
        inline_keyboard: [
          [
            {
              text: '❓ Help & Commands',
              callback_data: 'help_main_start'
            }
          ],
          [
            {
              text: '👨‍💻 Developer',
              url: `tg://user?id=${state.OWNER_ID}`
            },
            {
              text: '🆘 Support',
              url: state.SUPPORT_GROUP
            }
          ]
        ]
      });
    }

    // ─── Group help ───
    if (data === 'group_help') {
      const bi = await getBotInfo(env);

      return tg(env, 'answerCallbackQuery', {
        callback_query_id: cq.id,
        text: '📚 Open the bot in DM for full help.',
        url: `https://t.me/${bi.username}?start=help`
      });
    }

    // ─── Ping ───
    if (data === 'ping_test') {
      return tg(env, 'answerCallbackQuery', {
        callback_query_id: cq.id,
        text: '🏓 Pong! Bot is alive.',
        show_alert: true
      });
    }

    // ─── Settings ───
    if (data.startsWith('st:')) {
      const r = await handleSettingsCb(env, cq, data);

      if (r && r.toast) {
        return tg(env, 'answerCallbackQuery', {
          callback_query_id: cq.id,
          text: r.toast,
          show_alert: !!r.alert
        });
      }

      return;
    }

    // ─── Reveal ───
    if (data.startsWith('rv_')) {
      const parts = data.split('_');
      const mode = parts[1];
      const postId = parts.slice(2).join('_');

      if (mode === 'x') {
        await editCq(env, cq, '✖️ Reveal cancelled.');
        return;
      }

      const { doReveal } = await import('./handlers.js');
      const r = await doReveal(env, cq, mode, postId);

      if (r && r.toast) {
        return tg(env, 'answerCallbackQuery', {
          callback_query_id: cq.id,
          text: r.toast,
          show_alert: !!r.alert
        });
      }

      return;
    }

    // ─── Group picker for /ask ───
    if (data.startsWith('pickgrp_')) {
      const targetChat = data.slice(8);

      if (!/^-?\d+$/.test(targetChat)) {
        return tg(env, 'answerCallbackQuery', {
          callback_query_id: cq.id,
          text: '❌ Invalid group.',
          show_alert: true
        });
      }

      const pending = await q(
        env,
        `SELECT value FROM kv_store WHERE key = ?`,
        [`pending_ask:${userId}`]
      );

      if (!pending.rows.length) {
        return tg(env, 'answerCallbackQuery', {
          callback_query_id: cq.id,
          text: '❌ Session expired. Use /ask again.',
          show_alert: true
        });
      }

      const { sendAnonMessage } = await import('./anon.js');
      const data2 = JSON.parse(pending.rows[0].value);

      const threadData = {
        threadId: 't' + Date.now(),
        lastActive: Date.now(),
        users: {},
        nextCount: 1
      };

      const res = await sendAnonMessage(
        env,
        userId,
        data2.sourceMsg,
        targetChat,
        null,
        threadData,
        data2.content
      );

      await q(
        env,
        `DELETE FROM kv_store WHERE key = ?`,
        [`pending_ask:${userId}`]
      );

      await editCq(
        env,
        cq,
        res.ok
          ? '✅ Posted anonymously!'
          : '❌ Failed. Ensure I am admin there.'
      );

      return;
    }

    // ─── Vote ───
    if (data.startsWith('vote_')) {
      const subId = Number(data.slice(5));

      if (!Number.isSafeInteger(subId) || subId <= 0) {
        return tg(env, 'answerCallbackQuery', {
          callback_query_id: cq.id,
          text: '❌ Invalid submission.',
          show_alert: true
        });
      }

      const r = await handleVote(env, cq, subId);

      if (r && r.toast) {
        return tg(env, 'answerCallbackQuery', {
          callback_query_id: cq.id,
          text: r.toast,
          show_alert: !!r.alert
        });
      }

      return;
    }

    // ─── Submit run picker ───
    if (data.startsWith('subrun_')) {
      const runId = Number(data.slice(7));

      if (!Number.isSafeInteger(runId) || runId <= 0) {
        return tg(env, 'answerCallbackQuery', {
          callback_query_id: cq.id,
          text: '❌ Invalid contest.',
          show_alert: true
        });
      }

      const { kvPut } = await import('./db.js');

      await kvPut(
        env,
        `pending_submit_run:${userId}`,
        String(runId),
        600
      );

      await editCq(
        env,
        cq,
        `📝 Send your submission now.\n\n` +
        `• Text: send text\n` +
        `• Media: send photo/video/document\n\n` +
        `It will be stored as your entry. Send /cancel to abort.`
      );

      return;
    }

    // ─── Delete contest from group ───
    if (data.startsWith('delc_')) {
      if (!isOwner(userId)) {
        return tg(env, 'answerCallbackQuery', {
          callback_query_id: cq.id,
          text: '⛔ Owner only.',
          show_alert: true
        });
      }

      const rest = data.slice(5);
      const idx = rest.lastIndexOf('_');

      if (idx <= 0) {
        return tg(env, 'answerCallbackQuery', {
          callback_query_id: cq.id,
          text: '❌ Invalid request.',
          show_alert: true
        });
      }

      const groupChat = rest.slice(0, idx);
      const contestId = Number(rest.slice(idx + 1));

      if (
        !/^-?\d+$/.test(groupChat) ||
        !Number.isSafeInteger(contestId) ||
        contestId <= 0
      ) {
        return tg(env, 'answerCallbackQuery', {
          callback_query_id: cq.id,
          text: '❌ Invalid request.',
          show_alert: true
        });
      }

      await delContestFromBag(env, groupChat, contestId);

      return tg(env, 'answerCallbackQuery', {
        callback_query_id: cq.id,
        text: '✅ Deleted.',
        show_alert: false
      });
    }

    // ─── Delete contest group picker ───
    if (data.startsWith('dcg_')) {
      if (!isOwner(userId)) {
        return tg(env, 'answerCallbackQuery', {
          callback_query_id: cq.id,
          text: '⛔ Owner only.',
          show_alert: true
        });
      }

      const targetChat = data.slice(4);

      if (!/^-?\d+$/.test(targetChat)) {
        return tg(env, 'answerCallbackQuery', {
          callback_query_id: cq.id,
          text: '❌ Invalid group.',
          show_alert: true
        });
      }

      const r = await q(
        env,
        `SELECT c.* FROM contest_bag b
         JOIN contests c ON c.id = b.contest_id
         WHERE b.chat_id = ?
         ORDER BY c.id DESC`,
        [targetChat]
      );

      if (!r.rows.length) {
        return tg(env, 'answerCallbackQuery', {
          callback_query_id: cq.id,
          text: '📭 No contests in that group.',
          show_alert: true
        });
      }

      return editCq(
        env,
        cq,
        `🗑 <b>Select a contest to remove:</b>`,
        {
          inline_keyboard: r.rows.map(c => [{
            text: `❌ #${c.id} ${esc(c.name).slice(0, 40)}`,
            callback_data: `delc_${targetChat}_${c.id}`
          }])
        }
      );
    }

    // ─── Database wipe ───
    if (data.startsWith('deldb_')) {
      const op = data.slice(6);
      let r;

      if (op === 'cancel') {
        r = await handleDeldbCancel(env, cq);
      } else if (op === 'ok') {
        r = await handleDeldbConfirm(env, cq);
      } else if (op === 'bs') {
        r = await handleDeldbBackspace(env, cq);
      } else if (/^d\d$/.test(op)) {
        r = await handleDeldbDigit(env, cq, op.slice(1));
      } else {
        return tg(env, 'answerCallbackQuery', {
          callback_query_id: cq.id,
          text: '❌ Invalid action.',
          show_alert: true
        });
      }

      if (r && r.toast) {
        return tg(env, 'answerCallbackQuery', {
          callback_query_id: cq.id,
          text: r.toast,
          show_alert: !!r.alert
        });
      }

      return;
    }

    // ─── Unknown callback ───
    return tg(env, 'answerCallbackQuery', {
      callback_query_id: cq.id,
      text: '⏳ Unknown action.',
      show_alert: false
    });

  } catch (e) {
    console.error('callback error', e);

    return tg(env, 'answerCallbackQuery', {
      callback_query_id: cq.id,
      text: '❌ Something went wrong. Please try again.',
      show_alert: true
    });
  }
}
