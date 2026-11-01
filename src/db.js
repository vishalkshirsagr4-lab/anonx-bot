
import { state, CFG } from './config.js';

let DB_INITIALIZED = false;
let DB_INIT_PROMISE = null;

// ─── Turso configuration ───
function getConfig(env) {
  let url = (env && env.TURSO_DB_URL) || state.TURSO_DB_URL;
  const token =
    (env && env.TURSO_AUTH_TOKEN) || state.TURSO_AUTH_TOKEN;

  if (typeof url !== 'string' || !url.trim()) {
    throw new Error('Missing TURSO_DB_URL configuration.');
  }

  if (typeof token !== 'string' || !token.trim()) {
    throw new Error('Missing TURSO_AUTH_TOKEN configuration.');
  }

  url = url.trim()
    .replace(/^libsql:\/\//i, 'https://')
    .replace(/\/$/, '');

  if (!/^https:\/\//i.test(url)) {
    throw new Error(
      'TURSO_DB_URL must use https:// or libsql://.'
    );
  }

  return {
    url,
    token: token.trim()
  };
}

// ─── SQL argument formatting ───
function fmtArgs(args = []) {
  return args.map(a => {
    if (a === null || a === undefined) {
      return { type: 'null' };
    }

    if (typeof a === 'boolean') {
      return {
        type: 'integer',
        value: a ? '1' : '0'
      };
    }

    if (typeof a === 'number') {
      if (!Number.isFinite(a)) {
        throw new Error(
          'SQL arguments cannot contain NaN or Infinity.'
        );
      }

      return Number.isInteger(a)
        ? {
            type: 'integer',
            value: String(a)
          }
        : {
            type: 'float',
            value: a
          };
    }

    return {
      type: 'text',
      value: String(a)
    };
  });
}

// ─── Parse Turso response ───
function parseResult(r) {
  if (!r || r.type === 'error') {
    throw new Error(
      `Turso: ${JSON.stringify(r && r.error)}`
    );
  }

  const er = r.response?.result;

  if (!er) {
    throw new Error('Invalid response received from Turso.');
  }

  const cols = (er.cols || []).map(c => c.name);

  const rows = (er.rows || []).map(row => {
    const obj = {};

    row.forEach((cell, i) => {
      if (cell.type === 'null') {
        obj[cols[i]] = null;
      } else if (
        cell.type === 'integer' ||
        cell.type === 'float'
      ) {
        obj[cols[i]] = Number(cell.value);
      } else {
        obj[cols[i]] = cell.value;
      }
    });

    return obj;
  });

  return {
    rows,
    rowsAffected: er.affected_row_count ?? 0,
    lastId: er.last_insert_rowid == null
      ? null
      : Number(er.last_insert_rowid)
  };
}

// ─── Turso HTTP pipeline ───
async function pipeline(env, stmts) {
  if (!Array.isArray(stmts) || stmts.length === 0) {
    return [];
  }

  // Turso is required. Do not silently use an empty local database.
  const { url, token } = getConfig(env);

  const requests = stmts.map(s => ({
    type: 'execute',
    stmt: {
      sql: s.sql,
      args: fmtArgs(s.args || [])
    }
  }));

  requests.push({ type: 'close' });

  const res = await fetch(`${url}/v2/pipeline`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ requests })
  });

  if (!res.ok) {
    const errorText = await res.text();

    throw new Error(
      `Turso HTTP ${res.status}: ${errorText}`
    );
  }

  const data = await res.json();

  if (!Array.isArray(data.results)) {
    throw new Error('Invalid Turso pipeline response.');
  }

  if (data.results.length < stmts.length) {
    throw new Error('Incomplete response from Turso.');
  }

  return data.results
    .slice(0, stmts.length)
    .map(parseResult);
}

// ─── Public query functions ───
export const q = async (env, sql, args = []) => {
  return (await pipeline(env, [{ sql, args }]))[0];
};

export const batch = async (env, stmts) => {
  return stmts.length
    ? pipeline(env, stmts)
    : [];
};

