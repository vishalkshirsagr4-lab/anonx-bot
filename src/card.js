// src/cards.js
import { state, CFG } from './config.js';
import { tg, tgForm } from './telegram.js';
import { kvGet, kvPut, kvDel } from './db.js';
import { sleep, getPfpB64 } from './helpers.js';

export function imgBase(env) {
  const u = (env && env.IMAGE_API_URL) || state.IMAGE_API_URL;
  return (u || '').replace(/\/(result|card|leaderboard)\/?$/, '').replace(/\/$/, '');
}

export async function fetchImg(env, path, body, timeoutMs = 5000) {
  const base = imgBase(env);
  if (!base) return null;
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    const res = await fetch(base + path, {
      method: 'POST',
      signal: ac.signal,
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': (env && env.IMAGE_API_KEY) || state.IMAGE_API_KEY
      },
      body: JSON.stringify(body)
    });
    clearTimeout(timer);
    return res.ok ? await res.blob() : null;
  } catch (e) {
    console.error('Image API', e);
    return null;
  }
}

const CARD_ICONS = {
  '✅':'check','❌':'cross','⛔':'lock','🚫':'cross','⚠️':'warn','⚠':'warn',
  '⏰':'clock','⌛':'clock','⏳':'clock','🗳':'vote','🏆':'trophy','🎮':'trophy',
  '📢':'megaphone','🔔':'bell','🔕':'bell','👛':'coin','🪙':'coin','💰':'coin',
  '🔓':'lock_open','🔒':'lock','⚙️':'gear','⚙':'gear','📜':'scroll','📚':'book',
  '💬':'chat','🕵️':'spy','🕵':'spy','📤':'send','📋':'list','📝':'list','📄':'list',
  '🎯':'target','🗑':'trash','ℹ️':'info','ℹ':'info','❓':'info','😔':'cross',
  '🎁':'gift','👋':'star'
};

const GENERIC_TITLES = {
  check:'Success',cross:'Error',lock:'Access Denied',warn:'Warning',clock:'Please Wait',
  vote:'Voting',trophy:'Contest',megaphone:'Announcement',bell:'Reminder',coin:'Wallet',
  lock_open:'Unlocked',gear:'Settings',scroll:'Rules',book:'Guide',chat:'Reply',
  spy:'Anonymous',send:'Submission',list:'Details',target:'Participate',trash:'Deleted',
  info:'Information',gift:'Reward',star:'Notification'
};

export function autoCard(text) {
  const plainTxt = text.replace(/<[^>]+>/g, '');
  const first = plainTxt.split('\n').find(l => l.trim()) || '';
  const m = first.match(/^\s*(\p{Extended_Pictographic}\uFE0F?)\s*/u);
  const icon = (m && CARD_ICONS[m[1]]) || 'star';
  return { icon, title: GENERIC_TITLES[icon], cache: true };
}

export const claimSpec = () => ({
  icon: 'coin', badge: 'DAILY CLAIM', title: 'Daily Reward Claimed',
  value: `+${CFG.CLAIM_COINS} COINS`,
  lines: [['Resets', `12:00 AM ${CFG.TZ_LABEL}`]], cache: true
});
export const claimedSpec = () => ({
  icon: 'clock', badge: 'DAILY CLAIM', title: 'Already Claimed',
  lines: [['Next claim', `12:00 AM ${CFG.TZ_LABEL}`]], cache: true
});
export const walletSpec = () => ({
  icon: 'coin', badge: 'WALLET', title: 'Your Wallet',
  lines: [['Daily reward', `${CFG.CLAIM_COINS} coins`], ['Resets', `12:00 AM ${CFG.TZ_LABEL}`]], cache: true
});
export const revealSpec = mode => ({
  icon: mode === 's' ? 'spy' : 'lock_open',
  badge: mode === 's' ? 'SECRET REVEAL' : 'REVEALED',
  title: 'Identity Revealed',
  lines: [['Notified', mode === 's' ? 'No' : 'Yes (warned)']], cache: true
});

export function standardCards() {
  const list = [
    { icon: 'star', title: 'Welcome', subtitle: 'Anonymous Q&A • Daily Contests • Rewards', cache: true },
    { icon: 'book', title: 'Help Center', subtitle: 'Commands, rules and guides', cache: true },
    { icon: 'spy', title: 'Reveal Identity', subtitle: 'Secret reveal or standard reveal', cache: true },
    claimSpec(), claimedSpec(), walletSpec(), revealSpec('s'), revealSpec('n')
  ];
  for (const icon of Object.keys(GENERIC_TITLES))
    list.push({ icon, title: GENERIC_TITLES[icon], cache: true });
  return list;
}

const FID_CACHE = new Map();
const cardKey = s => 'cardfid:' + JSON.stringify([
  s.icon, s.title, s.subtitle || '', s.badge || '', s.value || '', s.lines || ''
]);
export async function getFid(env, key) {
  if (FID_CACHE.has(key)) return FID_CACHE.get(key);
  const v = await kvGet(env, key);
  if (v) FID_CACHE.set(key, v);
  return v;
}
export async function putFid(env, key, fid) {
  FID_CACHE.set(key, fid);
  await kvPut(env, key, fid);
}
export async function dropFid(env, key) {
  FID_CACHE.delete(key);
  await kvDel(env, key);
}

const BAR_FRAMES = ['▰▰▰▰▰▱▱▱▱▱', '▰▰▰▰▰▰▰▱▱▱', '▰▰▰▰▰▰▰▰▰▰'];
const PROGRESS_TEXT = i => `✨ <b>Generating your card…</b>\n\n${BAR_FRAMES[i]}`;

