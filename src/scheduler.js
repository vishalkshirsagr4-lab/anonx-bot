
import { q } from './db.js';
import { getSettings } from './settings.js';
import { startRun, advanceToVoting, finishRun } from './contest.js';
import { nextOccurrence } from './helpers.js';

export async function tick(env) {
  const now = Date.now();

  // 1. Advance runs whose phases have ended.
  const runs = (
    await q(
      env,
      `SELECT * FROM runs WHERE status IN ('submission', 'voting')`
    )
  ).rows;

  for (const run of runs) {
    try {
      if (run.status === 'submission' && now >= run.end_ts) {
        await advanceToVoting(env, run);
      } else if (run.status === 'voting' && now >= run.vote_end_ts) {
        await finishRun(env, run);
      }
    } catch (error) {
      console.error('Tick run error:', error);
    }
  }

  // 2. Start scheduled contests.
  const groups = (
    await q(env, `SELECT * FROM group_settings`)
  ).rows;

  for (const group of groups) {
    try {
      const st = await getSettings(env, group.chat_id);

      const next =
        st.next_announce_ts && st.next_announce_ts > 0
          ? st.next_announce_ts
          : nextOccurrence(st.announce_min, now);

      if (now >= next) {
        const started = await startRun(
          env,
          group.chat_id,
          st,
          now
        );

        // Advance the schedule only after a successful announcement.
        if (started) {
          await q(
            env,
            `UPDATE group_settings
             SET next_announce_ts = ?
             WHERE chat_id = ?`,
            [
              nextOccurrence(st.announce_min, now),
              group.chat_id
            ]
          );
        }
      }
    } catch (error) {
      console.error('Tick group error:', error);
    }
  }
}