// ─── Database schema ───
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS kv_store (
    key TEXT PRIMARY KEY,
    value TEXT,
    expires_at INTEGER
  )`,

  `CREATE TABLE IF NOT EXISTS groups (
    chat_id TEXT PRIMARY KEY,
    title TEXT,
    updated_at INTEGER
  )`,

  `CREATE TABLE IF NOT EXISTS posts (
    post_id TEXT PRIMARY KEY,
    owner_id INTEGER,
    msg_id INTEGER,
    chat_id TEXT,
    thread_id TEXT,
    created_at INTEGER
  )`,

  `CREATE TABLE IF NOT EXISTS threads (
    thread_id TEXT PRIMARY KEY,
    last_active INTEGER,
    users_json TEXT,
    next_count INTEGER
  )`,

  `CREATE TABLE IF NOT EXISTS logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER,
    user_id INTEGER,
    name TEXT,
    username TEXT,
    text TEXT,
    action TEXT
  )`,

  `CREATE TABLE IF NOT EXISTS users (
    user_id INTEGER PRIMARY KEY,
    first_name TEXT,
    username TEXT,
    coins INTEGER DEFAULT 0,
    dm_open INTEGER DEFAULT 0,
    created_at INTEGER,
    updated_at INTEGER
  )`,

  `CREATE TABLE IF NOT EXISTS reveals (
    user_id INTEGER,
    post_id TEXT,
    mode TEXT,
    ts INTEGER,
    PRIMARY KEY (user_id, post_id)
  )`,

  `CREATE TABLE IF NOT EXISTS group_members (
    chat_id TEXT,
    user_id INTEGER,
    first_name TEXT,
    last_seen INTEGER,
    PRIMARY KEY (chat_id, user_id)
  )`,

  `CREATE TABLE IF NOT EXISTS group_settings (
    chat_id TEXT PRIMARY KEY,
    vote_min INTEGER,
    submit_min INTEGER,
    announce_min INTEGER,
    next_announce_ts INTEGER,
    last_contest_id INTEGER,
    min_join INTEGER,
    remind_min INTEGER,
    remind_last_ts INTEGER
  )`,

  `CREATE TABLE IF NOT EXISTS contests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    image_url TEXT,
    rank_key TEXT,
    mode TEXT DEFAULT 'image',
    submission_type TEXT DEFAULT 'image',
    submit_hours INTEGER DEFAULT 20,
    p1 INTEGER,
    p2 INTEGER,
    p3 INTEGER,
    ps INTEGER,
    created_at INTEGER
  )`,

  `CREATE TABLE IF NOT EXISTS contest_bag (
    chat_id TEXT,
    contest_id INTEGER,
    PRIMARY KEY (chat_id, contest_id)
  )`,

  `CREATE TABLE IF NOT EXISTS runs (
    run_id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id TEXT,
    contest_id INTEGER,
    name TEXT,
    rank_key TEXT,
    image_url TEXT,
    p1 INTEGER,
    p2 INTEGER,
    p3 INTEGER,
    ps INTEGER,
    status TEXT,
    mode TEXT DEFAULT 'image',
    submission_type TEXT DEFAULT 'image',
    submit_hours INTEGER DEFAULT 20,
    start_ts INTEGER,
    end_ts INTEGER,
    vote_min INTEGER,
    vote_end_ts INTEGER,
    rem_stage INTEGER DEFAULT 0,
    announce_msg_id INTEGER,
    min_join INTEGER,
    remind_last_ts INTEGER,
    created_at INTEGER
  )`,

  `CREATE TABLE IF NOT EXISTS participants (
    run_id INTEGER,
    user_id INTEGER,
    joined_at INTEGER,
    PRIMARY KEY (run_id, user_id)
  )`,

  `CREATE TABLE IF NOT EXISTS submissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id INTEGER,
    user_id INTEGER,
    content_json TEXT,
    first_ts INTEGER,
    last_ts INTEGER,
    edits INTEGER DEFAULT 0,
    post_msg_id INTEGER,
    number INTEGER,
    votes INTEGER DEFAULT 0,
    UNIQUE (run_id, user_id)
  )`,

  `CREATE TABLE IF NOT EXISTS sub_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id INTEGER,
    user_id INTEGER,
    ts INTEGER,
    content_json TEXT
  )`,

  `CREATE TABLE IF NOT EXISTS votes (
    sub_id INTEGER,
    voter_id INTEGER,
    ts INTEGER,
    PRIMARY KEY (sub_id, voter_id)
  )`,

  `CREATE TABLE IF NOT EXISTS preregs (
    chat_id TEXT,
    user_id INTEGER,
    ts INTEGER,
    PRIMARY KEY (chat_id, user_id)
  )`,

  `CREATE TABLE IF NOT EXISTS claims (
    user_id INTEGER PRIMARY KEY,
    last_day INTEGER,
    total INTEGER DEFAULT 0
  )`,

  `CREATE TABLE IF NOT EXISTS wins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    run_id INTEGER,
    chat_id TEXT,
    place INTEGER,
    prize INTEGER,
    ts INTEGER
  )`,

  `CREATE TABLE IF NOT EXISTS run_rewards (
    run_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    reward_type TEXT NOT NULL,
    amount INTEGER NOT NULL DEFAULT 0,
    chat_id TEXT,
    place INTEGER,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (run_id, user_id, reward_type)
  )`,

  `CREATE TRIGGER IF NOT EXISTS trg_run_rewards_credit
   AFTER INSERT ON run_rewards
   BEGIN
     INSERT INTO users
       (user_id, first_name, coins, created_at, updated_at)
     VALUES
       (NEW.user_id, '', NEW.amount, NEW.created_at, NEW.created_at)
     ON CONFLICT(user_id) DO UPDATE SET
       coins = users.coins + NEW.amount,
       updated_at = NEW.created_at;

     INSERT INTO wins
       (user_id, run_id, chat_id, place, prize, ts)
     SELECT
       NEW.user_id,
       NEW.run_id,
       NEW.chat_id,
       NEW.place,
       NEW.amount,
       NEW.created_at
     WHERE NEW.reward_type = 'winner';
   END`
];

// ─── Database initialization ───
export async function initDB(env) {
  if (DB_INITIALIZED) return;

  if (DB_INIT_PROMISE) {
    return DB_INIT_PROMISE;
  }

  DB_INIT_PROMISE = (async () => {
    await batch(
      env,
      SCHEMA.map(sql => ({ sql }))
    );

    const migrations = [
      ['group_settings', 'min_join', 'INTEGER'],
      ['group_settings', 'remind_min', 'INTEGER'],
      ['group_settings', 'remind_last_ts', 'INTEGER'],
      ['runs', 'min_join', 'INTEGER'],
      ['runs', 'remind_last_ts', 'INTEGER'],
      ['contests', 'mode', "TEXT DEFAULT 'image'"],
      ['runs', 'mode', "TEXT DEFAULT 'image'"],
      ['contests', 'submission_type', "TEXT DEFAULT 'image'"],
      ['contests', 'submit_hours', 'INTEGER DEFAULT 20'],
      ['runs', 'submission_type', "TEXT DEFAULT 'image'"],
      ['runs', 'submit_hours', 'INTEGER DEFAULT 20'],
      ['votes', 'run_id', 'INTEGER']
    ];

    for (const [table, column, type] of migrations) {
      const info = await q(
        env,
        `PRAGMA table_info(${table})`
      );

      const exists = info.rows.some(
        row => row.name === column
      );

      if (!exists) {
        await q(
          env,
          `ALTER TABLE ${table} ADD COLUMN ${column} ${type}`
        );
      }
    }

    // Enforce one vote per member per contest, including votes from older versions.
    await q(env,
      `UPDATE votes
       SET run_id = (SELECT run_id FROM submissions WHERE submissions.id = votes.sub_id)
       WHERE run_id IS NULL`);

    // Preserve the earliest vote if older versions recorded multiple votes in one contest.
    await q(env,
      `DELETE FROM votes
       WHERE rowid NOT IN (
         SELECT MIN(rowid) FROM votes
         WHERE run_id IS NOT NULL
         GROUP BY run_id, voter_id
       ) AND run_id IS NOT NULL`);

    await q(env,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_votes_one_per_run
       ON votes(run_id, voter_id)`);

    await q(env,
      `UPDATE submissions
       SET votes = (SELECT COUNT(*) FROM votes WHERE votes.sub_id = submissions.id)`);

    DB_INITIALIZED = true;
  })().catch(error => {
    DB_INIT_PROMISE = null;
    throw error;
  });

  return DB_INIT_PROMISE;
}

