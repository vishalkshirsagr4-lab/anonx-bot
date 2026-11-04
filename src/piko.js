// Piko feature pack: Groq AI, voice transcription, credits, economy, fun and group tools.
// All credentials are supplied through Cloudflare Worker secrets/bindings.
import { state, isOwner } from './config.js';
import { q, batch, kvGet, kvPut, kvDel } from './db.js';
import { tg, tgForm } from './telegram.js';
import { sendAnonMessage } from './anon.js';
import { getBotInfo } from './helpers.js';

const GROQ_URL = 'https://api.groq.com/openai/v1';
const CHAT_MODEL = 'openai/gpt-oss-20b';
const VOICE_MODEL = 'whisper-large-v3-turbo';
let schemaReady = false;
let schemaPromise = null;

const esc = value => String(value ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const mention = user => user.username ? '@'+esc(user.username) : '<a href="tg://user?id='+Number(user.id)+'">'+esc(user.first_name || 'User')+'</a>';
const argsOf = text => String(text || '').trim().split(/\s+/).filter(Boolean);
const rand = (a,b) => Math.floor(Math.random()*(b-a+1))+a;
const groqKey = env => env?.GROQ_API_KEY || '';

async function ensureSchema(env) {
  if (schemaReady) return;
  if (schemaPromise) return schemaPromise;
  schemaPromise = (async () => {
  const statements = [
    `CREATE TABLE IF NOT EXISTS piko_profiles (user_id INTEGER PRIMARY KEY, credits INTEGER NOT NULL DEFAULT 30, daily_at INTEGER, work_at INTEGER, crime_at INTEGER, rob_at INTEGER, warnings INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS piko_history (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, created_at INTEGER NOT NULL)`,
    `CREATE INDEX IF NOT EXISTS idx_piko_history_user ON piko_history(user_id,id)`,
    `CREATE TABLE IF NOT EXISTS piko_groups (chat_id TEXT PRIMARY KEY, welcome_enabled INTEGER NOT NULL DEFAULT 1, welcome_text TEXT NOT NULL DEFAULT 'Welcome {first} to {chatname}! 🎉')`,
    `CREATE TABLE IF NOT EXISTS piko_filters (id INTEGER PRIMARY KEY AUTOINCREMENT, chat_id TEXT NOT NULL, keyword TEXT NOT NULL, response TEXT NOT NULL, UNIQUE(chat_id,keyword))`,
    `CREATE TABLE IF NOT EXISTS piko_bans (user_id INTEGER PRIMARY KEY, reason TEXT, created_at INTEGER NOT NULL)`
  ];
  await batch(env, statements.map(sql => ({ sql })));
  schemaReady = true;
  })().catch(error => { schemaPromise = null; throw error; });
  return schemaPromise;
}

async function profile(env, user) {
  await ensureSchema(env);
  const now=Date.now();
  const results=await batch(env,[
    {sql:`INSERT OR IGNORE INTO piko_profiles(user_id,created_at) VALUES(?,?)`,args:[user.id,now]},
    {sql:`INSERT INTO users(user_id,first_name,username,created_at,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET first_name=excluded.first_name,username=excluded.username,updated_at=excluded.updated_at`,args:[user.id,user.first_name||'',user.username||'',now,now]},
    {sql:`SELECT p.*,u.coins FROM piko_profiles p LEFT JOIN users u ON u.user_id=p.user_id WHERE p.user_id=?`,args:[user.id]}
  ]);
  return results[2].rows[0] || {credits:30,coins:0};
}
async function reply(env, chatId, text, extra={}) { return tg(env,'sendMessage',{chat_id:chatId,text,parse_mode:'HTML',...extra}); }
async function ownerOnly(env, msg) { if (!isOwner(msg.from.id)) { await reply(env,msg.chat.id,'⛔ Owner only.'); return false; } return true; }
async function banned(env,id) { const r=await q(env,'SELECT 1 FROM piko_bans WHERE user_id=?',[id]); return r.rows.length>0; }

async function groqChat(env, userId, input) {
  const key=groqKey(env); if(!key) return 'Piko AI is not configured yet. Add GROQ_API_KEY as a Cloudflare secret.';
  const h=await q(env,'SELECT role,content FROM piko_history WHERE user_id=? ORDER BY id DESC LIMIT 8',[userId]);
  const messages=[{role:'system',content:`You are Piko, a friendly and socially aware chat companion in this community. Sound natural, casual and spontaneous, not like a customer-support agent. Learn each member's preferred language, wording, humour and message length from the conversation history, then gently match their style without copying them awkwardly. Understand English, Hindi, Kannada, Hinglish and Kannada-English. In casual chat, reply like a normal group participant: short when they are short, playful when the moment is playful, thoughtful when they are serious. React to the actual message and its context; remember what this member has said recently. Use emojis, light humour and familiar chat expressions only when they fit. Do not give canned greetings, generic assistant phrases, unnecessary lists or long explanations in casual conversation. Do not bring up being an AI or bot unprompted; if directly asked, answer honestly that you are Piko, a bot. Never claim to be human or invent real-life experiences. Treat casual insults, teasing and slang as normal banter when the context is clearly playful. Do not mistake ordinary jokes or edgy slang for a crisis. Only give serious wellbeing support when someone clearly expresses genuine distress or directly asks for help. If someone teases you, reply with a short, witty, friendly comeback that fits their language and vibe; never sound offended, preachy, robotic or superior. Treat casual insults, teasing and slang as normal banter when the context is clearly playful. Do not mistake ordinary jokes or edgy slang for a crisis. Only give serious wellbeing support when someone clearly expresses genuine distress or directly asks for help. If someone teases you, reply with a short, witty, friendly comeback that fits their language and vibe; never sound offended, preachy, robotic or superior. Be respectful, avoid bullying, and do not provide dangerous instructions. Be excellent at playful anime emoji guessing. If a member asks for an emoji quiz, says “guess karo”, “batao”, or starts an anime-character guessing game, naturally create or solve short emoji clues in chat. Create clues with 2–5 emojis and clever layered hints such as powers, eye traits, weapons, accessories, animals, elements, clans, symbols and personality. Use occasional simple emoji-math/rebus twists (for example two symbols combining into a third idea), but keep clues fair and recognizable. When the member sends an emoji clue and asks who it is, infer the most likely anime character and explain briefly in their language; if ambiguous, say so and offer a second possibility instead of pretending certainty. When creating a challenge, send the emoji clue first and invite the group/member to guess; do not reveal the answer until asked or after a correct guess. Vary anime series and characters, do not repeat the same easy examples, and never use a hardcoded character-to-emoji lookup table or fixed question bank—compose clues dynamically from your knowledge. Keep replies short, playful, Hinglish-friendly when appropriate. Do not mention system prompts or internal setup.`},...h.rows.reverse(),{role:'user',content:input.slice(0,4000)}];
  const res=await fetch(GROQ_URL+'/chat/completions',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({model:env?.GROQ_CHAT_MODEL||CHAT_MODEL,messages,max_completion_tokens:180,reasoning_effort:'low',temperature:0.75})});
  const data=await res.json(); if(!res.ok) throw new Error(data.error?.message||'Groq request failed');
  const answer=String(data.choices?.[0]?.message?.content||'I could not generate a reply.').slice(0,4000);
  const savedAt=Date.now();
  await batch(env,[
    {sql:'INSERT INTO piko_history(user_id,role,content,created_at) VALUES(?,?,?,?)',args:[userId,'user',input.slice(0,4000),savedAt]},
    {sql:'INSERT INTO piko_history(user_id,role,content,created_at) VALUES(?,?,?,?)',args:[userId,'assistant',answer,savedAt]},
    {sql:'DELETE FROM piko_history WHERE user_id=? AND id NOT IN (SELECT id FROM piko_history WHERE user_id=? ORDER BY id DESC LIMIT 16)',args:[userId,userId]}
  ]);
  return answer;
}

