import assert from 'node:assert';
import { detectMedia, formatMediaBadge, sendSubmissionEntry } from '../src/media.js';

async function testMedia() {
  console.log('🧪 Testing Universal Media Detection & Handling...\n');

  // 1. Photo
  const photoMsg = {
    message_id: 1,
    photo: [
      { file_id: 'small_photo', width: 100, height: 100 },
      { file_id: 'large_photo', width: 1280, height: 720, file_size: 204800, file_unique_id: 'u_photo_1' }
    ],
    caption: 'Sunset in Tokyo'
  };
  const dPhoto = detectMedia(photoMsg);
  assert.equal(dPhoto.kind, 'photo');
  assert.equal(dPhoto.file_id, 'large_photo');
  assert.equal(dPhoto.caption, 'Sunset in Tokyo');
  assert.equal(dPhoto.metadata.width, 1280);

  // 2. Static Sticker
  const staticStickerMsg = {
    message_id: 2,
    sticker: {
      file_id: 'st_static_1',
      file_unique_id: 'u_st_1',
      emoji: '😎',
      set_name: 'cool_pack',
      is_animated: false,
      is_video: false,
      file_size: 45000
    }
  };
  const dSticker = detectMedia(staticStickerMsg);
  assert.equal(dSticker.kind, 'sticker');
  assert.equal(dSticker.metadata.is_animated, false);
  assert.equal(dSticker.metadata.emoji, '😎');
  assert.equal(dSticker.metadata.set_name, 'cool_pack');

  // 3. Animated Sticker (TGS)
  const animStickerMsg = {
    message_id: 3,
    sticker: {
      file_id: 'st_tgs_1',
      file_unique_id: 'u_tgs_1',
      emoji: '🎉',
      set_name: 'festive_pack',
      is_animated: true,
      is_video: false
    }
  };
  const dAnimSticker = detectMedia(animStickerMsg);
  assert.equal(dAnimSticker.kind, 'sticker');
  assert.equal(dAnimSticker.metadata.is_animated, true);

  // 4. Video Sticker (WEBM)
  const vidStickerMsg = {
    message_id: 4,
    sticker: {
      file_id: 'st_webm_1',
      file_unique_id: 'u_webm_1',
      emoji: '🔥',
      set_name: 'hot_pack',
      is_animated: false,
      is_video: true
    }
  };
  const dVidSticker = detectMedia(vidStickerMsg);
  assert.equal(dVidSticker.kind, 'sticker');
  assert.equal(dVidSticker.metadata.is_video, true);

  // 5. Video
  const videoMsg = {
    message_id: 5,
    video: {
      file_id: 'vid_1',
      file_unique_id: 'u_vid_1',
      duration: 42,
      width: 1920,
      height: 1080,
      mime_type: 'video/mp4',
      file_size: 10485760
    },
    caption: 'Drone shot'
  };
  const dVideo = detectMedia(videoMsg);
  assert.equal(dVideo.kind, 'video');
  assert.equal(dVideo.metadata.duration, 42);
  assert.equal(dVideo.metadata.mime_type, 'video/mp4');

  // 6. Animation / GIF
  const animMsg = {
    message_id: 6,
    animation: {
      file_id: 'gif_1',
      file_unique_id: 'u_gif_1',
      duration: 3,
      width: 480,
      height: 360,
      mime_type: 'video/mp4'
    }
  };
  const dAnim = detectMedia(animMsg);
  assert.equal(dAnim.kind, 'animation');
  assert.equal(dAnim.metadata.duration, 3);

  // 7. Video Note (round video)
  const vNoteMsg = {
    message_id: 7,
    video_note: {
      file_id: 'vn_1',
      file_unique_id: 'u_vn_1',
      duration: 15,
      length: 240
    }
  };
  const dVNote = detectMedia(vNoteMsg);
  assert.equal(dVNote.kind, 'video_note');
  assert.equal(dVNote.metadata.duration, 15);

  // 8. Voice Message
  const voiceMsg = {
    message_id: 8,
    voice: {
      file_id: 'voice_1',
      file_unique_id: 'u_voice_1',
      duration: 18,
      mime_type: 'audio/ogg'
    }
  };
  const dVoice = detectMedia(voiceMsg);
  assert.equal(dVoice.kind, 'voice');
  assert.equal(dVoice.metadata.duration, 18);

  // 9. Audio / Music
  const audioMsg = {
    message_id: 9,
    audio: {
      file_id: 'audio_1',
      file_unique_id: 'u_audio_1',
      duration: 210,
      title: 'Midnight Sun',
      performer: 'Synthwave Artist',
      mime_type: 'audio/mpeg'
    }
  };
  const dAudio = detectMedia(audioMsg);
  assert.equal(dAudio.kind, 'audio');
  assert.equal(dAudio.metadata.title, 'Midnight Sun');
  assert.equal(dAudio.metadata.performer, 'Synthwave Artist');

  // 10. Document / PDF / File
  const docMsg = {
    message_id: 10,
    document: {
      file_id: 'doc_1',
      file_unique_id: 'u_doc_1',
      file_name: 'paper.pdf',
      mime_type: 'application/pdf',
      file_size: 1024000
    },
    caption: 'Research paper'
  };
  const dDoc = detectMedia(docMsg);
  assert.equal(dDoc.kind, 'document');
  assert.equal(dDoc.metadata.file_name, 'paper.pdf');
  assert.equal(dDoc.metadata.mime_type, 'application/pdf');

  // 11. Contact
  const contactMsg = {
    message_id: 11,
    contact: {
      phone_number: '+1234567890',
      first_name: 'John',
      last_name: 'Doe',
      user_id: 55555
    }
  };
  const dContact = detectMedia(contactMsg);
  assert.equal(dContact.kind, 'contact');
  assert.equal(dContact.metadata.first_name, 'John');

  // 12. Location & Venue
  const locMsg = {
    message_id: 12,
    location: {
      latitude: 37.7749,
      longitude: -122.4194
    }
  };
  const dLoc = detectMedia(locMsg);
  assert.equal(dLoc.kind, 'location');
  assert.equal(dLoc.metadata.latitude, 37.7749);

  // 13. Dice
  const diceMsg = {
    message_id: 13,
    dice: {
      emoji: '🎲',
      value: 6
    }
  };
  const dDice = detectMedia(diceMsg);
  assert.equal(dDice.kind, 'dice');
  assert.equal(dDice.metadata.value, 6);

  // 14. Text with formatting entities
  const textMsg = {
    message_id: 14,
    text: 'Hello world with bold text',
    entities: [{ type: 'bold', offset: 17, length: 9 }]
  };
  const dText = detectMedia(textMsg);
  assert.equal(dText.kind, 'text');
  assert.equal(dText.text, 'Hello world with bold text');
  assert.equal(dText.metadata.entities.length, 1);

  // Test badges
  assert.equal(formatMediaBadge(dPhoto), '🖼️ Photo');
  assert.equal(formatMediaBadge(dSticker), '🎭 Sticker (Static 😎)');
  assert.equal(formatMediaBadge(dAnimSticker), '🎭 Sticker (Animated 🎉)');
  assert.equal(formatMediaBadge(dVidSticker), '🎭 Sticker (Video 🔥)');
  assert.equal(formatMediaBadge(dVideo), '🎬 Video (42s)');
  assert.equal(formatMediaBadge(dAnim), '🎞️ GIF Animation');
  assert.equal(formatMediaBadge(dVoice), '🎙️ Voice Message (18s)');
  assert.equal(formatMediaBadge(dAudio), '🎵 Audio: Midnight Sun by Synthwave Artist');
  assert.equal(formatMediaBadge(dDoc), '📄 Document: paper.pdf');
  assert.equal(formatMediaBadge(dContact), '👤 Contact: John Doe');
  assert.equal(formatMediaBadge(dLoc), '📍 Location (37.7749, -122.4194)');
  assert.equal(formatMediaBadge(dDice), '🎲 Dice (🎲: 6)');

  // Test sendSubmissionEntry with mock Telegram API
  const calls = [];
  const mockEnv = {
    BOT_TOKEN: '123:MOCK'
  };
  globalThis.fetch = async (url, options) => {
    const urlStr = String(url);
    const method = urlStr.split('/').pop();
    const body = JSON.parse(options.body);
    calls.push({ method, body });
    return {
      ok: true,
      json: async () => ({ ok: true, result: { message_id: 777 } })
    };
  };

  // Resend photo entry
  const photoSub = {
    id: 1,
    content_json: JSON.stringify(dPhoto),
    votes: 4
  };
  await sendSubmissionEntry(mockEnv, -1001, photoSub, 1, { inline_keyboard: [] });
  const photoCall = calls.find(c => c.method === 'sendPhoto');
  assert(photoCall, 'Should call sendPhoto');
  assert.equal(photoCall.body.photo, 'large_photo');

  // Resend sticker entry
  const stickerSub = {
    id: 2,
    content_json: JSON.stringify(dSticker),
    votes: 3
  };
  await sendSubmissionEntry(mockEnv, -1001, stickerSub, 2, { inline_keyboard: [] });
  const stickerCall = calls.find(c => c.method === 'sendSticker');
  assert(stickerCall, 'Should call sendSticker');
  assert.equal(stickerCall.body.sticker, 'st_static_1');

  // Resend voice entry
  const voiceSub = {
    id: 3,
    content_json: JSON.stringify(dVoice),
    votes: 2
  };
  await sendSubmissionEntry(mockEnv, -1001, voiceSub, 3, { inline_keyboard: [] });
  const voiceCall = calls.find(c => c.method === 'sendVoice');
  assert(voiceCall, 'Should call sendVoice');
  assert.equal(voiceCall.body.voice, 'voice_1');

  // Resend contact entry
  const contactSub = {
    id: 4,
    content_json: JSON.stringify(dContact),
    votes: 1
  };
  await sendSubmissionEntry(mockEnv, -1001, contactSub, 4, { inline_keyboard: [] });
  const contactCall = calls.find(c => c.method === 'sendContact');
  assert(contactCall, 'Should call sendContact');
  assert.equal(contactCall.body.phone_number, '+1234567890');

  console.log('🎉 Universal Media Detection & Resend Test Passed Successfully!\n');
}

testMedia().catch(err => {
  console.error('❌ Media test failed:', err);
  process.exit(1);
});
