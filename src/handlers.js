// src/handlers.js
import { state, CFG, isOwner } from './config.js';
import { q, kvGet, kvPut, kvDel, upsertGroup, touchUser, getCoins, spendCoins, getUser } from './db.js';
import { tg } from './telegram.js';
import { send, editCq, deleteCq, sendCard, welcomeSpec, botProfileSpec, revealSpec } from './cards.js';
import { getHelp, helpMainView } from './help.js';
import { handleSettingsCb, settingsView } from './settings.js';
import { handleJoin, handleSubmitCmd, groupContestStatus, dmContestStatus, forceContest } from './contest.js';
import { handleVotingCommand } from './voting.js';
import { sendWallet, handleClaim, showLeaderboard, handleSendCoins } from './users.js';
import { sendAnonMessage } from './anon.js';
import { handleGameCommand, handleGameMessage } from './games.js';
import {
  handleOwnerCmd, delcontestGroupView, startDeldb,
  addContestOne, handleDelContestDM, listContests, bulkAddStart, bulkAddFromFile,
  deldbKeypadMarkup, ownerAddOne, handleContestWizard
} from './owner.js';
import {
  esc, userLink, genId, getBotInfo, isAdmin, listUserGroups,
  parseCommand, shouldTouch, logToTerminal, fmtClock, fmtTime, fmtDur,
  botIdentity
} from './helpers.js';
import { detectMedia, validateSubmissionForMode, formatMediaBadge } from './media.js';

// ────────────────────────────────────────────────────────────
// UPDATE ENTRY
// ────────────────────────────────────────────────────────────
export async function handleUpdate(update, env, ctx) {
  if (update.my_chat_member) {
    const chat = update.my_chat_member.chat;
    const status = update.my_chat_member.new_chat_member.status;
    if (chat.type === 'private') return;
    if (['member', 'administrator', 'creator'].includes(status)) await upsertGroup(env, chat);
    else if (status === 'left' || status === 'kicked')
      await q(env, `DELETE FROM groups WHERE chat_id = ?`, [String(chat.id)]);
    return;
  }
  if (update.message) return handleMessage(update.message, env, ctx);
  if (update.callback_query) {
    const { handleCallback } = await import('./callbacks.js');
    return handleCallback(update.callback_query, env);
  }
}

// ────────────────────────────────────────────────────────────
// MESSAGE DISPATCH
// ────────────────────────────────────────────────────────────
export async function handleMessage(msg, env, ctx) {
  if (!msg.from || msg.from.is_bot) return;
  const isGroup = msg.chat.type === 'group' || msg.chat.type === 'supergroup';
  if (isGroup) return handleGroupMessage(msg, env);
  if (msg.chat.type === 'private') return handleDM(msg, env, ctx);
}

