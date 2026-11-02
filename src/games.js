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
    const target = msg.reply_to_message?.from;
    if (!target || target.is_bot || target.id === from.id) {
      return send(env, chatId,
        '✊ <b>Member vs Member RPS</b>\n\nReply to another member’s message with /rps to challenge them. Both players must choose a hand.');
    }
    const id = Date.now().toString(36);
    const session = {
      id, type: 'rps', status: 'pending',
      p1: from.id, p1Name: from.first_name || 'Player',
      p2: target.id, p2Name: target.first_name || 'Player',
      choices: {}, expires: Date.now() + 120000
    };
    const rpsKey = 'game:rps:' + chatId + ':' + id;
    await kvPut(env, rpsKey, session, 120);
    return send(env, chatId,
      '✊ <b>Rock, Paper, Scissors — Player Challenge</b>\n\n' +
      '<b>' + esc(session.p1Name) + '</b> challenged <b>' + esc(session.p2Name) + '</b>.\n' +
      'Only the challenged member can accept.',
      { reply_markup: { inline_keyboard: [[
        { text: '⚔️ Accept challenge', callback_data: 'grps_join_' + id }
      ]] } }
    );
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
  if (data.startsWith('grps_join_')) {
    const id = data.slice('grps_join_'.length);
    const rpsKey = 'game:rps:' + chatId + ':' + id;
    const session = await kvGet(env, rpsKey, true);
    if (!session || session.expires <= Date.now() || session.status !== 'pending') {
      return { toast: 'This challenge expired.', alert: true };
    }
    if (userId !== session.p2) return { toast: 'Only the challenged member can accept.', alert: true };
    const updated = { ...session, status: 'playing' };
    if (!(await claimSession(env, rpsKey, session, updated))) {
      return { toast: 'Please tap Accept again.', alert: false };
    }
    await editCq(env, cq,
      '✊ <b>Rock, Paper, Scissors</b>\n\n' +
      '<b>' + esc(session.p1Name) + '</b> vs <b>' + esc(session.p2Name) + '</b>\n' +
      'Both players: choose your hand. Your choice stays hidden until both have picked.',
      { inline_keyboard: [[
        { text: '✊ Rock', callback_data: 'grps_' + id + '_0' },
        { text: '✋ Paper', callback_data: 'grps_' + id + '_1' },
        { text: '✌️ Scissors', callback_data: 'grps_' + id + '_2' }
      ]] }
    );
    return { toast: 'Challenge accepted! Choose your hand.' };
  }
  if ((match = data.match(/^grps_([a-z0-9]+)_([0-2])$/))) {
    const rpsKey = 'game:rps:' + chatId + ':' + match[1];
    const session = await kvGet(env, rpsKey, true);
    if (!session || session.expires <= Date.now() || session.status !== 'playing') {
      return { toast: 'This round is not active.', alert: true };
    }
    if (userId !== session.p1 && userId !== session.p2) {
      return { toast: 'You are not one of the two players.', alert: true };
    }
    if (session.choices?.[String(userId)] !== undefined) {
      return { toast: 'You have already chosen your hand.', alert: true };
    }
    const choice = Number(match[2]);
    const updated = {
      ...session,
      choices: { ...(session.choices || {}), [String(userId)]: choice }
    };
    const bothChosen = updated.choices[String(session.p1)] !== undefined &&
      updated.choices[String(session.p2)] !== undefined;
    if (bothChosen) updated.status = 'done';
    if (!(await claimSession(env, rpsKey, session, updated))) {
      return { toast: 'Choice not saved. Please tap once more.', alert: false };
    }
    if (!bothChosen) {
      return { toast: 'Your hand is locked in. Waiting for the other player.' };
    }
    const p1 = updated.choices[String(session.p1)];
    const p2 = updated.choices[String(session.p2)];
    const labels = ['Rock', 'Paper', 'Scissors'];
    const winner = p1 === p2 ? 0 : ((p1 - p2 + 3) % 3 === 1 ? session.p1 : session.p2);
    if (winner) await addCoins(env, winner, 10);
    const result = winner === 0
      ? '🤝 It is a draw! No coins awarded.'
      : '🏆 <b>' + esc(winner === session.p1 ? session.p1Name : session.p2Name) + '</b> wins and earns 10 🪙!';
    await editCq(env, cq,
      '✊ <b>Rock, Paper, Scissors — Result</b>\n\n' +
      '<b>' + esc(session.p1Name) + '</b>: ' + labels[p1] + '\n' +
      '<b>' + esc(session.p2Name) + '</b>: ' + labels[p2] + '\n\n' + result
    );
    await kvDel(env, rpsKey);
    return { toast: winner ? 'Round complete! Winner gets 10 coins.' : 'Round ended in a draw.' };
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