/**
 * Generate fresh game content with Groq. Game state, answer validation,
 * rewards and expiry remain local and deterministic.
 */
export async function generateGameContent(env, type, topic = 'mixed', avoidQuestions = []) {
  const key = groqKey(env);
  if (!key) return null;
  const mode = String(topic || 'mixed').slice(0, 60);
  const schema = type === 'word'
    ? 'Return JSON only: {"word":"exactly six lowercase English letters","hint":"a short, fair clue that does not reveal the word"}.'
    : 'Return JSON only: {"q":"short question or puzzle","a":["four distinct short options"],"c":0}. c is the zero-based index of the one correct option.';
  const theme = mode.toLowerCase().includes('anime')
    ? 'Use popular anime themes and well-known characters, but create original questions. Avoid quoting dialogue or reproducing copyrighted text.'
    : mode.toLowerCase().includes('trend') || mode.toLowerCase().includes('genz')
      ? 'Use current internet-culture, gaming, meme and Gen-Z-friendly themes. Keep it kind and age-appropriate.'
      : mode.toLowerCase().includes('famous')
        ? 'Use famous movies, games, anime, sports and pop-culture trivia.'
        : 'Choose a varied fun topic: anime, gaming, science, pop culture, internet culture, riddles or everyday knowledge.';
  const task = type === 'quiz' ? 'Write one fresh, EASY multiple-choice trivia question suitable for a casual group chat.'
    : type === 'riddle' ? 'Write one very easy, short, original riddle that most people can solve.'
    : type === 'emoji' ? 'Create a fresh anime CHARACTER emoji-guessing puzzle in the style of a fun Telegram group chat. The answer must be ONE specific, recognizable anime character (not an anime title, movie, game, or generic concept). The clue must be a compact sequence of 2 to 5 emojis only, with clever layered hints about that character: signature power, eye or visual trait, weapon/accessory, animal/symbol, element, personality, clan, or iconic association. Combine and remix clues creatively; use clever twists, substitutions and occasional simple emoji-math/rebus ideas such as combining two symbols into a third concept. Keep it solvable and fair, not random or impossibly obscure. The q field should contain only the emoji clue followed by a short prompt such as “Guess the anime character!” Do not reveal the character name in q. The four a options must be four plausible anime CHARACTER NAMES, with exactly one correct answer at index c; the other three must be believable distractors from anime. Vary anime series and characters, avoid repeating the same popular characters too often, and follow the requested topic/difficulty. If topic includes hard, make the clue more indirect and layered; if easy, use iconic hints. Generate original emoji combinations every time. Never hardcode a fixed character list or fixed emoji mapping; generate each puzzle from anime knowledge. Keep it friendly and suitable for a mixed-age group.'
    : 'Choose one common, easy six-letter English word; do not use names or obscure words.';
  const avoid = Array.isArray(avoidQuestions) ? avoidQuestions.slice(-100).map(x => String(x).slice(0,180)) : [];
  const response = await fetch(GROQ_URL + '/chat/completions', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: env?.GROQ_CHAT_MODEL || CHAT_MODEL,
      messages: [
        { role: 'system', content: 'You create ORIGINAL, beginner-friendly group-game content. Follow requested difficulty: easy should be accessible; hard may use clever layered clues but must remain fair and solvable. For anime emoji puzzles, use emoji character clues and four character-name choices, never hardcode a question bank or fixed emoji mapping. Output valid JSON only, no markdown.' },
        { role: 'user', content: task + ' Theme: ' + theme + ' Requested category: ' + mode + '. Create a genuinely new question that is semantically different from every item in this recent-used list. Never reuse, lightly edit, reword, or paraphrase any listed question: ' + JSON.stringify(avoid) + '. Keep wording short and answer choices simple and clearly distinct. For emoji puzzles, make q start with 2–5 meaningful emojis and make all four choices character names, not series titles. ' + schema }
      ],
      temperature: 0.85,
      max_completion_tokens: 700,
      reasoning_effort: 'low',
      response_format: { type: 'json_object' }
    })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || 'Groq game generation failed');
  const raw = String(data.choices?.[0]?.message?.content || '').replace(/^`{3}(?:json)?/i, '').replace(/`{3}$/,'').trim();
  if (!raw) throw new Error('Groq returned an empty game response; model=' + (env?.GROQ_CHAT_MODEL || CHAT_MODEL));
  const parsed = JSON.parse(raw);
  if (type === 'word') return /^[a-z]{6}$/i.test(parsed.word || '') && typeof parsed.hint === 'string' ? { word: parsed.word.toLowerCase(), hint: parsed.hint.slice(0, 180) } : null;
  if (typeof parsed.q !== 'string' || !Array.isArray(parsed.a) || parsed.a.length !== 4 ||
      !Number.isInteger(parsed.c) || parsed.c < 0 || parsed.c > 3 ||
      parsed.a.some(x => typeof x !== 'string' || !x.trim())) return null;
  return { q: parsed.q.slice(0, 350), a: parsed.a.map(x => x.slice(0, 80)), c: parsed.c };
}

function remaining(last, hours) { if(!last)return 0; return Math.max(0,hours*3600000-(Date.now()-last)); }
function duration(ms) { const h=Math.floor(ms/3600000),m=Math.floor(ms%3600000/60000); return h? h+'h '+m+'m':m+'m'; }

