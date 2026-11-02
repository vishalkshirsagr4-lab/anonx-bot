
// src/owner.js
import { state, rankOf, isOwner } from './config.js';
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
    {
      step: 'step_image',
      file_id: null,
      name: '',
      submission_type: 'image',
      submit_hours: 24,
      p1: 0,
      p2: 0,
      p3: 0,
      ps: 0
    },
    600
  );

  return send(
    env,
    chatId,
    `➕ <b>Create New Contest</b>\n\n` +
    `Step 1/7 — Upload the contest image.\n\n` +
    `Please upload a photo from your device gallery.\n\n` +
    `Send /skip if you want to create a contest without an image.\n\n` +
    `Send /cancel to stop.`,
    { plain: true }
  );
}

export async function handleContestWizard(env, msg, userId, pending) {
  const chatId = msg.chat.id;
  const text = (msg.text || '').trim();

  // Any step can be cancelled with /cancel
  if (text.toLowerCase() === '/cancel') {
    await kvDel(env, `pending_addcontest:${userId}`);
    return send(env, chatId, `✅ Contest creation cancelled.`);
  }

  if (!pending) {
    return send(env, chatId, `❌ No active contest creation in progress. Use /addcontest to start.`);
  }

  const step = pending.step || 'step_image';

  // ─── Step 1: Image Upload ───
  if (step === 'step_image') {
    let fileId = null;
    if (text.toLowerCase() === '/skip') {
      fileId = null;
    } else if (msg.photo && Array.isArray(msg.photo) && msg.photo.length > 0) {
      fileId = msg.photo[msg.photo.length - 1].file_id;
    } else {
      return send(
        env,
        chatId,
        `Please upload a photo from your device gallery, or send /skip to continue without an image, or send /cancel to stop.`
      );
    }

    pending.file_id = fileId;
    pending.step = 'step_name';
    await kvPut(env, `pending_addcontest:${userId}`, pending, 600);

    return send(
      env,
      chatId,
      `Step 2/7 — Enter the contest name.`
    );
  }

  // ─── Step 2: Contest Name ───
  if (step === 'step_name') {
    if (!text) {
      return send(
        env,
        chatId,
        `❌ Contest name cannot be empty. Please enter a valid name.`
      );
    }
    if (text.length > 100) {
      return send(
        env,
        chatId,
        `❌ Contest name is too long (maximum 100 characters). Please enter a shorter name.`
      );
    }

    pending.name = text;
    pending.step = 'step_type';
    await kvPut(env, `pending_addcontest:${userId}`, pending, 600);

    return send(
      env,
      chatId,
      `Step 3/7 — Choose the submission type.\n\n` +
      `1. Image — Participants must upload a photo from their device.\n` +
      `2. Text — Participants must submit a written answer.\n` +
      `3. Media — Participants can submit supported Telegram media (photos, stickers, videos, GIFs, voice, audio, documents).`
    );
  }

  // ─── Step 3: Submission Type ───
  if (step === 'step_type') {
    const val = text.toLowerCase();
    let subType = null;
    if (val === '1' || val === 'image' || val === 'photo' || val === 'img') {
      subType = 'image';
    } else if (val === '2' || val === 'text' || val === 'written' || val === 'txt') {
      subType = 'text';
    } else if (val === '3' || val === 'media' || val === 'universal') {
      subType = 'media';
    } else {
      return send(
        env,
        chatId,
        `❌ Please choose a valid submission type:\n` +
        `1. Image — Participants must upload a photo from their device.\n` +
        `2. Text — Participants must submit a written answer.\n` +
        `3. Media — Participants can submit supported Telegram media (photos, stickers, videos, GIFs, voice, audio, documents).`
      );
    }

    pending.submission_type = subType;
    pending.step = 'step_duration';
    await kvPut(env, `pending_addcontest:${userId}`, pending, 600);

    return send(
      env,
      chatId,
      `Step 4/7 — How many hours should participants have to submit their entries?\n\n` +
      `Example: 4, 7, or 10.`
    );
  }

  // ─── Step 4: Submission Duration ───
  if (step === 'step_duration') {
    const hours = Number(text);
    if (!Number.isInteger(hours) || hours <= 0 || hours > 168) {
      return send(
        env,
        chatId,
        `❌ Please enter a positive whole number of hours between 1 and 168 (e.g. 4, 7, 10, 24).`
      );
    }

    pending.submit_hours = hours;
    pending.step = 'step_p1';
    await kvPut(env, `pending_addcontest:${userId}`, pending, 600);

    return send(
      env,
      chatId,
      `Step 5/7 — Enter the 1st prize amount.`
    );
  }

  // ─── Step 5a: 1st Prize ───
  if (step === 'step_p1') {
    const p1 = Number(text);
    if (!Number.isInteger(p1) || p1 < 0) {
      return send(
        env,
        chatId,
        `❌ Please enter a valid non-negative whole number for 1st prize (e.g. 500).`
      );
    }

    pending.p1 = p1;
    pending.step = 'step_p2';
    await kvPut(env, `pending_addcontest:${userId}`, pending, 600);

    return send(
      env,
      chatId,
      `Enter the 2nd prize amount.`
    );
  }

  // ─── Step 5b: 2nd Prize ───
  if (step === 'step_p2') {
    const p2 = Number(text);
    if (!Number.isInteger(p2) || p2 < 0) {
      return send(
        env,
        chatId,
        `❌ Please enter a valid non-negative whole number for 2nd prize (e.g. 300).`
      );
    }

    pending.p2 = p2;
    pending.step = 'step_p3';
    await kvPut(env, `pending_addcontest:${userId}`, pending, 600);

    return send(
      env,
      chatId,
      `Enter the 3rd prize amount.`
    );
  }

  // ─── Step 5c: 3rd Prize ───
  if (step === 'step_p3') {
    const p3 = Number(text);
    if (!Number.isInteger(p3) || p3 < 0) {
      return send(
        env,
        chatId,
        `❌ Please enter a valid non-negative whole number for 3rd prize (e.g. 200).`
      );
    }

    pending.p3 = p3;
    pending.step = 'step_ps';
    await kvPut(env, `pending_addcontest:${userId}`, pending, 600);

    return send(
      env,
      chatId,
      `Enter the participation prize amount.\n\n` +
      `Every participant who successfully submits a valid entry will receive this reward, even if they do not win 1st, 2nd, or 3rd place.`
    );
  }

  // ─── Step 5d: Participation Prize & Step 6 Review Preview ───
  if (step === 'step_ps') {
    const ps = Number(text);
    if (!Number.isInteger(ps) || ps < 0) {
      return send(
        env,
        chatId,
        `❌ Please enter a valid non-negative whole number for participation prize (e.g. 50).`
      );
    }

    pending.ps = ps;
    pending.step = 'step_confirm';
    await kvPut(env, `pending_addcontest:${userId}`, pending, 600);

    const imageStatus = pending.file_id ? 'Uploaded' : 'No image';
    const subTypeLabel =
      pending.submission_type === 'image'
        ? 'Image'
        : pending.submission_type === 'text'
        ? 'Text'
        : 'Media';

    const reviewText =
      `📋 <b>Contest Review</b>\n\n` +
      `🖼 Contest image: ${imageStatus}\n` +
      `🏆 Contest name: ${esc(pending.name)}\n` +
      `📤 Submission type: ${subTypeLabel}\n` +
      `⏱ Submission duration: ${pending.submit_hours} hours\n\n` +
      `🥇 1st Prize: ${pending.p1}\n` +
      `🥈 2nd Prize: ${pending.p2}\n` +
      `🥉 3rd Prize: ${pending.p3}\n` +
      `🎁 Participation Prize: ${pending.ps}\n\n` +
      `Every valid participant who submits an entry receives the participation reward.\n\n` +
      `Confirm: /confirm\n` +
      `Cancel: /cancel`;

    if (pending.file_id) {
      const { tg } = await import('./telegram.js');
      const photoSent = await tg(env, 'sendPhoto', {
        chat_id: chatId,
        photo: pending.file_id,
        caption: reviewText,
        parse_mode: 'HTML'
      });
      if (photoSent?.ok) return photoSent;
    }

    return send(env, chatId, reviewText, { plain: true });
  }

  // ─── Step 7: Confirm & Save ───
  if (step === 'step_confirm') {
    if (text.toLowerCase() === '/confirm') {
      if (!pending.name || !pending.submit_hours) {
        await kvDel(env, `pending_addcontest:${userId}`);
        return send(env, chatId, `❌ Incomplete contest data. Please restart with /addcontest.`);
      }

      const rankKey = pending.rank_key || 'com';
      const now = Date.now();

      const insertRes = await q(
        env,
        `INSERT INTO contests
          (name, image_url, rank_key, mode, submission_type, submit_hours, p1, p2, p3, ps, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          pending.name,
          pending.file_id,
          rankKey,
          pending.submission_type,
          pending.submission_type,
          pending.submit_hours,
          pending.p1,
          pending.p2,
          pending.p3,
          pending.ps,
          now
        ]
      );

      const contestId = insertRes.lastId;

      // Sync into contest_bag for all existing groups so it is immediately active in group rotations
      try {
        await q(
          env,
          `INSERT OR IGNORE INTO contest_bag (chat_id, contest_id)
           SELECT chat_id, ? FROM groups`,
          [contestId]
        );
      } catch (err) {
        console.warn('Contest bag auto-sync warning:', err.message);
      }

      // Delete wizard state (prevents duplicate creation if /confirm is sent again)
      await kvDel(env, `pending_addcontest:${userId}`);

      const subTypeLabel =
        pending.submission_type === 'image'
          ? 'Image'
          : pending.submission_type === 'text'
          ? 'Text'
          : 'Media';

      return send(
        env,
        chatId,
        `✅ <b>Contest created successfully!</b> (ID: #${contestId})\n\n` +
        `🏆 <b>${esc(pending.name)}</b>\n` +
        `🖼 Image: ${pending.file_id ? 'Uploaded' : 'No image'}\n` +
        `📤 Submission Type: <b>${subTypeLabel}</b>\n` +
        `⏱ Submission Duration: <b>${pending.submit_hours} hours</b>\n` +
        `🎁 Prizes: 🥇 ${pending.p1} • 🥈 ${pending.p2} • 🥉 ${pending.p3} • 🎁 ${pending.ps}\n\n` +
        `<i>Contest has been added to the rotation and is ready for groups.</i>`
      );
    }

    return send(
      env,
      chatId,
      `Please send /confirm to save this contest, or /cancel to abort.`
    );
  }
}

export async function ownerAddOne(env, chatId, userId, pending, text) {
  // Backwards-compatible legacy line adder
  const chosenMode = (pending && pending.mode) || 'image';
  const result = await addContestOne(env, text, chosenMode);

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
  const modeText = data.submission_type === 'text' ? '✍️ Text' : '🖼️ Image';

  return send(
    env,
    chatId,
    `✅ Contest added!\n\n<b>${esc(data.name)}</b>\n📁 Mode: <b>${modeText}</b>\n🏆 Rank: ${esc(data.rank_key)}\n🎁 Prizes: ${data.p1}/${data.p2}/${data.p3} + ${data.ps}`,
    { plain: true }
  );
}

export async function addContestOne(env, text, defaultMode = 'image') {
  if (typeof text !== 'string') {
    return { data: { error: 'Invalid contest data.' } };
  }

  const parts = text.split(' - ').map(s => s.trim());

  if (parts.length < 2) {
    return {
      data: {
        error: 'Format: image_url - Name - x, y, z, s [- rank_key] [- mode]'
      }
    };
  }

  const image_url = parts[0];
  const name = parts[1];
  const prizePart = parts[2] || '';
  const rankKey = parts[3] || 'com';
  let mode = defaultMode || 'image';

  if (parts[4] && ['image', 'text', 'media'].includes(parts[4].toLowerCase())) {
    mode = parts[4].toLowerCase();
  }

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

  const insertRes = await q(
    env,
    `INSERT INTO contests
      (name, image_url, rank_key, mode, submission_type, submit_hours, p1, p2, p3, ps, created_at)
     VALUES (?, ?, ?, ?, ?, 20, ?, ?, ?, ?, ?)`,
    [
      name,
      image_url,
      rankKey,
      mode,
      mode === 'text' ? 'text' : 'image',
      prizes[0],
      prizes[1],
      prizes[2],
      prizes[3],
      Date.now()
    ]
  );

  return {
    data: {
      id: insertRes.lastId,
      name,
      image_url,
      rank_key: rankKey,
      mode,
      submission_type: mode === 'text' ? 'text' : 'image',
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

  const lines = r.rows.map(c => {
    const typeLabel =
      c.submission_type === 'text'
        ? '✍️ Text'
        : c.submission_type === 'media'
        ? '🎬 Media'
        : '🖼️ Image';
    const hours = c.submit_hours ? `${c.submit_hours}h` : 'default';
    return `#${c.id} — <b>${esc(c.name)}</b> [${typeLabel}, ${hours}]\n  Prizes: 🥇 ${c.p1} • 🥈 ${c.p2} • 🥉 ${c.p3} • 🎁 ${c.ps}`;
  });

  return send(
    env,
    chatId,
    `📚 <b>Contests (${r.rows.length})</b>\n\n${lines.join('\n\n')}`,
    { plain: true }
  );
}

// ─── /delcontest ───

export async function delcontestGroupView(env, chatId, targetChatId, replyTo) {
  const r = await q(env,
    `SELECT c.* FROM contest_bag b JOIN contests c ON c.id = b.contest_id
     WHERE b.chat_id = ? ORDER BY c.id DESC`,
    [String(targetChatId)]
  );
  if (!r.rows.length) return send(env, chatId, '📭 No contests in this group bag.', { reply_to_message_id: replyTo });
  return send(env, chatId, '➖ <b>Remove Contest From This Group</b>\n\nSelect a contest:', {
    plain: true, reply_to_message_id: replyTo,
    reply_markup: { inline_keyboard: r.rows.map(c => [{
      text: '➖ #' + c.id + ' ' + esc(c.name).slice(0, 40),
      callback_data: 'delc_' + targetChatId + '_' + c.id
    }]) }
  });
}

export async function handleDelContestDM(env, chatId, userId, arg) {
  return send(env, chatId, '🗑 <b>Contest Management</b>\n\nChoose an action:', {
    plain: true,
    reply_markup: { inline_keyboard: [
      [{ text: '➖ Remove from one group', callback_data: 'dcm_remove' }],
      [{ text: '🗑 Permanently delete contest', callback_data: 'dcm_permanent' }]
    ] }
  });
}

export async function listGroupsForContestRemoval(env, chatId) {
  const r = await q(env, 'SELECT * FROM groups ORDER BY title LIMIT 100');
  if (!r.rows.length) return send(env, chatId, '📭 No groups are registered yet.', { plain: true });
  return send(env, chatId, '➖ <b>Remove from one group</b>\n\nSelect the group:', {
    plain: true, reply_markup: { inline_keyboard: r.rows.map(g => [{
      text: '📢 ' + esc(g.title || g.chat_id), callback_data: 'dcg_' + g.chat_id
    }]) }
  });
}

export async function listContestsForPermanentDeletion(env, chatId) {
  const r = await q(env, 'SELECT id, name FROM contests ORDER BY id DESC LIMIT 100');
  if (!r.rows.length) return send(env, chatId, '📭 There are no contests to delete.', { plain: true });
  return send(env, chatId, '🗑 <b>Permanently delete a contest</b>\n\nSelect one. You will be asked to confirm:', {
    plain: true, reply_markup: { inline_keyboard: r.rows.map(c => [{
      text: '🗑 #' + c.id + ' ' + esc(c.name).slice(0, 40), callback_data: 'dpx_' + c.id
    }]) }
  });
}

export async function delContestFromBag(env, chatId, contestId) {
  const exists = await q(env, 'SELECT id FROM contests WHERE id = ? LIMIT 1', [contestId]);
  if (!exists.rows.length) return false;
  const result = await q(env, 'DELETE FROM contest_bag WHERE chat_id = ? AND contest_id = ?', [String(chatId), contestId]);
  return result.rowsAffected > 0;
}

export async function deleteContestPermanently(env, contestId) {
  const exists = await q(env, 'SELECT id FROM contests WHERE id = ? LIMIT 1', [contestId]);
  if (!exists.rows.length) return false;
  const runFilter = 'run_id IN (SELECT run_id FROM runs WHERE contest_id = ?)';
  const statements = [
    { sql: 'DELETE FROM votes WHERE sub_id IN (SELECT id FROM submissions WHERE ' + runFilter + ')', args: [contestId] },
    { sql: 'DELETE FROM sub_history WHERE ' + runFilter, args: [contestId] },
    { sql: 'DELETE FROM participants WHERE ' + runFilter, args: [contestId] },
    { sql: 'DELETE FROM submissions WHERE ' + runFilter, args: [contestId] },
    { sql: 'DELETE FROM run_rewards WHERE ' + runFilter, args: [contestId] },
    { sql: 'DELETE FROM wins WHERE ' + runFilter, args: [contestId] },
    { sql: 'DELETE FROM runs WHERE contest_id = ?', args: [contestId] },
    { sql: 'DELETE FROM contest_bag WHERE contest_id = ?', args: [contestId] },
    { sql: 'UPDATE group_settings SET last_contest_id = NULL WHERE last_contest_id = ?', args: [contestId] },
    { sql: 'DELETE FROM contests WHERE id = ?', args: [contestId] }
  ];
  const { batch } = await import('./db.js');
  await batch(env, statements);
  return true;
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

  if (!isOwner(userId)) {
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
