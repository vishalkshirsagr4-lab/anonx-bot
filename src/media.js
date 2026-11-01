// src/media.js
import { tg } from './telegram.js';
import { send } from './cards.js';
import { esc } from './helpers.js';

/**
 * Universal Telegram Media & Data Detection Helper.
 * Safely inspects incoming Telegram messages and extracts structured metadata.
 */
export function detectMedia(msg) {
  if (!msg || typeof msg !== 'object') {
    return {
      version: 1,
      kind: 'unknown',
      file_id: null,
      file_unique_id: null,
      caption: '',
      text: '',
      metadata: {}
    };
  }

  const caption = typeof msg.caption === 'string' ? msg.caption : '';
  const captionEntities = Array.isArray(msg.caption_entities) ? msg.caption_entities : [];

  // 1. Photos
  if (Array.isArray(msg.photo) && msg.photo.length > 0) {
    const best = msg.photo[msg.photo.length - 1];
    return {
      version: 1,
      kind: 'photo',
      file_id: best.file_id,
      file_unique_id: best.file_unique_id || null,
      caption,
      text: '',
      metadata: {
        width: best.width || null,
        height: best.height || null,
        file_size: best.file_size || null,
        caption_entities: captionEntities
      }
    };
  }

  // 2. Stickers (Static, Animated TGS, Video WEBM)
  if (msg.sticker) {
    const s = msg.sticker;
    return {
      version: 1,
      kind: 'sticker',
      file_id: s.file_id,
      file_unique_id: s.file_unique_id || null,
      caption: '',
      text: '',
      metadata: {
        emoji: s.emoji || '',
        set_name: s.set_name || '',
        is_animated: Boolean(s.is_animated),
        is_video: Boolean(s.is_video),
        sticker_type: s.type || 'regular',
        width: s.width || null,
        height: s.height || null,
        file_size: s.file_size || null
      }
    };
  }

  // 3. Animation / GIFs
  if (msg.animation) {
    const a = msg.animation;
    return {
      version: 1,
      kind: 'animation',
      file_id: a.file_id,
      file_unique_id: a.file_unique_id || null,
      caption,
      text: '',
      metadata: {
        file_name: a.file_name || 'animation.gif',
        mime_type: a.mime_type || 'video/mp4',
        duration: a.duration || null,
        width: a.width || null,
        height: a.height || null,
        file_size: a.file_size || null,
        caption_entities: captionEntities
      }
    };
  }

  // 4. Regular Videos
  if (msg.video) {
    const v = msg.video;
    return {
      version: 1,
      kind: 'video',
      file_id: v.file_id,
      file_unique_id: v.file_unique_id || null,
      caption,
      text: '',
      metadata: {
        file_name: v.file_name || 'video.mp4',
        mime_type: v.mime_type || 'video/mp4',
        duration: v.duration || null,
        width: v.width || null,
        height: v.height || null,
        file_size: v.file_size || null,
        caption_entities: captionEntities
      }
    };
  }

  // 5. Video Notes (round quick video)
  if (msg.video_note) {
    const vn = msg.video_note;
    return {
      version: 1,
      kind: 'video_note',
      file_id: vn.file_id,
      file_unique_id: vn.file_unique_id || null,
      caption: '',
      text: '',
      metadata: {
        duration: vn.duration || null,
        length: vn.length || null,
        file_size: vn.file_size || null
      }
    };
  }

  // 6. Voice Messages
  if (msg.voice) {
    const vc = msg.voice;
    return {
      version: 1,
      kind: 'voice',
      file_id: vc.file_id,
      file_unique_id: vc.file_unique_id || null,
      caption,
      text: '',
      metadata: {
        duration: vc.duration || null,
        mime_type: vc.mime_type || 'audio/ogg',
        file_size: vc.file_size || null,
        caption_entities: captionEntities
      }
    };
  }

  // 7. Audio Files & Music
  if (msg.audio) {
    const au = msg.audio;
    return {
      version: 1,
      kind: 'audio',
      file_id: au.file_id,
      file_unique_id: au.file_unique_id || null,
      caption,
      text: '',
      metadata: {
        title: au.title || '',
        performer: au.performer || '',
        file_name: au.file_name || 'audio.mp3',
        mime_type: au.mime_type || 'audio/mpeg',
        duration: au.duration || null,
        file_size: au.file_size || null,
        caption_entities: captionEntities
      }
    };
  }

  // 8. Documents & Files (PDF, ZIP, TXT, etc.)
  if (msg.document) {
    const doc = msg.document;
    return {
      version: 1,
      kind: 'document',
      file_id: doc.file_id,
      file_unique_id: doc.file_unique_id || null,
      caption,
      text: '',
      metadata: {
        file_name: doc.file_name || 'document',
        mime_type: doc.mime_type || 'application/octet-stream',
        file_size: doc.file_size || null,
        caption_entities: captionEntities
      }
    };
  }

  // 9. Contacts
  if (msg.contact) {
    const c = msg.contact;
    return {
      version: 1,
      kind: 'contact',
      file_id: null,
      file_unique_id: null,
      caption: '',
      text: '',
      metadata: {
        phone_number: c.phone_number || '',
        first_name: c.first_name || '',
        last_name: c.last_name || '',
        contact_user_id: c.user_id || null,
        vcard: c.vcard || ''
      }
    };
  }

  // 10. Locations
  if (msg.location && !msg.venue) {
    const loc = msg.location;
    return {
      version: 1,
      kind: 'location',
      file_id: null,
      file_unique_id: null,
      caption: '',
      text: '',
      metadata: {
        latitude: loc.latitude,
        longitude: loc.longitude,
        horizontal_accuracy: loc.horizontal_accuracy || null
      }
    };
  }

  // 11. Venues
  if (msg.venue) {
    const ven = msg.venue;
    return {
      version: 1,
      kind: 'venue',
      file_id: null,
      file_unique_id: null,
      caption: '',
      text: '',
      metadata: {
        latitude: ven.location?.latitude,
        longitude: ven.location?.longitude,
        title: ven.title || '',
        address: ven.address || '',
        foursquare_id: ven.foursquare_id || '',
        google_place_id: ven.google_place_id || ''
      }
    };
  }

  // 12. Polls
  if (msg.poll) {
    const p = msg.poll;
    return {
      version: 1,
      kind: 'poll',
      file_id: null,
      file_unique_id: null,
      caption: '',
      text: '',
      metadata: {
        question: p.question || '',
        options: Array.isArray(p.options) ? p.options.map(o => o.text) : [],
        poll_type: p.type || 'regular',
        is_anonymous: Boolean(p.is_anonymous)
      }
    };
  }

  // 13. Dice
  if (msg.dice) {
    return {
      version: 1,
      kind: 'dice',
      file_id: null,
      file_unique_id: null,
      caption: '',
      text: '',
      metadata: {
        emoji: msg.dice.emoji || '🎲',
        value: msg.dice.value || 0
      }
    };
  }

  // 14. Games
  if (msg.game) {
    return {
      version: 1,
      kind: 'game',
      file_id: null,
      file_unique_id: null,
      caption: '',
      text: '',
      metadata: {
        title: msg.game.title || '',
        description: msg.game.description || ''
      }
    };
  }

  // 15. Text
  if (typeof msg.text === 'string' && msg.text.trim().length > 0) {
    return {
      version: 1,
      kind: 'text',
      file_id: null,
      file_unique_id: null,
      caption: '',
      text: msg.text,
      metadata: {
        entities: Array.isArray(msg.entities) ? msg.entities : []
      }
    };
  }

  return {
    version: 1,
    kind: 'unknown',
    file_id: null,
    file_unique_id: null,
    caption,
    text: '',
    metadata: {}
  };
}

