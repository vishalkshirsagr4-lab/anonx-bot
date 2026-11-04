// src/games.js
// Lightweight group games. Sessions live in the existing expiring kv_store.
import { q, kvGet, kvPut, kvDel, addCoins } from './db.js';
import { send, editCq } from './cards.js';
import { tg } from './telegram.js';
import { esc } from './helpers.js';
import { generateGameContent } from './piko.js';

// Groq is the primary generator. A small local emoji fallback keeps /emoji
// playable during provider outages or when the model returns invalid JSON.
const EMOJI_FALLBACK = [
  { q: 'Guess the movie: 🦁👑🌅', a: ['The Lion King','Madagascar','Finding Nemo','Kung Fu Panda'], c: 0 },
  { q: 'Guess the game: 🍄👨🏻‍🔧🏁', a: ['Sonic the Hedgehog','Minecraft','Super Mario','Among Us'], c: 2 },
  { q: 'Guess the anime: 🍥🦊🥷', a: ['One Piece','Naruto','Dragon Ball','Bleach'], c: 1 },
  { q: 'Guess the movie: 🚢🧊💔', a: ['Avatar','Titanic','Frozen','Jaws'], c: 1 },
  { q: 'Guess the game: ⛏️🧱💎', a: ['Roblox','Minecraft','Fortnite','Terraria'], c: 1 },
  { q: 'Guess the anime: 🏴‍☠️👒🍖', a: ['One Piece','Demon Slayer','Pokemon','Attack on Titan'], c: 0 },
  { q: 'Guess the movie: ❄️👸⛄', a: ['Moana','Frozen','Tangled','Shrek'], c: 1 },
  { q: 'Guess the game: 🚌🏝️🔫', a: ['Free Fire','Fortnite','PUBG Mobile','Clash Royale'], c: 1 },
  { q: 'Guess the anime: ⚡🐭🔴⚪', a: ['Digimon','Pokemon','Beyblade','Doraemon'], c: 1 },
  { q: 'Guess the movie: 🕷️🧑‍🦱🏙️', a: ['Batman','Spider-Man','Iron Man','Superman'], c: 1 },
  { q: 'Guess the game: 🧑‍🚀🔴🗳️', a: ['Among Us','Fall Guys','Stumble Guys','Brawl Stars'], c: 0 },
  { q: 'Guess the anime: 🗡️🌊🦋', a: ['Jujutsu Kaisen','Demon Slayer','Bleach','One Punch Man'], c: 1 }
];

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

