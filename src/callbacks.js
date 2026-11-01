
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
  delContestFromBag,
  deleteContestPermanently
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

    // ─── Add Contest Mode Wizard ───
    if (data.startsWith('addc_mode_')) {
      if (!isOwner(userId)) {
        return tg(env, 'answerCallbackQuery', {
          callback_query_id: cq.id,
          text: '⛔ Owner only.',
          show_alert: true
        });
      }

      const mode = data.slice('addc_mode_'.length);
      const { kvPut } = await import('./db.js');

      await kvPut(
        env,
        `pending_addcontest:${userId}`,
        { step: 'waiting_line', mode },
        600
      );

      let modeInfo = '';
      if (mode === 'image') {
        modeInfo =
          `🖼️ <b>Mode: Image Contest</b>\n` +
          `• Participants will submit: <b>Photos / Images only</b>\n\n`;
      } else if (mode === 'text') {
        modeInfo =
          `✍️ <b>Mode: Text Contest</b>\n` +
          `• Participants will submit: <b>Written Answers only</b>\n\n`;
      } else {
        modeInfo =
          `🎬 <b>Mode: Universal Media Contest</b>\n` +
          `• Accepted media types:\n` +
          `  - 🖼️ Photos & Images\n` +
          `  - 🎭 Stickers (Static, Animated TGS, Video WEBM)\n` +
          `  - 🎬 Videos & 🎞️ GIF Animations\n` +
          `  - 📹 Video Notes & 🎙️ Voice Notes\n` +
          `  - 🎵 Audio & Music Tracks\n` +
          `  - 📄 Documents & Files (PDF, ZIP, TXT, etc.)\n` +
          `  - 👤 Contacts, 📍 Locations & 🏢 Venues\n` +
          `  - ✍️ Written Text\n\n`;
      }

      return editCq(
        env,
        cq,
        `➕ <b>Create Contest</b>\n\n` +
        modeInfo +
        `Send contest details in this format:\n` +
        `<code>Banner_Image_URL - Name - 1st, 2nd, 3rd, part [- rank_key]</code>\n\n` +
        `Example:\n` +
        `<code>https://example.com/banner.jpg - My Contest - 1000, 500, 250, 50 - epic</code>\n\n` +
        `Send /cancel to abort.`
      );
    }

    if (data === 'addc_cancel') {
      const { kvDel } = await import('./db.js');
      await kvDel(env, `pending_addcontest:${userId}`);
      return editCq(env, cq, '✖️ Add contest cancelled.');
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

      const { kvPut, q } = await import('./db.js');

      await kvPut(
        env,
        `pending_submit_run:${userId}`,
        String(runId),
        600
      );

      const runRes = await q(
        env,
        `SELECT name, mode, submission_type FROM runs WHERE run_id = ?`,
        [runId]
      );
      const run = runRes.rows[0];
      const mode = (run && (run.submission_type || run.mode)) || 'image';
      const contestName = run ? run.name : 'Contest';

      let instructions = '';
      if (mode === 'image') {
        instructions =
          `📝 <b>Submit to: ${esc(contestName)}</b>\n\n` +
          `📁 Mode: <b>🖼️ Image Contest</b>\n` +
          `Please send your <b>photo</b> entry now.\n\n` +
          `Send /cancel to abort.`;
      } else if (mode === 'text') {
        instructions =
          `📝 <b>Submit to: ${esc(contestName)}</b>\n\n` +
          `📁 Mode: <b>✍️ Text Contest</b>\n` +
          `Please type your <b>written answer</b> now.\n\n` +
          `Send /cancel to abort.`;
      } else {
        instructions =
          `📝 <b>Submit to: ${esc(contestName)}</b>\n\n` +
          `📁 Mode: <b>🎬 Universal Media Contest</b>\n\n` +
          `Accepted media types:\n` +
          `• 🖼️ Photos & 🎭 Stickers (Static, Animated, Video)\n` +
          `• 🎬 Videos & 🎞️ GIF Animations\n` +
          `• 📹 Video Notes & 🎙️ Voice Messages\n` +
          `• 🎵 Audio Tracks & 📄 Documents\n` +
          `• 👤 Contacts, 📍 Locations & 🏢 Venues\n` +
          `• ✍️ Written Text\n\n` +
          `Send your entry now! Send /cancel to abort.`;
      }

      await editCq(env, cq, instructions);
      return;
    }

    // ─── Contest deletion menu ───
    if (data === 'dcm_remove' || data === 'dcm_permanent') {
      if (!isOwner(userId)) return tg(env, 'answerCallbackQuery', { callback_query_id: cq.id, text: '⛔ Owner only.', show_alert: true });
      await tg(env, 'answerCallbackQuery', { callback_query_id: cq.id });
      if (data === 'dcm_remove') {
        const r = await q(env, 'SELECT * FROM groups ORDER BY title LIMIT 100');
        if (!r.rows.length) return editCq(env, cq, '📭 No groups are registered yet.');
        return editCq(env, cq, '➖ <b>Remove from one group</b>\n\nSelect the group:', {
          inline_keyboard: r.rows.map(g => [{ text: '📢 ' + esc(g.title || g.chat_id), callback_data: 'dcg_' + g.chat_id }])
        });
      }
      const r = await q(env, 'SELECT id, name FROM contests ORDER BY id DESC LIMIT 100');
      if (!r.rows.length) return editCq(env, cq, '📭 There are no contests to delete.');
      return editCq(env, cq, '🗑 <b>Permanently delete a contest</b>\n\nSelect one. You will be asked to confirm:', {
        inline_keyboard: r.rows.map(c => [{ text: '🗑 #' + c.id + ' ' + esc(c.name).slice(0, 40), callback_data: 'dpx_' + c.id }])
      });
    }

    // ─── Remove contest from one group's rotation ───
    if (data.startsWith('delc_')) {
      if (!isOwner(userId)) return tg(env, 'answerCallbackQuery', { callback_query_id: cq.id, text: '⛔ Owner only.', show_alert: true });
      const rest = data.slice(5);
      const idx = rest.lastIndexOf('_');
      if (idx <= 0) return tg(env, 'answerCallbackQuery', { callback_query_id: cq.id, text: '❌ Invalid request.', show_alert: true });
      const groupChat = rest.slice(0, idx);
      const contestId = Number(rest.slice(idx + 1));
      if (!/^-?\d+$/.test(groupChat) || !Number.isSafeInteger(contestId) || contestId <= 0) return tg(env, 'answerCallbackQuery', { callback_query_id: cq.id, text: '❌ Invalid request.', show_alert: true });
      const removed = await delContestFromBag(env, groupChat, contestId);
      await tg(env, 'answerCallbackQuery', { callback_query_id: cq.id, text: removed ? '✅ Removed from this group.' : 'ℹ️ Contest was not in this group.', show_alert: false });
      const r = await q(env, 'SELECT c.* FROM contest_bag b JOIN contests c ON c.id = b.contest_id WHERE b.chat_id = ? ORDER BY c.id DESC', [groupChat]);
      if (!r.rows.length) return editCq(env, cq, '📭 This group has no contests left in its bag.');
      return editCq(env, cq, '➖ <b>Remove another contest from this group:</b>', {
        inline_keyboard: r.rows.map(c => [{ text: '➖ #' + c.id + ' ' + esc(c.name).slice(0, 40), callback_data: 'delc_' + groupChat + '_' + c.id }])
      });
    }

    // ─── Choose contest for permanent deletion ───
    if (data.startsWith('dpx_')) {
      if (!isOwner(userId)) return tg(env, 'answerCallbackQuery', { callback_query_id: cq.id, text: '⛔ Owner only.', show_alert: true });
      const contestId = Number(data.slice(4));
      if (!Number.isSafeInteger(contestId) || contestId <= 0) return tg(env, 'answerCallbackQuery', { callback_query_id: cq.id, text: '❌ Invalid contest ID.', show_alert: true });
      const r = await q(env, 'SELECT id, name FROM contests WHERE id = ? LIMIT 1', [contestId]);
      if (!r.rows.length) return tg(env, 'answerCallbackQuery', { callback_query_id: cq.id, text: 'Contest no longer exists.', show_alert: true });
      await tg(env, 'answerCallbackQuery', { callback_query_id: cq.id });
      return editCq(env, cq, '⚠️ <b>Confirm permanent deletion</b>\n\nContest: <b>#' + r.rows[0].id + ' — ' + esc(r.rows[0].name) + '</b>\n\nThis removes it from every group and permanently deletes its runs, submissions, votes and rewards. This cannot be undone.', {
        inline_keyboard: [
          [{ text: '🗑 Yes, permanently delete', callback_data: 'dpy_' + contestId }],
          [{ text: '✖️ Cancel', callback_data: 'dpn' }]
        ]
      });
    }

    // ─── Confirm permanent deletion ───
    if (data.startsWith('dpy_')) {
      if (!isOwner(userId)) return tg(env, 'answerCallbackQuery', { callback_query_id: cq.id, text: '⛔ Owner only.', show_alert: true });
      const contestId = Number(data.slice(4));
      if (!Number.isSafeInteger(contestId) || contestId <= 0) return tg(env, 'answerCallbackQuery', { callback_query_id: cq.id, text: '❌ Invalid contest ID.', show_alert: true });
      const deleted = await deleteContestPermanently(env, contestId);
      await tg(env, 'answerCallbackQuery', { callback_query_id: cq.id, text: deleted ? '✅ Contest permanently deleted.' : 'ℹ️ Contest no longer exists.', show_alert: false });
      return editCq(env, cq, deleted ? '🗑 Contest #' + contestId + ' and its associated data were permanently deleted.' : 'ℹ️ This contest was already deleted.');
    }

    // ─── Cancel permanent deletion ───
    if (data === 'dpn') {
      if (!isOwner(userId)) return tg(env, 'answerCallbackQuery', { callback_query_id: cq.id, text: '⛔ Owner only.', show_alert: true });
      await tg(env, 'answerCallbackQuery', { callback_query_id: cq.id, text: 'Cancelled.' });
      return editCq(env, cq, '✖️ Permanent deletion cancelled.');
    }

    // ─── Select group for group-only removal ───
    if (data.startsWith('dcg_')) {
      if (!isOwner(userId)) return tg(env, 'answerCallbackQuery', { callback_query_id: cq.id, text: '⛔ Owner only.', show_alert: true });
      const targetChat = data.slice(4);
      if (!/^-?\d+$/.test(targetChat)) return tg(env, 'answerCallbackQuery', { callback_query_id: cq.id, text: '❌ Invalid group.', show_alert: true });
      const r = await q(env, 'SELECT c.* FROM contest_bag b JOIN contests c ON c.id = b.contest_id WHERE b.chat_id = ? ORDER BY c.id DESC', [targetChat]);
      if (!r.rows.length) {
        await tg(env, 'answerCallbackQuery', { callback_query_id: cq.id, text: '📭 No contests in that group.', show_alert: true });
        return editCq(env, cq, '📭 This group has no contests in its bag.');
      }
      await tg(env, 'answerCallbackQuery', { callback_query_id: cq.id });
      return editCq(env, cq, '➖ <b>Select a contest to remove from this group:</b>', {
        inline_keyboard: r.rows.map(c => [{ text: '➖ #' + c.id + ' ' + esc(c.name).slice(0, 40), callback_data: 'delc_' + targetChat + '_' + c.id }])
      });
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