async function whisperCommand(env,msg,cmd) {
  const chatType = msg.chat.type;
  if (chatType !== 'group' && chatType !== 'supergroup') {
    await reply(env, msg.chat.id, '🔐 Use /whisper in a group to send a private message.');
    return;
  }

  // The command text contains the secret, so remove it from the group before delivery.
  // Fail closed: never send the whisper if Telegram cannot delete the public command.
  const removed = await tg(env, 'deleteMessage', {
    chat_id: msg.chat.id,
    message_id: msg.message_id
  });
  if (!removed?.ok) {
    console.error('Piko whisper could not delete public command:', removed?.description || 'Unknown Telegram error');
    await reply(env, msg.chat.id, '🔒 For privacy, I did not send this whisper because I could not remove your command from the group. Please make Piko a group admin with the <b>Delete messages</b> permission, then try again.');
    return;
  }

  let target = msg.reply_to_message?.from || null;
  let message = String(cmd.arg || '').trim();

  if (!target) {
    const match = message.match(/^@([A-Za-z0-9_]{5,32})\s+([\s\S]+)$/);
    if (!match) {
      await reply(env, msg.chat.id, 'Usage: <code>/whisper @username your private message</code>\nOr reply to a member: <code>/whisper your private message</code>');
      return;
    }
    const username = match[1].toLowerCase();
    message = match[2].trim();
    const found = await q(env, 'SELECT user_id,first_name,username,dm_open FROM users WHERE LOWER(username)=? LIMIT 1', [username]);
    target = found.rows[0] ? {
      id: Number(found.rows[0].user_id),
      first_name: found.rows[0].first_name || 'User',
      username: found.rows[0].username || username,
      is_bot: false,
      dm_open: Number(found.rows[0].dm_open) === 1
    } : null;
  }

  if (!target || !Number.isSafeInteger(Number(target.id)) || Number(target.id) <= 0 || target.is_bot) {
    await reply(env, msg.chat.id, '❌ I could not find that member. They must have started Piko in DM before you can whisper to them.');
    return;
  }
  if (Number(target.id) === Number(msg.from.id)) {
    await reply(env, msg.chat.id, 'You cannot whisper to yourself.');
    return;
  }
  if (!message) {
    await reply(env, msg.chat.id, '❌ Add a message after /whisper.');
    return;
  }
  if (message.length > 3000) {
    await reply(env, msg.chat.id, '❌ Whisper messages can be up to 3000 characters.');
    return;
  }

  const recipient = await q(env, 'SELECT dm_open FROM users WHERE user_id=? LIMIT 1', [Number(target.id)]);
  if (!recipient.rows.length || Number(recipient.rows[0].dm_open) !== 1) {
    await reply(env, msg.chat.id, '🔒 This member has not started Piko in DM yet. Ask them to open @Piko_866 and press Start, then try again.');
    return;
  }

  const senderName = esc(msg.from.first_name || 'A group member');
  const privateText = '🔐 <b>A whisper message to you.</b>\nFrom: ' + senderName + '\n\n' + esc(message);
  const sent = await tg(env, 'sendMessage', {
    chat_id: Number(target.id),
    text: privateText,
    parse_mode: 'HTML',
    disable_web_page_preview: true
  });

  if (!sent?.ok) {
    console.error('Piko whisper delivery failed:', { targetId: Number(target.id), error: sent?.description || 'Unknown Telegram error' });
    await reply(env, msg.chat.id, '❌ I could not deliver the whisper. The recipient may have blocked Piko or needs to press /start again.');
    return;
  }

  await reply(env, msg.chat.id, '🔐 A whisper message to ' + mention(target) + '.\nOnly they can read the message.');
}


const NAZRIYA_API_BASE = 'https://nazriya.teamgod.online/api';
const MUSIC_LINK_HOSTS = new Set([
  'youtube.com','www.youtube.com','youtu.be','music.youtube.com',
  'open.spotify.com','spotify.com','music.apple.com','itunes.apple.com',
  'soundcloud.com','www.soundcloud.com','deezer.com','www.deezer.com',
  'jiosaavn.com','www.jiosaavn.com','gaana.com','wynk.in'
]);
function musicItems(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];
  for (const key of ['results','data','songs','tracks','items','result']) {
    const value = payload[key];
    if (Array.isArray(value)) return value;
    if (value && typeof value === 'object') {
      for (const nested of ['results','songs','tracks','items']) if (Array.isArray(value[nested])) return value[nested];
    }
  }
  return payload.data && typeof payload.data === 'object' ? [payload.data] : [];
}
function musicField(item, keys) {
  for (const key of keys) {
    const value = item?.[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}
function safeMusicPlatformLink(raw) {
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'https:' || !MUSIC_LINK_HOSTS.has(parsed.hostname.toLowerCase())) return '';
    return parsed.href;
  } catch { return ''; }
}
function musicAuthorized(value) {
  if (!value || typeof value !== 'object') return false;
  if (value.authorized === true || value.rights_cleared === true || value.user_owned === true) return true;
  const license = String(value.license || value.licence || value.license_status || value.rights || '').toLowerCase();
  return /public.?domain|creative.?commons|royalty.?free|licensed|permission.?granted|user.?owned/.test(license);
}
function mediaPayloadUrl(payload, kind) {
  const candidates = [payload, payload?.data, payload?.result, payload?.media, payload?.data?.media].filter(Boolean);
  const keys = kind === 'audio'
    ? ['audio_url','stream_url','media_url','download_url','file_url','url']
    : ['video_url','stream_url','media_url','download_url','file_url','url'];
  for (const candidate of candidates) {
    for (const key of keys) {
      const raw = candidate?.[key];
      if (typeof raw === 'string' && raw.trim()) {
        try {
          const u = new URL(raw);
          if (u.protocol === 'https:' && !['localhost','127.0.0.1','0.0.0.0'].includes(u.hostname)) return u.href;
        } catch {}
      }
    }
  }
  return '';
}
async function fetchNazriyaJson(url) {
  const response = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(12000) });
  const payload = await response.json();
  if (!response.ok || payload?.status === 'error' || payload?.success === false) {
    throw new Error('Nazriya API request failed (' + response.status + ')');
  }
  return payload;
}
async function searchNazriya(env, query) {
  const url = new URL(NAZRIYA_API_BASE + '/search');
  url.searchParams.set('q', query);
  url.searchParams.set('key', String(env.NAZRIYA_API_KEY || '').trim());
  return musicItems(await fetchNazriyaJson(url.toString())).slice(0, 5);
}
async function sendNazriyaMedia(env, msg, item, kind) {
  const id = String(item.id || '').trim();
  if (!id || !/^[A-Za-z0-9_-]{3,80}$/.test(id)) {
    return { ok: false, reason: 'The selected result has no valid media ID.' };
  }
  const endpoint = new URL(NAZRIYA_API_BASE + (kind === 'audio' ? '/audio' : '/video'));
  endpoint.searchParams.set('id', id);
  endpoint.searchParams.set('key', String(env.NAZRIYA_API_KEY || '').trim());
  const payload = await fetchNazriyaJson(endpoint.toString());
  if (!musicAuthorized(payload) && !musicAuthorized(payload?.data) && !musicAuthorized(payload?.result)) {
    return { ok: false, reason: 'The media provider did not confirm distribution rights.' };
  }
  const mediaUrl = mediaPayloadUrl(payload, kind);
  if (!mediaUrl) return { ok: false, reason: 'The provider did not return a direct HTTPS media URL.' };
  const mediaResponse = await fetch(mediaUrl, { signal: AbortSignal.timeout(25000) });
  if (!mediaResponse.ok) throw new Error('Media source returned HTTP ' + mediaResponse.status);
  const contentType = String(mediaResponse.headers.get('content-type') || '').toLowerCase();
  const expected = kind === 'audio' ? contentType.startsWith('audio/') : contentType.startsWith('video/');
  if (!expected) return { ok: false, reason: 'The direct source did not return a valid ' + kind + ' media file.' };
  const blob = await mediaResponse.blob();
  if (!blob.size || blob.size > 45 * 1024 * 1024) {
    return { ok: false, reason: 'The media file is empty or exceeds Telegram upload limits.' };
  }
  const title = musicField(item, ['title','name','song','track']) || 'Piko music';
  const safeTitle = title.replace(/[\\r\\n]/g, ' ').slice(0, 900);
  const caption = '🎵 <b>' + esc(safeTitle) + '</b>\n👤 ' + esc(musicField(item, ['uploader','artist','author']) || 'Artist not listed');
  const method = kind === 'audio' ? 'sendAudio' : 'sendVideo';
  const field = kind === 'audio' ? 'audio' : 'video';
  const ext = kind === 'audio' ? 'mp3' : 'mp4';
  const sent = await tgForm(env, method, {
    chat_id: msg.chat.id,
    caption,
    parse_mode: 'HTML',
    reply_to_message_id: msg.message_id
  }, field, blob, 'piko-' + id + '.' + ext);
  if (!sent?.ok) throw new Error(sent?.description || 'Telegram rejected the media upload');
  return { ok: true };
}
async function musicSearchCommand(env, msg, cmd) {
  const query = String(cmd.arg || '').trim().slice(0, 120);
  if (!query) return reply(env, msg.chat.id, '🎵 <b>Piko Music</b>\n\n/search song — search metadata\n/play song — send authorized audio to this group\n/song song — same as /play\n/video song — send authorized video to this group\n/music song — send authorized audio and video');
  const apiKey = String(env?.NAZRIYA_API_KEY || '').trim();
  if (!apiKey) return reply(env, msg.chat.id, '⚙️ Music search is not configured. Add <code>NAZRIYA_API_KEY</code> as a Cloudflare Worker secret.');
  const status = await reply(env, msg.chat.id, '🔎 Searching music…', { reply_to_message_id: msg.message_id });
  if (!status?.ok || !status.result?.message_id) return true;
  const statusId = status.result.message_id;
  const editStatus = async text => tg(env, 'editMessageText', {
    chat_id: msg.chat.id, message_id: statusId, text, parse_mode: 'HTML', disable_web_page_preview: true
  });
  try {
    const items = await searchNazriya(env, query);
    if (!items.length) {
      await editStatus('🔎 No matching results. Try another song title or artist.');
      return true;
    }
    if (cmd.name === 'search') {
      const lines = items.map((item, i) => {
        const title = musicField(item, ['title','name','song','track']) || 'Unknown title';
        const uploader = musicField(item, ['uploader','artist','author','singer']) || 'Artist not listed';
        const duration = Number(item.duration);
        return (i + 1) + '. <b>' + esc(title.slice(0, 140)) + '</b>\n   👤 ' + esc(uploader.slice(0, 100)) +
          (Number.isFinite(duration) && duration > 0 ? '\n   ⏱ ' + Math.floor(duration / 60) + ':' + String(duration % 60).padStart(2,'0') : '');
      });
      await editStatus('🔎 <b>Matching music results</b>\n\n' + lines.join('\n\n') +
        '\n\nUse /play ' + esc(query) + ' or /video ' + esc(query) + ' for authorized media.');
      return true;
    }
    const selected = items[0];
    const title = musicField(selected, ['title','name','song','track']) || 'Selected result';
    await editStatus('🎵 Selected: <b>' + esc(title.slice(0, 140)) + '</b>\nPreparing authorized media for this group…');
    const kinds = cmd.name === 'video' ? ['video']
      : cmd.name === 'music' ? ['audio','video'] : ['audio'];
    let sentCount = 0;
    const failures = [];
    for (const kind of kinds) {
      try {
        const result = await sendNazriyaMedia(env, msg, selected, kind);
        if (result.ok) sentCount++;
        else failures.push((kind === 'audio' ? 'Audio: ' : 'Video: ') + result.reason);
      } catch (error) {
        console.error('Piko ' + kind + ' delivery failed:', String(error?.message || error).slice(0, 180));
        failures.push((kind === 'audio' ? 'Audio: ' : 'Video: ') + 'provider or Telegram delivery failed.');
      }
    }
    if (sentCount) {
      await editStatus('✅ Sent ' + sentCount + ' playable media item' + (sentCount === 1 ? '' : 's') + ' to this group.' +
        (failures.length ? '\n\n' + failures.map(esc).join('\n') : ''));
    } else {
      await editStatus('⚠️ No playable media was sent.\n\n' + failures.map(esc).join('\n') +
        '\n\nThe search result must explicitly identify public-domain, licensed, or user-owned media, and the media endpoint must return a direct audio/video file.');
    }
  } catch (error) {
    console.error('Piko music command failed:', String(error?.message || error).slice(0, 180));
    await editStatus('⚠️ Music service is temporarily unavailable. Please try again later.');
  }
  return true;
}

