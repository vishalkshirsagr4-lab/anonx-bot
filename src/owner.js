
// src/owner.js
import { state, rankOf } from './config.js';
import { q, kvGet, kvPut, kvDel } from './db.js';
import { send, editCq } from './cards.js';
import { esc } from './helpers.js';

// ─── Helpers ───

const MAX_IMPORT_SIZE = 1024 * 1024;
const MAX_IMPORT_LINES = 500;

function validImageUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:';
  } catch {
    return false;
  }
}

function validPrizes(values) {
  return (
    Array.isArray(values) &&
    values.length === 4 &&
    values.every(value =>
      Number.isSafeInteger(value) && value >= 0
    )
  );
}

function parsePrizeValues(value) {
  if (!value) return null;

  const parts = value.split(',').map(s => s.trim());

  if (parts.length < 3 || parts.length > 4) {
    return null;
  }

  const values = parts.map(Number);

  if (
    values.some(v =>
      !Number.isSafeInteger(v) || v < 0
    )
  ) {
    return null;
  }

  return [
    values[0],
    values[1],
    values[2],
    values[3] ?? 0
  ];
}

// ─── /addcontest ───

export async function addContestStart(env, chatId, userId) {
  await kvPut(
    env,
    `pending_addcontest:${userId}`,
    { step: 'waiting_line' },
    600
  );

  return send(
    env,
    chatId,
    `➕ <b>Add Contest</b>\n\nSend one line in this format:\n\n<code>image_url - Name - x, y, z, s</code>\n\n• <code>x,y,z</code> = 1st/2nd/3rd prizes\n• <code>s</code> = participation reward\n\nOptional 4th field: <code>rank_key</code>\n<code>image_url - Name - x, y, z, s - epic</code>\n\n/cancel to abort.`,
    { plain: true }
  );
}

export async function ownerAddOne(env, chatId, userId, pending, text) {
  const result = await addContestOne(env, text);

  await kvDel(env, `pending_addcontest:${userId}`);

  if (result.data.error) {
    return send(
      env,
      chatId,
      `❌ ${result.data.error}`,
      { plain: true }
    );
  }

  const data = result.data;

  return send(
    env,
    chatId,
    `✅ Contest added!\n\n<b>${esc(data.name)}</b>\n🏆 Rank: ${esc(data.rank_key)}\n🎁 Prizes: ${data.p1}/${data.p2}/${data.p3} + ${data.ps}`,
    { plain: true }
  );
}

