// Exact Telegram sticker file_ids for Piko greeting flows.
// Paste file_ids obtained through this bot. Empty placeholders disable each sticker.
import { tg } from './telegram.js';

export const STICKERS = {
  welcome: 'PASTE_FILE_ID_HERE',
  start: 'PASTE_FILE_ID_HERE',
  contest_win: 'PASTE_FILE_ID_HERE',
  contest_open: 'PASTE_FILE_ID_HERE',
  help: 'PASTE_FILE_ID_HERE'
};

export async function sendStickerThenButtons(env, chatId, {
  sticker,
  text,
  markup,
  replyToMessageId,
  parseMode = 'HTML'
}) {
  if (typeof sticker === 'string' && sticker.trim() && sticker !== 'PASTE_FILE_ID_HERE') {
    try {
      const stickerResult = await tg(env, 'sendSticker', {
        chat_id: chatId,
        sticker
      });
      if (!stickerResult?.ok) {
        console.error('Greeting sticker send failed:', stickerResult?.description || 'Telegram send failed');
      }
    } catch (error) {
      console.error('Greeting sticker send failed:', error);
    }
  }

  return tg(env, 'sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: parseMode,
    reply_markup: markup,
    disable_web_page_preview: true,
    ...(replyToMessageId ? { reply_to_message_id: replyToMessageId } : {})
  });
}
