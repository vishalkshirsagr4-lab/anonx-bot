// Piko feature pack: Groq AI, voice transcription, credits, economy, fun and group tools.
// All credentials are supplied through Cloudflare Worker secrets/bindings.
import { state, isOwner } from './config.js';
import { q } from './db.js';
import { tg, tgForm } from './telegram.js';

const GROQ_URL = 'https://api.groq.com/openai/v1';
const CHAT_MODEL = 'llama-3.3-70b-versatile';
const VOICE_MODEL = 'whisper-large-v3-turbo';
let schemaReady = false;
let schemaPromise = null;

const esc = value => String(value ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const mention = user => user.username ? '@'+esc(user.username) : '<a href="tg://user?id='+Number(user.id)+'">'+esc(user.first_name || 'User')+'</a>';
const argsOf = text => String(text || '').trim().split(/\s+/).filter(Boolean);
const rand = (a,b) => Math.floor(Math.random()*(b-a+1))+a;
const groqKey = env => env?.GROQ_API_KEY || '';

async function ensureSchema(env) {
  if (schemaReady) return;
  if (schemaPromise) return schemaPromise;
  schemaPromise = (async () => {
  const statements = [
    `CREATE TABLE IF NOT EXISTS piko_profiles (user_id INTEGER PRIMARY KEY, credits INTEGER NOT NULL DEFAULT 30, daily_at INTEGER, work_at INTEGER, crime_at INTEGER, rob_at INTEGER, warnings INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS piko_history (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, created_at INTEGER NOT NULL)`,
    `CREATE INDEX IF NOT EXISTS idx_piko_history_user ON piko_history(user_id,id)`,
    `CREATE TABLE IF NOT EXISTS piko_groups (chat_id TEXT PRIMARY KEY, welcome_enabled INTEGER NOT NULL DEFAULT 1, welcome_text TEXT NOT NULL DEFAULT 'Welcome {first} to {chatname}! 🎉')`,
    `CREATE TABLE IF NOT EXISTS piko_filters (id INTEGER PRIMARY KEY AUTOINCREMENT, chat_id TEXT NOT NULL, keyword TEXT NOT NULL, response TEXT NOT NULL, UNIQUE(chat_id,keyword))`,
    `CREATE TABLE IF NOT EXISTS piko_bans (user_id INTEGER PRIMARY KEY, reason TEXT, created_at INTEGER NOT NULL)`
  ];
  for (const sql of statements) await q(env, sql);
  schemaReady = true;
  })().catch(error => { schemaPromise = null; throw error; });
  return schemaPromise;
}

async function profile(env, user) {
  await ensureSchema(env);
  await q(env, `INSERT OR IGNORE INTO piko_profiles(user_id,created_at) VALUES(?,?)`, [user.id,Date.now()]);
  await q(env, `INSERT INTO users(user_id,first_name,username,created_at,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET first_name=excluded.first_name,username=excluded.username,updated_at=excluded.updated_at`, [user.id,user.first_name||'',user.username||'',Date.now(),Date.now()]);
  const r=await q(env,`SELECT p.*,u.coins FROM piko_profiles p LEFT JOIN users u ON u.user_id=p.user_id WHERE p.user_id=?`,[user.id]);
  return r.rows[0] || {credits:30,coins:0};
}
async function reply(env, chatId, text, extra={}) { return tg(env,'sendMessage',{chat_id:chatId,text,parse_mode:'HTML',...extra}); }
async function ownerOnly(env, msg) { if (!isOwner(msg.from.id)) { await reply(env,msg.chat.id,'⛔ Owner only.'); return false; } return true; }
async function banned(env,id) { const r=await q(env,'SELECT 1 FROM piko_bans WHERE user_id=?',[id]); return r.rows.length>0; }

async function groqChat(env, userId, input) {
  const key=groqKey(env); if(!key) return 'Piko AI is not configured yet. Add GROQ_API_KEY as a Cloudflare secret.';
  const h=await q(env,'SELECT role,content FROM piko_history WHERE user_id=? ORDER BY id DESC LIMIT 8',[userId]);
  const messages=[{role:'system',content:'You are Piko, a friendly, helpful and playful assistant. Keep replies concise, respectful and safe. You can understand English, Hindi and Kannada. Do not insult, bully, or provide dangerous instructions.'},...h.rows.reverse(),{role:'user',content:input.slice(0,4000)}];
  const res=await fetch(GROQ_URL+'/chat/completions',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({model:env?.GROQ_CHAT_MODEL||CHAT_MODEL,messages,max_tokens:350,temperature:0.7})});
  const data=await res.json(); if(!res.ok) throw new Error(data.error?.message||'Groq request failed');
  const answer=String(data.choices?.[0]?.message?.content||'I could not generate a reply.').slice(0,4000);
  await q(env,'INSERT INTO piko_history(user_id,role,content,created_at) VALUES(?,?,?,?)',[userId,'user',input.slice(0,4000),Date.now()]);
  await q(env,'INSERT INTO piko_history(user_id,role,content,created_at) VALUES(?,?,?,?)',[userId,'assistant',answer,Date.now()]);
  await q(env,'DELETE FROM piko_history WHERE user_id=? AND id NOT IN (SELECT id FROM piko_history WHERE user_id=? ORDER BY id DESC LIMIT 16)',[userId,userId]);
  return answer;
}
function remaining(last, hours) { if(!last)return 0; return Math.max(0,hours*3600000-(Date.now()-last)); }
function duration(ms) { const h=Math.floor(ms/3600000),m=Math.floor(ms%3600000/60000); return h? h+'h '+m+'m':m+'m'; }