export async function addContestOne(env, text) {
  if (typeof text !== 'string') {
    return { data: { error: 'Invalid contest data.' } };
  }

  const parts = text.split(' - ').map(s => s.trim());

  if (parts.length < 2) {
    return {
      data: {
        error: 'Format: image_url - Name - x, y, z, s'
      }
    };
  }

  const image_url = parts[0];
  const name = parts[1];
  const prizePart = parts[2] || '';
  const rankKey = parts[3] || 'com';

  if (!validImageUrl(image_url)) {
    return {
      data: { error: 'Image URL must be a valid HTTPS URL.' }
    };
  }

  if (!name || name.length > 100) {
    return {
      data: { error: 'Contest name must be between 1 and 100 characters.' }
    };
  }

  const rank = rankOf(rankKey);

  if (!rank || !Array.isArray(rank.prizes)) {
    return {
      data: { error: 'Invalid rank key.' }
    };
  }

  let prizes = prizePart
    ? parsePrizeValues(prizePart)
    : null;

  if (prizePart && !prizes) {
    return {
      data: { error: 'Invalid prizes. Use x, y, z, s with non-negative whole numbers.' }
    };
  }

  if (!prizes) {
    prizes = rank.prizes;
  }

  if (!validPrizes(prizes)) {
    return {
      data: { error: 'Invalid default prize configuration for this rank.' }
    };
  }

  await q(
    env,
    `INSERT INTO contests
      (name, image_url, rank_key, p1, p2, p3, ps, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      name,
      image_url,
      rankKey,
      prizes[0],
      prizes[1],
      prizes[2],
      prizes[3],
      Date.now()
    ]
  );

  return {
    data: {
      name,
      image_url,
      rank_key: rankKey,
      p1: prizes[0],
      p2: prizes[1],
      p3: prizes[2],
      ps: prizes[3]
    }
  };
}

// ─── /add bulk ───

export async function bulkAddStart(env, chatId, userId) {
  await kvPut(
    env,
    `pending_bulk:${userId}`,
    '1',
    600
  );

  return send(
    env,
    chatId,
    `📚 <b>Bulk Add</b>\n\nReply to a <b>.txt</b> file with /add to import contests.\n\nOne per line:\n<code>rank - image_url - Name - x, y, z, s</code>\n\nMaximum: 500 entries, 1 MB file.\n\n/cancel to abort.`,
    { plain: true }
  );
}

export async function bulkAddFromFile(env, chatId, userId, fileMsg) {
  const doc = fileMsg?.document;

  if (
    !doc ||
    typeof doc.file_name !== 'string' ||
    !doc.file_name.toLowerCase().endsWith('.txt')
  ) {
    return send(
      env,
      chatId,
      '❌ Please reply to a valid .txt file.',
      { plain: true }
    );
  }

  if (
    !Number.isInteger(doc.file_size) ||
    doc.file_size <= 0 ||
    doc.file_size > MAX_IMPORT_SIZE
  ) {
    return send(
      env,
      chatId,
      '❌ File must be between 1 byte and 1 MB.',
      { plain: true }
    );
  }

  try {
    const { tg } = await import('./telegram.js');

    const fileInfo = await tg(env, 'getFile', {
      file_id: doc.file_id
    });

    if (
      !fileInfo?.ok ||
      typeof fileInfo.result?.file_path !== 'string'
    ) {
      return send(
        env,
        chatId,
        '❌ Could not get the file from Telegram.',
        { plain: true }
      );
    }

    // Download the file.
    const fileUrl =
      `https://api.telegram.org/file/bot${state.BOT_TOKEN}/${fileInfo.result.file_path}`;

    const response = await fetch(fileUrl);

    if (!response.ok) {
      return send(
        env,
        chatId,
        '❌ File download failed. Please try again.',
        { plain: true }
      );
    }

    const txt = await response.text();

    if (
      !txt.trim() ||
      new TextEncoder().encode(txt).byteLength > MAX_IMPORT_SIZE
    ) {
      return send(
        env,
        chatId,
        '❌ File is empty or too large.',
        { plain: true }
      );
    }

    const lines = txt
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean);

    if (lines.length > MAX_IMPORT_LINES) {
      return send(
        env,
        chatId,
        `❌ Maximum ${MAX_IMPORT_LINES} contest entries are allowed per file.`,
        { plain: true }
      );
    }

    let added = 0;
    let failed = 0;

    for (const line of lines) {
      try {
        const parts = line
          .split(' - ')
          .map(part => part.trim());

        if (parts.length < 3) {
          failed++;
          continue;
        }

        const rankKey = parts[0];
        const image_url = parts[1];
        const name = parts[2];

        if (
          !rankKey ||
          !name ||
          name.length > 100 ||
          !validImageUrl(image_url)
        ) {
          failed++;
          continue;
        }

        const rank = rankOf(rankKey);

        if (!rank || !validPrizes(rank.prizes)) {
          failed++;
          continue;
        }

        let prizes = parts[3]
          ? parsePrizeValues(parts[3])
          : rank.prizes;

        if (!validPrizes(prizes)) {
          failed++;
          continue;
        }

        await q(
          env,
          `INSERT INTO contests
            (name, image_url, rank_key, p1, p2, p3, ps, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            name,
            image_url,
            rankKey,
            prizes[0],
            prizes[1],
            prizes[2],
            prizes[3],
            Date.now()
          ]
        );

        added++;
      } catch (error) {
        console.error('Contest import entry failed:', error);
        failed++;
      }
    }

    await kvDel(env, `pending_bulk:${userId}`);

    return send(
      env,
      chatId,
      `📚 <b>Bulk import completed</b>\n\n✅ Added: <b>${added}</b>\n❌ Failed: <b>${failed}</b>`,
      { plain: true }
    );

  } catch (error) {
    console.error('Bulk import error:', error);

    return send(
      env,
      chatId,
      '❌ Import failed due to a server error. Please try again.',
      { plain: true }
    );
  }
}

// ─── /listcontest ───

export async function listContests(env, chatId) {
  const r = await q(
    env,
    `SELECT * FROM contests ORDER BY id DESC LIMIT 50`
  );

  if (!r.rows.length) {
    return send(env, chatId, '📭 No contests.', {
      plain: true
    });
  }

  const lines = r.rows.map(c =>
    `#${c.id} — <b>${esc(c.name)}</b> [${esc(c.rank_key || 'com')}]\n  ${c.p1}/${c.p2}/${c.p3} + ${c.ps}`
  );

  return send(
    env,
    chatId,
    `📚 <b>Contests (${r.rows.length})</b>\n\n${lines.join('\n\n')}`,
    { plain: true }
  );
}

// ─── /delcontest ───

export async function delcontestGroupView(
  env,
  chatId,
  targetChatId,
  replyTo
) {
  const r = await q(
    env,
    `SELECT c.* FROM contest_bag b
     JOIN contests c ON c.id = b.contest_id
     WHERE b.chat_id = ?
     ORDER BY c.id DESC`,
    [String(targetChatId)]
  );

  if (!r.rows.length) {
    return send(
      env,
      chatId,
      '📭 No contests in this group bag.',
      { reply_to_message_id: replyTo }
    );
  }

  return send(
    env,
    chatId,
    '🗑 <b>Delete Contest</b>\n\nSelect:',
    {
      plain: true,
      reply_to_message_id: replyTo,
      reply_markup: {
        inline_keyboard: r.rows.map(c => [{
          text: `❌ #${c.id} ${esc(c.name).slice(0, 40)}`,
          callback_data: `delc_${targetChatId}_${c.id}`
        }])
      }
    }
  );
}

export async function handleDelContestDM(env, chatId, userId, arg) {
  const r = await q(
    env,
    `SELECT * FROM groups LIMIT 100`
  );

  if (!r.rows.length) {
    return send(env, chatId, '📭 No groups yet.');
  }

  return send(
    env,
    chatId,
    '🗑 <b>Select a group:</b>',
    {
      plain: true,
      reply_markup: {
        inline_keyboard: r.rows.map(g => [{
          text: `📢 ${esc(g.title)}`,
          callback_data: `dcg_${g.chat_id}`
        }])
      }
    }
  );
}

export async function delContestFromBag(env, chatId, contestId) {
  await q(
    env,
    `DELETE FROM contest_bag
     WHERE chat_id = ? AND contest_id = ?`,
    [String(chatId), contestId]
  );

  return send(
    env,
    chatId,
    `✅ Contest #${contestId} removed from group bag.`,
    { plain: true }
  );
}

// ─── /deldb ───

export async function startDeldb(env, chatId, userId) {
  await kvPut(env, `deldb:${userId}`, '', 300);

  return send(
    env,
    chatId,
    `🗑 <b>Database Wipe — Danger Zone</b>\n\nYou are about to <b>permanently delete</b> all data.\n\nEnter password to continue:`,
    {
      plain: true,
      reply_markup: deldbKeypadMarkup()
    }
  );
}

export function deldbKeypadMarkup() {
  const kb = [];

  for (let r = 1; r <= 4; r++) {
    kb.push([
      { text: `${r * 3 - 2}`, callback_data: `deldb_d${r * 3 - 2}` },
      { text: `${r * 3 - 1}`, callback_data: `deldb_d${r * 3 - 1}` },
      { text: `${r * 3}`, callback_data: `deldb_d${r * 3}` }
    ]);
  }

  kb.push([
    { text: '0', callback_data: 'deldb_d0' },
    { text: '⌫ Back', callback_data: 'deldb_bs' },
    { text: '✅ Done', callback_data: 'deldb_ok' }
  ]);

  kb.push([
    { text: '✖️ Cancel', callback_data: 'deldb_cancel' }
  ]);

  return { inline_keyboard: kb };
}

export async function handleDeldbDigit(env, cq, digit) {
  const userId = cq.from.id;

  if (!/^\d$/.test(String(digit))) {
    return { toast: '❌ Invalid digit.', alert: true };
  }

  const cur = await kvGet(env, `deldb:${userId}`);

  if (cur === null) {
    return { toast: '❌ Session expired.', alert: true };
  }

  const next = (String(cur) + digit).slice(-20);

  await kvPut(env, `deldb:${userId}`, next, 300);

  await editCq(
    env,
    cq,
    `🗑 Password so far: <code>${'•'.repeat(next.length)}</code>\n\nTap <b>✅ Done</b> when finished.`,
    deldbKeypadMarkup()
  );

  return {};
}

export async function handleDeldbBackspace(env, cq) {
  const userId = cq.from.id;
  const cur = await kvGet(env, `deldb:${userId}`);

  if (cur === null) {
    return { toast: '❌ Session expired.', alert: true };
  }

  const next = String(cur).slice(0, -1);

  await kvPut(env, `deldb:${userId}`, next, 300);

  await editCq(
    env,
    cq,
    `🗑 Password so far: <code>${'•'.repeat(next.length)}</code>\n\nTap <b>✅ Done</b> when finished.`,
    deldbKeypadMarkup()
  );

  return {};
}

export async function handleDeldbConfirm(env, cq) {
  const userId = cq.from.id;

  if (String(userId) !== String(state.OWNER_ID)) {
    return {
      toast: '⛔ Owner only.',
      alert: true
    };
  }

  if (
    typeof state.DELDB_PASSWORD !== 'string' ||
    !/^\d{4,20}$/.test(state.DELDB_PASSWORD)
  ) {
    await kvDel(env, `deldb:${userId}`);

    await editCq(
      env,
      cq,
      '⛔ Database wipe is disabled. Configure a password first.'
    );

    return {};
  }

  const entered = await kvGet(env, `deldb:${userId}`);

  if (entered === null) {
    return {
      toast: '❌ Session expired.',
      alert: true
    };
  }

  if (entered !== state.DELDB_PASSWORD) {
    await kvDel(env, `deldb:${userId}`);

    await editCq(
      env,
      cq,
      '❌ Wrong password. Session ended.'
    );

    return {};
  }

  const { batch } = await import('./db.js');

  const tables = [
    'kv_store',
    'groups',
    'posts',
    'threads',
    'logs',
    'users',
    'reveals',
    'group_members',
    'group_settings',
    'contests',
    'contest_bag',
    'runs',
    'participants',
    'submissions',
    'sub_history',
    'votes',
    'preregs',
    'claims',
    'wins'
  ];

  await batch(
    env,
    tables.map(table => ({
      sql: `DELETE FROM ${table}`,
      args: []
    }))
  );

  await kvDel(env, `deldb:${userId}`);

  await editCq(
    env,
    cq,
    '🗑 Database wiped. All data cleared.'
  );

  return {};
}

export async function handleDeldbCancel(env, cq) {
  const userId = cq.from.id;

  await kvDel(env, `deldb:${userId}`);

  await editCq(env, cq, '✖️ Cancelled.');

  return {};
}

// ─── Owner commands ───

export async function handleOwnerCmd(env, msg, cmd) {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (cmd.name === 'addcontest') {
    if (msg.reply_to_message?.document) {
      return bulkAddFromFile(
        env,
        chatId,
        userId,
        msg.reply_to_message
      );
    }

    return addContestStart(env, chatId, userId);
  }

  if (cmd.name === 'add') {
    if (!msg.reply_to_message?.document) {
      return bulkAddStart(env, chatId, userId);
    }

    return bulkAddFromFile(
      env,
      chatId,
      userId,
      msg.reply_to_message
    );
  }

  if (cmd.name === 'listcontest') {
    return listContests(env, chatId);
  }

  if (cmd.name === 'xcontest') {
    return send(
      env,
      chatId,
      'ℹ️ Use /xcontest in a group.'
    );
  }

  return send(
    env,
    chatId,
    '❓ Unknown owner command.'
  );
}
