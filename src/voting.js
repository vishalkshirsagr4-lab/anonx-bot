// src/voting.js
// Group-admin controls for contest voting phases and live/final standings.
import { isOwner } from './config.js';
import { q } from './db.js';
import { send } from './cards.js';
import { advanceToVoting, finishRun } from './contest.js';
import { isAdmin, esc, fmtTime, fmtDur } from './helpers.js';
import { sendSubmissionEntry } from './media.js';

async function canManage(env, chatId, userId) {
  return isOwner(userId) || await isAdmin(env, chatId, userId);
}

async function findRun(env, chatId, runId, statuses) {
  if (runId) {
    const result = await q(env,
      `SELECT * FROM runs WHERE run_id = ? AND chat_id = ? LIMIT 1`,
      [runId, String(chatId)]);
    const run = result.rows[0];
    return run && statuses.includes(run.status) ? run : null;
  }

  const marks = statuses.map(() => '?').join(', ');
  const result = await q(env,
    `SELECT * FROM runs WHERE chat_id = ? AND status IN (${marks}) ORDER BY run_id DESC LIMIT 1`,
    [String(chatId), ...statuses]);
  return result.rows[0] || null;
}

function parseRunId(arg) {
  if (!arg) return null;
  const id = Number(arg.trim().replace(/^#/, ''));
  return Number.isSafeInteger(id) && id > 0 ? id : NaN;
}

async function standings(env, run) {
  return (await q(env,
    `SELECT s.id, s.user_id, s.votes, s.first_ts,
            COALESCE(NULLIF(u.first_name, ''), 'Participant') AS first_name,
            u.username
     FROM submissions s
     LEFT JOIN users u ON u.user_id = s.user_id
     WHERE s.run_id = ?
     ORDER BY s.votes DESC, s.first_ts ASC
     LIMIT 20`,
    [run.run_id])).rows;
}

export async function handleVotingCommand(env, msg, cmd) {
  const chatId = String(msg.chat.id);
  const userId = msg.from.id;
  const runId = parseRunId(cmd.arg || '');

  if (Number.isNaN(runId)) {
    return send(env, chatId, '❌ Invalid contest ID. Use a positive ID, for example /voteend 12.', {
      reply_to_message_id: msg.message_id
    });
  }

  if (['votestart', 'voteend'].includes(cmd.name)) {
    if (!(await canManage(env, chatId, userId))) {
      return send(env, chatId, '⛔ Only this group’s admins or the bot owner can control voting.', {
        reply_to_message_id: msg.message_id
      });
    }
  }

  if (cmd.name === 'vote') {
    const run = await findRun(env, chatId, runId, ['voting']);
    if (!run) {
      return send(env, chatId, '🗳 No active voting round in this group. Check /contest or /voting.', {
        reply_to_message_id: msg.message_id
      });
    }

    const subs = (await q(env,
      `SELECT * FROM submissions WHERE run_id = ? ORDER BY first_ts ASC`,
      [run.run_id])).rows;

    if (!subs.length) {
      return send(env, chatId, '📭 No participant submissions were found for this contest.', {
        reply_to_message_id: msg.message_id
      });
    }

    await send(env, chatId,
      `🗳 <b>Vote for one participant</b>\n\n🏆 <b>${esc(run.name)}</b> · #${run.run_id}\nEach member can vote only once. Your own entry cannot be selected.\n⌛ Voting closes: <b>${fmtTime(run.vote_end_ts)}</b>`,
      { reply_to_message_id: msg.message_id });

    let number = 1;
    for (const sub of subs) {
      const markup = { inline_keyboard: [[{
        text: '🗳 Vote for this participant',
        callback_data: `vote_${sub.id}`
      }]] };
      const sent = await sendSubmissionEntry(env, chatId, sub, number, markup);
      if (sent?.ok) {
        await q(env, `UPDATE submissions SET post_msg_id = ?, number = ? WHERE id = ?`,
          [sent.result.message_id, number, sub.id]);
      }
      number++;
    }
    return;
  }

  if (cmd.name === 'votestart') {
    const run = await findRun(env, chatId, runId, ['submission']);
    if (!run) return send(env, chatId, 'ℹ️ No contest is currently accepting submissions in this group.', {
      reply_to_message_id: msg.message_id
    });

    const entryCount = await q(env, `SELECT COUNT(*) AS total FROM submissions WHERE run_id = ?`, [run.run_id]);
    if (!Number(entryCount.rows[0]?.total || 0)) {
      return send(env, chatId, 'ℹ️ There are no submissions yet. Voting cannot start until at least one entry is submitted.', {
        reply_to_message_id: msg.message_id
      });
    }

    await advanceToVoting(env, run);
    return;
  }

  if (cmd.name === 'voteend') {
    const run = await findRun(env, chatId, runId, ['voting']);
    if (!run) return send(env, chatId, 'ℹ️ No active voting round was found. Use /voting to check the current status.', {
      reply_to_message_id: msg.message_id
    });

    await finishRun(env, run, { forcePublish: true });
    return;
  }

  if (cmd.name === 'voting' || cmd.name === 'voteresult') {
    const run = runId
      ? await findRun(env, chatId, runId, ['submission', 'voting', 'done'])
      : await findRun(env, chatId, null, ['voting', 'submission', 'done']);

    if (!run) return send(env, chatId, '📭 No contest found. Start or check a contest with /contest.', {
      reply_to_message_id: msg.message_id
    });

    const rows = await standings(env, run);
    const totals = await q(env, `SELECT COUNT(*) AS entries, COALESCE(SUM(votes), 0) AS votes FROM submissions WHERE run_id = ?`, [run.run_id]);
    const entryTotal = Number(totals.rows[0]?.entries || 0);
    const totalVotes = Number(totals.rows[0]?.votes || 0);
    const medals = ['🥇', '🥈', '🥉'];
    const lines = rows.length
      ? rows.slice(0, 10).map((row, index) => {
          const label = row.username ? '@' + esc(row.username) : esc(row.first_name);
          return `${medals[index] || (index + 1) + '.'} <b>${label}</b> — <b>${Number(row.votes || 0)}</b> votes`;
        }).join('\n')
      : 'No entries have been submitted yet.';

    const phase = run.status === 'submission'
      ? `📝 Submissions open · ends ${fmtTime(run.end_ts)}`
      : run.status === 'voting'
      ? `🗳 Voting open · ${fmtDur(run.vote_end_ts - Date.now())} remaining`
      : '🏁 Contest completed';

    return send(env, chatId,
      `📊 <b>${cmd.name === 'voting' ? 'Voting Status' : 'Contest Results'}</b>\n\n` +
      `🏆 <b>${esc(run.name)}</b> · #${run.run_id}\n` +
      `${phase}\n\n` +
      `👥 Entries: <b>${entryTotal}</b>\n` +
      `🗳 Total votes: <b>${totalVotes}</b>\n\n` +
      `<b>Current ranking</b>\n${lines}` +
      (run.status === 'voting' ? '\n\n<i>Ranking updates when this command is run again.</i>' : ''),
      { reply_to_message_id: msg.message_id });
  }
}