// ────────────────────────────────────────────────────────────
// GROUP HANDLER
// ────────────────────────────────────────────────────────────
async function handleGroupMessage(msg, env) {
  const chatId = String(msg.chat.id);
  if (shouldTouch('g' + chatId)) await upsertGroup(env, msg.chat);
  if (shouldTouch(`m${chatId}:${msg.from.id}`)) {
    await q(env, `INSERT INTO group_members (chat_id, user_id, first_name, last_seen) VALUES (?, ?, ?, ?) ON CONFLICT(chat_id, user_id) DO UPDATE SET first_name = excluded.first_name, last_seen = excluded.last_seen`,
      [chatId, msg.from.id, msg.from.first_name || 'User', Date.now()]);
    await touchUser(env, msg.from, false);
  }

  const cmd = parseCommand(msg.text || '');
  if (!cmd) return handleGameMessage(env, msg);
  if (cmd.bot) {
    const bi = await getBotInfo(env);
    if (bi && bi.username.toLowerCase() !== cmd.bot.toLowerCase()) return;
  }

  // DM-only commands
  if (['ask', 'reveal', 'submit', 'deldb', 'addcontest', 'add', 'listcontest'].includes(cmd.name)) {
    const bi = await getBotInfo(env);
    return send(env, chatId, `📩 <b>Use this command in DM.</b>`, {
      reply_to_message_id: msg.message_id,
      reply_markup: { inline_keyboard: [[{ text: '📩 Open DM', url: `https://t.me/${bi.username}` }]] }
    });
  }

  if (['game', 'quiz', 'rps', 'word', 'riddle', 'dice', 'emoji', 'hunt'].includes(cmd.name)) return handleGameCommand(env, msg, cmd);
  if (cmd.name === 'start') return groupStart(env, msg);
  if (cmd.name === 'help') return groupHelp(env, msg);
  if (cmd.name === 'setting') {
    if (!(await isAdmin(env, chatId, msg.from.id)))
      return send(env, chatId, `⛔ Admins only.`, { reply_to_message_id: msg.message_id });
    const v = await settingsView(env, chatId, 'main');
    return send(env, chatId, v.text, { reply_markup: v.markup });
  }
  if (cmd.name === 'contest') return groupContestStatus(env, chatId, msg.message_id);
  if (['vote', 'voting', 'voteresult', 'votestart', 'voteend'].includes(cmd.name)) return handleVotingCommand(env, msg, cmd);
  if (cmd.name === 'claim') return handleClaim(env, chatId, msg.from, msg.message_id);
  if (cmd.name === 'sendcoins') return handleSendCoins(env, msg, cmd);
  if (cmd.name === 'wallet') return sendWallet(env, chatId, msg.from, msg.message_id);
  if (cmd.name === 'leaderboard') return showLeaderboard(env, chatId, msg.from, 'coins', 'group', msg.message_id);

  if (cmd.name === 'xcontest') {
    if (!isOwner(msg.from.id)) return send(env, chatId, `⛔ Owner only.`, { reply_to_message_id: msg.message_id });
    return forceContest(env, chatId);
  }
  if (cmd.name === 'delcontest') {
    if (!isOwner(msg.from.id)) return send(env, chatId, `⛔ Owner only.`, { reply_to_message_id: msg.message_id });
    return delcontestGroupView(env, chatId, chatId, msg.message_id);
  }
}

async function groupStart(env, msg) {
  const chatId = String(msg.chat.id);
  const id = await botIdentity(env);
  const spec = await botProfileSpec(env, id);
  const caption = `🤖 <b>${esc(state.BOT_NAME)}</b>\n\nUsername: @${esc(id.botUsername)}\nOwner: ${id.ownerName ? esc(id.ownerName) : '—'}\n\nUse the buttons below:`;
  const markup = { inline_keyboard: [
    [{ text: '🏓 Ping Test', callback_data: 'ping_test' }],
    [{ text: '📚 Help', callback_data: 'group_help' }]
  ] };
  return send(env, chatId, caption, { card: spec, reply_markup: markup, reply_to_message_id: msg.message_id });
}

async function groupHelp(env, msg) {
  const chatId = String(msg.chat.id);
  const bi = await getBotInfo(env);
  return send(env, chatId, `📚 <b>Help</b>\n\nThe full help menu is available in my DM.`, {
    reply_to_message_id: msg.message_id,
    card: { icon: 'book', title: 'Help Center', subtitle: 'Commands, rules and guides', cache: true },
    reply_markup: { inline_keyboard: [[{ text: '📩 Open Help in DM', url: `https://t.me/${bi.username}?start=help` }]] }
  });
}

