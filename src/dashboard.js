// src/dashboard.js
// Dashboard buttons expose only features already implemented in Piko.
import { state } from './config.js';
import { q } from './db.js';
import { tg } from './telegram.js';
import { editCq } from './cards.js';
import { esc } from './helpers.js';

async function getCoins(env, userId) {
  try {
    const result = await q(env, 'SELECT coins FROM users WHERE user_id=? LIMIT 1', [Number(userId)]);
    return Math.max(0, Number(result.rows[0]?.coins || 0));
  } catch (error) {
    console.error('Piko dashboard wallet lookup failed:', error?.message || String(error));
    return null;
  }
}

export async function dashboardMarkup() {
  return {
    inline_keyboard: [
      [
        { text: '🤖 AI CHAT', callback_data: 'dash_ai', style: 'primary' },
        { text: '🎨 AI IMAGE', callback_data: 'dash_image', style: 'success' }
      ],
      [
        { text: '🕵️ ANONYMOUS', callback_data: 'dash_anon', style: 'primary' },
        { text: '🏆 CONTESTS', callback_data: 'dash_contests', style: 'success' }
      ],
      [
        { text: '🪙 WALLET & REWARDS', callback_data: 'dash_wallet', style: 'primary' },
        { text: '🎮 GAMES & FUN', callback_data: 'dash_fun', style: 'success' }
      ],
      [{ text: '📚 HELP & COMMANDS', callback_data: 'dash_help' }],
      [
        { text: '💬 SUPPORT', url: state.SUPPORT_GROUP },
        { text: '👨‍💻 DEVELOPER', url: 'tg://user?id=' + Number(state.OWNER_ID) }
      ]
    ]
  };
}

export async function dashboardCaption(env, user) {
  const coins = await getCoins(env, user.id);
  const balance = coins === null ? 'Unavailable' : coins.toLocaleString('en-US');
  return (
    '✦ <b>ＰＩＫＯ • MAIN MENU</b> ✨\n' +
    '<blockquote>' +
    '👤 <b>NAME:</b> ' + esc(user.first_name || 'Friend') + '\n' +
    '🆔 <b>USER ID:</b> <code>' + Number(user.id) + '</code>\n' +
    '🪙 <b>WALLET:</b> <code>' + balance + '</code>' +
    '</blockquote>\n' +
    '<b>WELCOME TO PIKO</b>\n' +
    '<i>AI assistant • Anonymous posts • Contests • Rewards • Fun</i>\n' +
    'Choose a feature below.'
  );
}

const back = () => ({
  inline_keyboard: [[{ text: '🔙 BACK TO MENU', callback_data: 'dash_home', style: 'primary' }]]
});

function page(title, intro, commands) {
  return (
    '✦ <b>' + title + '</b>\n' +
    '<blockquote>' + intro + '\n\n' + commands + '</blockquote>' +
    '\nUse the commands below in this chat.'
  );
}

export async function handleDashboardCallback(env, cq, action) {
  const user = cq.from || {};
  if (!cq.message?.chat?.id) return false;

  let text;
  let markup = back();

  if (action === 'dash_home') {
    text = await dashboardCaption(env, user);
    markup = await dashboardMarkup();
  } else if (action === 'dash_ai') {
    text = page('AI CHAT', 'Chat with Piko directly in this private chat. Send a normal text message or a voice message.', '💬 Send any message to start AI chat.\n🎙️ Send a voice message for voice transcription and AI response.');
  } else if (action === 'dash_image') {
    text = page('AI IMAGE GENERATOR', 'Generate an image from a text prompt using Piko image generation.', '🎨 <code>/img your image prompt</code>\n🪙 <code>/credits</code> — check image credits and coins\n🔄 <code>/convert 100</code> — convert coins into image credits');
  } else if (action === 'dash_anon') {
    text = page('ANONYMOUS SPACE', 'Post anonymous questions and replies using the existing anonymous message tools.', '❔ <code>/ask your question</code>\n↩️ <code>/reply message_link your text</code>\n🔎 <code>/reveal</code> — reveal options for an active anonymous post\n💰 <code>/wallet</code> — check your coin balance');
  } else if (action === 'dash_contests') {
    text = page('CONTEST CENTER', 'Check active contests, submit entries and view rankings.', '🏆 <code>/contest</code> — current contest status\n📤 <code>/submit</code> — submit your entry\n🥇 <code>/leaderboard</code> — top rankings\n📚 <code>/help</code> — contest rules and voting details');
  } else if (action === 'dash_wallet') {
    const coins = await getCoins(env, user.id);
    const balance = coins === null ? 'Temporarily unavailable' : '<code>' + coins.toLocaleString('en-US') + '</code> coins';
    text = page('WALLET & REWARDS', 'Your current wallet balance: ' + balance + '.', '👛 <code>/wallet</code> — wallet balance\n💳 <code>/credits</code> — credits and coins\n🎁 <code>/daily</code> or <code>/claim</code> — daily reward\n💼 <code>/work</code> — earn coins\n🎲 <code>/crime</code> and <code>/rob</code> — coin challenges\n🔁 <code>/convert amount</code> — convert coins to image credits\n💸 <code>/pay</code> — send coins by replying to a user');
  } else if (action === 'dash_fun') {
    text = page('GAMES & FUN', 'Use the existing dice, friendship and sticker/GIF commands. Sticker packs depend on media configured by the bot owner.', '🎲 <code>/roll</code> — roll a dice\n💞 <code>/ship @username</code> — friendship match\n👋 <code>/wave</code> • <code>/highfive</code> • <code>/cheer</code>\n🤗 <code>/hug</code> • <code>/kiss</code>\n🎭 <code>/slap</code> • <code>/punch</code> • <code>/kick</code> (reply to a member)');
  } else if (action === 'dash_help') {
    text = page('HELP & COMMANDS', 'Open the bot help center for detailed command instructions and rules.', '📚 <code>/help</code> — open the full help menu\n🆔 <code>/myid</code> — show your Telegram user ID\n❌ <code>/cancel</code> — cancel a pending action');
  } else {
    return false;
  }

  const result = await editCq(env, cq, text, markup);
  await tg(env, 'answerCallbackQuery', {
    callback_query_id: cq.id,
    text: action === 'dash_home' ? 'Main menu refreshed.' : 'Opened ' + action.replace('dash_', '') + '.',
    show_alert: false
  });
  if (!result?.ok && result?.description && !/message is not modified/i.test(result.description)) {
    console.error('Piko dashboard edit failed:', result.description);
  }
  return true;
}
