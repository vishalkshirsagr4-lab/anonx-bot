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