async function economy(env,msg,cmd) {
  const id=msg.from.id, a=argsOf(cmd.arg), p=await profile(env,msg.from), now=Date.now();
  if(cmd.name==='credits'||cmd.name==='wallet') return reply(env,msg.chat.id,`💼 <b>Piko Wallet</b>\n\n✨ Credits: <b>${p.credits}</b>\n🪙 Coins: <b>${p.coins||0}</b>\n\nUse /daily and /work to earn coins.`);
  if(cmd.name==='daily'||cmd.name==='work'||cmd.name==='crime'||cmd.name==='rob'){
    const field={daily:'daily_at',work:'work_at',crime:'crime_at',rob:'rob_at'}[cmd.name], hours={daily:24,work:1,crime:2,rob:6}[cmd.name];
    const wait=remaining(p[field],hours); if(wait) return reply(env,msg.chat.id,'⏳ Try again in '+duration(wait)+'.');
    if(cmd.name==='rob'){
      const target=msg.reply_to_message?.from; if(!target||target.is_bot||target.id===id) return reply(env,msg.chat.id,'Reply to a group member with /rob.');
      const t=await profile(env,target); if((t.coins||0)<50) return reply(env,msg.chat.id,'That user needs at least 50 coins.');
      await q(env,'UPDATE piko_profiles SET rob_at=? WHERE user_id=?',[now,id]);
      if(Math.random()<0.5){const n=rand(30,Math.min(200,t.coins));await q(env,'UPDATE users SET coins=MAX(0,coins+?) WHERE user_id=?', [n,id]);await q(env,'UPDATE users SET coins=MAX(0,coins-?) WHERE user_id=?',[n,target.id]);return reply(env,msg.chat.id,`💸 You won ${n} coins from ${mention(target)}.`);}
      const fine=rand(10,40);await q(env,'UPDATE users SET coins=MAX(0,coins-?) WHERE user_id=?',[fine,id]);return reply(env,msg.chat.id,`🚓 You were caught. Fine: ${fine} coins.`);
    }
    let reward,desc;
    if(cmd.name==='daily'){reward=rand(150,300);desc='Daily reward';}
    else if(cmd.name==='work'){reward=rand(50,120);desc='Work completed';}
    else {const win=Math.random()<0.6;reward=win?rand(40,120):-rand(20,60);desc=win?'Fictional challenge succeeded':'Fictional challenge failed';}
    await q(env,`UPDATE piko_profiles SET ${field}=? WHERE user_id=?`,[now,id]);
    await q(env,'UPDATE users SET coins=MAX(0,coins+?) WHERE user_id=?',[reward,id]);
    return reply(env,msg.chat.id,`💰 <b>${desc}</b>\n${reward>=0?'+':''}${reward} coins.`);
  }
  if(cmd.name==='pay'){
    const target=msg.reply_to_message?.from, amount=Number(a[0]);
    if(!target||target.is_bot||target.id===id||!Number.isSafeInteger(amount)||amount<1||amount>100000) return reply(env,msg.chat.id,'Reply to a member: /pay amount');
    const sender=await profile(env,msg.from); if((sender.coins||0)<amount)return reply(env,msg.chat.id,'Not enough coins.');
    await profile(env,target);
    await q(env,'UPDATE users SET coins=coins-? WHERE user_id=?',[amount,id]);await q(env,'UPDATE users SET coins=coins+? WHERE user_id=?',[amount,target.id]);
    return reply(env,msg.chat.id,`✅ Sent ${amount} coins to ${mention(target)}.`);
  }
}

