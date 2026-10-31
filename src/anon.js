// src/anon.js
import { state } from './config.js';
import { tg } from './telegram.js';
import { q } from './db.js';
import { genId, esc, getBotInfo } from './helpers.js';

export async function sendAnonMessage(env, userId, sourceMsg, targetChatId, replyToMsgId, threadData, textContent) {
  let userAnonNum = threadData.users[userId];
  if (!userAnonNum) {
    userAnonNum = state.ANON_SHUFFLE_MODE
      ? Math.floor(Math.random() * 900) + 100
      : threadData.nextCount++;
    threadData.users[userId] = userAnonNum;
  }
  const anonLabel = state.MULTI_ANON
    ? `Anonymous #${userAnonNum}`
    : `Anonymous Message`;
  const botInfo = await getBotInfo(env);
  const postId = genId();
  const replyMarkup = {
    inline_keyboard: [[{
      text: "💬 Reply",
      url: `https://t.me/${botInfo.username}?start=reply_${postId}`
    }]]
  };
  const reply = replyToMsgId ? { reply_to_message_id: replyToMsgId } : {};
  let sentMsg;

  if (sourceMsg.photo || sourceMsg.video || sourceMsg.document ||
      sourceMsg.voice || sourceMsg.audio) {
    let cap = sourceMsg.caption ? `<b>${esc(sourceMsg.caption)}</b>\n\n` : '';
    cap += `<i>${anonLabel}</i>`;
    sentMsg = await tg(env, 'copyMessage', {
      chat_id: targetChatId, from_chat_id: sourceMsg.chat.id,
      message_id: sourceMsg.message_id, ...reply,
      caption: cap, parse_mode: 'HTML', reply_markup: replyMarkup
    });
  } else if (sourceMsg.sticker || sourceMsg.animation) {
    sentMsg = await tg(env, 'copyMessage', {
      chat_id: targetChatId, from_chat_id: sourceMsg.chat.id,
      message_id: sourceMsg.message_id, ...reply, reply_markup: replyMarkup
    });
  } else {
    const txt = textContent || sourceMsg.text || '';
    sentMsg = await tg(env, 'sendMessage', {
      chat_id: targetChatId,
      text: `<b>${esc(txt)}</b>\n\n<i>${anonLabel}</i>`,
      parse_mode: 'HTML', ...reply, reply_markup: replyMarkup
    });
  }

  if (sentMsg.ok) {
    const now = Date.now();
    await q(env, `INSERT INTO posts (post_id, owner_id, msg_id, chat_id, thread_id, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      [postId, userId, sentMsg.result.message_id, String(targetChatId), threadData.threadId, now]);
    threadData.lastActive = now;
    await q(env, `INSERT INTO threads (thread_id, last_active, users_json, next_count) VALUES (?, ?, ?, ?) ON CONFLICT(thread_id) DO UPDATE SET last_active = excluded.last_active, users_json = excluded.users_json, next_count = excluded.next_count`,
      [threadData.threadId, threadData.lastActive, JSON.stringify(threadData.users), threadData.nextCount]);
    return { ok: true, msgId: sentMsg.result.message_id };
  }
  return { ok: false };
}