// ────────────────────────────────────────────────────────────
// DM HANDLER
// ────────────────────────────────────────────────────────────
async function handleDM(msg, env, ctx) {
  const chatId = msg.chat.id, userId = msg.from.id, text = msg.text || '';
  await Promise.all([
    touchUser(env, msg.from, true),
    logToTerminal(env, msg.from, text || '[Media]', 'DM_MSG')
  ]);

  const cmd = parseCommand(text);

  // deldb keypad state — numeric typed messages
  const deldbMode = await kvGet(env, `deldb:${userId}`);
  if (deldbMode !== null && !cmd) {
    if (/^\d+$/.test(text)) {
      const entered = ((deldbMode || '') + text).slice(-20);
      await kvPut(env, `deldb:${userId}`, entered, 300);
      return send(env, chatId, `🗑 Password so far: <code>${'•'.repeat(entered.length)}</code>\n\nTap <b>✅ Done</b> when finished.`,
        { plain: true, reply_markup: deldbKeypadMarkup() });
    }
    return;
  }

  // Active owner /addcontest wizard session
  if (isOwner(userId)) {
    const pendContest = await kvGet(env, `pending_addcontest:${userId}`, true);
    if (pendContest) {
      return handleContestWizard(env, msg, userId, pendContest);
    }
  }

  // Submit flow — user sends media/text after picking run
  const pendingSubmitRun = await kvGet(env, `pending_submit_run:${userId}`);
  if (!cmd && pendingSubmitRun) {
    return handleSubmitEntry(env, msg, Number(pendingSubmitRun));
  }

  if (cmd) {
    switch (cmd.name) {
      case 'start': {
        if (isOwner(userId)) await setupCommands(env);
        if (cmd.arg.startsWith('reply_')) {
          const postId = cmd.arg.split('_')[1];
          await kvPut(env, `pending_reply:${userId}`, postId, 600);
          return send(env, chatId, `💬 <b>Reply Mode</b>\n\nType your message or send media. Use /reveal to reveal the anon user.`);
        }
        if (cmd.arg.startsWith('join_')) {
          const r = await handleJoin(env, msg.from, Number(cmd.arg.slice(5)));
          if (r.err) return send(env, chatId, `❌ Cannot join: ${r.err}`);
          return send(env, chatId, `✅ You joined <b>${esc(r.run.name)}</b>!\n\nSend your submission anytime with /submit.`);
        }
        if (cmd.arg === 'pre') return send(env, chatId, `✅ Bot started! Go back to the group and tap <b>Pre-Participate</b> again.`);
        if (cmd.arg === 'help') {
          const v = helpMainView(userId, 'help');
          return send(env, chatId, v.text, {
            card: { icon: 'book', title: 'Help Center', subtitle: 'Commands, rules and guides', cache: true },
            reply_markup: v.markup
          });
        }
        const spec = await welcomeSpec(env, msg.from);
        const startTxt = `Hello ${userLink(msg.from.id, msg.from.first_name)} 👋\n\nI am <b>${esc(state.BOT_NAME)}</b> — the <b>Anonymous Q&amp;A Bot</b>. Post and reply anonymously, join daily contests. Claim free coins with /claim.\n\nSelect an option below:`;
        const markup = { inline_keyboard: [
          [{ text: '❓ Help & Commands', callback_data: 'help_main_start' }],
          [{ text: '👨‍💻 Developer', url: `tg://user?id=${state.OWNER_ID}` }, { text: '🆘 Support', url: state.SUPPORT_GROUP }]
        ] };
        return send(env, chatId, startTxt, { card: spec, reply_markup: markup });
      }

      case 'help': {
        const v = helpMainView(userId, 'help');
        return send(env, chatId, v.text, {
          card: { icon: 'book', title: 'Help Center', subtitle: 'Commands, rules and guides', cache: true },
          reply_markup: v.markup
        });
      }

      case 'cancel': {
        await q(env, `DELETE FROM kv_store WHERE key IN (?, ?, ?, ?, ?, ?)`,
          [`pending_reply:${userId}`, `pending_ask:${userId}`, `pending_submit:${userId}`,
           `pending_addcontest:${userId}`, `pending_bulk:${userId}`, `deldb:${userId}`]);
        await kvDel(env, `pending_submit_run:${userId}`);
        return send(env, chatId, `✅ Cancelled.`);
      }

      case 'wallet': return sendWallet(env, chatId, msg.from);
      case 'claim': return handleClaim(env, chatId, msg.from);
      case 'leaderboard': return showLeaderboard(env, chatId, msg.from, 'coins', 'global');
      case 'ask': return handleAsk(msg, cmd, env);
      case 'reveal': return handleRevealCmd(env, chatId, userId);
      case 'submit': return handleSubmitCmd(env, chatId, userId, msg);
      case 'contest': return dmContestStatus(env, chatId, userId);
      case 'deldb':
        if (!isOwner(userId)) return send(env, chatId, `⛔ Owner only.`);
        return startDeldb(env, chatId, userId);
      case 'addcontest': case 'add': case 'listcontest': case 'xcontest':
        if (!isOwner(userId)) return send(env, chatId, `⛔ Owner only.`);
        return handleOwnerCmd(env, msg, cmd);
      case 'delcontest':
        if (!isOwner(userId)) return send(env, chatId, `⛔ Owner only.`);
        return handleDelContestDM(env, chatId, userId, cmd.arg);
      case 'confirm':
        return send(env, chatId, `❌ No active contest creation in progress. Use /addcontest to start.`);
      default:
        return send(env, chatId, `❓ Unknown command. Use /help.`);
    }
  }

  // Reply mode
  const pendingPostId = await kvGet(env, `pending_reply:${userId}`);
  if (pendingPostId) {
    const postRes = await q(env, `SELECT owner_id, msg_id, chat_id, thread_id FROM posts WHERE post_id = ?`, [pendingPostId]);
    if (postRes.rows.length > 0) {
      const originalPost = postRes.rows[0];
      const threadRes = await q(env, `SELECT thread_id, last_active, users_json, next_count FROM threads WHERE thread_id = ?`, [originalPost.thread_id]);
      if (threadRes.rows.length === 0) return send(env, chatId, `❌ Topic data not found.`);
      const tRow = threadRes.rows[0];
      const threadData = {
        threadId: tRow.thread_id,
        lastActive: tRow.last_active,
        users: JSON.parse(tRow.users_json || '{}'),
        nextCount: tRow.next_count
      };
      if ((Date.now() - threadData.lastActive) / 60000 > state.TOPIC_END_IDLE_MINUTES) {
        await kvDel(env, `pending_reply:${userId}`);
        return send(env, chatId, `🔒 <b>Topic Closed</b>\n\n${state.TOPIC_END_IDLE_MINUTES} min of inactivity.`);
      }
      const res = await sendAnonMessage(env, userId, msg, originalPost.chat_id, originalPost.msg_id, threadData, msg.text);
      if (res.ok) {
        await kvDel(env, `pending_reply:${userId}`);
        const cleanChatId = originalPost.chat_id.toString().replace('-100', '');
        await send(env, originalPost.owner_id, `🔔 <b>New Anonymous Reply!</b>`, {
          reply_markup: { inline_keyboard: [[{ text: '👀 View', url: `https://t.me/c/${cleanChatId}/${res.msgId}` }]] }
        });
        return send(env, chatId, `✅ Reply posted anonymously!`);
      }
      return send(env, chatId, `❌ Failed to post.`);
    }
  }
}