async function economy(env,msg,cmd) {
  const id=msg.from.id, a=argsOf(cmd.arg), p=await profile(env,msg.from), now=Date.now();
  if(cmd.name==='credits'||cmd.name==='wallet') return reply(env,msg.chat.id,`💼 <b>Piko Wallet</b>\n\n✨ Credits: <b>${p.credits}</b>\n🪙 Coins: <b>${p.coins||0}</b>\n\nUse /daily and /work to earn coins.`);
  if(cmd.name==='daily'||cmd.name==='work'||cmd.name==='crime'||cmd.name==='rob'){
    const field={daily:'daily_at',work:'work_at',crime:'crime_at',rob:'rob_at'}[cmd.name], hours={daily:24,work:1,crime:2,rob:6}[cmd.name];
    const wait=remaining(p[field],hours); if(wait) return reply(env,msg.chat.id,'⏳ Try again in '+duration(wait)+'.');
    if(cmd.name==='rob'){
      const target=msg.reply_to_message?.from; if(!target||target.is_bot||target.id===id) return reply(env,msg.chat.id,'Reply to a group member with /rob.');
      const t=await profile(env,target); if((t.coins||0)<50) return reply(env,msg.chat.id,'That user needs at least 50 coins.');
      await q(env,'UPDATE piko_profiles SET rob_at=? WHERE user_id=?',[now,id]);
      if(Math.random()<0.5){const n=rand(30,Math.min(200,t.coins));await q(env,'UPDATE users SET coins=MAX(0,coins+?) WHERE user_id=?', [n,id]);await q(env,'UPDATE users SET coins=MAX(0,coins-?) WHERE user_id=?',[n,target.id]);return reply(env,msg.chat.id,`💸 You won ${n} coins from ${mention(target)}.`);}
      const fine=rand(10,40);await q(env,'UPDATE users SET coins=MAX(0,coins-?) WHERE user_id=?',[fine,id]);return reply(env,msg.chat.id,`🚓 You were caught. Fine: ${fine} coins.`);
    }
    let reward,desc;
    if(cmd.name==='daily'){reward=rand(150,300);desc='Daily reward';}
    else if(cmd.name==='work'){reward=rand(50,120);desc='Work completed';}
    else {const win=Math.random()<0.6;reward=win?rand(40,120):-rand(20,60);desc=win?'Fictional challenge succeeded':'Fictional challenge failed';}
    await q(env,`UPDATE piko_profiles SET ${field}=? WHERE user_id=?`,[now,id]);
    await q(env,'UPDATE users SET coins=MAX(0,coins+?) WHERE user_id=?',[reward,id]);
    return reply(env,msg.chat.id,`💰 <b>${desc}</b>\n${reward>=0?'+':''}${reward} coins.`);
  }
  if(cmd.name==='pay'){
    const target=msg.reply_to_message?.from, amount=Number(a[0]);
    if(!target||target.is_bot||target.id===id||!Number.isSafeInteger(amount)||amount<1||amount>100000) return reply(env,msg.chat.id,'Reply to a member: /pay amount');
    const sender=await profile(env,msg.from); if((sender.coins||0)<amount)return reply(env,msg.chat.id,'Not enough coins.');
    await profile(env,target);
    await q(env,'UPDATE users SET coins=coins-? WHERE user_id=?',[amount,id]);await q(env,'UPDATE users SET coins=coins+? WHERE user_id=?',[amount,target.id]);
    return reply(env,msg.chat.id,`✅ Sent ${amount} coins to ${mention(target)}.`);
  }
}

