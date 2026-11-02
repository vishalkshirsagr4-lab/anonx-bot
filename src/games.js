// src/games.js
// Lightweight group games. Sessions live in the existing expiring kv_store.
import { q, kvGet, kvPut, kvDel, addCoins } from './db.js';
import { send, editCq } from './cards.js';
import { tg } from './telegram.js';
import { esc } from './helpers.js';

const BANK = {
  quiz: [
    { q: 'Which planet is known as the Red Planet?', a: ['Venus','Mars','Jupiter','Mercury'], c: 1 },
    { q: 'How many sides does a hexagon have?', a: ['5','6','7','8'], c: 1 },
    { q: 'Which language runs natively in web browsers?', a: ['Python','Java','JavaScript','C'], c: 2 },
    { q: 'What is the largest ocean on Earth?', a: ['Atlantic','Indian','Arctic','Pacific'], c: 3 },
    { q: 'What does CPU stand for?', a: ['Central Processing Unit','Computer Power Utility','Core Program Unit','Central Print Unit'], c: 0 }
  ],
  riddle: [
    { q: 'I have keys but no locks, and space but no room. What am I?', a: ['A map','A keyboard','A house','A clock'], c: 1 },
    { q: 'What gets wetter as it dries?', a: ['A towel','The sun','A sponge','A cloud'], c: 0 },
    { q: 'What has a face and two hands but no arms or legs?', a: ['A robot','A clock','A doll','A statue'], c: 1 },
    { q: 'What has one eye but cannot see?', a: ['A needle','A storm','A potato','A camera'], c: 0 }
  ],
  emoji: [
    { q: 'Guess the phrase: 🐝 + 🍃', a: ['Believe','Bee leaf','Be happy','Blue leaf'], c: 0 },
    { q: 'Guess the movie type: 🦁👑', a: ['Space adventure','The Lion King','Ocean story','Car racing'], c: 1 },
    { q: 'Guess the food: 🍎🥧', a: ['Apple pie','Fruit salad','Apple juice','Bread'], c: 0 },
    { q: 'Guess the phrase: 🌧️🐱🐶', a: ['Heavy rain','Raining cats and dogs','Pet shop','Storm warning'], c: 1 }
  ]
};

const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const key = (chatId) => 'game:active:' + chatId;

// Compare-and-set prevents two rapid button taps from paying twice.
async function claimSession(env, storageKey, session, updated) {
  const result = await q(env,
    `UPDATE kv_store SET value = ? WHERE key = ? AND value = ? AND expires_at > ?`,
    [JSON.stringify(updated), storageKey, JSON.stringify(session), Date.now()]
  );
  return result.rowsAffected === 1;
}
const buttons = (gameId, items, prefix) => ({
  inline_keyboard: items.map((label, i) => [{
    text: label,
    callback_data: prefix + gameId + '_' + i
  }])
});

async function startChoiceGame(env, chatId, from, type) {
  const old = await kvGet(env, key(chatId), true);
  if (old && old.expires > Date.now()) {
    return send(env, chatId, '🎮 A game is already running here. Finish it first or wait for it to expire.');
  }
  const item = pick(BANK[type]);
  const id = Date.now().toString(36);
  const session = { id, type, answer: item.c, question: item.q, choices: item.a, expires: Date.now() + 120000, winner: false };
  await kvPut(env, key(chatId), session, 120);
  const title = type === 'quiz' ? '🧠 Quick Quiz' : type === 'riddle' ? '🧩 Riddle Time' : '🎭 Emoji Guess';
  const prefix = type === 'quiz' ? 'gq_' : type === 'riddle' ? 'gr_' : 'ge_';
  return send(env, chatId, '<b>' + title + '</b>\n\n' + esc(item.q) + '\n\nFirst correct answer wins 15 🪙!', {
    reply_markup: buttons(id, item.a, prefix)
  });
}

