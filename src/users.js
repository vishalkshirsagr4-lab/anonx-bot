// src/users.js
import { CFG } from './config.js';
import { q } from './db.js';
import { getCoins, addCoins } from './db.js';
import { send, walletSpec, claimedSpec, claimSpec } from './cards.js';
import { userLink, esc } from './helpers.js';

export async function sendWallet(env, chatId, from, replyTo) {
  const coins = await getCoins(env, from.id);
  return send(env, chatId,
    `👛 <b>Wallet</b>\n\n${userLink(from.id, from.first_name)}\n💰 <b>${coins} 🪙</b>`,
    { card: walletSpec(), reply_to_message_id: replyTo });
}


// Transfer coins to another member of the current group.
// Usage: reply to a member with /sendcoins 50, or /sendcoins @username 50.
export async function handleSendCoins(env, msg, cmd) {
  const chatId = String(msg.chat.id);
  const senderId = Number(msg.from.id);
  const parts = (cmd.arg || '').trim().split(/\s+/).filter(Boolean);
  let targetId = null;
  let amountText = '';

  if (msg.reply_to_message?.from && parts.length === 1) {
    targetId = Number(msg.reply_to_message.from.id);
    amountText = parts[0];
  } else if (parts.length === 2 && /^@[A-Za-z0-9_]{5,32}$/.test(parts[0])) {
    const username = parts[0].slice(1);
    const target = await q(env,
      `SELECT u.user_id FROM users u
       JOIN group_members gm ON gm.user_id = u.user_id
       WHERE gm.chat_id = ? AND lower(u.username) = lower(?)
       LIMIT 1`,
      [chatId, username]);
    if (target.rows.length) targetId = Number(target.rows[0].user_id);
    amountText = parts[1];
  } else if (msg.reply_to_message?.from && parts.length === 0) {
    return send(env, chatId, `ℹ️ Usage: reply to a member's message with <code>/sendcoins 50</code>.`, { reply_to_message_id: msg.message_id });
  } else {
    return send(env, chatId,
      `ℹ️ <b>How to send coins</b>\n\nReply to a member: <code>/sendcoins 50</code>\nOr use username: <code>/sendcoins @username 50</code>`,
      { reply_to_message_id: msg.message_id });
  }

  if (!targetId) {
    return send(env, chatId, `❌ I couldn't find that member in this group. Ask them to send a message here first.`, { reply_to_message_id: msg.message_id });
  }
  if (!Number.isSafeInteger(targetId) || targetId <= 0 || targetId === senderId) {
    return send(env, chatId, `❌ You cannot send coins to yourself.`, { reply_to_message_id: msg.message_id });
  }
  if (!/^[1-9]\d{0,8}$/.test(amountText)) {
    return send(env, chatId, `❌ Enter a valid amount from 1 to 999,999,999 coins.`, { reply_to_message_id: msg.message_id });
  }

  const amount = Number(amountText);
  const now = Date.now();

  // A single SQLite UPDATE makes the debit and credit atomic.
  // Both users must already exist and the sender must have enough coins.
  const transfer = await q(env,
    `UPDATE users
     SET coins = CASE
       WHEN user_id = ? THEN coins - ?
       WHEN user_id = ? THEN coins + ?
       ELSE coins
     END,
     updated_at = ?
     WHERE user_id IN (?, ?)
       AND (SELECT coins FROM users WHERE user_id = ?) >= ?
       AND (SELECT COUNT(*) FROM users WHERE user_id IN (?, ?)) = 2`,
    [senderId, amount, targetId, amount, now,
     senderId, targetId, senderId, amount, senderId, targetId]);

  if (transfer.rowsAffected !== 2) {
    const balance = await getCoins(env, senderId);
    return send(env, chatId,
      `❌ <b>Transfer failed.</b>\nYour wallet: <b>${balance} 🪙</b>\nCheck that the member has used the bot before and that you have enough coins.`,
      { reply_to_message_id: msg.message_id });
  }

  const [senderBalance, targetBalance] = await Promise.all([
    getCoins(env, senderId),
    getCoins(env, targetId)
  ]);
  const targetName = msg.reply_to_message?.from?.first_name ||
    (await q(env, `SELECT first_name FROM users WHERE user_id = ?`, [targetId])).rows[0]?.first_name ||
    'Member';

  return send(env, chatId,
    `✅ <b>Coins sent successfully!</b>\n\n👤 From: ${userLink(senderId, msg.from.first_name)}\n👤 To: ${userLink(targetId, targetName)}\n💸 Sent: <b>${amount} 🪙</b>\n\n👛 Your balance: <b>${senderBalance} 🪙</b>\n👛 Recipient balance: <b>${targetBalance} 🪙</b>`,
    { reply_to_message_id: msg.message_id });
}

export async function handleClaim(env, chatId, from, replyTo) {
  const day = Math.floor((Date.now() + CFG.TZ_OFFSET_HOURS * 3600000) / 86400000);
  const r = await q(env, `SELECT last_day FROM claims WHERE user_id = ?`, [from.id]);
  if (r.rows.length && r.rows[0].last_day === day) {
    return send(env, chatId,
      `⏳ <b>Already claimed today.</b>\nCome back tomorrow!`,
      { card: claimedSpec(), reply_to_message_id: replyTo });
  }
  await addCoins(env, from.id, CFG.CLAIM_COINS);
  await q(env, `INSERT INTO claims (user_id, last_day, total) VALUES (?, ?, 1) ON CONFLICT(user_id) DO UPDATE SET last_day = excluded.last_day, total = total + 1`,
    [from.id, day]);
  const coins = await getCoins(env, from.id);
  return send(env, chatId,
    `🎁 <b>+${CFG.CLAIM_COINS} coins claimed!</b>\n\n👛 Wallet: <b>${coins} 🪙</b>`,
    { card: claimSpec(), reply_to_message_id: replyTo });
}

export async function showLeaderboard(env, chatId, from, kind, scope, replyTo) {
  let rows;
  if (scope === 'group') {
    rows = (await q(env,
      `SELECT u.user_id, u.first_name, u.coins FROM users u JOIN group_members g ON g.user_id = u.user_id WHERE g.chat_id = ? ORDER BY u.coins DESC LIMIT ?`,
      [String(chatId), CFG.LEADERBOARD_TOP])).rows;
  } else {
    rows = (await q(env,
      `SELECT user_id, first_name, coins FROM users ORDER BY coins DESC LIMIT ?`,
      [CFG.LEADERBOARD_TOP])).rows;
  }
  const medals = ['🥇', '🥈', '🥉'];
  const list = rows.map((r, i) =>
    `${medals[i] || `${i + 1}.`} ${esc(r.first_name || 'User')} — ${r.coins} 🪙`
  ).join('\n') || 'No data yet.';
  return send(env, chatId,
    `🏆 <b>Top ${CFG.LEADERBOARD_TOP} — ${scope === 'group' ? 'This Group' : 'Global'}</b>\n\n${list}`,
    {
      card: {
        icon: 'trophy', title: 'Leaderboard',
        subtitle: scope === 'group' ? 'This group' : 'Global ranking',
        cache: true
      },
      reply_to_message_id: replyTo
    });
}