// ────────────────────────────────────────────────────────────
// /ask
// ────────────────────────────────────────────────────────────
async function handleAsk(msg, cmd, env) {
  const chatId = msg.chat.id, userId = msg.from.id;
  const parts = cmd.arg.split(/\s+/).filter(Boolean);
  const targetGroup = (parts.length > 0 && parts[0].startsWith('-100')) ? parts[0] : null;
  const content = targetGroup ? parts.slice(1).join(' ') : parts.join(' ');
  if (!content && !msg.reply_to_message)
    return send(env, chatId, `❌ Write some text or reply to media with /ask.`);
  const sourceMessage = msg.reply_to_message || msg;

  if (targetGroup) {
    const threadData = { threadId: genId(), lastActive: Date.now(), users: {}, nextCount: 1 };
    const res = await sendAnonMessage(env, userId, sourceMessage, targetGroup, null, threadData, content);
    return send(env, chatId, res.ok ? `✅ Posted anonymously!` : `❌ Failed. Ensure I'm admin there.`);
  }

  await kvPut(env, `pending_ask:${userId}`, { sourceMsg: sourceMessage, content }, 300);
  const loadMsg = await send(env, chatId, `⏳ Searching groups...`, { plain: true });
  const groups = await listUserGroups(env, userId);
  const mid = loadMsg.result.message_id;
  if (!groups.length)
    return tg(env, 'editMessageText', { chat_id: chatId, message_id: mid, text: `❌ No common groups.` });
  return tg(env, 'editMessageText', {
    chat_id: chatId, message_id: mid,
    text: `📤 Select a group:`,
    reply_markup: { inline_keyboard: groups.map(g => [{
      text: `📢 ${g.title}`, callback_data: `pickgrp_${g.chatId}`
    }]) }
  });
}