const TRIVIA=[
 ['Capital of Japan?','Tokyo',['Beijing','Seoul','Tokyo','Bangkok']],
 ['Sides of a hexagon?','6',['5','6','7','8']],
 ['Red Planet?','Mars',['Venus','Mars','Jupiter','Saturn']],
 ['7 × 8 = ?','56',['48','54','56','63']],
 ['Gas plants absorb?','CO₂',['O₂','N₂','CO₂','H₂']],
 ['Largest ocean?','Pacific',['Atlantic','Pacific','Indian','Arctic']]
];
async function funCommand(env,msg,cmd){
  const target=msg.reply_to_message?.from;
  if(['hug','slap','punch','kick'].includes(cmd.name)){
    if(!target)return reply(env,msg.chat.id,'Reply to someone to use /'+cmd.name+'.');
    const verbs={hug:'gives a friendly hug to',slap:'playfully slaps',punch:'challenges',kick:'playfully kicks'};
    const icons={hug:'🤗',slap:'👋',punch:'👊',kick:'🦵'};
    return reply(env,msg.chat.id,`${icons[cmd.name]} ${mention(msg.from)} ${verbs[cmd.name]} ${mention(target)}!`);
  }
  if(cmd.name==='ship'){
    if(!target)return reply(env,msg.chat.id,'Reply to someone: /ship');
    const score=rand(0,100);return reply(env,msg.chat.id,`✨ <b>Friendship match</b>\n${mention(msg.from)} + ${mention(target)}\n<b>${score}%</b> ${'💚'.repeat(Math.floor(score/20))}`);
  }
  if(cmd.name==='roll') return reply(env,msg.chat.id,'🎲 You rolled <b>'+rand(1,6)+'</b>.');
  if(cmd.name==='trivia'){
    const [question,answer,choices]=TRIVIA[rand(0,TRIVIA.length-1)],shuffled=[...choices].sort(()=>Math.random()-0.5);
    const buttons=shuffled.map((v,i)=>[{text:(i+1)+'. '+v,callback_data:'piko_trivia_'+msg.from.id+'_'+(v===answer?'1':'0')}]);
    await q(env,'INSERT OR REPLACE INTO kv_store(key,value,expires_at) VALUES(?,?,?)',['piko_trivia:'+msg.from.id,answer,Date.now()+60000]);
    return reply(env,msg.chat.id,'❓ <b>'+question+'</b>',{reply_markup:{inline_keyboard:buttons}});
  }
}

async function imageCommand(env,msg,cmd){
  const prompt=String(cmd.arg||'').trim(); if(!prompt)return reply(env,msg.chat.id,'Usage: /img describe your image');
  const p=await profile(env,msg.from);if(p.credits<5)return reply(env,msg.chat.id,'You need 5 credits. Use /daily to earn coins; ask the owner about credits.');
  const status=await reply(env,msg.chat.id,'🎨 Piko is creating your image…');
  try{
    const url='https://image.pollinations.ai/prompt/'+encodeURIComponent(prompt)+'?width=1024&height=1024&nologo=true';
    const res=await fetch(url);if(!res.ok)throw new Error('Image provider returned '+res.status);
    const blob=await res.blob();if(blob.size>10*1024*1024)throw new Error('Image is too large');
    const sent=await tgForm(env,'sendPhoto',{chat_id:msg.chat.id,caption:'🎨 <b>Piko AI Image</b>\n'+esc(prompt.slice(0,700)),parse_mode:'HTML'},'photo',blob,'piko.png');
    if(!sent.ok)throw new Error(sent.description||'Telegram upload failed');
    await q(env,'UPDATE piko_profiles SET credits=credits-5 WHERE user_id=? AND credits>=5',[msg.from.id]);
    await tg(env,'deleteMessage',{chat_id:msg.chat.id,message_id:status.result.message_id});
  }catch(e){await tg(env,'editMessageText',{chat_id:msg.chat.id,message_id:status.result.message_id,text:'Image generation failed. Please try again later.'});}
}

