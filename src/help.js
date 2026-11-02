// src/help.js
import { CFG, state, isOwner } from './config.js';

let HELP = null;

export function getHelp() {
  if (HELP) return HELP;
  HELP = {
    games: {
      title: '🎮 Game Center',
      cmds: `<b>🎮 Games</b>\n\n/game — Open Game Center\n/quiz — Quick quiz\n/rps — Rock, paper, scissors\n/word — Guess the hidden word\n/riddle — Solve a riddle\n/dice — Roll the dice\n/emoji — Guess the emoji phrase\n/hunt — Find hidden treasure`,
      rules: `<b>🏅 Rewards</b>\n\nWin games to earn coins. Send word guesses as normal group messages.`,
    },
    ask: {
      title: '❓ Ask & Reply',
      cmds: `<b>❓ Ask &amp; Reply</b>\n\n/ask <code>&lt;text&gt;</code> — Post an anonymous question\n/ask <code>-100…</code> <code>&lt;text&gt;</code> — Post to a specific group\nReply to media with /ask — Post anonymously\n/reveal — Reveal who is behind a post\n/wallet — Check your coin balance\n/cancel — Cancel any pending action`,
      rules: `<b>📜 Rules</b>\n\n1. Your identity stays hidden.\n2. Tap <b>💬 Reply</b> under a post and send in DM within 10 min.\n3. Topic closes after ${state.TOPIC_END_IDLE_MINUTES} min inactivity.\n4. <b>Secret Reveal</b>: ${CFG.REVEAL_COST_SECRET} 🪙.\n5. <b>Reveal</b>: ${CFG.REVEAL_COST_NORMAL} 🪙 (user warned).\n6. Be respectful.`,
    },
    contest: {
      title: '🏆 Contest',
      cmds: `<b>🏆 Contest</b>\n\n/contest — Current contest status\n/voting — Live voting status\n/voteresult — Current standings or final results\n/submit — Submit your entry in DM\n<b>🎯 Participate</b> — Join a contest\n/leaderboard — Top 10 rankings\n/wallet — Coin balance`,
      rules: `<b>📜 Rules & Modes</b>\n\n1. Submissions are 100% anonymous.\n2. Three Contest Modes:\n   • 🖼️ <b>Image</b>: Photos\n   • ✍️ <b>Text</b>: Written answers\n   • 🎬 <b>Media</b>: Photos, Stickers, Videos, GIFs, Voice, Audio, Docs & more!\n3. Vote before the deadline.\n4. You cannot vote for your own entry.\n5. Min ${CFG.MIN_JOIN_DEFAULT} participants required.`,
    },
    setting: {
      title: '⚙️ Settings',
      cmds: `<b>⚙️ Settings (admins)</b>\n\n/setting — Open panel\n\nChange: voting, announcement, submission times, min participants, reminder interval.`,
      rules: `<b>📜 Rules</b>\n\nOnly admins can change. Applies from next contest.`,
    },
    wallet: {
      title: '💰 Wallet & Claim',
      cmds: `<b>💰 Wallet</b>\n\n/claim — Daily ${CFG.CLAIM_COINS} 🪙\n/wallet — Balance\n/leaderboard — Top 10`,
      rules: `<b>📜 Rules</b>\n\n1. ${CFG.CLAIM_COINS} 🪙 daily.\n2. Resets 12:00 AM ${CFG.TZ_LABEL}.`,
    },
    owner: {
      title: '👑 Owner',
      cmds: `<b>👑 Owner</b>\n\n/addcontest — Add one\n/add — Reply to .txt to bulk-add\n/listcontest — List\n/delcontest — Delete\n/xcontest — Force-start\n/votestart — Start voting early (group)\n/voteend — End voting and publish results (group)\n/deldb — Wipe DB (password)`,
      rules: `<b>📜 Format</b>\n\n<code>image_url - Name - x, y, z, s</code>`,
    },
  };
  return HELP;
}

export function helpMainView(userId, origin = 'help') {
  
  const H = getHelp();
  const rows = [
    [{ text: H.games.title, callback_data: `help_games:${origin}` }],
    [{ text: H.ask.title, callback_data: `help_ask:${origin}` }],
    [{ text: H.contest.title, callback_data: `help_contest:${origin}` }],
    [{ text: H.wallet.title, callback_data: `help_wallet:${origin}` }],
    [{ text: H.setting.title, callback_data: `help_setting:${origin}` }],
  ];
  if (isOwner(userId)) rows.push([{ text: H.owner.title, callback_data: `help_owner:${origin}` }]);
  rows.push([
    { text: '👨‍💻 Developer', url: `tg://user?id=${state.OWNER_ID}` },
    { text: '🆘 Support', url: state.SUPPORT_GROUP }
  ]);
  rows.push([origin === 'start'
    ? { text: '🔙 Back', callback_data: 'back_start' }
    : { text: '✖️ Close', callback_data: 'help_close' }]);
  return {
    text: `📚 <b>Help Menu</b>\n\nChoose a section:`,
    markup: { inline_keyboard: rows }
  };
}