// ─── Key-value storage ───
export async function kvGet(env, key, asJson = false) {
  const res = await q(
    env,
    `SELECT value, expires_at FROM kv_store WHERE key = ?`,
    [key]
  );

  if (!res.rows.length) {
    return null;
  }

  const row = res.rows[0];

  if (
    row.expires_at &&
    Date.now() > row.expires_at
  ) {
    await q(
      env,
      `DELETE FROM kv_store WHERE key = ?`,
      [key]
    );

    return null;
  }

  if (
    asJson ||
    (
      typeof row.value === 'string' &&
      (
        row.value.startsWith('{') ||
        row.value.startsWith('[')
      )
    )
  ) {
    try {
      return JSON.parse(row.value);
    } catch {
      return row.value;
    }
  }

  return row.value;
}

export async function kvPut(
  env,
  key,
  value,
  ttlSeconds = null
) {
  const valStr =
    typeof value === 'string'
      ? value
      : JSON.stringify(value);

  const expiresAt = ttlSeconds
    ? Date.now() + ttlSeconds * 1000
    : null;

  await q(
    env,
    `INSERT INTO kv_store (key, value, expires_at)
     VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET
       value = excluded.value,
       expires_at = excluded.expires_at`,
    [key, valStr, expiresAt]
  );
}