async function startChoiceGame(env, chatId, from, type, topic = '') {
  // Starting a new choice game replaces any unfinished game in this chat.
  // Old inline buttons become invalid because their session ID no longer matches.
  const recentKey = 'game:recent:' + chatId + ':' + type;
  const recent = await kvGet(env, recentKey, true);
  const used = Array.isArray(recent) ? recent : [];
  let item = null;
  // Ask Groq again if it returns a recently-used question.
  for (let attempt = 0; attempt < 2 && !item; attempt++) {
    try {
      const fresh = await generateGameContent(env, type, attempt ? topic + ' (new variation ' + attempt + ')' : topic, used);
      if (!fresh || typeof fresh.q !== 'string' || !Array.isArray(fresh.a) || fresh.a.length !== 4 ||
          !Number.isInteger(fresh.c) || fresh.c < 0 || fresh.c > 3 ||
          fresh.a.some(x => typeof x !== 'string' || !x.trim())) continue;
      const normalized = fresh.q.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      const duplicate = used.some(q => String(q).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() === normalized);
      if (!duplicate) item = fresh;
    } catch (error) {
      console.error('Groq game generation failed:', error?.message || String(error));
      // Retry malformed or temporarily failed generations instead of ending the game immediately.
    }
  }
  if (!item && type === 'emoji') {
    const normalize = value => String(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    // Prefer never-used questions; when the small local bank is exhausted,
    // allow older questions again while avoiding the three most recent ones.
    let available = EMOJI_FALLBACK.filter(candidate =>
      !used.some(previous => normalize(previous) === normalize(candidate.q))
    );
    if (!available.length) {
      const recentFew = used.slice(-3).map(normalize);
      available = EMOJI_FALLBACK.filter(candidate => !recentFew.includes(normalize(candidate.q)));
    }
    // Last-resort guarantee: even if recent-history data is unusual, never block /emoji.\n    if (!available.length) available = EMOJI_FALLBACK;\n    item = available[Math.floor(Math.random() * available.length)];
  }
  if (!item) {
    console.error('Game question unavailable:', { type, topic, groqConfigured: !!env?.GROQ_API_KEY });
    return send(env, chatId, '⚠️ I could not create a fresh question right now. Please try again in a moment.');
  }
  const nextRecent = [...used, item.q].slice(-30);
  await kvPut(env, recentKey, nextRecent, 2592000);
  const id = Date.now().toString(36);
  const session = { id, type, topic: topic.slice(0,50), answer: item.c, question: item.q, choices: item.a, expires: Date.now() + 120000, winner: false };
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
      '/quiz [topic] or /trivia [topic] — Fresh AI quiz\n/rps — Rock, paper, scissors\n/word [topic] — Guess the hidden word\n' +
      '/riddle [topic] — Fresh AI riddle\n/dice — Roll the dice\n/emoji [topic] — AI emoji challenge\n/hunt — Find hidden coins\n\n' +
      'Try topics: anime, genz, trending, gaming, movies. Fresh questions are generated by Groq. Win games to earn coins.');
  }
  if (name === 'quiz' || name === 'trivia') return startChoiceGame(env, chatId, from, 'quiz', cmd.arg || 'mixed');
  if (name === 'riddle' || name === 'emoji') return startChoiceGame(env, chatId, from, name, cmd.arg || 'mixed');
  if (name === 'rps') {
    const id = Date.now().toString(36);
    const session = {
      id,
      type: 'rps',
      status: 'lobby',
      host: from.id,
      players: {
        [String(from.id)]: { id: from.id, name: from.first_name || 'Player' }
      },
      choices: {},
      expires: Date.now() + 180000
    };
    const rpsKey = 'game:rps:' + chatId + ':' + id;
    await kvPut(env, rpsKey, session, 180);
    return send(env, chatId,
      '✊ <b>Group Rock, Paper, Scissors</b>\n\n' +
      '<b>' + esc(session.players[String(from.id)].name) + '</b> opened a group round.\n' +
      'Members: tap Join, then the host starts the hand selection. Choices stay hidden until the round ends.\n\n' +
      'The winning hand earns 10 🪙 per winning player. If the round is tied, nobody earns coins.',
      { reply_markup: { inline_keyboard: [
        [{ text: '🙋 Join round', callback_data: 'grpm_join_' + id }],
        [{ text: '▶️ Start choosing (host)', callback_data: 'grpm_start_' + id }]
      ] } }
    );
  }
  if (name === 'word') {
    // A new word game replaces any unfinished game in this chat.
    const words = ['planet','garden','puzzle','silver','window','rocket','orange','castle','dragon','mystic','naruto','zenits'];
    let word = pick(words);
    let hint = 'A common six-letter English word.';
    try {
      const fresh = await generateGameContent(env, 'word', cmd.arg || 'mixed');
      if (typeof fresh?.word === 'string' && /^[a-z]{6}$/i.test(fresh.word)) {
        word = fresh.word.toLowerCase();
        hint = typeof fresh.hint === 'string' ? fresh.hint : hint;
      }
    } catch (error) { console.error('Groq word generation failed:', error?.message || String(error)); }
    const id = Date.now().toString(36);
    const session = { id, type: 'word', word, hint, topic: String(cmd.arg || 'mixed').slice(0, 50), attempts: 5, expires: Date.now() + 180000 };
    await kvPut(env, key(chatId), session, 180);
    return send(env, chatId, '🔤 <b>AI Word Guess</b> · ' + esc(cmd.arg || 'mixed') + '\n\n🧩 Hint: ' + esc(hint) + '\nGuess the 6-letter hidden word. You have 5 tries.\nSend your guess as a normal message in this group.');
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
    // A new treasure hunt replaces any unfinished game in this chat.
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
    await send(env, chatId, '⌛ Game over! The word was <b>' + esc(session.word) + '</b>.');
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
    const claimed = await claimSession(env, key(chatId), session, { ...session, winner: userId, status: 'done' });
    if (!claimed) return { toast: 'This question has already been answered.', alert: false };
    // One attempt per player/question: the first selected option ends the round.
    await kvDel(env, key(chatId));
    if (choice === session.answer) {
      await addCoins(env, userId, 15);
      await editCq(env, cq, '🏆 <b>' + esc(cq.from.first_name || 'Player') + '</b> got it right! +15 🪙\n\n' + esc(session.question));
      return { toast: 'Correct! +15 coins' };
    }
    const correct = session.choices?.[session.answer] || 'the correct option';
    await editCq(env, cq, '❌ <b>Game over!</b>\\n' + esc(cq.from.first_name || 'Player') + ' used their one attempt.\\n\\nCorrect answer: <b>' + esc(correct) + '</b>\\n\\n' + esc(session.question));
    return { toast: 'Wrong answer. Game over!', alert: true };
  }
  if (data.startsWith('grpm_join_')) {
    const id = data.slice('grpm_join_'.length);
    const rpsKey = 'game:rps:' + chatId + ':' + id;
    const session = await kvGet(env, rpsKey, true);
    if (!session || session.expires <= Date.now() || session.status !== 'lobby') {
      return { toast: 'The joining phase has ended.', alert: true };
    }
    if (session.players[String(userId)]) return { toast: 'You already joined this round.' };
    const playerName = cq.from.first_name || 'Player';
    const updated = {
      ...session,
      players: {
        ...session.players,
        [String(userId)]: { id: userId, name: playerName }
      }
    };
    if (!(await claimSession(env, rpsKey, session, updated))) {
      return { toast: 'Please tap Join again.', alert: false };
    }
    await send(env, chatId,
      '🙋 <b>' + esc(playerName) + '</b> joined the RPS round. ' +
      '<b>' + Object.keys(updated.players).length + ' member(s)</b> are in.\n' +
      'The host can press Start on the original RPS message.'
    );
    return { toast: 'You joined the RPS round!' };
  }
  if (data.startsWith('grpm_start_')) {
    const id = data.slice('grpm_start_'.length);
    const rpsKey = 'game:rps:' + chatId + ':' + id;
    const session = await kvGet(env, rpsKey, true);
    if (!session || session.expires <= Date.now() || session.status !== 'lobby') {
      return { toast: 'This round cannot be started.', alert: true };
    }
    if (userId !== session.host) return { toast: 'Only the round host can start it.', alert: true };
    if (Object.keys(session.players).length < 2) return { toast: 'At least two members must join.', alert: true };
    const updated = { ...session, status: 'choosing' };
    if (!(await claimSession(env, rpsKey, session, updated))) return { toast: 'Round changed. Try again.', alert: false };
    await send(env, chatId,
      '✊ <b>RPS is starting!</b>\n\n' +
      'Players: ' + Object.values(updated.players).map(p => esc(p.name)).join(', ') + '\n' +
      'Everyone who joined: choose ONE hand below. Your choice is private until the result is announced.',
      { reply_markup: { inline_keyboard: [[
        { text: '✊ Rock', callback_data: 'grpm_pick_' + id + '_0' },
        { text: '✋ Paper', callback_data: 'grpm_pick_' + id + '_1' },
        { text: '✌️ Scissors', callback_data: 'grpm_pick_' + id + '_2' }
      ], [
        { text: '🏁 Finish round (host)', callback_data: 'grpm_end_' + id }
      ]] } }
    );
    return { toast: 'Round started. Choose your hand!' };
  }
  if ((match = data.match(/^grpm_pick_([a-z0-9]+)_([0-2])$/))) {
    const id = match[1];
    const rpsKey = 'game:rps:' + chatId + ':' + id;
    const session = await kvGet(env, rpsKey, true);
    if (!session || session.expires <= Date.now() || session.status !== 'choosing') {
      return { toast: 'Hand selection is closed.', alert: true };
    }
    if (!session.players[String(userId)]) return { toast: 'Join the round first.', alert: true };
    if (session.choices?.[String(userId)] !== undefined) return { toast: 'Your hand is already locked in.', alert: true };
    const updated = {
      ...session,
      choices: { ...(session.choices || {}), [String(userId)]: Number(match[2]) }
    };
    if (!(await claimSession(env, rpsKey, session, updated))) return { toast: 'Choice not saved. Tap once more.', alert: false };
    // Keep selections private; the callback toast confirms the player's choice.
    // The host can finish after at least two players have selected.
    return { toast: 'Your hand is locked in!' };
  }
  if (data.startsWith('grpm_end_')) {
    const id = data.slice('grpm_end_'.length);
    const rpsKey = 'game:rps:' + chatId + ':' + id;
    const session = await kvGet(env, rpsKey, true);
    if (!session || session.expires <= Date.now() || session.status !== 'choosing') {
      return { toast: 'This round is not active.', alert: true };
    }
    if (userId !== session.host) return { toast: 'Only the round host can finish it.', alert: true };
    const players = Object.values(session.players);
    const chosenIds = Object.keys(session.choices || {});
    if (chosenIds.length < 2) return { toast: 'At least two members must choose a hand.', alert: true };
    const updated = { ...session, status: 'done' };
    if (!(await claimSession(env, rpsKey, session, updated))) return { toast: 'Round already finished.', alert: false };
    const counts = [0, 0, 0];
    for (const choice of Object.values(session.choices)) counts[choice] += 1;
    const activeHands = counts.map((count, hand) => count ? hand : -1).filter(hand => hand >= 0);
    let winningHand = -1;
    if (activeHands.length === 2) {
      const a = activeHands[0], b = activeHands[1];
      winningHand = (a - b + 3) % 3 === 1 ? a : b;
    }
    const labels = ['Rock', 'Paper', 'Scissors'];
    const lines = players.map(p => {
      const choice = session.choices[String(p.id)];
      return esc(p.name) + ': ' + (choice === undefined ? 'Did not choose' : labels[choice]);
    });
    const winners = winningHand < 0 ? [] : players.filter(p => session.choices[String(p.id)] === winningHand);
    for (const player of winners) await addCoins(env, player.id, 10);
    const result = winners.length
      ? '🏆 <b>Winning hand: ' + labels[winningHand] + '</b>\n' +
        winners.map(p => esc(p.name)).join(', ') + ' ' + (winners.length === 1 ? 'wins' : 'win') +
        ' 10 🪙 each!'
      : '🤝 <b>It is a draw!</b> No coins awarded. (A draw happens when only one hand or all three hands were chosen.)';
    await send(env, chatId,
      '✊ <b>Group Rock, Paper, Scissors — Results</b>\n\n' +
      lines.join('\n') + '\n\n' + result
    );
    await kvDel(env, rpsKey);
    return { toast: 'Group round finished!' };
  }
  if ((match = data.match(/^gh_([a-z0-9]+)_([0-8])$/))) {
    const session = await kvGet(env, 'game:hunt:' + chatId + ':' + match[1], true);
    if (!session || session.found) return { toast: 'The hunt has ended.', alert: true };
    const spot = Number(match[2]);
    const huntKey = 'game:hunt:' + chatId + ':' + match[1];
    // The first tap consumes the hunt, whether the selected spot is right or wrong.
    if (!(await claimSession(env, huntKey, session, { ...session, found: true, ended: true, player: userId }))) {
      return { toast: 'This hunt has already ended.', alert: true };
    }
    await kvDel(env, key(chatId));
    if (spot !== session.hidden) {
      const cells = ['🌳','🪨','📦','🌲','🏕️','🧰','🪵','🌿','🗺️'];
      await editCq(env, cq, '❌ <b>Hunt over!</b>\\n' + esc(cq.from.first_name || 'Player') +
        ' used their one try, but found nothing.\\n\\nThe treasure was hidden under ' + cells[session.hidden] + '.');
      return { toast: 'Wrong spot. Hunt over!', alert: true };
    }
    await addCoins(env, userId, 20);
    await editCq(env, cq, '💎 <b>Treasure found!</b>\\n' + esc(cq.from.first_name || 'Player') + ' found the hidden coins and earned 20 🪙!');
    return { toast: 'Treasure found! +20 coins' };
  }
  return null;
}