function findFunTarget(msg) {
  const replied=msg.reply_to_message?.from;
  if(replied&&!replied.is_bot&&replied.id!==msg.from.id)return replied;
  const entities=[...(msg.entities||[]),...(msg.caption_entities||[])];
  for(const entity of entities){
    if(entity.type==='text_mention'&&entity.user&&!entity.user.is_bot&&entity.user.id!==msg.from.id)return entity.user;
    if(entity.type==='mention'){
      const raw=String(msg.text||'').slice(entity.offset,entity.offset+entity.length);
      if(raw)return {id:0,username:raw.slice(1),first_name:raw};
    }
  }
  const raw=String(msg.text||'').match(/(?:^|\s)@([A-Za-z0-9_]{5,32})(?:\s|$)/);
  if(raw)return {id:0,username:raw[1],first_name:'@'+raw[1]};
  return null;
}
const FUN_MEDIA_COMMANDS=['hug','wave','highfive','cheer','kick','punch','slap'];
async function sendFunMedia(env,chatId,name,replyTo){
  const items=await kvGet(env,'piko_media:'+name,true);
  if(!Array.isArray(items)||!items.length){
    return {ok:false,reason:'No saved stickers found for /'+name+'. Configure the pack again in Piko DM using /set'+name+'.'};
  }
  if(!Number.isInteger(replyTo)||replyTo<=0){
    return {ok:false,reason:'I could not identify the original message. Reply directly to the member message.'};
  }
  const valid=items.filter(item=>item&&typeof item.file_id==='string'&&item.file_id&&['sticker','animation'].includes(item.type));
  if(!valid.length){
    return {ok:false,reason:'The saved /'+name+' pack has no valid Telegram file IDs. Please configure it again with /set'+name+'.'};
  }
  const item=valid[rand(0,valid.length-1)];
  const method=item.type==='animation'?'sendAnimation':'sendSticker';
  const mediaField=item.type==='animation'?'animation':'sticker';
  const result=await tg(env,method,{
    chat_id:chatId,
    [mediaField]:item.file_id,
    reply_to_message_id:replyTo
  });
  if(!result?.ok){
    const description=String(result?.description||'Unknown Telegram API error').slice(0,220);
    console.error('Piko fun media send failed:',{name,method,replyTo,error_code:result?.error_code,description});
    return {ok:false,reason:'Telegram rejected the saved media: '+description};
  }
  const actualReplyId=result.result?.reply_to_message?.message_id;
  if(Number.isInteger(actualReplyId)&&actualReplyId!==replyTo){
    console.error('Piko fun media reply mismatch:',{name,replyTo,actualReplyId});
    return {ok:false,reason:'Telegram sent the sticker but attached it to a different message. Please report this to the bot owner.'};
  }
  return {ok:true};
}
async function setFunMedia(env,msg,cmd){
  if(!isOwner(msg.from.id)){await reply(env,msg.chat.id,'⛔ Owner only.');return true;}
  if(msg.chat.type!=='private'){await reply(env,msg.chat.id,'Please configure media in Piko DM.');return true;}
  const name=cmd.name.slice(3);
  await kvPut(env,'piko_media_pending:'+msg.from.id,name,1800);
  const current=await kvGet(env,'piko_media:'+name,true);
  await reply(env,msg.chat.id,'📥 <b>Set /'+name+' media</b>\n\nSend a sticker or GIF/animation now. I will keep asking for more until you send /cancel.\n\nSaved items: <b>'+(Array.isArray(current)?current.length:0)+'</b>');
  return true;
}
async function handleFunMediaSetup(env,msg,cmd){
  if(!isOwner(msg.from.id))return false;
  const pending=await kvGet(env,'piko_media_pending:'+msg.from.id);
  if(!pending)return false;
  if(cmd?.name==='cancel'){
    await kvDel(env,'piko_media_pending:'+msg.from.id);
    await reply(env,msg.chat.id,'✅ Media setup cancelled. Previously saved media is kept.');
    return true;
  }
  const media=msg.sticker?{type:'sticker',file_id:msg.sticker.file_id}:msg.animation?{type:'animation',file_id:msg.animation.file_id}:null;
  if(!media){
    await reply(env,msg.chat.id,'Please send a Telegram sticker or GIF/animation. Send /cancel to finish.');
    return true;
  }
  const key='piko_media:'+pending;
  const items=await kvGet(env,key,true);
  const next=Array.isArray(items)?items:[];
  if(!next.some(x=>x.file_id===media.file_id))next.push(media);
  await kvPut(env,key,next);
  await reply(env,msg.chat.id,'✅ Added '+media.type+'. Total saved for /'+pending+': <b>'+next.length+'</b>\n\nSend another sticker/GIF, or /cancel when finished.');
  return true;
}
async function funCommand(env,msg,cmd){
  if(FUN_MEDIA_COMMANDS.includes(cmd.name)){
    // Only accept a direct reply; target the member's original message ID.
    const original=msg.reply_to_message;
    // The replied-to message can be text, sticker, photo, video, or another
    // Telegram message type. Only its message_id is needed to reply to it.
    if(!original||!Number.isInteger(original.message_id)||original.message_id<=0){
      return reply(env,msg.chat.id,'Reply directly to the message with /'+cmd.name+'.');
    }
    const sent=await sendFunMedia(env,msg.chat.id,cmd.name,original.message_id);
    if(!sent.ok)return reply(env,msg.chat.id,'❌ '+sent.reason,{reply_to_message_id:msg.message_id});
    return true;
  }
  const target=findFunTarget(msg);
  if(cmd.name==='ship'){
    if(!target)return reply(env,msg.chat.id,'Reply to someone or tag them: /ship @username');
    const score=rand(0,100);
    return reply(env,msg.chat.id,`💚 <b>Friendship percentage</b>\n${mention(msg.from)} + ${mention(target)}\n\n<b>${score}%</b> ${'💚'.repeat(Math.floor(score/20))}`,{reply_to_message_id:msg.message_id});
  }
  if(cmd.name==='roll'){
    return tg(env,'sendDice',{chat_id:msg.chat.id,emoji:'🎲',reply_to_message_id:msg.message_id});
  }
}
async function imageCommand(env,msg,cmd){
  const prompt=String(cmd.arg||'').trim(); if(!prompt)return reply(env,msg.chat.id,'Usage: /img describe your image');
  const p=await profile(env,msg.from);if(p.credits<5)return reply(env,msg.chat.id,'You need 5 credits. Use /daily to earn coins; ask the owner about credits.');
  const status=await reply(env,msg.chat.id,'🎨 Piko is creating your image…');
  try{
    const url='https://image.pollinations.ai/prompt/'+encodeURIComponent(prompt)+'?width=1024&height=1024&nologo=true';
    const res=await fetch(url);if(!res.ok)throw new Error('Image provider returned '+res.status);
    const blob=await res.blob();if(blob.size>10*1024*1024)throw new Error('Image is too large');
    const sent=await tgForm(env,'sendPhoto',{chat_id:msg.chat.id,caption:'🎨 <b>Piko AI Image</b>\n'+esc(prompt.slice(0,700)),parse_mode:'HTML'},'photo',blob,'piko.png');
    if(!sent.ok)throw new Error(sent.description||'Telegram upload failed');
    await q(env,'UPDATE piko_profiles SET credits=credits-5 WHERE user_id=? AND credits>=5',[msg.from.id]);
    await tg(env,'deleteMessage',{chat_id:msg.chat.id,message_id:status.result.message_id});
  }catch(e){await tg(env,'editMessageText',{chat_id:msg.chat.id,message_id:status.result.message_id,text:'Image generation failed. Please try again later.'});}
}

