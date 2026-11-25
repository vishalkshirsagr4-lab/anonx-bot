// src/dashboard.js
// Piko's private-chat dashboard and compact feature navigation.
import { state } from './config.js';
import { q } from './db.js';
import { tg } from './telegram.js';
import { editCq } from './cards.js';
import { esc } from './helpers.js';

export function dashboardMarkup() {
  const rows = [
    [{ text: '🤖 CHAT WITH PIKO', callback_data: 'dash_ai', style: 'success' }],
    [
      { text: '🕵️ ANONYMOUS', callback_data: 'dash_anon', style: 'primary' },
      { text: '🏆 CONTESTS', callback_data: 'dash_contests', style: 'success' }
    ],
    [
      { text: '👛 MY WALLET', callback_data: 'dash_wallet', style: 'primary' },
      { text: '🎨 AI IMAGE', callback_data: 'dash_image', style: 'success' }
    ],
    [
      { text: '🎭 FUN & STICKERS', callback_data: 'dash_fun', style: 'danger' },
      { text: '📚 HELP', callback_data: 'dash_help', style: 'primary' }
    ],
    [
      { text: '🆘 SUPPORT', url: state.SUPPORT_GROUP, style: 'primary' },
      ...(Number(state.OWNER_ID) > 0
        ? [{ text: '👨‍💻 DEVELOPER', url: 'tg://user?id=' + Number(state.OWNER_ID), style: 'primary' }]
        : [])
    ],
    [{ text: '🔄 REFRESH DASHBOARD', callback_data: 'dash_home', style: 'success' }]
  ];
  return { inline_keyboard: rows };
}

export async function dashboardCaption(env, user) {
  let coins = 0;
  try {
    const result = await q(env, 'SELECT coins FROM users WHERE user_id=? LIMIT 1', [Number(user.id)]);
    coins = Number(result.rows[0]?.coins || 0);
  } catch (error) {
    console.error('Piko dashboard wallet lookup failed:', error?.message || String(error));
  }

  return '✨ <b>PIKO CONTROL CENTER</b> ✨\n' +
    '━━━━━━━━━━━━━━━━━━━━\n' +
    '👤 <b>' + esc(user.first_name || 'Friend') + '</b>\n' +
    '🆔 <code>' + Number(user.id) + '</code>\n' +
    '🪙 <b>' + coins.toLocaleString('en-US') + '</b> coins\n' +
    '━━━━━━━━━━━━━━━━━━━━\n' +
    '🤖 Your AI companion & community hub\n\n' +
    'Choose a colourful menu button to get started! 🌟';
}

const back = () => ({ inline_keyboard: [[{ text: '🏠 MAIN DASHBOARD', callback_data: 'dash_home', style: 'primary' }]] });

export async function handleDashboardCallback(env, cq, action) {
  const user = cq.from || {};
  const chatId = cq.message?.chat?.id;
  if (!chatId) return false;

  let text = '';
  let markup = back();

  if (action === 'dash_home') {
    text = await dashboardCaption(env, user);
    markup = dashboardMarkup();
  } else if (action === 'dash_ai') {
    text = '🤖 <b>CHAT WITH PIKO</b>\n\nSend me any question or message in this private chat. I will reply naturally and keep a short conversation context.\n\n💡 Tip: You can also send a voice message for transcription.';
  } else if (action === 'dash_anon') {
    text = '🕵️ <b>ANONYMOUS MESSAGES</b>\n\n• <code>/ask your question</code> — post anonymously\n• Reply to a post with <code>/reply</code> — send an anonymous reply\n• <code>/reveal</code> — view the available reveal options\n\n🔐 Your identity is not shown on the anonymous post.';
  } else if (action === 'dash_contests') {
    text = '🏆 <b>CONTEST CENTER</b>\n\n• <code>/contest</code> — current contest\n• <code>/submit</code> — submit your entry\n• <code>/voting</code> — live voting status\n• <code>/voteresult</code> — results\n\n✨ Join in and show your creativity!';
  } else if (action === 'dash_wallet') {
    let coins = 0;
    let credits = null;
    try {
      const result = await q(env, 'SELECT coins FROM users WHERE user_id=? LIMIT 1', [Number(user.id)]);
      coins = Number(result.rows[0]?.coins || 0);
    } catch (error) {
      console.error('Piko dashboard coin lookup failed:', error?.message || String(error));
    }
    try {
      const result = await q(env, 'SELECT credits FROM piko_profiles WHERE user_id=? LIMIT 1', [Number(user.id)]);
      if (result.rows.length) credits = Number(result.rows[0].credits);
    } catch {}
    text = '👛 <b>MY WALLET</b>\n\n🪙 Coins: <b>' + coins.toLocaleString('en-US') + '</b>\n' +
      '✨ Image credits: <b>' + (credits === null ? 'Use /credits to initialize' : credits) + '</b>\n\n' +
      'Use <code>/credits</code> for the full wallet, <code>/daily</code> for your daily reward, and <code>/convert 100</code> to exchange coins for image credits.';
  } else if (action === 'dash_image') {
    text = '🎨 <b>AI IMAGE STUDIO</b>\n\nSend:\n<code>/img describe your original image idea</code>\n\n✨ Image generation uses 5 credits per image. Check your balance with <code>/credits</code>.';
  } else if (action === 'dash_fun') {
    text = '🎭 <b>FUN & STICKERS</b>\n\nTry these friendly interactions:\n• <code>/roll</code> — roll a dice\n• <code>/ship @username</code> — fun compatibility score\n• <code>/hug</code> — send a hug (reply to a member)\n• <code>/wave</code> — wave to someone\n• <code>/highfive</code> — high-five a member\n• <code>/cheer</code> — send encouragement\n\nSticker reactions can be configured by the bot owner.';
  } else if (action === 'dash_help') {
    text = '📚 <b>PIKO HELP CENTER</b>\n\n🤖 AI chat — send a message\n🎙️ Voice — send a voice note\n🎨 Images — <code>/img prompt</code>\n🕵️ Anonymous — <code>/ask text</code>\n🏆 Contests — <code>/contest</code>\n👛 Wallet — <code>/credits</code>\n\nUse /help for the full command guide.';
  } else {
    return false;
  }

  await tg(env, 'answerCallbackQuery', { callback_query_id: cq.id });
  await editCq(env, cq, text, markup);
  return true;
}