async function voiceCommand(env,msg){
  const key=groqKey(env);if(!key)return reply(env,msg.chat.id,'Voice transcription needs GROQ_API_KEY in Cloudflare secrets.');
  const fileId=msg.voice?.file_id||msg.audio?.file_id;if(!fileId)return false;
  const meta=await tg(env,'getFile',{file_id:fileId});if(!meta.ok)return reply(env,msg.chat.id,'Could not retrieve that voice file.');
  const token=env.BOT_TOKEN||state.BOT_TOKEN;
  const file=await fetch('https://api.telegram.org/file/bot'+token+'/'+meta.result.file_path);
  if(!file.ok)return reply(env,msg.chat.id,'Could not download the voice file.');
  const form=new FormData();form.append('file',await file.blob(),'voice.ogg');form.append('model',env.GROQ_VOICE_MODEL||VOICE_MODEL);
  const result=await fetch(GROQ_URL+'/audio/transcriptions',{method:'POST',headers:{Authorization:'Bearer '+key},body:form});
  const data=await result.json();if(!result.ok)return reply(env,msg.chat.id,'Transcription failed: '+esc(data.error?.message||'provider error'));
  const transcript=String(data.text||'').slice(0,3500);if(!transcript)return reply(env,msg.chat.id,'No speech was detected.');
  await reply(env,msg.chat.id,'🎙️ <b>Transcription</b>\n'+esc(transcript));
  const answer=await groqChat(env,msg.from.id,'A user sent this voice message: '+transcript+'\nReply helpfully and briefly.');
  return reply(env,msg.chat.id,'🤖 <b>Piko says</b>\n'+esc(answer));
}

async function groupTools(env,msg,cmd){
  const chat=String(msg.chat.id), uid=msg.from.id;
  const admin=async()=>{const r=await tg(env,'getChatMember',{chat_id:chat,user_id:uid});return r.ok&&['creator','administrator'].includes(r.result.status);};
  if(['welcome','setwelcome','delwelcome','save','stop','filters','ban','unban'].includes(cmd.name)&&!(await admin()))return reply(env,chat,'⛔ Group admins only.');
  if(cmd.name==='welcome'){
    const on=cmd.arg.trim().toLowerCase();if(!['on','off'].includes(on))return reply(env,chat,'Usage: /welcome on or /welcome off');
    await q(env,'INSERT INTO piko_groups(chat_id,welcome_enabled) VALUES(?,?) ON CONFLICT(chat_id) DO UPDATE SET welcome_enabled=excluded.welcome_enabled',[chat,on==='on'?1:0]);return reply(env,chat,'Welcome messages turned '+on+'.');
  }
  if(cmd.name==='setwelcome'){
    const value=cmd.arg.trim();if(!value||value.length>1000)return reply(env,chat,'Usage: /setwelcome Welcome {first} to {chatname}');
    await q(env,'INSERT INTO piko_groups(chat_id,welcome_text) VALUES(?,?) ON CONFLICT(chat_id) DO UPDATE SET welcome_text=excluded.welcome_text',[chat,value]);return reply(env,chat,'✅ Welcome text saved.');
  }
  if(cmd.name==='delwelcome'){await q(env,'INSERT INTO piko_groups(chat_id,welcome_enabled,welcome_text) VALUES(?,0,?) ON CONFLICT(chat_id) DO UPDATE SET welcome_enabled=0,welcome_text=excluded.welcome_text',[chat,'Welcome {first} to {chatname}! 🎉']);return reply(env,chat,'Welcome message disabled and reset.');}
  if(cmd.name==='save'){
    const a=argsOf(cmd.arg),keyword=(a.shift()||'').toLowerCase(),response=(a.join(' ')||msg.reply_to_message?.text||'').trim();
    if(!keyword||!response)return reply(env,chat,'Usage: /save keyword response (or reply to a message).');
    await q(env,'INSERT INTO piko_filters(chat_id,keyword,response) VALUES(?,?,?) ON CONFLICT(chat_id,keyword) DO UPDATE SET response=excluded.response',[chat,keyword.slice(0,80),response.slice(0,1000)]);return reply(env,chat,'✅ Saved keyword filter: '+esc(keyword));
  }
  if(cmd.name==='stop'){
    const keyword=cmd.arg.trim().toLowerCase();if(!keyword)return reply(env,chat,'Usage: /stop keyword');
    await q(env,'DELETE FROM piko_filters WHERE chat_id=? AND keyword=?',[chat,keyword]);return reply(env,chat,'Removed filter: '+esc(keyword));
  }
  if(cmd.name==='filters'){
    const r=await q(env,'SELECT keyword FROM piko_filters WHERE chat_id=? ORDER BY keyword',[chat]);return reply(env,chat,r.rows.length?'🔎 <b>Active filters</b>\n'+r.rows.map(x=>'• '+esc(x.keyword)).join('\n'):'No filters configured.');
  }
  if(cmd.name==='ban'||cmd.name==='unban'){
    const target=msg.reply_to_message?.from;if(!target)return reply(env,chat,'Reply to the member you want to '+cmd.name+'.');
    const r=await tg(env,cmd.name==='ban'?'banChatMember':'unbanChatMember',{chat_id:chat,user_id:target.id});
    return reply(env,chat,r.ok?'✅ '+(cmd.name==='ban'?'Banned ':'Unbanned ')+mention(target):'Telegram rejected the action. Check my admin permissions.');
  }
}

