
import { CFG, rankLabel } from './config.js';
import { q, addCoins } from './db.js';
import { tg } from './telegram.js';
import { send } from './cards.js';
import { esc, fmtDur, fmtTime, getBotInfo } from './helpers.js';

export async function handleJoin(env, from, runId) {
  const r = await q(env, `SELECT * FROM runs WHERE run_id = ?`, [runId]);
  if (!r.rows.length) return { err: 'not_found' };

  const run = r.rows[0];
  if (run.status !== 'submission') return { err: 'closed' };

  await q(
    env,
    `INSERT OR IGNORE INTO participants (run_id, user_id, joined_at) VALUES (?, ?, ?)`,
    [runId, from.id, Date.now()]
  );

  return { ok: true, run };
}

export async function handleSubmitCmd(env, chatId, userId, msg) {
  const r = await q(
    env,
    `SELECT * FROM runs WHERE status = 'submission' ORDER BY run_id DESC`
  );

  if (!r.rows.length) {
    return send(env, chatId, `❌ No contest open for submission right now.`);
  }

  return send(
    env,
    chatId,
    `📝 <b>Submit</b>\n\nSelect a contest:`,
    {
      plain: true,
      reply_markup: {
        inline_keyboard: r.rows.map(run => [{
          text: `🎮 ${esc(run.name)}`,
          callback_data: `subrun_${run.run_id}`
        }])
      }
    }
  );
}

export async function dmContestStatus(env, chatId, userId) {
  const r = await q(
    env,
    `SELECT * FROM runs WHERE status != 'done' ORDER BY run_id DESC LIMIT 3`
  );

  if (!r.rows.length) {
    return send(env, chatId, `🎮 <b>No contest running.</b>`);
  }

  const lines = r.rows.map(run => {
    const when = run.status === 'submission'
      ? `ends ${fmtTime(run.end_ts)}`
      : `voting ends ${fmtTime(run.vote_end_ts)}`;

    return `• <b>${esc(run.name)}</b> (${run.status}) — ${when}`;
  });

  return send(
    env,
    chatId,
    `🎮 <b>Contests</b>\n\n${lines.join('\n')}`
  );
}

export async function groupContestStatus(env, chatId, replyTo) {
  const now = Date.now();

  const r = await q(
    env,
    `SELECT * FROM runs WHERE chat_id = ? AND status != 'done' ORDER BY run_id DESC LIMIT 1`,
    [chatId]
  );

  if (!r.rows.length) {
    const { getSettings } = await import('./settings.js');
    const st = await getSettings(env, chatId);
    const { nextOccurrence } = await import('./helpers.js');

    const next = st.next_announce_ts && st.next_announce_ts > 0
      ? st.next_announce_ts
      : nextOccurrence(st.announce_min, now);

    return send(
      env,
      chatId,
      `🎮 <b>No contest running.</b>\n\n⏳ Next contest: <b>${fmtTime(next)}</b>`,
      { reply_to_message_id: replyTo }
    );
  }

  const run = r.rows[0];
  const bi = await getBotInfo(env);
  const partUrl = `https://t.me/${bi.username}?start=join_${run.run_id}`;

  if (run.status === 'submission') {
    const joined = (
      await q(
        env,
        `SELECT COUNT(*) as n FROM participants WHERE run_id = ?`,
        [run.run_id]
      )
    ).rows[0].n;

    const caption =
      `🎮 <b>${esc(run.name)}</b>\n` +
      `🏆 Rank: ${rankLabel(run.rank_key)}\n\n` +
      `👥 Joined: <b>${joined}/${run.min_join || CFG.MIN_JOIN_DEFAULT}</b>\n` +
      `📝 Submissions <b>open</b>\n` +
      `⌛ Ends in: <b>${fmtDur(run.end_ts - now)}</b>\n\n` +
      `🥇 ${run.p1} • 🥈 ${run.p2} • 🥉 ${run.p3} • 🎁 ${run.ps}`;

    const markup = {
      inline_keyboard: [[
        { text: '🎯 Participate', url: partUrl }
      ]]
    };

    if (run.image_url) {
      const photo = await tg(env, 'sendPhoto', {
        chat_id: chatId,
        photo: run.image_url,
        caption,
        parse_mode: 'HTML',
        reply_markup: markup,
        reply_to_message_id: replyTo
      });

      if (photo.ok) return;
    }

    return send(
      env,
      chatId,
      caption,
      {
        reply_markup: markup,
        reply_to_message_id: replyTo
      }
    );
  }

  return send(
    env,
    chatId,
    `🎮 <b>${esc(run.name)}</b>\n` +
    `🏆 Rank: ${rankLabel(run.rank_key)}\n\n` +
    `🗳 <b>Voting open</b>\n` +
    `⌛ Ends in: <b>${fmtDur(run.vote_end_ts - now)}</b>`,
    { reply_to_message_id: replyTo }
  );
}

