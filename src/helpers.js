
// src/helpers.js
import { CFG, state } from './config.js';
import { tg } from './telegram.js';
import { kvGet, kvPut } from './db.js';

export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const genId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
export const userLink = (id, name) => `<a href="tg://user?id=${id}">${esc(name || 'User')}</a>`;

const TOUCH = new Map();
export const shouldTouch = (key, ms = 600000) => {
  const n = Date.now(), t = TOUCH.get(key);
  if (t && n - t < ms) return false;
  TOUCH.set(key, n);
  return true;
};

export function parseCommand(text) {
  const m = (text || '').match(/^\/([a-zA-Z0-9_]+)(?:@(\w+))?(?:\s+([\s\S]*))?$/);
  return m ? { name: m[1].toLowerCase(), bot: m[2] || null, arg: (m[3] || '').trim() } : null;
}

export function b64(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
export function fmtClock(min) {
  let h = Math.floor(min / 60), m = min % 60;
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${String(m).padStart(2, '0')} ${ap}`;
}
export function fmtTime(ts) {
  const d = new Date(ts + CFG.TZ_OFFSET_HOURS * 3600000);
  return `${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${fmtClock(d.getUTCHours() * 60 + d.getUTCMinutes())} ${CFG.TZ_LABEL}`;
}
export function fmtDur(ms) {
  if (ms <= 0) return '0m';
  const m = Math.floor(ms / 60000), h = Math.floor(m / 60);
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  return h ? `${h}h ${m % 60}m` : `${m}m`;
}
export function fmtMin(min) {
  const h = Math.floor(min / 60), m = min % 60;
  return h ? (m ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
}
export function nextOccurrence(announceMin, now) {
  const off = CFG.TZ_OFFSET_HOURS * 3600000;
  const dayStart = Math.floor((now + off) / 86400000) * 86400000;
  let cand = dayStart + announceMin * 60000 - off;
  if (cand <= now) cand += 86400000;
  return cand;
}

let CACHED_BOT_INFO = null;
export async function getBotInfo(env) {
  if (CACHED_BOT_INFO) return CACHED_BOT_INFO;
  const cached = await kvGet(env, 'bot_info', true);
  if (cached) { CACHED_BOT_INFO = cached; return cached; }
  const me = await tg(env, 'getMe');
  if (me.ok) {
    CACHED_BOT_INFO = me.result;
    await kvPut(env, 'bot_info', me.result, 86400);
    return me.result;
  }
  return null;
}

const PFP_CACHE = new Map();
export async function getPfpB64(env, userId) {
  const c = PFP_CACHE.get(userId);
  if (c && Date.now() - c.t < 600000) return c.v;
  try {
    const r = await tg(env, 'getUserProfilePhotos', { user_id: userId, limit: 1 });
    if (!r.ok || !r.result.total_count) return '';
    const fileId = r.result.photos[0][r.result.photos[0].length - 1].file_id;
    const f = await tg(env, 'getFile', { file_id: fileId });
    if (!f.ok) return '';
    const res = await fetch(`https://api.telegram.org/file/bot${state.BOT_TOKEN}/${f.result.file_path}`);
    if (!res.ok) return '';
    const out = b64(await res.arrayBuffer());
    PFP_CACHE.set(userId, { t: Date.now(), v: out });
    return out;
  } catch { return ''; }
}

export async function isAdmin(env, chatId, userId) {
  const { isOwner } = await import('./config.js');
  if (isOwner(userId)) return true;
  const m = await tg(env, 'getChatMember', { chat_id: chatId, user_id: userId });
  return m.ok && ['creator', 'administrator'].includes(m.result.status);
}

export async function listUserGroups(env, userId) {
  const { q } = await import('./db.js');
  const res = await q(env, `SELECT chat_id, title FROM groups LIMIT 100`);
  const checks = res.rows.map(async g => {
    try {
      const m = await tg(env, 'getChatMember', { chat_id: g.chat_id, user_id: userId });
      if (m.ok && ['creator', 'administrator', 'member'].includes(m.result.status))
        return { chatId: g.chat_id, title: g.title };
    } catch {}
    return null;
  });
  return (await Promise.all(checks)).filter(g => g !== null);
}

export async function logToTerminal(env, user, text, action) {
  const { batch } = await import('./db.js');
  try {
    await batch(env, [
      { sql: `INSERT INTO logs (ts, user_id, name, username, text, action) VALUES (?, ?, ?, ?, ?, ?)`,
        args: [Date.now(), user.id, user.first_name || 'Unknown', user.username || 'N/A', text, action] },
      { sql: `DELETE FROM logs WHERE id NOT IN (SELECT id FROM logs ORDER BY id DESC LIMIT 50)`, args: [] }
    ]);
  } catch (e) { console.error('Logging Error:', e); }
}

export async function botIdentity(env) {
  const bi = await getBotInfo(env);
  let pfp = await kvGet(env, 'bot_pfp');
  if (pfp === null) {
    pfp = (await getPfpB64(env, bi.id)) || '';
    await kvPut(env, 'bot_pfp', pfp, 86400 * 7);
  }
  let ownerName = await kvGet(env, 'owner_username');
  if (ownerName === null) {
    const c = await tg(env, 'getChat', { chat_id: state.OWNER_ID });
    ownerName = (c.ok && c.result.username) ? '@' + c.result.username : '';
    await kvPut(env, 'owner_username', ownerName, 86400 * 7);
  }
  return { botUsername: bi.username, pfp, ownerName };
}