async function voiceCommand(env,msg){
  const key=groqKey(env);if(!key)return reply(env,msg.chat.id,'Voice transcription needs GROQ_API_KEY in Cloudflare secrets.');
  const fileId=msg.voice?.file_id||msg.audio?.file_id;if(!fileId)return false;
  const meta=await tg(env,'getFile',{file_id:fileId});if(!meta.ok)return reply(env,msg.chat.id,'Could not retrieve that voice file.');
  const token=env.BOT_TOKEN||state.BOT_TOKEN;
  const file=await fetch('https://api.telegram.org/file/bot'+token+'/'+meta.result.file_path);
  if(!file.ok)return reply(env,msg.chat.id,'Could not download the voice file.');
  const form=new FormData();form.append('file',await file.blob(),'voice.ogg');form.append('model',env.GROQ_VOICE_MODEL||VOICE_MODEL);
  const result=await fetch(GROQ_URL+'/audio/transcriptions',{method:'POST',headers:{Authorization:'Bearer '+key},body:form});
  const data=await result.json();if(!result.ok)return reply(env,msg.chat.id,'Transcription failed: '+esc(data.error?.message||'provider error'));
  const transcript=String(data.text||'').slice(0,3500);if(!transcript)return reply(env,msg.chat.id,'No speech was detected.');
  await reply(env,msg.chat.id,'🎙️ <b>Transcription</b>\n'+esc(transcript));
  const answer=await groqChat(env,msg.from.id,'A user sent this voice message: '+transcript+'\nReply helpfully and briefly.');
  return reply(env,msg.chat.id,'🤖 <b>Piko says</b>\n'+esc(answer));
}

async function groupTools(env,msg,cmd){
  const chat=String(msg.chat.id), uid=msg.from.id;
  const { isAdmin } = await import('./helpers.js');
  if(!await isAdmin(env,chat,uid)) return reply(env,chat,'⛔ Only this group\'s administrators can use that command.');

  if(cmd.name==='welcome'){
    const value=cmd.arg.trim().toLowerCase();
    if(!value){
      const r=await q(env,'SELECT welcome_enabled FROM piko_groups WHERE chat_id=?',[chat]);
      const enabled=r.rows.length ? Number(r.rows[0].welcome_enabled)!==0 : true;
      return reply(env,chat,'👋 Welcome messages are currently <b>'+ (enabled?'ON':'OFF') +'</b>.\nUse /welcome on or /welcome off.');
    }
    if(!['on','off'].includes(value)) return reply(env,chat,'Usage: /welcome on or /welcome off');
    await q(env,'INSERT INTO piko_groups(chat_id,welcome_enabled) VALUES(?,?) ON CONFLICT(chat_id) DO UPDATE SET welcome_enabled=excluded.welcome_enabled',[chat,value==='on'?1:0]);
    return reply(env,chat,'✅ Welcome messages turned '+value+'.');
  }

  if(cmd.name==='setwelcome'){
    const value=(cmd.arg.trim() || msg.reply_to_message?.text || msg.reply_to_message?.caption || '').trim();
    if(!value || value.length>1000) return reply(env,chat,'Usage: /setwelcome Welcome {first} to {chatname}\nYou can also reply to a message with /setwelcome.');
    await q(env,'INSERT INTO piko_groups(chat_id,welcome_text) VALUES(?,?) ON CONFLICT(chat_id) DO UPDATE SET welcome_text=excluded.welcome_text',[chat,value]);
    return reply(env,chat,'✅ Custom welcome message saved. Placeholders: {first}, {username}, {chatname}.');
  }

  if(cmd.name==='delwelcome'){
    await q(env,'INSERT INTO piko_groups(chat_id,welcome_enabled,welcome_text) VALUES(?,0,?) ON CONFLICT(chat_id) DO UPDATE SET welcome_enabled=0,welcome_text=excluded.welcome_text',[chat,'Welcome {first} to {chatname}! 🎉']);
    return reply(env,chat,'✅ Welcome messages disabled and the custom text reset. Use /welcome on to enable them again.');
  }

  if(cmd.name==='save'){
    const replied=(msg.reply_to_message?.text || msg.reply_to_message?.caption || '').trim();
    let keyword='', response='';
    if(replied){
      keyword=cmd.arg.trim().toLowerCase();
      response=replied;
    }else{
      const split=cmd.arg.trim().match(/^(\S+)\s+([\s\S]+)$/);
      if(split){keyword=split[1].toLowerCase();response=split[2].trim();}
    }
    if(!keyword || !response) return reply(env,chat,'Usage: /save keyword response\nOr reply to a text message with /save keyword.');
    if(keyword.length>80 || response.length>1000) return reply(env,chat,'❌ Keyword limit: 80 characters. Reply limit: 1000 characters.');
    await q(env,'INSERT INTO piko_filters(chat_id,keyword,response) VALUES(?,?,?) ON CONFLICT(chat_id,keyword) DO UPDATE SET response=excluded.response',[chat,keyword,response]);
    return reply(env,chat,'✅ Saved filter for keyword: <code>'+esc(keyword)+'</code>');
  }

  if(cmd.name==='stop'){
    const keyword=cmd.arg.trim().toLowerCase();
    if(!keyword) return reply(env,chat,'Usage: /stop keyword');
    const r=await q(env,'DELETE FROM piko_filters WHERE chat_id=? AND keyword=?',[chat,keyword]);
    return reply(env,chat,r.rowsAffected?'🗑 Removed filter: <code>'+esc(keyword)+'</code>':'ℹ️ No filter found for: <code>'+esc(keyword)+'</code>');
  }

  if(cmd.name==='filters'){
    const r=await q(env,'SELECT keyword FROM piko_filters WHERE chat_id=? ORDER BY LENGTH(keyword) DESC, keyword LIMIT 50',[chat]);
    return reply(env,chat,r.rows.length?'🔎 <b>Active filters ('+r.rows.length+')</b>\n'+r.rows.map(x=>'• <code>'+esc(x.keyword)+'</code>').join('\n'):'📭 No filters configured. Add one with /save keyword response.');
  }

  if(cmd.name==='ban'||cmd.name==='unban'){
    const replied=msg.reply_to_message?.from;
    const numeric=cmd.arg.trim().match(/^\d+$/);
    const targetId=replied?.id || (numeric?Number(numeric[0]):0);
    if(!Number.isSafeInteger(Number(targetId)) || Number(targetId)<=0) return reply(env,chat,'Reply to a member with /'+cmd.name+' or use /'+cmd.name+' user_id.');
    const me=await tg(env,'getMe');
    if(me.ok && Number(me.result.id)===Number(targetId)) return reply(env,chat,'❌ I cannot apply this action to myself.');
    const botMember=me.ok?await tg(env,'getChatMember',{chat_id:chat,user_id:me.result.id}):null;
    if(!botMember?.ok || !['administrator','creator'].includes(botMember.result.status) || (cmd.name==='ban' && botMember.result.status!=='creator' && botMember.result.can_restrict_members!==true)){
      return reply(env,chat,'⚠️ I need to be a group admin with <b>Ban users</b> permission to do this.');
    }
    const method=cmd.name==='ban'?'banChatMember':'unbanChatMember';
    const result=await tg(env,method,{chat_id:chat,user_id:Number(targetId),...(cmd.name==='unban'?{only_if_banned:true}:{})});
    if(!result.ok) return reply(env,chat,'❌ Telegram could not '+cmd.name+' that member: '+esc(result.description||'Check my admin permissions and the target user.'));
    return reply(env,chat,'✅ '+(cmd.name==='ban'?'Banned':'Unbanned')+' user <code>'+Number(targetId)+'</code>.');
  }
}
async function adminCommand(env,msg,cmd){
  if(!await ownerOnly(env,msg))return true;
  if(cmd.name==='admin'||cmd.name==='stats'){
    await ensureSchema(env);
    const [u,g,b]=await Promise.all([q(env,'SELECT COUNT(*) n FROM users'),q(env,'SELECT COUNT(*) n FROM groups'),q(env,'SELECT COUNT(*) n FROM piko_bans')]);
    return reply(env,msg.chat.id,`👑 <b>Piko Admin</b>\nUsers: ${u.rows[0].n}\nGroups: ${g.rows[0].n}\nBanned: ${b.rows[0].n}\n\n/addcredits user_id amount\n/addcoins user_id amount\n/gban user_id reason\n/ungban user_id`);
  }
  const a=argsOf(cmd.arg),id=Number(a[0]),amount=Number(a[1]);
  if(cmd.name==='addcredits'||cmd.name==='addcoins'){
    if(!Number.isSafeInteger(id)||id<=0||!Number.isSafeInteger(amount)||amount===0||Math.abs(amount)>1000000)return reply(env,msg.chat.id,'Usage: /'+cmd.name+' user_id amount');
    await q(env,'INSERT OR IGNORE INTO piko_profiles(user_id,created_at) VALUES(?,?)',[id,Date.now()]);
    if(cmd.name==='addcredits')await q(env,'UPDATE piko_profiles SET credits=MAX(0,credits+?) WHERE user_id=?',[amount,id]);
    else {await q(env,'INSERT OR IGNORE INTO users(user_id,first_name,coins,created_at,updated_at) VALUES(?,?,?,?,?)',[id,'',0,Date.now(),Date.now()]);await q(env,'UPDATE users SET coins=MAX(0,coins+?) WHERE user_id=?',[amount,id]);}
    return reply(env,msg.chat.id,'✅ Updated '+cmd.name+' for user '+id+'.');
  }
  if(cmd.name==='gban'){
    if(!Number.isSafeInteger(id)||id<=0)return reply(env,msg.chat.id,'Usage: /gban user_id reason');
    await q(env,'INSERT INTO piko_bans(user_id,reason,created_at) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET reason=excluded.reason,created_at=excluded.created_at',[id,a.slice(1).join(' ').slice(0,300)||'Owner action',Date.now()]);
    return reply(env,msg.chat.id,'🚫 User '+id+' is blocked from Piko features.');
  }
  if(cmd.name==='ungban'){
    if(!Number.isSafeInteger(id)||id<=0)return reply(env,msg.chat.id,'Usage: /ungban user_id');
    await q(env,'DELETE FROM piko_bans WHERE user_id=?',[id]);return reply(env,msg.chat.id,'✅ User '+id+' unblocked.');
  }
  return true;
}