// ────────────────────────────────────────────────────────────
// /reveal
// ────────────────────────────────────────────────────────────
async function handleRevealCmd(env, chatId, userId) {
  const postId = await kvGet(env, `pending_reply:${userId}`);
  if (!postId)
    return send(env, chatId, `ℹ️ /reveal only works while replying to a post. Tap <b>💬 Reply</b> first.`);
  const coins = await getCoins(env, userId);
  return send(env, chatId,
    `👛 <b>Wallet:</b> ${coins} 🪙\n\n🕵️ <b>Secret Reveal</b> — no warning\n⚠️ <b>Reveal</b> — user warned`,
    {
      card: { icon: 'spy', title: 'Reveal Identity', subtitle: 'Secret or standard', cache: true },
      reply_markup: { inline_keyboard: [
        [{ text: `🕵️ Secret — ${CFG.REVEAL_COST_SECRET} 🪙`, callback_data: `rv_s_${postId}` }],
        [{ text: `⚠️ Reveal — ${CFG.REVEAL_COST_NORMAL} 🪙`, callback_data: `rv_n_${postId}` }],
        [{ text: `✖️ Cancel`, callback_data: `rv_x` }]
      ] }
    });
}

export async function doReveal(env, cq, mode, postId) {
  const userId = cq.from.id;
  const pr = await q(env, `SELECT owner_id FROM posts WHERE post_id = ?`, [postId]);
  if (!pr.rows.length) { await editCq(env, cq, `❌ Post gone.`); return; }
  const ownerId = pr.rows[0].owner_id;
  if (ownerId === userId) return { toast: `That's your own post 😄`, alert: true };

  const already = await q(env, `SELECT mode FROM reveals WHERE user_id = ? AND post_id = ?`, [userId, postId]);
  const cost = mode === 's' ? CFG.REVEAL_COST_SECRET : CFG.REVEAL_COST_NORMAL;

  if (!already.rows.length) {
    if (!(await spendCoins(env, userId, cost))) {
      const coins = await getCoins(env, userId);
      await editCq(env, cq, `❌ <b>Not enough coins.</b>\nWallet: ${coins} 🪙\nRequired: ${cost} 🪙`);
      return;
    }
    await q(env, `INSERT OR IGNORE INTO reveals (user_id, post_id, mode, ts) VALUES (?, ?, ?, ?)`,
      [userId, postId, mode, Date.now()]);
    if (mode === 'n')
      await send(env, ownerId, `⚠️ <b>Identity Warning</b>\n\nSomeone revealed your identity.\nThey know you — you won't know them.`);
  }

  const owner = await getUser(env, ownerId);
  const coins = await getCoins(env, userId);
  await deleteCq(env, cq);
  await send(env, cq.message.chat.id,
    `🔓 <b>Identity Revealed</b>\n\n👤 ${userLink(ownerId, owner && owner.first_name)}\n🔗 ${owner && owner.username ? '@' + esc(owner.username) : 'None'}\n🆔 <code>${ownerId}</code>\n\n👛 Wallet: ${coins} 🪙\n${mode === 's' ? '🕵️ Secret — user not notified.' : '⚠️ User has been warned.'}`,
    { card: revealSpec(mode) });
}