export async function sendCard(env, chatId, spec, caption, rest = {}) {
  const base = { chat_id: chatId, caption, parse_mode: 'HTML', ...rest };
  const key = spec.cache ? (spec.cacheKey || cardKey(spec)) : null;

  if (key) {
    const fid = await getFid(env, key);
    if (fid) {
      const r = await tg(env, 'sendPhoto', { ...base, photo: fid });
      if (r.ok) return r;
      if (!(r.error_code === 400 && /file|wrong/i.test(r.description || ''))) return null;
      await dropFid(env, key);
    }
  }

  const wantProg = spec.progress !== undefined
    ? spec.progress
    : !!(spec.user && (spec.user.pfp_b64 || spec.user.fetch_pfp_id));

  let mid = null, anim = Promise.resolve();
  if (wantProg) {
    const p = await tg(env, 'sendMessage', {
      chat_id: chatId, text: PROGRESS_TEXT(0), parse_mode: 'HTML'
    });
    mid = p.ok ? p.result.message_id : null;
    if (mid) {
      anim = (async () => {
        for (let i = 1; i < BAR_FRAMES.length; i++) {
          await sleep(700);
          await tg(env, 'editMessageText', {
            chat_id: chatId, message_id: mid,
            text: PROGRESS_TEXT(i), parse_mode: 'HTML'
          });
        }
      })();
    }
  }

  const body = { ...spec };
  delete body.progress;
  delete body.cacheKey;
  if (body.user) {
    body.user = { ...body.user };
    if (!body.user.pfp_b64 && body.user.fetch_pfp_id)
      body.user.pfp_b64 = (await getPfpB64(env, body.user.fetch_pfp_id)) || '';
    delete body.user.fetch_pfp_id;
    if (body.user.pfp_b64 && body.adaptive_bg === undefined) body.adaptive_bg = true;
  }

  const blob = await fetchImg(env, '/card', body, 20000);
  await anim;
  if (mid) await tg(env, 'deleteMessage', { chat_id: chatId, message_id: mid });
  if (!blob) return null;

  const r = await tgForm(env, 'sendPhoto', base, 'photo', blob, 'card.png');
  if (!r.ok) return null;
  if (key) {
    const ph = r.result.photo;
    await putFid(env, key, ph[ph.length - 1].file_id);
  }
  return r;
}

export async function warmCards(env) {
  if (!imgBase(env) || !state.OWNER_ID) return;
  const flag = `cards_warm_done:${CFG.CLAIM_COINS}:${CFG.TZ_LABEL}`;
  if (await kvGet(env, flag) || await kvGet(env, 'cards_warm_wait')) return;
  let budget = 4;
  for (const spec of standardCards()) {
    const key = cardKey(spec);
    if (await getFid(env, key)) continue;
    if (budget-- <= 0) return;
    const blob = await fetchImg(env, '/card', spec, 20000);
    const r = blob
      ? await tgForm(env, 'sendPhoto', { chat_id: state.OWNER_ID, disable_notification: true }, 'photo', blob, 'card.png')
      : { ok: false };
    if (!r.ok) { await kvPut(env, 'cards_warm_wait', '1', 600); return; }
    const ph = r.result.photo;
    await putFid(env, key, ph[ph.length - 1].file_id);
    await tg(env, 'deleteMessage', { chat_id: state.OWNER_ID, message_id: r.result.message_id });
  }
  await kvPut(env, flag, '1');
}

export async function send(env, chat_id, text, extra = {}) {
  const { card, plain, ...rest } = extra;
  if (!plain && imgBase(env) && text.length <= 1000) {
    const r = await sendCard(env, chat_id, card || autoCard(text), text, rest);
    if (r) return r;
  }
  return tg(env, 'sendMessage', {
    chat_id, text, parse_mode: 'HTML',
    disable_web_page_preview: true, ...rest
  });
}

export function editCq(env, cq, text, markup) {
  const base = {
    chat_id: cq.message.chat.id, message_id: cq.message.message_id,
    parse_mode: 'HTML', reply_markup: markup || { inline_keyboard: [] }
  };
  if (cq.message.photo)
    return tg(env, 'editMessageCaption', { ...base, caption: text.slice(0, 1024) });
  return tg(env, 'editMessageText', { ...base, text, disable_web_page_preview: true });
}
export const deleteCq = (env, cq) => tg(env, 'deleteMessage', {
  chat_id: cq.message.chat.id, message_id: cq.message.message_id
});
export async function replaceCq(env, cq, text, extra = {}) {
  await deleteCq(env, cq);
  return send(env, cq.message.chat.id, text, extra);
}

export async function welcomeSpec(env, u) {
  return {
    icon: 'star', badge: 'WELCOME',
    title: 'Anonymous Q&A Bot',
    subtitle: `Hey ${u.first_name || 'there'}!`,
    lines: [['Daily reward', `${CFG.CLAIM_COINS} coins`], ['Contests', 'Daily • Rewards']],
    user: { name: u.first_name || 'User', username: u.username || '', fetch_pfp_id: u.id },
    cache: true,
    cacheKey: `cardfid:welcome:${u.id}:${(u.first_name || '').slice(0, 24)}`
  };
}

export async function botProfileSpec(env, id) {
  const spec = {
    icon: 'star', badge: 'BOT PROFILE', title: state.BOT_NAME,
    subtitle: `@${id.botUsername}`,
    lines: [['Owner', id.ownerName || '—'], ['Website', 'Telegram Bot']],
    cache: true, cacheKey: `cardfid:botprofile:${state.BOT_NAME}:${id.ownerName}`
  };
  if (id.pfp) spec.user = { name: state.BOT_NAME, username: id.botUsername, pfp_b64: id.pfp };
  return spec;
}