// src/cards.js
import { state, CFG } from './config.js';
import { tg, tgForm } from './telegram.js';
import { kvGet, kvPut, kvDel } from './db.js';
import { sleep, getPfpB64, getBotInfo } from './helpers.js';
import { Resvg, initWasm } from '@resvg/resvg-wasm';
import resvgWasm from '@resvg/resvg-wasm/index_bg.wasm';

let resvgReady;
async function ensureResvg() {
  if (!resvgReady) resvgReady = initWasm(resvgWasm);
  return resvgReady;
}

function xmlEscape(value) {
  return String(value ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
}

function wrapStickerQuote(value, maxChars = 27, maxLines = 7) {
  const words = String(value || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const chunks = word.length > maxChars ? (word.match(new RegExp('.{1,' + maxChars + '}', 'gu')) || [word]) : [word];
    for (const chunk of chunks) {
      const next = line ? line + ' ' + chunk : chunk;
      if (next.length > maxChars && line) { lines.push(line); line = chunk; }
      else line = next;
    }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    lines.length = maxLines;
    lines[maxLines - 1] = lines[maxLines - 1].slice(0, maxChars - 1).replace(/[.,;:!?]?$/, '') + '…';
  }
  return lines;
}

function quoteStickerSvg(spec) {
  const user = spec.user || {};
  const name = String(user.name || 'Telegram member').replace(/\s+/g, ' ').trim().slice(0, 25);
  const username = String(user.username || '').replace(/^@/, '').slice(0, 24);
  const quote = String(spec.subtitle || '').replace(/\s+/g, ' ').trim().slice(0, 420);
  const lines = wrapStickerQuote(quote || ' ', 27, 7);
  const fontSize = lines.length > 5 ? 19 : lines.length > 3 ? 21 : 23;
  const lineHeight = fontSize + 9;
  const quoteText = lines.map((line, i) =>
    '<text x="177" y="' + (247 + i * lineHeight) +
    '" font-family="DejaVu Sans,Arial,sans-serif" font-size="' + fontSize +
    '" font-weight="600" fill="#17324d">' + xmlEscape(line) + '</text>'
  ).join('');
  const initials = xmlEscape((name || 'T').trim().charAt(0).toUpperCase());
  const cleanAvatar = String(user.pfp_b64 || '').replace(/[^A-Za-z0-9+/=]/g, '');
  const avatar = cleanAvatar
    ? '<image href="data:image/jpeg;base64,' + cleanAvatar +
      '" x="25" y="169" width="112" height="112" preserveAspectRatio="xMidYMid slice" clip-path="url(#avatarClip)"/>'
    : '<circle cx="81" cy="225" r="56" fill="#dceeff"/><text x="81" y="241" text-anchor="middle" font-family="DejaVu Sans,Arial,sans-serif" font-size="44" font-weight="700" fill="#23618b">' + initials + '</text>';
  const handle = username ? '@' + username : 'Telegram member';
  const bubbleHeight = Math.max(196, 100 + lines.length * lineHeight);
  const footerY = Math.min(455, 271 + bubbleHeight);
  return \`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e9f5ff"/><stop offset="1" stop-color="#c9e6ff"/></linearGradient>
      <linearGradient id="bubble" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#f3f9ff"/></linearGradient>
      <clipPath id="avatarClip"><circle cx="81" cy="225" r="56"/></clipPath>
    </defs>
    <rect width="512" height="512" rx="48" fill="url(#bg)"/>
    <circle cx="468" cy="48" r="105" fill="#ffffff" opacity=".34"/>
    <circle cx="25" cy="490" r="100" fill="#72c7ef" opacity=".20"/>
    <rect x="98" y="55" width="390" height="402" rx="30" fill="#6b9fc3" opacity=".18"/>
    <rect x="91" y="48" width="390" height="402" rx="30" fill="url(#bubble)" stroke="#b9d9ef" stroke-width="2"/>
    <rect x="91" y="48" width="390" height="9" rx="4" fill="#28a8e0"/>
    <circle cx="81" cy="225" r="65" fill="#ffffff" stroke="#ffffff" stroke-width="5"/>
    <circle cx="81" cy="225" r="60" fill="#dceeff" stroke="#2a9ed2" stroke-width="3"/>
    \${avatar}
    <text x="155" y="91" font-family="DejaVu Sans,Arial,sans-serif" font-size="13" font-weight="700" letter-spacing="1.7" fill="#1687b8">TELEGRAM MESSAGE</text>
    <text x="155" y="129" font-family="DejaVu Sans,Arial,sans-serif" font-size="22" font-weight="700" fill="#17324d">\${xmlEscape(name)}</text>
    <text x="155" y="154" font-family="DejaVu Sans,Arial,sans-serif" font-size="14" fill="#66839b">\${xmlEscape(handle)}</text>
    <rect x="119" y="177" width="334" height="\${bubbleHeight}" rx="23" fill="#e7f4ff" stroke="#c5e2f5" stroke-width="1.5"/>
    <path d="M119 201 L102 215 L119 225 Z" fill="#e7f4ff"/>
    <text x="145" y="218" font-family="DejaVu Sans,Arial,sans-serif" font-size="12" font-weight="700" letter-spacing="1.3" fill="#258db8">QUOTED MESSAGE</text>
    \${quoteText}
    <path d="M145 \${footerY - 24} H425" stroke="#c7dfef" stroke-width="1.5"/>
    <text x="145" y="\${footerY}" font-family="DejaVu Sans,Arial,sans-serif" font-size="12" font-weight="600" fill="#7894a8">via Piko</text>
    <text x="426" y="\${footerY}" text-anchor="end" font-family="DejaVu Sans,Arial,sans-serif" font-size="17" font-weight="700" fill="#28a8e0">✓✓</text>
    <rect x="175" y="473" width="162" height="25" rx="12" fill="#168fc2"/>
    <text x="256" y="490" text-anchor="middle" font-family="DejaVu Sans,Arial,sans-serif" font-size="11" font-weight="700" letter-spacing="1.5" fill="#ffffff">PIKO QUOTE</text>
  </svg>\`;
}

function isValidStickerPng(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 100) return false;
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (!signature.every((value, index) => bytes[index] === value)) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return view.getUint32(16, false) === 512 && view.getUint32(20, false) === 512;
}
function stickerPackName(userId, botUsername) {
  const username = String(botUsername || '').replace(/[^a-zA-Z0-9_]/g, '');
  if (!username) throw new Error('Could not identify the bot username for the sticker pack');
  return `pikoq${String(userId).replace(/\D/g, '')}_by_${username}`.slice(0, 64);
}

async function addQuoteToUserPack(env, userId, botUsername, displayName, png) {
  const name = stickerPackName(userId, botUsername);
  const title = (String(displayName || 'Piko user').trim().slice(0, 42) + ' • Piko Quotes').slice(0, 64);
  const stickerSpec = [{ sticker: 'attach://sticker', format: 'static', emoji_list: ['💬'] }];
  const existing = await tg(env, 'getStickerSet', { name });
  if (existing?.ok) {
    const added = await tgForm(env, 'addStickerToSet', {
      user_id: userId, name, sticker: JSON.stringify({ ...stickerSpec[0], sticker: 'attach://file' })
    }, 'file', png, 'piko-quote.png');
    if (!added?.ok) throw new Error(added?.description || 'Could not add the quote to your sticker pack');
    const refreshed = await tg(env, 'getStickerSet', { name });
    const latest = refreshed?.ok ? refreshed.result.stickers?.at(-1) : null;
    if (!latest?.file_id) throw new Error('Sticker was added, but Telegram did not return its sticker file ID');
    return { name, title, fileId: latest.file_id };
  }

  const created = await tgForm(env, 'createNewStickerSet', {
    user_id: userId, name, title, stickers: JSON.stringify(stickerSpec)
  }, 'sticker', png, 'piko-quote.png');
  if (!created?.ok) {
    // Another request may have created this user's pack between the lookup and create.
    const retry = await tgForm(env, 'addStickerToSet', {
      user_id: userId, name, sticker: JSON.stringify({ ...stickerSpec[0], sticker: 'attach://file' })
    }, 'file', png, 'piko-quote.png');
    if (!retry?.ok) throw new Error(created?.description || retry?.description || 'Could not create the user sticker pack');
  }
  const refreshed = await tg(env, 'getStickerSet', { name });
  const latest = refreshed?.ok ? refreshed.result.stickers?.at(-1) : null;
  if (!latest?.file_id) throw new Error('Sticker pack was created, but Telegram did not return its sticker file ID');
  return { name, title, fileId: latest.file_id };
}

export async function sendQuoteSticker(env, chatId, spec, rest = {}, packOwnerId) {
  try {
    const user = { ...(spec.user || {}) };
    if (!user.pfp_b64 && user.fetch_pfp_id) user.pfp_b64 = await getPfpB64(env, user.fetch_pfp_id) || '';
    await ensureResvg();

    let pngBytes;
    try {
      pngBytes = new Resvg(quoteStickerSvg({ ...spec, user }), {
        fitTo: { mode: 'width', value: 512 }, background: '#e1f1ff'
      }).render().asPng();
      if (!isValidStickerPng(pngBytes)) throw new Error('Renderer returned an invalid or empty PNG');
    } catch (avatarError) {
      if (!user.pfp_b64) throw avatarError;
      console.warn('Piko quote avatar render failed; retrying with initials:', avatarError?.message || String(avatarError));
      user.pfp_b64 = '';
      pngBytes = new Resvg(quoteStickerSvg({ ...spec, user }), {
        fitTo: { mode: 'width', value: 512 }, background: '#e1f1ff'
      }).render().asPng();
      if (!isValidStickerPng(pngBytes)) throw new Error('Quote renderer produced an invalid PNG even without the profile photo');
    }

    const png = new Blob([pngBytes], { type: 'image/png' });
    if (png.size > 512 * 1024) throw new Error('Sticker PNG exceeds Telegram 512 KB limit');

    const ownerId = Number(packOwnerId || spec.pack_owner_id);
    if (!Number.isSafeInteger(ownerId) || ownerId <= 0) throw new Error('Could not identify the user who requested this sticker');
    const botInfo = await getBotInfo(env);
    if (!botInfo?.username) throw new Error('Could not identify the bot username');
    const pack = await addQuoteToUserPack(env, ownerId, botInfo.username, user.name, png);

    const sent = await tg(env, 'sendSticker', {
      chat_id: chatId, sticker: pack.fileId, emoji: '💬',
      reply_markup: { inline_keyboard: [[{ text: '📦 Open quote sticker pack', url: 'https://t.me/addstickers/' + pack.name }]] },
      ...rest
    });
    if (!sent?.ok) throw new Error(sent?.description || 'Sticker was saved, but Telegram could not send it');
    return { ...sent, sticker_pack_name: pack.name, sticker_pack_title: pack.title };
  } catch (error) {
    const message = error?.message || String(error);
    console.error('Piko quote sticker generation/pack failed:', message);
    return { ok: false, description: message };
  }
}
export function imgBase(env) {
  const u = (env && env.IMAGE_API_URL) || state.IMAGE_API_URL;
  return (u || '').replace(/\/(result|card|leaderboard)\/?$/, '').replace(/\/$/, '');
}

function decodeBase64Image(value) {
  try {
    const binary = atob(String(value || ''));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: 'image/jpeg' });
  } catch {
    return null;
  }
}

function quoteFallbackCaption(spec) {
  const escHtml = value => String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const user = spec.user || {};
  const quote = String(spec.subtitle || '').trim();
  const name = String(user.name || 'Telegram member').trim();
  const username = String(user.username || '').trim();
  const lines = ['🖼️ <b>Piko Quote</b>', '', '“' + escHtml(quote).slice(0, 650) + '”', '', '— <b>' + escHtml(name).slice(0, 80) + '</b>'];
  if (username) lines.push(escHtml(username.startsWith('@') ? username : '@' + username).slice(0, 64));
  return lines.join('\n').slice(0, 1024);
}

async function makeWorkersAiFallback(env, spec) {
  if (!env?.AI || typeof env.AI.run !== 'function') return null;
  try {
    const result = await env.AI.run('@cf/black-forest-labs/flux-1-schnell', {
      prompt: 'Create a polished square abstract editorial background for a social media quote card. Deep midnight navy and violet gradient, subtle luminous accents, elegant soft texture, generous clean negative space in the center, no words, no letters, no logos, no watermark.',
      width: 1024,
      height: 1024,
      num_steps: 4
    });
    const image = result?.image || result;
    if (typeof image === 'string') return decodeBase64Image(image);
    if (image instanceof Uint8Array || image instanceof ArrayBuffer) {
      return new Blob([image], { type: 'image/png' });
    }
    if (image && typeof image.arrayBuffer === 'function') {
      return new Blob([await image.arrayBuffer()], { type: 'image/png' });
    }
  } catch (error) {
    console.error('Workers AI quote background failed:', error?.message || String(error));
  }
  return null;
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

  // Keep quote creation usable even when the optional external card renderer
  // is not configured. Prefer the user's real Telegram avatar; otherwise use
  // the already-bound Cloudflare Workers AI image model for a clean backdrop.
  if (!blob && body.user?.pfp_b64) {
    const avatar = decodeBase64Image(body.user.pfp_b64);
    if (avatar) {
      const fallback = await tgForm(env, 'sendPhoto', {
        ...base,
        caption: quoteFallbackCaption(body),
        parse_mode: 'HTML'
      }, 'photo', avatar, 'piko-quote.jpg');
      if (fallback.ok) return fallback;
      console.error('Piko quote avatar fallback failed:', fallback.description || 'sendPhoto failed');
    }
  }

  if (!blob) {
    const generated = await makeWorkersAiFallback(env, body);
    if (generated) {
      const fallback = await tgForm(env, 'sendPhoto', {
        ...base,
        caption: quoteFallbackCaption(body),
        parse_mode: 'HTML'
      }, 'photo', generated, 'piko-quote.png');
      if (fallback.ok) return fallback;
      console.error('Piko Workers AI quote fallback failed:', fallback.description || 'sendPhoto failed');
    }
  }

  // Last-resort text quote: never fail silently when image generation is
  // unavailable, and do not consume credits for this fallback.
  if (!blob) {
    const fallback = await tg(env, 'sendMessage', {
      chat_id: chatId,
      text: quoteFallbackCaption(body),
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      ...rest
    });
    return fallback?.ok ? fallback : null;
  }

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
