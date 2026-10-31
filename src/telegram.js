// src/telegram.js
import { state } from './config.js';

const API_BASE = 'https://api.telegram.org/bot';
export const tok = env => (env && env.BOT_TOKEN) || state.BOT_TOKEN;

export async function tg(env, method, body) {
  try {
    const res = await fetch(`${API_BASE}${tok(env)}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    });
    return await res.json();
  } catch (e) {
    return { ok: false, error_code: 0, description: String(e) };
  }
}

export async function tgForm(env, method, fields, fileField, blob, filename) {
  try {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) {
      if (v === undefined) continue;
      fd.append(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
    }
    fd.append(fileField, blob, filename);
    const res = await fetch(`${API_BASE}${tok(env)}/${method}`, { method: 'POST', body: fd });
    return await res.json();
  } catch (e) {
    return { ok: false, description: String(e) };
  }
}