/**
 * Normalizes any stored submission JSON (handling both legacy and modern formats).
 */
export function normalizeSubmission(raw) {
  if (!raw) {
    return {
      version: 1,
      kind: 'unknown',
      file_id: null,
      file_unique_id: null,
      caption: '',
      text: '',
      metadata: {}
    };
  }

  let obj = raw;
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw);
    } catch {
      return {
        version: 1,
        kind: 'text',
        file_id: null,
        file_unique_id: null,
        caption: '',
        text: String(raw),
        metadata: {}
      };
    }
  }

  if (typeof obj !== 'object' || obj === null) {
    return {
      version: 1,
      kind: 'text',
      file_id: null,
      file_unique_id: null,
      caption: '',
      text: String(obj || ''),
      metadata: {}
    };
  }

  // Return with safe fallbacks
  return {
    version: obj.version || 1,
    kind: obj.kind || (obj.file_id ? 'photo' : (obj.text ? 'text' : 'unknown')),
    file_id: obj.file_id || null,
    file_unique_id: obj.file_unique_id || null,
    caption: obj.caption || '',
    text: obj.text || '',
    metadata: obj.metadata || {}
  };
}

/**
 * Human-readable description of the submission type and details.
 */
export function formatMediaBadge(sub) {
  const kind = sub.kind || 'text';
  const meta = sub.metadata || {};

  switch (kind) {
    case 'photo':
      return '🖼️ Photo';
    case 'sticker': {
      const type = meta.is_video ? 'Video' : (meta.is_animated ? 'Animated' : 'Static');
      return `🎭 Sticker (${type}${meta.emoji ? ' ' + meta.emoji : ''})`;
    }
    case 'video':
      return `🎬 Video${meta.duration ? ' (' + meta.duration + 's)' : ''}`;
    case 'animation':
      return '🎞️ GIF Animation';
    case 'video_note':
      return `📹 Video Note${meta.duration ? ' (' + meta.duration + 's)' : ''}`;
    case 'voice':
      return `🎙️ Voice Message${meta.duration ? ' (' + meta.duration + 's)' : ''}`;
    case 'audio': {
      const title = meta.title || meta.file_name || 'Track';
      const performer = meta.performer ? ` by ${meta.performer}` : '';
      return `🎵 Audio: ${title}${performer}`;
    }
    case 'document':
      return `📄 Document: ${meta.file_name || 'File'}`;
    case 'contact':
      return `👤 Contact: ${meta.first_name || ''} ${meta.last_name || ''}`.trim();
    case 'location':
      return `📍 Location (${meta.latitude}, ${meta.longitude})`;
    case 'venue':
      return `🏢 Venue: ${meta.title || ''} (${meta.address || ''})`.trim();
    case 'poll':
      return `📊 Poll: ${meta.question || ''}`;
    case 'dice':
      return `🎲 Dice (${meta.emoji || '🎲'}: ${meta.value || ''})`;
    case 'text':
      return '✍️ Text';
    default:
      return '📎 Media';
  }
}