async function adminCommand(env,msg,cmd){
  if(!await ownerOnly(env,msg))return true;
  if(cmd.name==='admin'||cmd.name==='stats'){
    await ensureSchema(env);
    const [u,g,b]=await Promise.all([q(env,'SELECT COUNT(*) n FROM users'),q(env,'SELECT COUNT(*) n FROM groups'),q(env,'SELECT COUNT(*) n FROM piko_bans')]);
    return reply(env,msg.chat.id,`👑 <b>Piko Admin</b>\nUsers: ${u.rows[0].n}\nGroups: ${g.rows[0].n}\nBanned: ${b.rows[0].n}\n\n/addcredits user_id amount\n/addcoins user_id amount\n/gban user_id reason\n/ungban user_id`);
  }
  const a=argsOf(cmd.arg),id=Number(a[0]),amount=Number(a[1]);
  if(cmd.name==='addcredits'||cmd.name==='addcoins'){
    if(!Number.isSafeInteger(id)||id<=0||!Number.isSafeInteger(amount)||amount===0||Math.abs(amount)>1000000)return reply(env,msg.chat.id,'Usage: /'+cmd.name+' user_id amount');
    await q(env,'INSERT OR IGNORE INTO piko_profiles(user_id,created_at) VALUES(?,?)',[id,Date.now()]);
    if(cmd.name==='addcredits')await q(env,'UPDATE piko_profiles SET credits=MAX(0,credits+?) WHERE user_id=?',[amount,id]);
    else {await q(env,'INSERT OR IGNORE INTO users(user_id,first_name,coins,created_at,updated_at) VALUES(?,?,?,?,?)',[id,'',0,Date.now(),Date.now()]);await q(env,'UPDATE users SET coins=MAX(0,coins+?) WHERE user_id=?',[amount,id]);}
    return reply(env,msg.chat.id,'✅ Updated '+cmd.name+' for user '+id+'.');
  }
  if(cmd.name==='gban'){
    if(!Number.isSafeInteger(id)||id<=0)return reply(env,msg.chat.id,'Usage: /gban user_id reason');
    await q(env,'INSERT INTO piko_bans(user_id,reason,created_at) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET reason=excluded.reason,created_at=excluded.created_at',[id,a.slice(1).join(' ').slice(0,300)||'Owner action',Date.now()]);
    return reply(env,msg.chat.id,'🚫 User '+id+' is blocked from Piko features.');
  }
  if(cmd.name==='ungban'){
    if(!Number.isSafeInteger(id)||id<=0)return reply(env,msg.chat.id,'Usage: /ungban user_id');
    await q(env,'DELETE FROM piko_bans WHERE user_id=?',[id]);return reply(env,msg.chat.id,'✅ User '+id+' unblocked.');
  }
  return true;
}