export async function handleGameCommand(env, msg, cmd) {
  const chatId = String(msg.chat.id);
  const from = msg.from;
  const name = cmd.name;
  if (name === 'game') {
    return send(env, chatId,
      '🎮 <b>AnonX Game Center</b>\n\n' +
      '/quiz — Quick knowledge quiz\n/rps — Rock, paper, scissors\n/word — Guess the hidden word\n' +
      '/riddle — Solve a riddle\n/dice — Roll the dice\n/emoji — Guess the emoji phrase\n/hunt — Find hidden coins\n\n' +
      'Win games to earn coins. One active group game at a time.');
  }
  if (name === 'quiz' || name === 'riddle' || name === 'emoji') return startChoiceGame(env, chatId, from, name);
  if (name === 'rps') {
    const id = Date.now().toString(36);
    const session = { id, type: 'rps', userId: from.id, name: from.first_name || 'Player', expires: Date.now() + 60000 };
    await kvPut(env, 'game:rps:' + chatId + ':' + id, session, 60);
    return send(env, chatId, '✊ <b>Rock, Paper, Scissors</b>\nChoose your move:', {
      reply_markup: { inline_keyboard: [[
        { text: '✊ Rock', callback_data: 'grps_' + id + '_0' },
        { text: '✋ Paper', callback_data: 'grps_' + id + '_1' },
        { text: '✌️ Scissors', callback_data: 'grps_' + id + '_2' }
      ]] }
    });
  }
  if (name === 'word') {
    const words = ['planet','garden','puzzle','silver','window','rocket','orange','castle'];
    const word = pick(words);
    const id = Date.now().toString(36);
    const session = { id, type: 'word', word, attempts: 5, expires: Date.now() + 180000 };
    await kvPut(env, key(chatId), session, 180);
    return send(env, chatId, '🔤 <b>Word Guess</b>\n\nGuess the 6-letter hidden word. You have 5 tries.\nSend your guess as a normal message in this group.');
  }
  if (name === 'dice') {
    const result = await tg(env, 'sendDice', { chat_id: chatId, emoji: '🎲', reply_to_message_id: msg.message_id });
    const value = result?.result?.dice?.value;
    if (value === 6) {
      await addCoins(env, from.id, 10);
      return send(env, chatId, '🎉 ' + esc(from.first_name || 'Player') + ' rolled a 6 and earned 10 🪙!');
    }
    return send(env, chatId, '🎲 ' + esc(from.first_name || 'Player') + ' rolled ' + (value || '?') + '. Roll a 6 to win 10 🪙!');
  }
  if (name === 'hunt') {
    const old = await kvGet(env, key(chatId), true);
    if (old && old.expires > Date.now()) return send(env, chatId, '🕵️ A group game is already active. Finish it before starting a hunt.');
    const id = Date.now().toString(36);
    await kvPut(env, key(chatId), { id, type: 'hunt', expires: Date.now() + 60000, found: false }, 60);
    const cells = ['🌳','🪨','📦','🌲','🏕️','🧰','🪵','🌿','🗺️'];
    const hidden = Math.floor(Math.random() * cells.length);
    await kvPut(env, 'game:hunt:' + chatId + ':' + id, { hidden, found: false }, 60);
    return send(env, chatId, '🗺️ <b>Treasure Hunt!</b>\n\nOne of these places hides 20 coins. Tap one to search!', {
      reply_markup: { inline_keyboard: [0,1,2].map(row => cells.slice(row*3,row*3+3).map((cell,col) => ({
        text: cell, callback_data: 'gh_' + id + '_' + (row*3+col)
      }))) }
    });
  }
  return send(env, chatId, 'Unknown game. Use /game.');
}

