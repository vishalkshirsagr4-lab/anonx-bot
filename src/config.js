
// src/config.js

export const state = {
  BOT_TOKEN: '',
  WEBHOOK_SECRET: '',
  ADMIN_SECRET: '',

  TURSO_DB_URL: '',
  TURSO_AUTH_TOKEN: '',

  IMAGE_API_URL: '',
  IMAGE_API_KEY: '',

  OWNER_ID: 0,
  OWNER_IDS: [],
  SUPPORT_GROUP: 'https://t.me/+lOxdvQHVCSdhZWU9',
  BOT_NAME: 'Piko',

  DELDB_PASSWORD: '',

  MULTI_ANON: true,
  ANON_SHUFFLE_MODE: false,
  TOPIC_END_IDLE_MINUTES: 10,
};

export const CFG = {
  TZ_OFFSET_HOURS: 5.5,
  DEFAULT_VOTE_HOURS: 24,
  DEFAULT_SUBMIT_HOURS: 20,
  DEFAULT_ANNOUNCE_HOUR: 0,

  START_COINS: 100,
  REVEAL_COST_SECRET: 50,
  REVEAL_COST_NORMAL: 25,

  MENTION_LIMIT: 100,
  MENTION_BATCH: 20,
  POST_BATCH: 40,

  REMIND_FINAL_HOURS: 1,
  CLAIM_COINS: 50,

  MIN_JOIN_DEFAULT: 4,
  MIN_JOIN_FLOOR: 3,
  REMIND_MIN_DEFAULT: 60,

  LEADERBOARD_TOP: 10,
  TZ_LABEL: 'IST',
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

const isSet = value =>
  value !== undefined &&
  value !== null &&
  String(value).trim() !== '' &&
  String(value).trim() !== 'SET_IN_ENV';

function pick(env, key, currentValue, kind = 'str') {
  const raw = env?.[key];

  if (isSet(raw)) {
    const value = String(raw).trim();

    if (kind === 'num') {
      const number = Number(value);

      if (Number.isFinite(number)) {
        SOURCES[key] = 'env';
        return number;
      }

      SOURCES[key] = 'INVALID';
      return currentValue;
    }

    if (kind === 'bool') {
      if (/^(1|true|yes|on)$/i.test(value)) {
        SOURCES[key] = 'env';
        return true;
      }

      if (/^(0|false|no|off)$/i.test(value)) {
        SOURCES[key] = 'env';
        return false;
      }

      SOURCES[key] = 'INVALID';
      return currentValue;
    }

    SOURCES[key] = 'env';
    return value;
  }

  SOURCES[key] =
    typeof currentValue === 'boolean' ||
    typeof currentValue === 'number' ||
    isSet(currentValue)
      ? 'hardcoded'
      : 'MISSING';

  return currentValue;
}

function validRank(rank) {
  return (
    rank &&
    typeof rank === 'object' &&
    typeof rank.key === 'string' &&
    /^[a-z0-9_-]{1,30}$/i.test(rank.key) &&
    typeof rank.name === 'string' &&
    rank.name.trim().length > 0 &&
    rank.name.length <= 50 &&
    Array.isArray(rank.prizes) &&
    rank.prizes.length === 4 &&
    rank.prizes.every(
      prize =>
        Number.isSafeInteger(prize) &&
        prize >= 0
    ) &&
    (rank.emoji === undefined ||
      (typeof rank.emoji === 'string' && rank.emoji.length <= 12))
  );
}

function loadRanks(env) {
  if (!isSet(env?.RANKS_JSON)) {
    SOURCES.RANKS_JSON = 'hardcoded';
    return;
  }

  try {
    const parsed = JSON.parse(env.RANKS_JSON);

    const valid =
      Array.isArray(parsed) &&
      parsed.length >= 1 &&
      parsed.length <= 20 &&
      parsed.every(validRank) &&
      new Set(parsed.map(rank => rank.key)).size === parsed.length;

    if (!valid) {
      SOURCES.RANKS_JSON = 'INVALID';
      return;
    }

    RANKS = parsed.map(rank => ({
      emoji: '🏅',
      ...rank,
    }));

    SOURCES.RANKS_JSON = 'env';
  } catch {
    SOURCES.RANKS_JSON = 'INVALID';
  }
}

export function applyEnv(env) {
  if (ENV_APPLIED || !env) return;

  ENV_APPLIED = true;

  state.BOT_TOKEN = pick(env, 'BOT_TOKEN', state.BOT_TOKEN);
  state.WEBHOOK_SECRET = pick(env, 'WEBHOOK_SECRET', state.WEBHOOK_SECRET);
  state.ADMIN_SECRET = pick(env, 'ADMIN_SECRET', state.ADMIN_SECRET);

  state.TURSO_DB_URL = pick(env, 'TURSO_DB_URL', state.TURSO_DB_URL);
  state.TURSO_AUTH_TOKEN = pick(env, 'TURSO_AUTH_TOKEN', state.TURSO_AUTH_TOKEN);

  state.IMAGE_API_URL = pick(env, 'IMAGE_API_URL', state.IMAGE_API_URL);
  state.IMAGE_API_KEY = pick(env, 'IMAGE_API_KEY', state.IMAGE_API_KEY);

  state.OWNER_ID = pick(env, 'OWNER_ID', state.OWNER_ID, 'num');

  const ownerIdsRaw = pick(env, 'OWNER_IDS', '', 'str');
  const parsedOwnerIds = String(ownerIdsRaw || '')
    .split(',')
    .map(value => value.trim())
    .filter(value => /^\d+$/.test(value))
    .map(Number)
    .filter(value => Number.isSafeInteger(value) && value > 0);
  state.OWNER_IDS = [...new Set([Number(state.OWNER_ID), ...parsedOwnerIds])].filter(id => Number.isSafeInteger(id) && id > 0);

  state.SUPPORT_GROUP = pick(env, 'SUPPORT_GROUP', state.SUPPORT_GROUP);
  state.BOT_NAME = pick(env, 'BOT_NAME', state.BOT_NAME);

  state.DELDB_PASSWORD = pick(env, 'DELDB_PASSWORD', state.DELDB_PASSWORD);

  state.MULTI_ANON = pick(env, 'MULTI_ANON', state.MULTI_ANON, 'bool');
  state.ANON_SHUFFLE_MODE = pick(
    env,
    'ANON_SHUFFLE_MODE',
    state.ANON_SHUFFLE_MODE,
    'bool'
  );

  state.TOPIC_END_IDLE_MINUTES = pick(
    env,
    'TOPIC_END_IDLE_MINUTES',
    state.TOPIC_END_IDLE_MINUTES,
    'num'
  );

  for (const key of Object.keys(CFG)) {
    CFG[key] = pick(
      env,
      key,
      CFG[key],
      typeof CFG[key] === 'number' ? 'num' : 'str'
    );
  }

  loadRanks(env);
}

// Returns null for an unknown rank instead of silently treating it as Common.
export const rankOf = key =>
  RANKS.find(rank => rank.key === key) || null;

export const rankLabel = key => {
  const rank = rankOf(key);
  return rank ? `${rank.emoji} ${rank.name}` : 'Unknown Rank';
};

export const isOwner = id => {
  const userId = Number(id);
  return Number.isSafeInteger(userId) &&
    userId > 0 &&
    state.OWNER_IDS.includes(userId);
};