// ────────────────────────────────────────────────────────────
// Submit entry storage
// ────────────────────────────────────────────────────────────
async function handleSubmitEntry(env, msg, runId) {
  const userId = msg.from.id;
  const chatId = msg.chat.id;
  const rr = await q(env, `SELECT * FROM runs WHERE run_id = ?`, [runId]);
  if (!rr.rows.length) return send(env, chatId, `❌ Contest gone.`);
  const run = rr.rows[0];
  if (run.status !== 'submission' || Date.now() >= run.end_ts) {
    await kvDel(env, `pending_submit_run:${userId}`);
    return send(env, chatId, `⏰ Submission closed.`);
  }

  const subType = run.submission_type || run.mode || 'image';

  let content = null;

  if (subType === 'image') {
    if (!msg.photo || !Array.isArray(msg.photo) || msg.photo.length === 0) {
      return send(
        env,
        chatId,
        `This is an Image contest. Please upload a photo from your device.`
      );
    }
    const photo = msg.photo[msg.photo.length - 1];
    content = {
      version: 1,
      kind: 'photo',
      file_id: photo.file_id,
      file_unique_id: photo.file_unique_id || null,
      caption: msg.caption || '',
      text: '',
      metadata: {
        width: photo.width,
        height: photo.height,
        file_size: photo.file_size
      }
    };
  } else if (subType === 'text') {
    if (msg.photo || msg.video || msg.document || msg.voice || msg.audio || msg.sticker || msg.animation) {
      return send(
        env,
        chatId,
        `This is a Text contest. Please send your written answer.`
      );
    }
    const textAnswer = (msg.text || '').trim();
    if (!textAnswer) {
      return send(
        env,
        chatId,
        `This is a Text contest. Please send your written answer.`
      );
    }
    content = {
      version: 1,
      kind: 'text',
      file_id: null,
      file_unique_id: null,
      caption: '',
      text: textAnswer,
      metadata: {}
    };
  } else {
    const detected = detectMedia(msg);
    if (!detected || detected.kind === 'unknown') {
      return send(env, chatId, `❌ Please send a valid submission.`);
    }
    content = {
      version: 1,
      kind: detected.kind,
      file_id: detected.file_id,
      file_unique_id: detected.file_unique_id,
      caption: detected.caption,
      text: detected.text,
      metadata: detected.metadata
    };
  }

  const existing = await q(env, `SELECT id FROM submissions WHERE run_id = ? AND user_id = ?`, [runId, userId]);
  const now = Date.now();
  const contentJson = JSON.stringify(content);
  const badge = formatMediaBadge(content);

  if (existing.rows.length) {
    await q(
      env,
      `UPDATE submissions SET content_json = ?, last_ts = ?, edits = edits + 1 WHERE id = ?`,
      [contentJson, now, existing.rows[0].id]
    );
    await q(
      env,
      `INSERT INTO sub_history (run_id, user_id, ts, content_json) VALUES (?, ?, ?, ?)`,
      [runId, userId, now, contentJson]
    );
    return send(
      env,
      chatId,
      `🔄 <b>Submission updated!</b>\n\nEntry: <b>${badge}</b>\nYou can update again anytime before the deadline.`
    );
  }

  await q(
    env,
    `INSERT INTO submissions (run_id, user_id, content_json, first_ts, last_ts) VALUES (?, ?, ?, ?, ?)`,
    [runId, userId, contentJson, now, now]
  );
  await q(
    env,
    `INSERT INTO sub_history (run_id, user_id, ts, content_json) VALUES (?, ?, ?, ?)`,
    [runId, userId, now, contentJson]
  );
  await q(
    env,
    `INSERT OR IGNORE INTO participants (run_id, user_id, joined_at) VALUES (?, ?, ?)`,
    [runId, userId, now]
  );
  await kvDel(env, `pending_submit_run:${userId}`);
  return send(
    env,
    chatId,
    `✅ <b>Submission received!</b>\n\nEntry: <b>${badge}</b>\nYou can edit anytime until the deadline.`
  );
}