export async function handleGameMessage(env, msg) {
  if (!msg.text || msg.text.startsWith('/')) return false;
  const chatId = String(msg.chat.id);
  const session = await kvGet(env, key(chatId), true);
  if (!session || session.type !== 'word') return false;
  if (session.expires <= Date.now()) { await kvDel(env, key(chatId)); return false; }
  const guess = msg.text.trim().toLowerCase();
  if (!/^[a-z]{6}$/.test(guess)) return true;
  if (guess === session.word) {
    await kvDel(env, key(chatId));
    await addCoins(env, msg.from.id, 20);
    await send(env, chatId, '🎉 ' + esc(msg.from.first_name || 'Player') + ' guessed the word and won 20 🪙!');
    return true;
  }
  session.attempts -= 1;
  if (session.attempts <= 0) {
    await kvDel(env, key(chatId));
    await send(env, chatId, '⌛ Game over! The word was <b>' + session.word + '</b>.');
  } else {
    await kvPut(env, key(chatId), session, Math.max(1, Math.ceil((session.expires-Date.now())/1000)));
    await send(env, chatId, '❌ Not that word. ' + session.attempts + ' tries left.');
  }
  return true;
}

export async function handleGameCallback(env, cq, data) {
  const chatId = String(cq.message?.chat?.id || '');
  const userId = cq.from.id;
  let match;
  if ((match = data.match(/^g([qre])_([a-z0-9]+)_([0-3])$/))) {
    const session = await kvGet(env, key(chatId), true);
    if (!session || session.id !== match[2] || session.expires <= Date.now() || session.winner) {
      return { toast: 'This game has ended.', alert: true };
    }
    const choice = Number(match[3]);
    if (choice !== session.answer) return { toast: 'Not quite. Try another option!', alert: false };
    const claimed = await claimSession(env, key(chatId), session, { ...session, winner: userId });
    if (!claimed) return { toast: 'Someone already answered!', alert: false };
    await addCoins(env, userId, 15);
    await editCq(env, cq, '🏆 <b>' + esc(cq.from.first_name || 'Player') + '</b> got it right! +15 🪙\n\n' + esc(session.question));
    return { toast: 'Correct! +15 coins' };
  }
  if ((match = data.match(/^grps_([a-z0-9]+)_([0-2])$/))) {
    const session = await kvGet(env, 'game:rps:' + chatId + ':' + match[1], true);
    if (!session || session.expires <= Date.now()) return { toast: 'This round expired.', alert: true };
    if (session.userId !== userId) return { toast: 'This is ' + session.name + "'s round.", alert: true };
    const rpsKey = 'game:rps:' + chatId + ':' + match[1];
    if (!(await claimSession(env, rpsKey, session, { ...session, done: true }))) return { toast: 'This round was already played.', alert: true };
    await kvDel(env, rpsKey);
    const choices = ['Rock','Paper','Scissors'];
    const player = Number(match[2]), bot = Math.floor(Math.random()*3);
    const win = (player - bot + 3) % 3 === 1;
    if (win) await addCoins(env, userId, 10);
    const result = player === bot ? 'It is a draw.' : win ? 'You win! +10 🪙' : 'AnonX wins this round.';
    await editCq(env, cq, '✊ <b>Rock, Paper, Scissors</b>\nYou: ' + choices[player] + '\nAnonX: ' + choices[bot] + '\n\n' + result);
    return { toast: result };
  }
  if ((match = data.match(/^gh_([a-z0-9]+)_([0-8])$/))) {
    const session = await kvGet(env, 'game:hunt:' + chatId + ':' + match[1], true);
    if (!session || session.found) return { toast: 'The hunt has ended.', alert: true };
    const spot = Number(match[2]);
    if (spot !== session.hidden) return { toast: 'Nothing here. Try another spot!', alert: false };
    const huntKey = 'game:hunt:' + chatId + ':' + match[1];
    if (!(await claimSession(env, huntKey, session, { ...session, found: true }))) return { toast: 'Someone found it first!', alert: false };
    await kvDel(env, key(chatId));
    await addCoins(env, userId, 20);
    await editCq(env, cq, '💎 <b>Treasure found!</b>\n' + esc(cq.from.first_name || 'Player') + ' found the hidden coins and earned 20 🪙!');
    return { toast: 'Treasure found! +20 coins' };
  }
  return null;
}