function parseTelegramMessageLink(raw) {
  let url;
  try { url = new URL(raw); } catch { return null; }
  if (!['t.me', 'www.t.me', 'telegram.me', 'www.telegram.me'].includes(url.hostname.toLowerCase())) return null;
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts[0] === 'c') {
    if (parts.length < 3 || !/^\d+$/.test(parts[1])) return null;
    const chatId = '-100' + parts[1];
    if (parts.length >= 4 && /^\d+$/.test(parts[2]) && /^\d+$/.test(parts[3])) {
      return { chatId, threadId: Number(parts[2]), messageId: Number(parts[3]) };
    }
    if (!/^\d+$/.test(parts[2])) return null;
    return { chatId, messageId: Number(parts[2]) };
  }
  if (parts.length < 2 || !/^[a-zA-Z0-9_]{5,}$/.test(parts[0])) return null;
  if (parts.length >= 3 && /^\d+$/.test(parts[1]) && /^\d+$/.test(parts[2])) {
    return { chatId: '@' + parts[0], threadId: Number(parts[1]), messageId: Number(parts[2]) };
  }
  if (!/^\d+$/.test(parts[1])) return null;
  return { chatId: '@' + parts[0], messageId: Number(parts[1]) };
}

async function replyByMessageLink(env, msg, cmd) {
  const raw = String(cmd.arg || '').trim();
  const linkMatch = raw.match(/https?:\/\/(?:www\.)?(?:t\.me|telegram\.me)\/[a-zA-Z0-9_/-]+(?:\?[^\s]*)?/i);
  const link = linkMatch?.[0]?.replace(/[),.!?]+$/, '');
  const target = link ? parseTelegramMessageLink(link) : null;
  if (!target || !Number.isSafeInteger(target.messageId) || target.messageId <= 0) {
    return reply(env, msg.chat.id,
      '❌ Invalid Telegram message link.\n\nUsage:\n/reply <message_link> <text>\n/reply <text> <message_link>\n/reply <message_link> (anonymously copy the linked message/media).',
      { reply_to_message_id: msg.message_id });
  }

  const text = linkMatch ? (raw.slice(0, linkMatch.index) + raw.slice(linkMatch.index + linkMatch[0].length)).trim() : '';
  const threadData = {
    threadId: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    lastActive: Date.now(),
    users: {},
    nextCount: 1
  };
  const source = text
    ? {}
    : { photo: true, chat: { id: target.chatId }, message_id: target.messageId };

  const result = await sendAnonMessage(
    env, msg.from.id, source, target.chatId, target.messageId, threadData,
    text, target.threadId || null
  );
  if (!result?.ok) {
    return reply(env, msg.chat.id,
      '❌ Could not post anonymously. Check that I can access the linked chat and send messages there.',
      { reply_to_message_id: msg.message_id });
  }
  return reply(env, msg.chat.id,
    '✅ Your anonymous reply was posted. A 💬 Reply button is attached so others can reply anonymously too.',
    { reply_to_message_id: msg.message_id });
}

