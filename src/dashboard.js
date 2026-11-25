// src/dashboard.js
// AnonX/Piko dashboard: compact media card, live wallet progress and in-place navigation.
import { state } from './config.js';
import { q } from './db.js';
import { tg } from './telegram.js';
import { editCq } from './cards.js';
import { esc } from './helpers.js';

const REWARD_TARGET = 500;

async function getDashboardData(env, user) {
  let coins = 0;
  let topUsers = [];
  try {
    const result = await q(env, 'SELECT coins FROM users WHERE user_id=? LIMIT 1', [Number(user.id)]);
    coins = Math.max(0, Number(result.rows[0]?.coins || 0));
  } catch (error) {
    console.error('Piko dashboard wallet lookup failed:', error?.message || String(error));
  }
  try {
    const result = await q(env, 'SELECT first_name, coins FROM users ORDER BY coins DESC, user_id ASC LIMIT 10');
    topUsers = result.rows || [];
  } catch (error) {
    console.error('Piko dashboard leaderboard lookup failed:', error?.message || String(error));
  }
  return { coins, topUsers };
}

function progressBar(coins) {
  const percent = Math.max(0, Math.min(100, Math.floor((coins / REWARD_TARGET) * 100)));
  const filled = Math.round(percent / 10);
  return { percent, bar: '▰'.repeat(filled) + '▱'.repeat(10 - filled) };
}

function referralUrl(userId, username) {
  if (!username) return '';
  return 'https://t.me/' + username.replace(/^@/, '') + '?start=ref_' + Number(userId);
}

export async function dashboardMarkup(env, user) {
  let username = '';
  try {
    const me = await tg(env, 'getMe', {});
    username = me?.ok ? String(me.result?.username || '') : '';
  } catch (error) {
    console.error('Piko bot username lookup failed:', error?.message || String(error));
  }

  const link = referralUrl(user.id, username);
  const shareUrl = link
    ? 'https://t.me/share/url?url=' + encodeURIComponent(link) + '&text=' + encodeURIComponent('Join me on Piko!')
    : state.SUPPORT_GROUP;

  return { inline_keyboard: [
    [
      { text: '🚀 CREATE / CLAIM', callback_data: 'dash_claim', style: 'success' },
      { text: '📦 MY ITEMS', callback_data: 'dash_wallet', style: 'primary' }
    ],
    [
      { text: '👤 MY PROFILE', callback_data: 'dash_profile', style: 'danger' },
      { text: '🏆 LEADERBOARD', callback_data: 'dash_leaderboard', style: 'success' }
    ],
    [{ text: '💎 PLANS / UPGRADE', callback_data: 'dash_plans', style: 'primary' }],
    [{ text: '⚡ BUY POINTS ⭐', callback_data: 'dash_buy', style: 'danger' }],
    [{ text: '💬 SUPPORT', url: state.SUPPORT_GROUP }],
    ...(link ? [[{ text: '📤 SHARE REF LINK', url: shareUrl }]] : []),
    [{ text: '🔄 REFRESH', callback_data: 'dash_home', style: 'primary' }]
  ] };
}

export async function dashboardCaption(env, user) {
  const { coins } = await getDashboardData(env, user);
  const firstName = esc(user.first_name || 'Friend');
  const percent = Math.max(0, Math.min(100, Math.floor((coins / REWARD_TARGET) * 100)));
  const filled = Math.round(percent / 10);
  const bar = '▰'.repeat(filled) + '▱'.repeat(10 - filled);

  let username = '';
  try {
    const me = await tg(env, 'getMe', {});
    username = me?.ok ? String(me.result?.username || '') : '';
  } catch {}

  const link = referralUrl(user.id, username);
  const refLine = link ? '🔗 <b>REF LINK:</b>\n<code>' + esc(link) + '</code>\n' : '';

  return (
    '✦ <b>ＰＩＫＯ • PERSONAL DASHBOARD</b> ✨\n' +
    '<blockquote>' +
    '👤 <b>NAME:</b> ' + firstName + '\n' +
    '🆔 <b>USER ID:</b> <code>' + Number(user.id) + '</code>\n' +
    '⭐ <b>POINTS:</b> <code>' + coins.toLocaleString('en-US') + '</code>\n' +
    refLine +
    '━━━━━━━━━━━━━━━━━━\n' +
    '🎯 <b>REWARD PROGRESS</b>\n' +
    bar + ' <b>' + percent + '%</b>\n' +
    '<i>Next milestone: ' + REWARD_TARGET.toLocaleString('en-US') + ' points</i>' +
    '</blockquote>\n' +
    '<b>WELCOME TO PIKO</b>\n' +
    '<i>AI chat • Anonymous space • Contests • Rewards</i>\n' +
    'Choose a section below to continue.'
  );
}