export async function startRun(env, chatId, st, now) {
  const bagResult = await q(
    env,
    `SELECT c.*
     FROM contest_bag b
     JOIN contests c ON c.id = b.contest_id
     WHERE b.chat_id = ?
     ORDER BY RANDOM()
     LIMIT 1`,
    [chatId]
  );

  const bag = bagResult.rows[0];

  if (!bag) return false;

  const submitMin =
    st.submit_min || Math.round(CFG.DEFAULT_SUBMIT_HOURS * 60);

  const voteMin =
    st.vote_min || Math.round(CFG.DEFAULT_VOTE_HOURS * 60);

  const minJoin =
    st.min_join || CFG.MIN_JOIN_DEFAULT;

  const endTs = now + submitMin * 60000;

  const res = await q(
    env,
    `INSERT INTO runs (
      chat_id, contest_id, name, rank_key, image_url,
      p1, p2, p3, ps, status, start_ts, end_ts,
      vote_min, min_join, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'submission', ?, ?, ?, ?, ?)`,
    [
      chatId,
      bag.id,
      bag.name,
      bag.rank_key,
      bag.image_url,
      bag.p1,
      bag.p2,
      bag.p3,
      bag.ps,
      now,
      endTs,
      voteMin,
      minJoin,
      now
    ]
  );

  const runId = res.lastId;

  if (!runId) {
    console.error('Contest creation failed: missing run ID.');
    return false;
  }

  try {
    const bi = await getBotInfo(env);
    const partUrl = `https://t.me/${bi.username}?start=join_${runId}`;

    const caption =
      `🎮 <b>New Contest!</b>\n\n` +
      `<b>${esc(bag.name)}</b>\n` +
      `🏆 Rank: ${rankLabel(bag.rank_key)}\n\n` +
      `📝 Submission open until <b>${fmtTime(endTs)}</b>\n\n` +
      `🥇 ${bag.p1} • 🥈 ${bag.p2} • 🥉 ${bag.p3} • 🎁 ${bag.ps}\n` +
      `👥 Min participants: ${minJoin}`;

    const markup = {
      inline_keyboard: [[
        {
          text: '🎯 Participate',
          url: partUrl
        }
      ]]
    };

    let sent = null;

    // Try sending the contest image first.
    if (bag.image_url) {
      sent = await tg(env, 'sendPhoto', {
        chat_id: chatId,
        photo: bag.image_url,
        caption,
        parse_mode: 'HTML',
        reply_markup: markup
      });
    }

    // If the image fails or is unavailable, send text.
    if (!sent?.ok) {
      sent = await send(
        env,
        chatId,
        caption,
        { reply_markup: markup }
      );
    }

    // Do not keep a contest that was never announced.
    if (!sent?.ok) {
      console.error(
        'Contest announcement failed:',
        sent?.description || 'Telegram send failed'
      );

      await q(
        env,
        `DELETE FROM runs WHERE run_id = ? AND status = 'submission'`,
        [runId]
      );

      return false;
    }

    await q(
      env,
      `UPDATE runs SET announce_msg_id = ? WHERE run_id = ?`,
      [sent.result.message_id, runId]
    );

    return true;

  } catch (error) {
    console.error('Contest announcement error:', error);

    await q(
      env,
      `DELETE FROM runs WHERE run_id = ? AND status = 'submission'`,
      [runId]
    );

    return false;
  }
}

export async function forceContest(env, chatId) {
  const { getSettings } = await import('./settings.js');
  const st = await getSettings(env, chatId);

  const ok = await startRun(env, chatId, st, Date.now());

  if (!ok) {
    return send(
      env,
      chatId,
      `❌ No contest in bag for this group. Add with /addcontest.`
    );
  }
}

export async function advanceToVoting(env, run) {
  await q(
    env,
    `UPDATE runs SET status = 'voting', vote_end_ts = ? WHERE run_id = ?`,
    [
      Date.now() + (run.vote_min || 1440) * 60000,
      run.run_id
    ]
  );

  const subs = (
    await q(
      env,
      `SELECT * FROM submissions WHERE run_id = ? ORDER BY first_ts ASC`,
      [run.run_id]
    )
  ).rows;

  if (!subs.length) {
    await finishRun(env, { ...run, status: 'voting' });
    return;
  }

  await send(
    env,
    run.chat_id,
    `🗳 <b>Voting has begun!</b>\n\n` +
    `Contest: <b>${esc(run.name)}</b>\n` +
    `Entries: <b>${subs.length}</b>\n` +
    `Vote for your favorites!`,
    { plain: true }
  );

  let num = 1;

  for (const s of subs) {
    const c = JSON.parse(s.content_json || '{}');
    const header = `#${num} — Anonymous Entry`;

    let body = '';

    if (c.text) {
      body = `<b>${esc(c.text)}</b>`;
    } else {
      body = `<i>[media]</i>`;
    }

    const msgText = `${header}\n\n${body}`;

    const kb = {
      inline_keyboard: [[
        { text: '🗳 Vote', callback_data: `vote_${s.id}` }
      ]]
    };

    let sent;

    if (c.file_id && c.kind === 'photo') {
      sent = await tg(env, 'sendPhoto', {
        chat_id: run.chat_id,
        photo: c.file_id,
        caption: msgText,
        parse_mode: 'HTML',
        reply_markup: kb
      });
    } else if (c.file_id && c.kind === 'video') {
      sent = await tg(env, 'sendVideo', {
        chat_id: run.chat_id,
        video: c.file_id,
        caption: msgText,
        parse_mode: 'HTML',
        reply_markup: kb
      });
    } else if (c.file_id && c.kind === 'document') {
      sent = await tg(env, 'sendDocument', {
        chat_id: run.chat_id,
        document: c.file_id,
        caption: msgText,
        parse_mode: 'HTML',
        reply_markup: kb
      });
    } else {
      sent = await send(
        env,
        run.chat_id,
        msgText,
        { plain: true, reply_markup: kb }
      );
    }

    if (sent.ok) {
      await q(
        env,
        `UPDATE submissions SET post_msg_id = ?, number = ? WHERE id = ?`,
        [sent.result.message_id, num, s.id]
      );
    }

    num++;
  }
}