const PIKO_COMMANDS=new Set(['reply','sethug','setwave','sethighfive','setcheer','setkick','setpunch','setslap','credits','wallet','daily','work','crime','rob','pay','img','ship','roll','hug','slap','punch','kick','wave','highfive','cheer','welcome','setwelcome','delwelcome','save','stop','filters','ban','unban','whisper','search','music','play','song','video','admin','stats','addcredits','addcoins','gban','ungban']);
export async function handlePikoDM(msg,env,cmd){
  await ensureSchema(env);
  if(await handleFunMediaSetup(env,msg,cmd))return true;
  if(cmd&&cmd.name.startsWith('set')&&FUN_MEDIA_COMMANDS.includes(cmd.name.slice(3)))return setFunMedia(env,msg,cmd);
  if(await banned(env,msg.from.id))return true;
  if(cmd&&PIKO_COMMANDS.has(cmd.name)){
    await profile(env,msg.from);
    if(cmd.name==='reply'){await replyByMessageLink(env,msg,cmd);return true;}
    if(cmd.name==='whisper'){await whisperCommand(env,msg,cmd);return true;}
    if(['search','music','play','song','video'].includes(cmd.name)){await musicSearchCommand(env,msg,cmd);return true;}
    if(['credits','wallet','daily','work','crime','rob','pay'].includes(cmd.name)){await economy(env,msg,cmd);return true;}
    if(cmd.name==='img'){await imageCommand(env,msg,cmd);return true;}
    if(['ship','roll','hug','slap','punch','kick','wave','highfive','cheer'].includes(cmd.name)){await funCommand(env,msg,cmd);return true;}
    if(['admin','stats','addcredits','addcoins','gban','ungban'].includes(cmd.name)){await adminCommand(env,msg,cmd);return true;}
  }
  return false;
}

export async function handlePikoVoice(msg,env){
  if(!msg.voice&&!msg.audio)return false;
  await ensureSchema(env);if(await banned(env,msg.from.id))return true;
  await profile(env,msg.from);await voiceCommand(env,msg);return true;
}

export async function handlePikoAI(msg,env){
  if(!msg.text||!['private','group','supergroup'].includes(msg.chat.type)||msg.from?.is_bot)return false;
  await ensureSchema(env);
  if(await banned(env,msg.from.id))return true;
  await profile(env,msg.from);
  const inGroup=msg.chat.type==='group'||msg.chat.type==='supergroup';
  // In groups, make it clear who Piko is answering and attach the answer
  // to the exact message that called Piko. HTML mention works even without username.
  const groupReply=inGroup?{reply_to_message_id:msg.message_id}: {};
  const prefix=inGroup?mention(msg.from)+' ':'';
  try{
    void tg(env,'sendChatAction',{chat_id:msg.chat.id,action:'typing'}).catch(()=>{});
    const answer=await groqChat(env,msg.from.id,msg.text);
    await reply(env,msg.chat.id,prefix+esc(answer),groupReply);
  }catch(e){
    console.error('Piko AI request failed:',e?.message||String(e));
    const fallback = prefix+'Piko AI is temporarily unavailable. Please try again later.';
    await reply(env,msg.chat.id,fallback,groupReply);
  }
  return true;
}

export async function handlePikoGroup(msg,env,cmd){
  await ensureSchema(env);
  if(msg.new_chat_members?.length){
    const r=await q(env,'SELECT welcome_enabled,welcome_text FROM piko_groups WHERE chat_id=?',[String(msg.chat.id)]);
    const setting=r.rows[0]||{welcome_enabled:1,welcome_text:'Welcome {first} to {chatname}! 🎉'};
    if(setting.welcome_enabled)for(const m of msg.new_chat_members){if(m.is_bot)continue;const text=String(setting.welcome_text).replaceAll('{first}',m.first_name||'friend').replaceAll('{username}',m.username?'@'+m.username:m.first_name||'friend').replaceAll('{chatname}',msg.chat.title||'this group');await reply(env,msg.chat.id,esc(text));}
    return false;
  }
  if(cmd&&PIKO_COMMANDS.has(cmd.name)){
    if(['welcome','setwelcome','delwelcome','save','stop','filters','ban','unban'].includes(cmd.name)){
      try {
        await groupTools(env,msg,cmd);
      } catch(error) {
        console.error('Piko group admin command failed:',cmd.name,error?.message||String(error));
        await reply(env,msg.chat.id,'❌ That command failed. Check that I have the required group permissions, then try again.');
      }
      return true;
    }
    // Route every other Piko command through the same tested dispatcher used in DM.
    // This also gives a clear owner-only response instead of silently ignoring admin commands.
    await handlePikoDM(msg,env,cmd);
    return true;
  }
  if(!cmd&&msg.text){
    // Match both Piko's display name and Telegram username, including punctuation.
    // Use the known bot username as a fallback if getMe/cache is temporarily unavailable.
    let botInfo = null;
    try { botInfo = await getBotInfo(env); }
    catch (error) { console.error('Piko getMe lookup failed:', error?.message || String(error)); }
    const username = String(botInfo?.username || 'Piko_Pikobot').replace(/^@/, '').trim().toLowerCase();
    const botName = String(state.BOT_NAME || 'Piko').trim().toLowerCase();
    const text = String(msg.text);
    const lowerText = text.toLowerCase();
    const entities = Array.isArray(msg.entities) ? msg.entities : [];
    const escapedUsername = username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const usernameMention = !!username && (
      new RegExp('(^|[^a-z0-9_])@' + escapedUsername + '($|[^a-z0-9_])', 'i').test(text) ||
      entities.some(entity => entity.type === 'mention' &&
        text.slice(entity.offset, entity.offset + entity.length).toLowerCase() === '@' + username)
    );
    const escapedName = botName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const nameMention = !!botName && new RegExp('(^|[^\\p{L}\\p{N}_])' + escapedName + '($|[^\\p{L}\\p{N}_])', 'iu').test(text);
    const replied = msg.reply_to_message?.from;
    const repliedToPiko = !!(replied?.is_bot && (
      (botInfo?.id && Number(replied.id) === Number(botInfo.id)) ||
      (username && String(replied.username || '').toLowerCase() === username)
    ));
    if(usernameMention || nameMention || repliedToPiko){
      await handlePikoAI({...msg, text: text.trim() || 'Someone called your name. Reply naturally.'}, env);
      return true;
    }
    const chat = String(msg.chat.id);
    const f = await q(env, 'SELECT keyword,response FROM piko_filters WHERE chat_id=? ORDER BY LENGTH(keyword) DESC', [chat]);
    const match = f.rows.find(x => x.keyword && lowerText.includes(x.keyword.toLowerCase()));
    if(match) await reply(env, msg.chat.id, esc(match.response));
  }
  return false;
}

export async function pikoHelpText(){
 return '🤖 <b>Piko features</b>\n\n/reply <link> <text> — reply to a linked Telegram message\n/reply <text> <link> — same format\n/reply <link> — copy a linked message or media\n\n\nAI chat: send a DM\nVoice: send a voice message\n/credits — credits and coins\n/img prompt — generate an image (5 credits)\n/daily, /work, /crime, /rob, /pay\n/ship @username — friendship percentage\n/roll — Telegram rolling die 🎲\n/hug, /wave, /highfive, /cheer (reply or tag a member)\n/slap, /punch, /kick use playful cartoon sticker/GIF packs\nMusic: /search song, /play song, /song song, /video song, /music song (official platform links)\nOwner media setup in DM: /sethug, /setwave, /sethighfive, /setcheer, /setkick, /setpunch, /setslap (send multiple stickers/GIFs, then /cancel)\nGroup tools: /whisper @username message (private DM; recipient must have started Piko), /welcome, /setwelcome, /save, /stop, /filters, /ban, /unban\nOwner: /admin, /stats, /addcredits, /addcoins, /gban, /ungban';
}