/**
 * Checks if a detected media type is allowed for a contest mode.
 * Modes:
 *   - 'image': Only photos
 *   - 'text': Only text
 *   - 'media': All valid media types & text
 */
export function validateSubmissionForMode(detected, mode = 'media') {
  const kind = detected.kind;

  if (mode === 'image') {
    if (kind === 'photo') {
      return { ok: true };
    }
    return {
      ok: false,
      error: '❌ This contest only accepts <b>Photos / Images</b>. Please send a photo.'
    };
  }

  if (mode === 'text') {
    if (kind === 'text') {
      return { ok: true };
    }
    return {
      ok: false,
      error: '❌ This contest only accepts <b>Written Text</b>. Please type your answer.'
    };
  }

  // mode === 'media'
  const acceptedKinds = [
    'photo',
    'sticker',
    'video',
    'animation',
    'video_note',
    'voice',
    'audio',
    'document',
    'contact',
    'location',
    'venue',
    'poll',
    'dice',
    'text'
  ];

  if (acceptedKinds.includes(kind)) {
    return { ok: true };
  }

  return {
    ok: false,
    error: '❌ Unsupported message type. Accepted types:\n• Photos & Stickers\n• Videos & GIF animations\n• Voice & Audio tracks\n• Documents & Files\n• Contacts, Locations & Venues\n• Text'
  };
}

/**
 * Sends a contest entry to a group during voting phase using the proper Telegram Bot API method.
 * If media cannot be sent directly, falls back safely to text rather than crashing.
 */
