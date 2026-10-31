// src/settings.js
import { CFG } from './config.js';
import { q } from './db.js';
import { editCq } from './cards.js';
import { fmtClock, fmtMin, nextOccurrence, isAdmin } from './helpers.js';

export async function getSettings(env, chatId) {
  const r = await q(env, `SELECT * FROM group_settings WHERE chat_id = ?`, [String(chatId)]);
  const row = r.rows[0] || {};
  return {
    vote_min: row.vote_min ?? Math.round(CFG.DEFAULT_VOTE_HOURS * 60),
    submit_min: row.submit_min ?? Math.round(CFG.DEFAULT_SUBMIT_HOURS * 60),
    announce_min: row.announce_min ?? (Math.round(CFG.DEFAULT_ANNOUNCE_HOUR * 60) % 1440),
    next_announce_ts: row.next_announce_ts ?? null,
    last_contest_id: row.last_contest_id ?? null,
    min_join: row.min_join ?? CFG.MIN_JOIN_DEFAULT,
    remind_min: row.remind_min ?? CFG.REMIND_MIN_DEFAULT
  };
}

export const SET_KINDS = {
  vote: { col: 'vote_min', icon: '🗳', title: 'Voting Period', presets: [180, 360, 720, 1440, 2880, 4320], step: 60, step2: 5, min: 60, max: 4320, fmt: fmtMin },
  sub:  { col: 'submit_min', icon: '⏱', title: 'Submission Time', presets: [360, 720, 1080, 1200, 1440, 2160], step: 60, step2: 5, min: 60, max: 4320, fmt: fmtMin },
  ann:  { col: 'announce_min', icon: '📢', title: 'Announcement Time', presets: [0, 180, 360, 540, 720, 900, 1080, 1260], step: 60, step2: 5, min: 0, max: 1439, wrap: true, fmt: m => `${fmtClock(m)} ${CFG.TZ_LABEL}` },
  minj: { col: 'min_join', icon: '👥', title: 'Minimum Participants', presets: [3, 4, 5, 6, 8, 10], step: 5, step2: 1, min: CFG.MIN_JOIN_FLOOR, max: 50, fmt: n => `${n} members` },
  remind: { col: 'remind_min', icon: '🔔', title: 'Reminder Interval', presets: [15, 30, 60, 120, 180, 360], step: 30, step2: 5, min: 5, max: 720, fmt: fmtMin }
};

export async function settingsView(env, chatId, kind) {
  const st = await getSettings(env, chatId);
  if (kind === 'main') {
    return {
      text: `⚙️ <b>Contest Settings</b>\n\n🗳 Voting: <b>${fmtMin(st.vote_min)}</b>\n📢 Announce: <b>${SET_KINDS.ann.fmt(st.announce_min)}</b>\n⏱ Submit: <b>${fmtMin(st.submit_min)}</b>\n👥 Min participants: <b>${st.min_join}</b>\n🔔 Reminder: <b>${fmtMin(st.remind_min)}</b>\n\n<i>Changes apply from next contest.</i>`,
      markup: {
        inline_keyboard: [
          [{ text: '🗳 Voting', callback_data: `st:vote:${chatId}` }, { text: '📢 Announce', callback_data: `st:ann:${chatId}` }],
          [{ text: '⏱ Submit', callback_data: `st:sub:${chatId}` }, { text: '👥 Min Participants', callback_data: `st:minj:${chatId}` }],
          [{ text: '🔔 Reminder', callback_data: `st:remind:${chatId}` }],
          [{ text: '♻️ Reset All', callback_data: `st:reset:${chatId}` }, { text: '✖️ Close', callback_data: `st:close:${chatId}` }]
        ]
      }
    };
  }

  const k = SET_KINDS[kind];
  const cur = st[k.col];
  const rows = [];
  for (let i = 0; i < k.presets.length; i += 4)
    rows.push(k.presets.slice(i, i + 4).map(p => ({
      text: (p === cur ? '✅ ' : '') + (k.wrap ? fmtClock(p) : k.fmt(p)),
      callback_data: `st:${kind}:${chatId}:v${p}`
    })));
  const s1 = kind === 'minj' ? `${k.step}` : fmtMin(k.step);
  const s2 = kind === 'minj' ? `${k.step2}` : fmtMin(k.step2);
  rows.push([
    { text: `➖${s1}`, callback_data: `st:${kind}:${chatId}:d-${k.step}` },
    { text: `➖${s2}`, callback_data: `st:${kind}:${chatId}:d-${k.step2}` },
    { text: `➕${s2}`, callback_data: `st:${kind}:${chatId}:d${k.step2}` },
    { text: `➕${s1}`, callback_data: `st:${kind}:${chatId}:d${k.step}` }
  ]);
  rows.push([{ text: '🔙 Back', callback_data: `st:main:${chatId}` }]);

  return {
    text: `${k.icon} <b>${k.title}</b>\n\nCurrent: <b>${k.fmt(cur)}</b>\n\n<i>Preset or fine-tune with ➖${s2}/➕${s2}/➖${s1}/➕${s1}.${kind === 'minj' ? ` Min allowed: ${CFG.MIN_JOIN_FLOOR}.` : ''}</i>`,
    markup: { inline_keyboard: rows }
  };
}

export async function syncNextAnnounce(env, chatId, announceMin) {
  await q(env, `UPDATE group_settings SET next_announce_ts = CASE WHEN next_announce_ts = -1 THEN -1 ELSE ? END WHERE chat_id = ?`,
    [nextOccurrence(announceMin, Date.now()), chatId]);
}

export async function handleSettingsCb(env, cq, data) {
  const [, kind, chatId, op] = data.split(':');
  if (!(await isAdmin(env, chatId, cq.from.id)))
    return { toast: '⛔ Admins only.', alert: true };

  if (kind === 'close') {
    await editCq(env, cq, `⚙️ Settings closed.`);
    return;
  }

  let toast;
  if (kind === 'reset') {
    await q(env, `UPDATE group_settings SET vote_min = NULL, submit_min = NULL, announce_min = NULL, min_join = NULL, remind_min = NULL WHERE chat_id = ?`, [chatId]);
    await syncNextAnnounce(env, chatId, Math.round(CFG.DEFAULT_ANNOUNCE_HOUR * 60) % 1440);
    toast = '♻️ Reset to defaults.';
  } else if (op && SET_KINDS[kind]) {
    const k = SET_KINDS[kind];
    const st = await getSettings(env, chatId);
    let val = op[0] === 'v'
      ? Number(op.slice(1))
      : st[k.col] + Number(op.slice(1));
    val = k.wrap
      ? ((val % 1440) + 1440) % 1440
      : Math.max(k.min, Math.min(k.max, val));
    await q(env, `UPDATE group_settings SET ${k.col} = ? WHERE chat_id = ?`, [val, chatId]);
    if (kind === 'ann') await syncNextAnnounce(env, chatId, val);
    toast = '✅ Updated.';
  }

  const v = await settingsView(env, chatId, SET_KINDS[kind] ? kind : 'main');
  await editCq(env, cq, v.text, v.markup);
  return { toast };
}