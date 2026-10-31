// src/scheduler.js
import { q } from './db.js';
import { getSettings } from './settings.js';
import { startRun, advanceToVoting, finishRun } from './contest.js';
import { nextOccurrence } from './helpers.js';

export async function tick(env) {
  const now = Date.now();

  // 1) Advance any runs whose phase has ended
  const runs = (await q(env, `SELECT * FROM runs WHERE status IN ('submission','voting')`)).rows;
  for (const run of runs) {
    try {
      if (run.status === 'submission' && now >= run.end_ts) {
        await advanceToVoting(env, run);
      } else if (run.status === 'voting' && now >= run.vote_end_ts) {
        await finishRun(env, run);
      }
    } catch (e) { console.error('tick run error', e); }
  }

  // 2) Fire due announcements
  const gs = (await q(env, `SELECT * FROM group_settings`)).rows;
  for (const g of gs) {
    try {
      const st = await getSettings(env, g.chat_id);
      const next = st.next_announce_ts && st.next_announce_ts > 0
        ? st.next_announce_ts
        : nextOccurrence(st.announce_min, now);
      if (now >= next) {
        const ok = await startRun(env, g.chat_id, st, now);
        await q(env, `UPDATE group_settings SET next_announce_ts = ? WHERE chat_id = ?`,
          [nextOccurrence(st.announce_min, now), g.chat_id]);
      }
    } catch (e) { console.error('tick group error', e); }
  }
}