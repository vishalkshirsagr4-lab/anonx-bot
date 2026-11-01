import assert from 'node:assert';
import { initDB, q, kvPut, kvGet, kvDel } from '../src/db.js';
import { addContestStart, handleContestWizard } from '../src/owner.js';
import { startRun, handleJoin, finishRun } from '../src/contest.js';
import { handleUpdate } from '../src/handlers.js';
import { state } from '../src/config.js';

// Mock telegram fetch to intercept API calls in tests
let lastTgCall = null;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options = {}) => {
  const urlStr = String(url);
  if (urlStr.includes('api.telegram.org')) {
    let body = {};
    if (options.body && typeof options.body === 'string') {
      try {
        body = JSON.parse(options.body);
      } catch {}
    }
    const method = urlStr.split('/').pop();
    lastTgCall = { method, body };
    return {
      ok: true,
      json: async () => ({
        ok: true,
        result: {
          message_id: 9999,
          chat: { id: body.chat_id || 0 },
          text: body.text || body.caption || ''
        }
      })
    };
  }
  return originalFetch(url, options);
};

async function runTests() {
  console.log('🧪 Starting Contest Wizard & Universal Media Test Suite...\n');

  const env = {
    BOT_TOKEN: '123456:TEST_TOKEN',
    OWNER_ID: '999999',
    DEFAULT_LANG: 'en'
  };

  await initDB(env);
  state.OWNER_ID = '999999';
  state.BOT_TOKEN = '123456:TEST_TOKEN';

  const ownerId = 999999;
  const ownerChatId = 999999;
  const groupChatId = -100123456789;

  // Ensure owner user exists
  await q(env, `INSERT OR REPLACE INTO users (user_id, username, first_name, coins) VALUES (?, ?, ?, ?)`,
    [ownerId, 'owner', 'Admin', 1000]);

  // Ensure group exists
  await q(env, `INSERT OR REPLACE INTO groups (chat_id, title) VALUES (?, ?)`,
    [groupChatId, 'Test Contest Group']);

  // ==========================================
  // Test 1: Start Wizard (/addcontest)
  // ==========================================
  console.log('Test 1: Starting /addcontest wizard');
  const res1 = await addContestStart(env, ownerChatId, ownerId);
  assert(res1.ok, 'addContestStart should return ok');
  assert(lastTgCall.body.text.includes('Step 1/7'), 'Should ask Step 1/7');
  assert(lastTgCall.body.text.includes('/skip'), 'Should mention /skip');
  assert(lastTgCall.body.text.includes('/cancel'), 'Should mention /cancel');

  let wizardState = await kvGet(env, `pending_addcontest:${ownerId}`);
  assert.equal(wizardState.step, 'step_image', 'State should be in step_image');

  // ==========================================
  // Test 2: Invalid input in Step 1 (plain text instead of photo or /skip)
  // ==========================================
  console.log('Test 2: Invalid input in Step 1');
  const res2 = await handleContestWizard(env, {
    text: 'not a photo',
    chat: { id: ownerChatId },
    from: { id: ownerId }
  }, ownerId, wizardState);
  assert(lastTgCall.body.text.includes('Please upload a photo'), 'Should prompt for photo or /skip');

  // ==========================================
  // Test 3: Upload photo in Step 1
  // ==========================================
  console.log('Test 3: Upload photo in Step 1');
  const res3 = await handleContestWizard(env, {
    photo: [
      { file_id: 'thumb_id', width: 100, height: 100 },
      { file_id: 'highres_file_id_123', width: 800, height: 800 }
    ],
    chat: { id: ownerChatId },
    from: { id: ownerId }
  }, ownerId, wizardState);
  assert(lastTgCall.body.text.includes('Step 2/7'), 'Should advance to Step 2/7');
  wizardState = await kvGet(env, `pending_addcontest:${ownerId}`);
  assert.equal(wizardState.step, 'step_name');
  assert.equal(wizardState.file_id, 'highres_file_id_123', 'Should select highest resolution file_id');

  // ==========================================
  // Test 4: /cancel at Step 2
  // ==========================================
  console.log('Test 4: /cancel aborts wizard');
  const res4 = await handleContestWizard(env, {
    text: '/cancel',
    chat: { id: ownerChatId },
    from: { id: ownerId }
  }, ownerId, wizardState);
  assert(lastTgCall.body.text.includes('cancelled'), 'Should confirm cancellation');
  wizardState = await kvGet(env, `pending_addcontest:${ownerId}`);
  assert.equal(wizardState, null, 'Pending state should be deleted');

  // ==========================================
  // Test 5: Complete 7-step wizard with /skip for image and submission_type = Image
  // ==========================================
  console.log('Test 5: Step 1 with /skip');
  await addContestStart(env, ownerChatId, ownerId);
  wizardState = await kvGet(env, `pending_addcontest:${ownerId}`);

  await handleContestWizard(env, {
    text: '/skip',
    chat: { id: ownerChatId },
    from: { id: ownerId }
  }, ownerId, wizardState);
  assert(lastTgCall.body.text.includes('Step 2/7'));
  wizardState = await kvGet(env, `pending_addcontest:${ownerId}`);
  assert.equal(wizardState.file_id, null, 'file_id should be null when skipped');

  // Step 2: Name validation
  console.log('Test 5b: Step 2 validation');
  await handleContestWizard(env, {
    text: '   ',
    chat: { id: ownerChatId },
    from: { id: ownerId }
  }, ownerId, wizardState);
  assert(lastTgCall.body.text.includes('cannot be empty'));

  await handleContestWizard(env, {
    text: '  Super Photo Contest  ',
    chat: { id: ownerChatId },
    from: { id: ownerId }
  }, ownerId, wizardState);
  assert(lastTgCall.body.text.includes('Step 3/7'));
  wizardState = await kvGet(env, `pending_addcontest:${ownerId}`);
  assert.equal(wizardState.name, 'Super Photo Contest', 'Should trim name');

  // Step 3: Submission type validation
  console.log('Test 5c: Step 3 submission type');
  await handleContestWizard(env, {
    text: 'invalid_type',
    chat: { id: ownerChatId },
    from: { id: ownerId }
  }, ownerId, wizardState);
  assert(lastTgCall.body.text.includes('valid submission type'));

  await handleContestWizard(env, {
    text: '1', // test "1" alias for Image
    chat: { id: ownerChatId },
    from: { id: ownerId }
  }, ownerId, wizardState);
  assert(lastTgCall.body.text.includes('Step 4/7'));
  wizardState = await kvGet(env, `pending_addcontest:${ownerId}`);
  assert.equal(wizardState.submission_type, 'image');

  // Step 4: Submission duration
  console.log('Test 5d: Step 4 duration validation');
  await handleContestWizard(env, {
    text: '200', // exceeds 168
    chat: { id: ownerChatId },
    from: { id: ownerId }
  }, ownerId, wizardState);
  assert(lastTgCall.body.text.includes('1 and 168'));

  await handleContestWizard(env, {
    text: '7',
    chat: { id: ownerChatId },
    from: { id: ownerId }
  }, ownerId, wizardState);
  assert(lastTgCall.body.text.includes('Step 5/7'));
  assert(lastTgCall.body.text.includes('1st prize'));
  wizardState = await kvGet(env, `pending_addcontest:${ownerId}`);
  assert.equal(wizardState.submit_hours, 7);

  // Step 5a: 1st prize
  console.log('Test 5e: Step 5 prizes entered individually');
  await handleContestWizard(env, {
    text: '500',
    chat: { id: ownerChatId },
    from: { id: ownerId }
  }, ownerId, wizardState);
  assert(lastTgCall.body.text.includes('2nd prize'));
  wizardState = await kvGet(env, `pending_addcontest:${ownerId}`);
  assert.equal(wizardState.p1, 500);

  // Step 5b: 2nd prize
  await handleContestWizard(env, {
    text: '300',
    chat: { id: ownerChatId },
    from: { id: ownerId }
  }, ownerId, wizardState);
  assert(lastTgCall.body.text.includes('3rd prize'));
  wizardState = await kvGet(env, `pending_addcontest:${ownerId}`);
  assert.equal(wizardState.p2, 300);

  // Step 5c: 3rd prize
  await handleContestWizard(env, {
    text: '200',
    chat: { id: ownerChatId },
    from: { id: ownerId }
  }, ownerId, wizardState);
  assert(lastTgCall.body.text.includes('participation prize'));
  wizardState = await kvGet(env, `pending_addcontest:${ownerId}`);
  assert.equal(wizardState.p3, 200);

  // Step 5d: Participation prize & Review preview
  console.log('Test 5f: Step 6 Review preview');
  await handleContestWizard(env, {
    text: '50',
    chat: { id: ownerChatId },
    from: { id: ownerId }
  }, ownerId, wizardState);
  const previewText = lastTgCall.body.text || lastTgCall.body.caption;
  assert(previewText.includes('Contest Review'), 'Must show Contest Review');
  assert(previewText.includes('Super Photo Contest'), 'Must show name');
  assert(previewText.includes('Image'), 'Must show Image submission type');
  assert(previewText.includes('7 hours'), 'Must show 7 hours duration');
  assert(previewText.includes('1st Prize: 500'), 'Must show 1st prize');
  assert(previewText.includes('2nd Prize: 300'), 'Must show 2nd prize');
  assert(previewText.includes('3rd Prize: 200'), 'Must show 3rd prize');
  assert(previewText.includes('Participation Prize: 50'), 'Must show participation prize');
  assert(previewText.includes('/confirm'), 'Must instruct /confirm');

  wizardState = await kvGet(env, `pending_addcontest:${ownerId}`);
  assert.equal(wizardState.step, 'step_confirm');

  // Step 7: Confirm
  console.log('Test 5g: Step 7 /confirm');
  await handleContestWizard(env, {
    text: '/confirm',
    chat: { id: ownerChatId },
    from: { id: ownerId }
  }, ownerId, wizardState);
  assert(lastTgCall.body.text.includes('Contest created successfully'));

  // Verify DB record
  const contestRow = (await q(env, `SELECT * FROM contests WHERE name = ?`, ['Super Photo Contest'])).rows[0];
  assert(contestRow, 'Contest must exist in DB');
  assert.equal(contestRow.submission_type, 'image');
  assert.equal(contestRow.submit_hours, 7);
  assert.equal(contestRow.p1, 500);
  assert.equal(contestRow.p2, 300);
  assert.equal(contestRow.p3, 200);
  assert.equal(contestRow.ps, 50);

  // Verify wizard state was cleared
  const wizardDone = await kvGet(env, `pending_addcontest:${ownerId}`);
  assert.equal(wizardDone, null, 'Pending wizard state must be cleared after confirm');

  // Duplicate /confirm should safely fail/ask for command
  const resDupConfirm = await handleContestWizard(env, {
    text: '/confirm',
    chat: { id: ownerChatId },
    from: { id: ownerId }
  }, ownerId, null);
  // It shouldn't crash!

  // ==========================================
  // Test 6: Create a Text contest via Wizard
  // ==========================================
  console.log('Test 6: Create Text contest');
  await addContestStart(env, ownerChatId, ownerId);
  wizardState = await kvGet(env, `pending_addcontest:${ownerId}`);
  await handleContestWizard(env, { text: '/skip', chat: { id: ownerChatId }, from: { id: ownerId } }, ownerId, wizardState);
  wizardState = await kvGet(env, `pending_addcontest:${ownerId}`);
  await handleContestWizard(env, { text: 'Poetry Challenge', chat: { id: ownerChatId }, from: { id: ownerId } }, ownerId, wizardState);
  wizardState = await kvGet(env, `pending_addcontest:${ownerId}`);
  await handleContestWizard(env, { text: 'text', chat: { id: ownerChatId }, from: { id: ownerId } }, ownerId, wizardState);
  wizardState = await kvGet(env, `pending_addcontest:${ownerId}`);
  await handleContestWizard(env, { text: '12', chat: { id: ownerChatId }, from: { id: ownerId } }, ownerId, wizardState);
  wizardState = await kvGet(env, `pending_addcontest:${ownerId}`);
  await handleContestWizard(env, { text: '1000', chat: { id: ownerChatId }, from: { id: ownerId } }, ownerId, wizardState);
  wizardState = await kvGet(env, `pending_addcontest:${ownerId}`);
  await handleContestWizard(env, { text: '600', chat: { id: ownerChatId }, from: { id: ownerId } }, ownerId, wizardState);
  wizardState = await kvGet(env, `pending_addcontest:${ownerId}`);
  await handleContestWizard(env, { text: '300', chat: { id: ownerChatId }, from: { id: ownerId } }, ownerId, wizardState);
  wizardState = await kvGet(env, `pending_addcontest:${ownerId}`);
  await handleContestWizard(env, { text: '100', chat: { id: ownerChatId }, from: { id: ownerId } }, ownerId, wizardState);
  wizardState = await kvGet(env, `pending_addcontest:${ownerId}`);
  await handleContestWizard(env, { text: '/confirm', chat: { id: ownerChatId }, from: { id: ownerId } }, ownerId, wizardState);

  const textContestRow = (await q(env, `SELECT * FROM contests WHERE name = ?`, ['Poetry Challenge'])).rows[0];
  assert(textContestRow, 'Poetry contest created');
  assert.equal(textContestRow.submission_type, 'text');
  assert.equal(textContestRow.submit_hours, 12);

  // ==========================================
  // Test 7: Starting run uses contest-specific duration
  // ==========================================
  console.log('Test 7: Start run verifies submit_hours');
  const now = Date.now();
  const startOk = await startRun(env, groupChatId, { submit_min: 60, vote_min: 60, min_join: 2 }, now);
  assert(startOk, 'Run should start');

  const runRow = (await q(env, `SELECT * FROM runs WHERE chat_id = ? AND status = 'submission'`, [groupChatId])).rows[0];
  assert(runRow, 'Run must exist');
  assert.equal(runRow.status, 'submission');
  // Check that duration was based on submit_hours
  const expectedMin = (runRow.submit_hours || 7) * 60;
  assert.equal(runRow.end_ts - runRow.start_ts, expectedMin * 60000, 'Duration must match submit_hours');

  // ==========================================
  // Test 8: Submissions validation
  // ==========================================
  console.log('Test 8: Contest submissions validation (Image vs Text)');
  const participant1 = 1001;
  const participant2 = 1002;
  const participant3 = 1003;
  const participantJoinedOnly = 1004;

  // Ensure participants in users table
  for (const uid of [participant1, participant2, participant3, participantJoinedOnly]) {
    await q(env, `INSERT OR REPLACE INTO users (user_id, username, first_name, coins) VALUES (?, ?, ?, ?)`,
      [uid, `user${uid}`, `User ${uid}`, 0]);
  }

  // All join the run
  await handleJoin(env, { id: participant1 }, runRow.run_id);
  await handleJoin(env, { id: participant2 }, runRow.run_id);
  await handleJoin(env, { id: participant3 }, runRow.run_id);
  await handleJoin(env, { id: participantJoinedOnly }, runRow.run_id);

  // Put user 1 in pending submit run
  await kvPut(env, `pending_submit_run:${participant1}`, String(runRow.run_id), 600);

  if (runRow.submission_type === 'image') {
    // Send text to image contest -> REJECT
    const textMsg = {
      message_id: 10,
      chat: { id: participant1, type: 'private' },
      from: { id: participant1 },
      text: 'My written answer'
    };
    await handleUpdate({ update_id: 1, message: textMsg }, env);
    assert(lastTgCall.body.text.includes('This is an Image contest. Please upload a photo from your device.'),
      'Must reject text in Image contest with exact message');

    // Send valid photo -> ACCEPT
    const photoMsg = {
      message_id: 11,
      chat: { id: participant1, type: 'private' },
      from: { id: participant1 },
      photo: [{ file_id: 'sub_photo_1', width: 500, height: 500 }]
    };
    await handleUpdate({ update_id: 2, message: photoMsg }, env);
    assert(lastTgCall.body.text.includes('Submission received') || lastTgCall.body.text.includes('Entry saved') || lastTgCall.body.text.includes('received'),
      'Must accept photo submission');

    // Participant 2 submits photo
    await kvPut(env, `pending_submit_run:${participant2}`, String(runRow.run_id), 600);
    await handleUpdate({
      update_id: 3,
      message: {
        message_id: 12,
        chat: { id: participant2, type: 'private' },
        from: { id: participant2 },
        photo: [{ file_id: 'sub_photo_2', width: 500, height: 500 }]
      }
    }, env);

    // Participant 3 submits photo
    await kvPut(env, `pending_submit_run:${participant3}`, String(runRow.run_id), 600);
    await handleUpdate({
      update_id: 4,
      message: {
        message_id: 13,
        chat: { id: participant3, type: 'private' },
        from: { id: participant3 },
        photo: [{ file_id: 'sub_photo_3', width: 500, height: 500 }]
      }
    }, env);
  }

  // ==========================================
  // Test 9: Voting & Winner selection & Participation rewards
  // ==========================================
  console.log('Test 9: Voting and rewards calculation');

  // Advance run to voting
  await q(env, `UPDATE runs SET status = 'voting', vote_end_ts = ? WHERE run_id = ?`,
    [Date.now() + 3600000, runRow.run_id]);

  // Assign votes to submissions
  const subs = (await q(env, `SELECT * FROM submissions WHERE run_id = ?`, [runRow.run_id])).rows;
  assert(subs.length >= 3, 'Must have at least 3 submissions');

  // Set votes: sub 0 has 10 votes, sub 1 has 5 votes, sub 2 has 2 votes
  await q(env, `UPDATE submissions SET votes = 10 WHERE id = ?`, [subs[0].id]);
  await q(env, `UPDATE submissions SET votes = 5 WHERE id = ?`, [subs[1].id]);
  await q(env, `UPDATE submissions SET votes = 2 WHERE id = ?`, [subs[2].id]);

  const updatedRun = (await q(env, `SELECT * FROM runs WHERE run_id = ?`, [runRow.run_id])).rows[0];

  // Finish run and award prizes
  await finishRun(env, updatedRun);

  // Check run status is 'done'
  const doneRun = (await q(env, `SELECT * FROM runs WHERE run_id = ?`, [runRow.run_id])).rows[0];
  assert.equal(doneRun.status, 'done', 'Run should be marked done');

  // Check rewards in run_rewards table
  const rewards = (await q(env, `SELECT * FROM run_rewards WHERE run_id = ?`, [runRow.run_id])).rows;

  // Winner 1 should have 1st prize + participation prize
  const u1WinnerReward = rewards.find(r => r.user_id === subs[0].user_id && r.reward_type === 'winner');
  const u1PartReward = rewards.find(r => r.user_id === subs[0].user_id && r.reward_type === 'participant');
  assert(u1WinnerReward, 'Winner 1 must receive winner reward');
  assert.equal(u1WinnerReward.amount, runRow.p1, 'Winner 1 must receive p1');
  assert.equal(u1WinnerReward.place, 1);
  assert(u1PartReward, 'Winner 1 must also receive participation reward');
  assert.equal(u1PartReward.amount, runRow.ps, 'Participation reward must equal ps');

  // Winner 2
  const u2WinnerReward = rewards.find(r => r.user_id === subs[1].user_id && r.reward_type === 'winner');
  assert.equal(u2WinnerReward.amount, runRow.p2, 'Winner 2 must receive p2');

  // Winner 3
  const u3WinnerReward = rewards.find(r => r.user_id === subs[2].user_id && r.reward_type === 'winner');
  assert.equal(u3WinnerReward.amount, runRow.p3, 'Winner 3 must receive p3');

  // Joined-only participant should have ZERO rewards
  const joinedOnlyRewards = rewards.filter(r => r.user_id === participantJoinedOnly);
  assert.equal(joinedOnlyRewards.length, 0, 'Users who joined but never submitted must receive NO rewards');

  // Verify users table coins
  const u1Coins = (await q(env, `SELECT coins FROM users WHERE user_id = ?`, [subs[0].user_id])).rows[0].coins;
  assert.equal(u1Coins, runRow.p1 + runRow.ps, 'Coins in users table must reflect p1 + ps via trigger');

  // Test idempotency: calling finishRun again should not duplicate coins
  console.log('Test 9b: Idempotency of finishRun');
  await finishRun(env, doneRun);
  const u1CoinsAfter = (await q(env, `SELECT coins FROM users WHERE user_id = ?`, [subs[0].user_id])).rows[0].coins;
  assert.equal(u1CoinsAfter, u1Coins, 'Coins must not be duplicated on repeated finishRun');

  console.log('\n🎉 ALL 9 TEST SUITES AND SUB-SCENARIOS PASSED WITH ZERO ERRORS!');
}

runTests().catch(err => {
  console.error('\n❌ Test failure:', err);
  process.exit(1);
});