export async function sendSubmissionEntry(env, chatId, sub, entryNumber, replyMarkup) {
  const s = normalizeSubmission(sub.content_json);
  const header = `#${entryNumber} — Anonymous Entry`;
  const badge = formatMediaBadge(s);

  let caption = `<b>${header}</b>\n\n`;
  if (s.caption) {
    caption += `<b>${esc(s.caption)}</b>\n\n`;
  }
  if (s.kind === 'text') {
    caption += `<b>${esc(s.text)}</b>`;
  } else {
    caption += `<i>[${badge}]</i>`;
  }

  const kb = replyMarkup || { inline_keyboard: [] };

  try {
    // 1. Photo
    if (s.kind === 'photo' && s.file_id) {
      const res = await tg(env, 'sendPhoto', {
        chat_id: chatId,
        photo: s.file_id,
        caption,
        parse_mode: 'HTML',
        reply_markup: kb
      });
      if (res?.ok) return res;
    }

    // 2. Video
    if (s.kind === 'video' && s.file_id) {
      const res = await tg(env, 'sendVideo', {
        chat_id: chatId,
        video: s.file_id,
        caption,
        parse_mode: 'HTML',
        reply_markup: kb
      });
      if (res?.ok) return res;
    }

    // 3. Animation / GIF
    if (s.kind === 'animation' && s.file_id) {
      const res = await tg(env, 'sendAnimation', {
        chat_id: chatId,
        animation: s.file_id,
        caption,
        parse_mode: 'HTML',
        reply_markup: kb
      });
      if (res?.ok) return res;
    }

    // 4. Voice message
    if (s.kind === 'voice' && s.file_id) {
      const res = await tg(env, 'sendVoice', {
        chat_id: chatId,
        voice: s.file_id,
        caption,
        parse_mode: 'HTML',
        reply_markup: kb
      });
      if (res?.ok) return res;
    }

    // 5. Audio / Music
    if (s.kind === 'audio' && s.file_id) {
      const res = await tg(env, 'sendAudio', {
        chat_id: chatId,
        audio: s.file_id,
        caption,
        parse_mode: 'HTML',
        reply_markup: kb
      });
      if (res?.ok) return res;
    }

    // 6. Document / File
    if (s.kind === 'document' && s.file_id) {
      const res = await tg(env, 'sendDocument', {
        chat_id: chatId,
        document: s.file_id,
        caption,
        parse_mode: 'HTML',
        reply_markup: kb
      });
      if (res?.ok) return res;
    }

    // 7. Sticker (Static, Animated, Video)
    // Note: sendSticker in Telegram Bot API does not take a caption.
    // Send the sticker first, then send the vote banner as a linked message.
    if (s.kind === 'sticker' && s.file_id) {
      const stRes = await tg(env, 'sendSticker', {
        chat_id: chatId,
        sticker: s.file_id
      });
      if (stRes?.ok) {
        const voteMsg = await tg(env, 'sendMessage', {
          chat_id: chatId,
          text: caption,
          parse_mode: 'HTML',
          reply_markup: kb,
          reply_to_message_id: stRes.result.message_id
        });
        return voteMsg?.ok ? voteMsg : stRes;
      }
    }

    // 8. Video Note (round video)
    // Telegram sendVideoNote does not take a caption either.
    if (s.kind === 'video_note' && s.file_id) {
      const vnRes = await tg(env, 'sendVideoNote', {
        chat_id: chatId,
        video_note: s.file_id
      });
      if (vnRes?.ok) {
        const voteMsg = await tg(env, 'sendMessage', {
          chat_id: chatId,
          text: caption,
          parse_mode: 'HTML',
          reply_markup: kb,
          reply_to_message_id: vnRes.result.message_id
        });
        return voteMsg?.ok ? voteMsg : vnRes;
      }
    }

    // 9. Contact
    if (s.kind === 'contact' && s.metadata?.phone_number) {
      const ctRes = await tg(env, 'sendContact', {
        chat_id: chatId,
        phone_number: s.metadata.phone_number,
        first_name: s.metadata.first_name || 'Contact',
        last_name: s.metadata.last_name || '',
        vcard: s.metadata.vcard || undefined
      });
      if (ctRes?.ok) {
        const voteMsg = await tg(env, 'sendMessage', {
          chat_id: chatId,
          text: caption,
          parse_mode: 'HTML',
          reply_markup: kb,
          reply_to_message_id: ctRes.result.message_id
        });
        return voteMsg?.ok ? voteMsg : ctRes;
      }
    }

    // 10. Location
    if (s.kind === 'location' && s.metadata?.latitude != null && s.metadata?.longitude != null) {
      const locRes = await tg(env, 'sendLocation', {
        chat_id: chatId,
        latitude: s.metadata.latitude,
        longitude: s.metadata.longitude,
        horizontal_accuracy: s.metadata.horizontal_accuracy || undefined
      });
      if (locRes?.ok) {
        const voteMsg = await tg(env, 'sendMessage', {
          chat_id: chatId,
          text: caption,
          parse_mode: 'HTML',
          reply_markup: kb,
          reply_to_message_id: locRes.result.message_id
        });
        return voteMsg?.ok ? voteMsg : locRes;
      }
    }

    // 11. Venue
    if (s.kind === 'venue' && s.metadata?.latitude != null && s.metadata?.longitude != null) {
      const venRes = await tg(env, 'sendVenue', {
        chat_id: chatId,
        latitude: s.metadata.latitude,
        longitude: s.metadata.longitude,
        title: s.metadata.title || 'Venue',
        address: s.metadata.address || 'Location Address',
        foursquare_id: s.metadata.foursquare_id || undefined,
        google_place_id: s.metadata.google_place_id || undefined
      });
      if (venRes?.ok) {
        const voteMsg = await tg(env, 'sendMessage', {
          chat_id: chatId,
          text: caption,
          parse_mode: 'HTML',
          reply_markup: kb,
          reply_to_message_id: venRes.result.message_id
        });
        return voteMsg?.ok ? voteMsg : venRes;
      }
    }

    // 12. Dice
    if (s.kind === 'dice') {
      const diceRes = await tg(env, 'sendDice', {
        chat_id: chatId,
        emoji: s.metadata?.emoji || '🎲'
      });
      if (diceRes?.ok) {
        const voteMsg = await tg(env, 'sendMessage', {
          chat_id: chatId,
          text: caption,
          parse_mode: 'HTML',
          reply_markup: kb,
          reply_to_message_id: diceRes.result.message_id
        });
        return voteMsg?.ok ? voteMsg : diceRes;
      }
    }
  } catch (err) {
    console.error(`[sendSubmissionEntry error for kind=${s.kind}]:`, err);
  }

  // Default / Fallback: Send formatted text message with vote button
  return send(env, chatId, caption, {
    plain: true,
    reply_markup: kb
  });
}