export async function finishRun(env, run) {
  const subs = (
    await q(
      env,
      `SELECT * FROM submissions WHERE run_id = ? ORDER BY votes DESC, first_ts ASC`,
      [run.run_id]
    )
  ).rows;

  const minJoin = run.min_join || CFG.MIN_JOIN_DEFAULT;

  if (subs.length < minJoin) {
    await send(
      env,
      run.chat_id,
      `⚠️ <b>Contest Cancelled</b>\n\n` +
      `<b>${esc(run.name)}</b>\n` +
      `Only ${subs.length}/${minJoin} submissions. Not enough to award prizes.`,
      { plain: true }
    );

    await q(
      env,
      `UPDATE runs SET status = 'done' WHERE run_id = ?`,
      [run.run_id]
    );

    return;
  }

  const prizes = [run.p1, run.p2, run.p3];
  const winners = [];

  for (let i = 0; i < Math.min(3, subs.length); i++) {
    const prize = prizes[i] || 0;

    await addCoins(env, subs[i].user_id, prize);

    await q(
      env,
      `INSERT INTO wins (user_id, run_id, chat_id, place, prize, ts) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        subs[i].user_id,
        run.run_id,
        run.chat_id,
        i + 1,
        prize,
        Date.now()
      ]
    );

    winners.push({
      user_id: subs[i].user_id,
      place: i + 1,
      prize,
      votes: subs[i].votes
    });
  }

  for (const s of subs) {
    if (s.votes >= 0 && run.ps) {
      await addCoins(env, s.user_id, run.ps);
    }
  }

  const medals = ['🥇', '🥈', '🥉'];

  const winLines = winners.map((w, i) =>
    `${medals[i]} ${w.votes} votes — +${w.prize} 🪙`
  ).join('\n');

  await send(
    env,
    run.chat_id,
    `🏆 <b>Contest Finished!</b>\n\n` +
    `<b>${esc(run.name)}</b>\n\n` +
    `${winLines}\n\n` +
    `🎁 All submitters get +${run.ps} 🪙\n\n` +
    `<i>Winners have been credited.</i>`,
    { plain: true }
  );

  await q(
    env,
    `UPDATE runs SET status = 'done' WHERE run_id = ?`,
    [run.run_id]
  );
}


export async function handleVote(env, cq, subId) {
  const userId = cq.from.id;

  const sr = await q(
    env,
    `SELECT * FROM submissions WHERE id = ?`,
    [subId]
  );

  if (!sr.rows.length) {
    return { toast: '❌ Entry not found.', alert: true };
  }

  const sub = sr.rows[0];

  const rr = await q(
    env,
    `SELECT * FROM runs WHERE run_id = ?`,
    [sub.run_id]
  );

  if (!rr.rows.length) {
    return { toast: '❌ Contest gone.', alert: true };
  }

  const run = rr.rows[0];

  if (run.status !== 'voting') {
    return { toast: '🗳 Voting not open.', alert: true };
  }

  if (Date.now() >= run.vote_end_ts) {
    return { toast: '⏰ Voting ended.', alert: true };
  }

  if (Number(sub.user_id) === Number(userId)) {
    return {
      toast: '🚫 You cannot vote for your own entry.',
      alert: true
    };
  }

  // Insert only if this user has not voted for this entry.
  const voteResult = await q(
    env,
    `INSERT OR IGNORE INTO votes (sub_id, voter_id, ts)
     VALUES (?, ?, ?)`,
    [subId, userId, Date.now()]
  );

  // A zero row count means the vote already exists.
  if (voteResult.rowsAffected === 0) {
    return {
      toast: '✅ You already voted for this entry.',
      alert: true
    };
  }

  // Increase the vote count only after a successful insertion.
  await q(
    env,
    `UPDATE submissions
     SET votes = votes + 1
     WHERE id = ?`,
    [subId]
  );

  return { toast: '✅ Vote recorded!' };
}