export async function kvDel(env, key) {
  await q(
    env,
    `DELETE FROM kv_store WHERE key = ?`,
    [key]
  );
}

// ─── User functions ───
export async function touchUser(env, from, dmOpen = false) {
  const now = Date.now();

  await q(
    env,
    `INSERT INTO users
      (user_id, first_name, username, coins, dm_open, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       first_name = excluded.first_name,
       username = excluded.username,
       updated_at = excluded.updated_at,
       dm_open = CASE
         WHEN excluded.dm_open = 1 THEN 1
         ELSE users.dm_open
       END`,
    [
      from.id,
      from.first_name || '',
      from.username || null,
      CFG.START_COINS,
      dmOpen ? 1 : 0,
      now,
      now
    ]
  );
}

export async function getUser(env, id) {
  const r = await q(
    env,
    `SELECT * FROM users WHERE user_id = ?`,
    [id]
  );

  return r.rows[0] || null;
}

export async function getCoins(env, id) {
  const u = await getUser(env, id);
  return u ? u.coins : 0;
}

export async function addCoins(env, id, n) {
  if (!n) return;

  const now = Date.now();

  await q(
    env,
    `INSERT INTO users
      (user_id, first_name, coins, created_at, updated_at)
     VALUES (?, '', ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       coins = coins + excluded.coins`,
    [id, n, now, now]
  );
}

export async function spendCoins(env, id, n) {
  if (!n) return true;

  const r = await q(
    env,
    `UPDATE users
     SET coins = coins - ?
     WHERE user_id = ? AND coins >= ?`,
    [n, id, n]
  );

  return r.rowsAffected > 0;
}

// ─── Group functions ───
export async function upsertGroup(env, chat) {
  await batch(env, [
    {
      sql: `INSERT INTO groups
        (chat_id, title, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(chat_id) DO UPDATE SET
          title = excluded.title,
          updated_at = excluded.updated_at`,
      args: [
        String(chat.id),
        chat.title || 'Group',
        Date.now()
      ]
    },
    {
      sql: `INSERT OR IGNORE INTO group_settings (chat_id)
            VALUES (?)`,
      args: [String(chat.id)]
    }
  ]);
}