// ────────────────────────────────────────────────────────────
// Command setup
// ────────────────────────────────────────────────────────────

export async function setupCommands(env) {
  const user = [
    { command: 'start', description: 'Main menu' },
    { command: 'ask', description: 'Anonymous question' },
    { command: 'reveal', description: 'Reveal while replying' },
    { command: 'claim', description: 'Daily coins' },
    { command: 'wallet', description: 'Coin balance' },
    { command: 'leaderboard', description: 'Top 10' },
    { command: 'submit', description: 'Submit contest entry' },
    { command: 'contest', description: 'Contest status' },
    { command: 'cancel', description: 'Cancel pending action' },
    { command: 'help', description: 'Help menu' },
  ];

  const owner = [
    ...user,
    { command: 'addcontest', description: 'Owner: add a contest' },
    { command: 'add', description: 'Owner: bulk add from .txt' },
    { command: 'listcontest', description: 'Owner: list contests' },
    { command: 'delcontest', description: 'Owner: delete contests' },
    { command: 'xcontest', description: 'Owner: force start contest' },
    { command: 'deldb', description: 'Owner: wipe database' },
  ];

  const group = [
    { command: 'start', description: 'Bot info' },
    { command: 'ask', description: 'Anonymous question (opens DM)' },
    { command: 'contest', description: 'Contest status' },
    { command: 'vote', description: 'View entries and cast one vote' },
    { command: 'voting', description: 'Live voting status' },
    { command: 'voteresult', description: 'Contest standings/results' },
    { command: 'claim', description: 'Daily coins' },
    { command: 'wallet', description: 'Coin balance' },
    { command: 'sendcoins', description: 'Send coins to a group member' },
    { command: 'game', description: 'Open the Game Center' },
    { command: 'quiz', description: 'Play a quick quiz' },
    { command: 'rps', description: 'Rock paper scissors' },
    { command: 'word', description: 'Guess the hidden word' },
    { command: 'riddle', description: 'Solve a riddle' },
    { command: 'dice', description: 'Roll the dice' },
    { command: 'emoji', description: 'Guess the emoji phrase' },
    { command: 'hunt', description: 'Find hidden treasure' },
    { command: 'leaderboard', description: 'Top 10 group' },
    { command: 'help', description: 'Help' },
  ];

  const groupAdmins = [
    ...group,
    { command: 'votestart', description: 'Admin: start voting now' },
    { command: 'voteend', description: 'Admin: end voting and publish results' },
    { command: 'setting', description: 'Contest settings' },
  ];

  const requests = [
    {
      name: 'private commands',
      body: {
        commands: user,
        scope: { type: 'all_private_chats' },
      },
    },
    {
      name: 'group commands',
      body: {
        commands: group,
        scope: { type: 'all_group_chats' },
      },
    },
    {
      name: 'group admin commands',
      body: {
        commands: groupAdmins,
        scope: { type: 'all_chat_administrators' },
      },
    },
    {
      name: 'owner commands',
      owners: true,
      body: {
        commands: owner,
      },
    },
  ];

  for (const request of requests) {
    const targets = request.owners
      ? state.OWNER_IDS.map(ownerId => ({
          ...request.body,
          scope: { type: 'chat', chat_id: ownerId },
        }))
      : [request.body];

    for (const body of targets) {
      const result = await tg(env, 'setMyCommands', body);

    if (!result || result.ok !== true) {
      console.error(
        `Telegram command setup failed: ${request.name}`,
        result?.description || 'Unknown Telegram API error'
      );

      return {
        ok: false,
        failed: request.name,
        description: result?.description || 'Telegram API error',
      };
      }
    }
  }

  return { ok: true };
}