const back = () => ({
  inline_keyboard: [[{ text: '🔙 BACK TO MENU', callback_data: 'dash_home', style: 'primary' }]]
});

function page(title, description, details = '') {
  return '✦ <b>' + title + '</b>\n' +
    '<blockquote>' + description + (details ? '\n\n' + details : '') + '</blockquote>';
}

export async function handleDashboardCallback(env, cq, action) {
  const user = cq.from || {};
  if (!cq.message?.chat?.id) return false;

  let text = '';
  let markup = back();

  if (action === 'dash_home') {
    text = await dashboardCaption(env, user);
    markup = await dashboardMarkup(env, user);
  } else if (action === 'dash_claim') {
    text = page('CREATE / CLAIM', 'Your Piko rewards are managed through the existing wallet and daily-claim system.', '🎁 <code>/claim</code> — claim your daily coins\n👛 <code>/wallet</code> — view your wallet\n🎨 <code>/img prompt</code> — create an AI image');
  } else if (action === 'dash_wallet') {
    const { coins } = await getDashboardData(env, user);
    text = page('MY ITEMS & WALLET', 'Your current Piko balance and creative tools.', '🪙 <b>COINS:</b> <code>' + coins.toLocaleString('en-US') + '</code>\n🎨 <b>IMAGE CREDITS:</b> use <code>/credits</code> to view your available credits.\n\n🎁 <code>/daily</code> — daily reward');
  } else if (action === 'dash_profile') {
    const { coins } = await getDashboardData(env, user);
    text = page('MY PROFILE', 'Your Telegram account details.', '👤 <b>NAME:</b> ' + esc(user.first_name || 'Friend') + '\n🆔 <b>USER ID:</b> <code>' + Number(user.id) + '</code>\n⭐ <b>POINTS:</b> <code>' + coins.toLocaleString('en-US') + '</code>');
  } else if (action === 'dash_leaderboard') {
    const { topUsers } = await getDashboardData(env, user);
    const lines = topUsers.length
      ? topUsers.map((row, index) => (index + 1) + '. ' + esc(row.first_name || 'Member') + ' — <code>' + Number(row.coins || 0).toLocaleString('en-US') + '</code> ⭐').join('\n')
      : 'No leaderboard entries are available yet.';
    text = page('LEADERBOARD', 'Top Piko members by coin balance.', lines);
  } else if (action === 'dash_plans') {
    text = page('PLANS / UPGRADE', 'Piko plan information will be shown here when subscription plans are configured.', 'No subscription or payment is processed from this page yet. Use <code>/credits</code> to check current credits.');
  } else if (action === 'dash_buy') {
    text = page('BUY POINTS', 'Coin purchases are not enabled in this bot yet.', 'This page is informational only. No payment is collected and no points are deducted. Check <code>/wallet</code> for your current balance.');
  } else {
    return false;
  }

  await tg(env, 'answerCallbackQuery', {
    callback_query_id: cq.id,
    text: action === 'dash_home' ? 'Dashboard refreshed.' : 'Opened ' + action.replace('dash_', '') + '.',
    show_alert: false
  });

  const result = await editCq(env, cq, text, markup);
  if (!result?.ok && result?.description && !/message is not modified/i.test(result.description)) {
    console.error('Piko dashboard edit failed:', result.description);
  }
  return true;
}
