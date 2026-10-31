// src/config.js
export const state = {
  BOT_TOKEN: '',
  WEBHOOK_SECRET: '',
  TURSO_DB_URL: '',
  TURSO_AUTH_TOKEN: '',
  IMAGE_API_URL: '',
  IMAGE_API_KEY: '',
  OWNER_ID: 8750122483,
  SUPPORT_GROUP: 'https://t.me/+lOxdvQHVCSdhZWU9',
  BOT_NAME: 'AnonX',
  DELDB_PASSWORD: '9861',
  MULTI_ANON: true,
  ANON_SHUFFLE_MODE: false,
  TOPIC_END_IDLE_MINUTES: 10,
};

export const CFG = {
  TZ_OFFSET_HOURS: 5.5, DEFAULT_VOTE_HOURS: 24, DEFAULT_SUBMIT_HOURS: 20,
  DEFAULT_ANNOUNCE_HOUR: 0, START_COINS: 100, REVEAL_COST_SECRET: 50,
  REVEAL_COST_NORMAL: 25, MENTION_LIMIT: 100, MENTION_BATCH: 20,
  POST_BATCH: 40, REMIND_FINAL_HOURS: 1, CLAIM_COINS: 50,
  MIN_JOIN_DEFAULT: 4, MIN_JOIN_FLOOR: 3, REMIND_MIN_DEFAULT: 60,
  LEADERBOARD_TOP: 10, TZ_LABEL: 'IST',
};

export let RANKS = [
  { key: 'god', emoji: '👑', name: 'God Tier', prizes: [5000, 3000, 1500, 300] },
  { key: 'myth', emoji: '🔱', name: 'Mythical', prizes: [3000, 2000, 1000, 200] },
  { key: 'leg', emoji: '🌟', name: 'Legendary', prizes: [2000, 1200, 600, 150] },
  { key: 'epic', emoji: '💜', name: 'Epic', prizes: [1000, 600, 300, 100] },
  { key: 'rare', emoji: '💙', name: 'Rare', prizes: [600, 400, 200, 60] },
  { key: 'unc', emoji: '💚', name: 'Uncommon', prizes: [300, 200, 100, 30] },
  { key: 'com', emoji: '⚪', name: 'Common', prizes: [150, 100, 50, 15] },
];

export const SOURCES = {};
let ENV_APPLIED = false;

const isSet = v => v !== undefined && v !== null &&
  String(v).trim() !== '' && String(v).trim() !== 'SET_IN_ENV';

function pick(env, key, cur, kind) {
  const raw = env ? env[key] : undefined;
  if (isSet(raw)) {
    const val = String(raw).trim();
    if (kind === 'num') {
      const n = Number(val);
      if (Number.isFinite(n)) { SOURCES[key] = 'env'; return n; }
    } else if (kind === 'bool') {
      SOURCES[key] = 'env'; return /^(1|true|yes|on)$/i.test(val);
    } else { SOURCES[key] = 'env'; return val; }
  }
  SOURCES[key] = (typeof cur === 'boolean' || typeof cur === 'number' || isSet(cur))
    ? 'hardcoded' : 'MISSING';
  return cur;
}

export function applyEnv(env) {
  if (ENV_APPLIED || !env) return;
  ENV_APPLIED = true;
  state.BOT_TOKEN = pick(env, 'BOT_TOKEN', state.BOT_TOKEN);
  state.WEBHOOK_SECRET = pick(env, 'WEBHOOK_SECRET', state.WEBHOOK_SECRET);
  state.TURSO_DB_URL = pick(env, 'TURSO_DB_URL', state.TURSO_DB_URL);
  state.TURSO_AUTH_TOKEN = pick(env, 'TURSO_AUTH_TOKEN', state.TURSO_AUTH_TOKEN);
  state.IMAGE_API_URL = pick(env, 'IMAGE_API_URL', state.IMAGE_API_URL);
  state.IMAGE_API_KEY = pick(env, 'IMAGE_API_KEY', state.IMAGE_API_KEY);
  state.OWNER_ID = pick(env, 'OWNER_ID', state.OWNER_ID, 'num');
  state.SUPPORT_GROUP = pick(env, 'SUPPORT_GROUP', state.SUPPORT_GROUP);
  state.BOT_NAME = pick(env, 'BOT_NAME', state.BOT_NAME);
  state.DELDB_PASSWORD = pick(env, 'DELDB_PASSWORD', state.DELDB_PASSWORD);
  state.MULTI_ANON = pick(env, 'MULTI_ANON', state.MULTI_ANON, 'bool');
  state.ANON_SHUFFLE_MODE = pick(env, 'ANON_SHUFFLE_MODE', state.ANON_SHUFFLE_MODE, 'bool');
  state.TOPIC_END_IDLE_MINUTES = pick(env, 'TOPIC_END_IDLE_MINUTES', state.TOPIC_END_IDLE_MINUTES, 'num');
  for (const k of Object.keys(CFG)) CFG[k] = pick(env, k, CFG[k], typeof CFG[k] === 'number' ? 'num' : 'str');
  if (isSet(env.RANKS_JSON)) {
    try {
      const r = JSON.parse(env.RANKS_JSON);
      if (Array.isArray(r) && r.length && r.every(x => x.key && x.name &&
          Array.isArray(x.prizes) && x.prizes.length === 4)) {
        RANKS = r.map(x => ({ emoji: '🏅', ...x }));
        SOURCES.RANKS_JSON = 'env';
      } else SOURCES.RANKS_JSON = 'INVALID';
    } catch { SOURCES.RANKS_JSON = 'INVALID'; }
  } else SOURCES.RANKS_JSON = 'hardcoded';
}

export const rankOf = k => RANKS.find(r => r.key === k) || RANKS[RANKS.length - 1];
export const rankLabel = k => `${rankOf(k).emoji} ${rankOf(k).name}`;
export const isOwner = id => Number(id) === Number(state.OWNER_ID);