const PIKO_COMMANDS=new Set(['credits','wallet','daily','work','crime','rob','pay','img','ship','roll','trivia','hug','slap','punch','kick','welcome','setwelcome','delwelcome','save','stop','filters','ban','unban','admin','stats','addcredits','addcoins','gban','ungban']);
export async function handlePikoDM(msg,env,cmd){
  await ensureSchema(env);
  if(await banned(env,msg.from.id))return true;
  if(cmd&&PIKO_COMMANDS.has(cmd.name)){
    await profile(env,msg.from);
    if(['credits','wallet','daily','work','crime','rob','pay'].includes(cmd.name)){await economy(env,msg,cmd);return true;}
    if(cmd.name==='img'){await imageCommand(env,msg,cmd);return true;}
    if(['ship','roll','trivia','hug','slap','punch','kick'].includes(cmd.name)){await funCommand(env,msg,cmd);return true;}
    if(['admin','stats','addcredits','addcoins','gban','ungban'].includes(cmd.name)){await adminCommand(env,msg,cmd);return true;}
  }
  return false;
}

export async function handlePikoVoice(msg,env){
  if(!msg.voice&&!msg.audio)return false;
  await ensureSchema(env);if(await banned(env,msg.from.id))return true;
  await profile(env,msg.from);await voiceCommand(env,msg);return true;
}

export async function handlePikoAI(msg,env){
  if(!msg.text||msg.chat.type!=='private'||msg.from?.is_bot)return false;
  await ensureSchema(env);
  if(await banned(env,msg.from.id))return true;
  await profile(env,msg.from);
  try{const answer=await groqChat(env,msg.from.id,msg.text);await reply(env,msg.chat.id,esc(answer));}
  catch(e){await reply(env,msg.chat.id,'Piko AI is temporarily unavailable. Please try again later.');}
  return true;
}

export async function handlePikoGroup(msg,env,cmd){
  await ensureSchema(env);
  if(msg.new_chat_members?.length){
    const r=await q(env,'SELECT welcome_enabled,welcome_text FROM piko_groups WHERE chat_id=?',[String(msg.chat.id)]);
    const setting=r.rows[0]||{welcome_enabled:1,welcome_text:'Welcome {first} to {chatname}! 🎉'};
    if(setting.welcome_enabled)for(const m of msg.new_chat_members){if(m.is_bot)continue;const text=String(setting.welcome_text).replaceAll('{first}',m.first_name||'friend').replaceAll('{username}',m.username?'@'+m.username:m.first_name||'friend').replaceAll('{chatname}',msg.chat.title||'this group');await reply(env,msg.chat.id,esc(text));}
    return false;
  }
  if(cmd&&PIKO_COMMANDS.has(cmd.name)&&['welcome','setwelcome','delwelcome','save','stop','filters','ban','unban'].includes(cmd.name)){await groupTools(env,msg,cmd);return true;}
  if(cmd&&['credits','wallet','daily','work','crime','rob','pay','img','ship','roll','trivia','hug','slap','punch','kick'].includes(cmd.name)){await handlePikoDM(msg,env,cmd);return true;}
  if(!cmd&&msg.text){
    const chat=String(msg.chat.id),text=msg.text.toLowerCase();
    const f=await q(env,'SELECT keyword,response FROM piko_filters WHERE chat_id=? ORDER BY LENGTH(keyword) DESC',[chat]);
    const match=f.rows.find(x=>x.keyword&&text.includes(x.keyword.toLowerCase()));
    if(match)await reply(env,msg.chat.id,esc(match.response));
  }
  return false;
}

export async function pikoHelpText(){
 return '🤖 <b>Piko features</b>\n\nAI chat: send a DM\nVoice: send a voice message\n/credits — credits and coins\n/img prompt — generate an image (5 credits)\n/daily, /work, /crime, /rob, /pay\n/ship, /roll, /trivia, /hug, /slap, /punch, /kick\nGroup admins: /welcome, /setwelcome, /save, /stop, /filters, /ban, /unban\nOwner: /admin, /stats, /addcredits, /addcoins, /gban, /ungban';
}
