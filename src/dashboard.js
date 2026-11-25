// src/dashboard.js
// Piko's refreshed private-chat dashboard with Telegram-native rich formatting.
import { state } from './config.js';
import { q } from './db.js';
import { tg } from './telegram.js';
import { editCq } from './cards.js';
import { esc } from './helpers.js';

export function dashboardMarkup() {
  const rows = [
    [
      { text: '🤖  CHAT WITH PIKO', callback_data: 'dash_ai', style: 'success' },
      { text: '🎨  AI STUDIO', callback_data: 'dash_image', style: 'primary' }
    ],
    [
      { text: '🕵️  ANONYMOUS', callback_data: 'dash_anon', style: 'primary' },
      { text: '🏆  CONTESTS', callback_data: 'dash_contests', style: 'success' }
    ],
    [
      { text: '👛  MY WALLET', callback_data: 'dash_wallet', style: 'primary' },
      { text: '🎭  FUN & STICKERS', callback_data: 'dash_fun', style: 'danger' }
    ],
    [
      { text: '📚  HELP CENTER', callback_data: 'dash_help', style: 'primary' },
      { text: '🔄  REFRESH', callback_data: 'dash_home', style: 'success' }
    ],
    [
      { text: '🆘  SUPPORT', url: state.SUPPORT_GROUP, style: 'primary' },
      ...(Number(state.OWNER_ID) > 0
        ? [{ text: '👨‍💻  DEVELOPER', url: 'tg://user?id=' + Number(state.OWNER_ID), style: 'primary' }]
        : [])
    ]
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

  const firstName = esc(user.first_name || 'Friend');
  const coinText = coins.toLocaleString('en-US');
  return (
    '✦ <b>Ｐ Ｉ Ｋ Ｏ</b>  <tg-emoji emoji-id="5368324170671202286">✨</tg-emoji>\n' +
    '<b>YOUR PERSONAL COMMUNITY HUB</b>\n' +
    '━━━━━━━━━━━━━━━━━━━━\n\n' +
    '╭─ <b>YOUR PROFILE</b> ─────────╮\n' +
    '│  👤 <b>' + firstName + '</b>\n' +
    '│  🆔 <code>' + Number(user.id) + '</code>\n' +
    '│  🪙 <b>' + coinText + '</b> coins\n' +
    '╰──────────────────────╯\n\n' +
    '<blockquote>Welcome to Piko — your space for AI conversations, anonymous messages, community contests and creative fun.\n\nChoose a section below and let’s get started. ✨</blockquote>' +
    '\n<b>⚡ QUICK ACCESS</b>  <i>Tap any button</i>'
  );
}

const back = () => ({
  inline_keyboard: [[{ text: '↩️  BACK TO PIKO HOME', callback_data: 'dash_home', style: 'primary' }]]
});

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
    text = '🤖 <b>PIKO AI CHAT</b>\n━━━━━━━━━━━━━━━━━━━━\n\n<blockquote>Talk naturally with Piko. Ask questions, explore ideas or just have a friendly conversation.</blockquote>\n\n💬 <b>HOW TO START</b>\nSend any message in this private chat.\n\n🎙️ <i>Voice messages are supported when enabled.</i>';
  } else if (action === 'dash_anon') {
    text = '🕵️ <b>ANONYMOUS SPACE</b>\n━━━━━━━━━━━━━━━━━━━━\n\n<blockquote>Share thoughts and questions with your community while keeping your identity off the public post.</blockquote>\n\n📨 <code>/ask your message</code> — create a post\n💬 <code>/reply</code> — reply to an anonymous post\n🔐 <code>/reveal</code> — view reveal options';
  } else if (action === 'dash_contests') {
    text = '🏆 <b>CONTEST ARENA</b>\n━━━━━━━━━━━━━━━━━━━━\n\n<blockquote>Take part, share your creativity and see how the community votes.</blockquote>\n\n🎯 <code>/contest</code> — current contest\n📤 <code>/submit</code> — submit an entry\n🗳️ <code>/voting</code> — voting status\n🏅 <code>/voteresult</code> — results';
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
    text = '👛 <b>YOUR PIKO WALLET</b>\n━━━━━━━━━━━━━━━━━━━━\n\n<blockquote>Your rewards and creative credits, together in one place.</blockquote>\n\n🪙 <b>Coins:</b> ' + coins.toLocaleString('en-US') + '\n🎨 <b>Image credits:</b> ' + (credits === null ? 'Use /credits to initialize' : credits) + '\n\n🎁 <code>/daily</code> — daily reward\n💱 <code>/convert 100</code> — exchange coins\n📊 <code>/credits</code> — full wallet details';
  } else if (action === 'dash_image') {
    text = '🎨 <b>PIKO AI STUDIO</b>\n━━━━━━━━━━━━━━━━━━━━\n\n<blockquote>Turn your original ideas into images with AI.</blockquote>\n\n✍️ Send a prompt like:\n<code>/img a glowing city in a futuristic world</code>\n\n✨ <i>Image generation costs 5 credits per image. Check /credits before creating.</i>';
  } else if (action === 'dash_fun') {
    text = '🎭 <b>FUN & STICKER CORNER</b>\n━━━━━━━━━━━━━━━━━━━━\n\n<blockquote>Light-hearted reactions and playful commands for your chats.</blockquote>\n\n🎲 <code>/roll</code> — roll a dice\n🤝 <code>/hug</code> — send a friendly hug (reply to a member)\n👋 <code>/wave</code> — wave to someone\n🙌 <code>/highfive</code> — high-five a member\n🌟 <code>/cheer</code> — send encouragement\n\n<i>Sticker packs depend on the bot's configured Telegram media.</i>';
  } else if (action === 'dash_help') {
    text = '📚 <b>PIKO HELP CENTER</b>\n━━━━━━━━━━━━━━━━━━━━\n\n<blockquote>Everything you need to get started with Piko.</blockquote>\n\n🤖 AI chat — send a message\n🎨 AI images — <code>/img prompt</code>\n🕵️ Anonymous posts — <code>/ask text</code>\n🏆 Contests — <code>/contest</code>\n👛 Wallet — <code>/credits</code>\n\nUse <code>/help</code> for the complete command guide.';
  } else {
    return false;
  }

  await tg(env, 'answerCallbackQuery', { callback_query_id: cq.id });
  await editCq(env, cq, text, markup);
  return true;
}
