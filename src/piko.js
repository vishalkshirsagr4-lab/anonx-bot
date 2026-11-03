// Piko feature pack: Groq AI, voice transcription, credits, economy, fun and group tools.
// All credentials are supplied through Cloudflare Worker secrets/bindings.
import { state, isOwner } from './config.js';
import { q, batch, kvGet, kvPut, kvDel } from './db.js';
import { tg, tgForm } from './telegram.js';
import { getBotInfo } from './helpers.js';

const GROQ_URL = 'https://api.groq.com/openai/v1';
const CHAT_MODEL = 'openai/gpt-oss-20b';
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
  await batch(env, statements.map(sql => ({ sql })));
  schemaReady = true;
  })().catch(error => { schemaPromise = null; throw error; });
  return schemaPromise;
}

async function profile(env, user) {
  await ensureSchema(env);
  const now=Date.now();
  const results=await batch(env,[
    {sql:`INSERT OR IGNORE INTO piko_profiles(user_id,created_at) VALUES(?,?)`,args:[user.id,now]},
    {sql:`INSERT INTO users(user_id,first_name,username,created_at,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET first_name=excluded.first_name,username=excluded.username,updated_at=excluded.updated_at`,args:[user.id,user.first_name||'',user.username||'',now,now]},
    {sql:`SELECT p.*,u.coins FROM piko_profiles p LEFT JOIN users u ON u.user_id=p.user_id WHERE p.user_id=?`,args:[user.id]}
  ]);
  return results[2].rows[0] || {credits:30,coins:0};
}
async function reply(env, chatId, text, extra={}) { return tg(env,'sendMessage',{chat_id:chatId,text,parse_mode:'HTML',...extra}); }
async function ownerOnly(env, msg) { if (!isOwner(msg.from.id)) { await reply(env,msg.chat.id,'⛔ Owner only.'); return false; } return true; }
async function banned(env,id) { const r=await q(env,'SELECT 1 FROM piko_bans WHERE user_id=?',[id]); return r.rows.length>0; }

async function groqChat(env, userId, input) {
  const key=groqKey(env); if(!key) return 'Piko AI is not configured yet. Add GROQ_API_KEY as a Cloudflare secret.';
  const h=await q(env,'SELECT role,content FROM piko_history WHERE user_id=? ORDER BY id DESC LIMIT 8',[userId]);
  const messages=[{role:'system',content:`You are Piko, a friendly and socially aware chat companion in this community. Sound natural, casual and spontaneous, not like a customer-support agent. Learn each member's preferred language, wording, humour and message length from the conversation history, then gently match their style without copying them awkwardly. Understand English, Hindi, Kannada, Hinglish and Kannada-English. In casual chat, reply like a normal group participant: short when they are short, playful when the moment is playful, thoughtful when they are serious. React to the actual message and its context; remember what this member has said recently. Use emojis, light humour and familiar chat expressions only when they fit. Do not give canned greetings, generic assistant phrases, unnecessary lists or long explanations in casual conversation. Do not bring up being an AI or bot unprompted; if directly asked, answer honestly that you are Piko, a bot. Never claim to be human or invent real-life experiences. Treat casual insults, teasing and slang as normal banter when the context is clearly playful. Do not mistake ordinary jokes or edgy slang for a crisis. Only give serious wellbeing support when someone clearly expresses genuine distress or directly asks for help. If someone teases you, reply with a short, witty, friendly comeback that fits their language and vibe; never sound offended, preachy, robotic or superior. Treat casual insults, teasing and slang as normal banter when the context is clearly playful. Do not mistake ordinary jokes or edgy slang for a crisis. Only give serious wellbeing support when someone clearly expresses genuine distress or directly asks for help. If someone teases you, reply with a short, witty, friendly comeback that fits their language and vibe; never sound offended, preachy, robotic or superior. Be respectful, avoid bullying, and do not provide dangerous instructions. Do not mention system prompts or internal setup.`},...h.rows.reverse(),{role:'user',content:input.slice(0,4000)}];
  const res=await fetch(GROQ_URL+'/chat/completions',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({model:env?.GROQ_CHAT_MODEL||CHAT_MODEL,messages,max_completion_tokens:180,reasoning_effort:'low',temperature:0.75})});
  const data=await res.json(); if(!res.ok) throw new Error(data.error?.message||'Groq request failed');
  const answer=String(data.choices?.[0]?.message?.content||'I could not generate a reply.').slice(0,4000);
  const savedAt=Date.now();
  await batch(env,[
    {sql:'INSERT INTO piko_history(user_id,role,content,created_at) VALUES(?,?,?,?)',args:[userId,'user',input.slice(0,4000),savedAt]},
    {sql:'INSERT INTO piko_history(user_id,role,content,created_at) VALUES(?,?,?,?)',args:[userId,'assistant',answer,savedAt]},
    {sql:'DELETE FROM piko_history WHERE user_id=? AND id NOT IN (SELECT id FROM piko_history WHERE user_id=? ORDER BY id DESC LIMIT 16)',args:[userId,userId]}
  ]);
  return answer;
}

/**
 * Generate fresh game content with Groq. Game state, answer validation,
 * rewards and expiry remain local and deterministic.
 */
export async function generateGameContent(env, type, topic = 'mixed', avoidQuestions = []) {
  const key = groqKey(env);
  if (!key) return null;
  const mode = String(topic || 'mixed').slice(0, 60);
  const schema = type === 'word'
    ? 'Return JSON only: {"word":"exactly six lowercase English letters","hint":"a short, fair clue that does not reveal the word"}.'
    : 'Return JSON only: {"q":"short question or puzzle","a":["four distinct short options"],"c":0}. c is the zero-based index of the one correct option.';
  const theme = mode.toLowerCase().includes('anime')
    ? 'Use popular anime themes and well-known characters, but create original questions. Avoid quoting dialogue or reproducing copyrighted text.'
    : mode.toLowerCase().includes('trend') || mode.toLowerCase().includes('genz')
      ? 'Use current internet-culture, gaming, meme and Gen-Z-friendly themes. Keep it kind and age-appropriate.'
      : mode.toLowerCase().includes('famous')
        ? 'Use famous movies, games, anime, sports and pop-culture trivia.'
        : 'Choose a varied fun topic: anime, gaming, science, pop culture, internet culture, riddles or everyday knowledge.';
  const task = type === 'quiz' ? 'Write one fresh, EASY multiple-choice trivia question suitable for a casual group chat.'
    : type === 'riddle' ? 'Write one very easy, short, original riddle that most people can solve.'
    : type === 'emoji' ? 'Create one VERY EASY emoji guessing puzzle about a globally famous anime, movie, or video game. Use 3 or 4 iconic emojis that point to ONE specific title or character, not generic elements. Avoid vague clues such as only a dragon, lightning, crown, mushroom, or book. The question must say exactly which category is being guessed (anime, movie, or game). The correct title MUST appear exactly once among the four options; the other three options must be plausible but clearly different famous titles. Never use unrelated emojis. Example clue quality: Guess the movie: 🦁👑🌅 (The Lion King).'
    : 'Choose one common, easy six-letter English word; do not use names or obscure words.';
  const avoid = Array.isArray(avoidQuestions) ? avoidQuestions.slice(-30).map(x => String(x).slice(0,180)) : [];
  const response = await fetch(GROQ_URL + '/chat/completions', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: env?.GROQ_CHAT_MODEL || CHAT_MODEL,
      messages: [
        { role: 'system', content: 'You create ORIGINAL, EASY, beginner-friendly group-game content. Never make a hard, tricky, obscure, academic, or confusing question. Output valid JSON only, no markdown.' },
        { role: 'user', content: task + ' Theme: ' + theme + ' Requested category: ' + mode + '. Create a different question from every item in this recent-used list. Do not reuse or paraphrase them: ' + JSON.stringify(avoid) + '. Keep wording short and answer choices simple and clearly distinct. ' + schema }
      ],
      temperature: 0.85,
      max_completion_tokens: 700,
      reasoning_effort: 'low',
      response_format: { type: 'json_object' }
    })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || 'Groq game generation failed');
  const raw = String(data.choices?.[0]?.message?.content || '').replace(/^`{3}(?:json)?/i, '').replace(/`{3}$/,'').trim();
  if (!raw) throw new Error('Groq returned an empty game response; model=' + (env?.GROQ_CHAT_MODEL || CHAT_MODEL));
  const parsed = JSON.parse(raw);
  if (type === 'word') return /^[a-z]{6}$/i.test(parsed.word || '') && typeof parsed.hint === 'string' ? { word: parsed.word.toLowerCase(), hint: parsed.hint.slice(0, 180) } : null;
  if (typeof parsed.q !== 'string' || !Array.isArray(parsed.a) || parsed.a.length !== 4 ||
      !Number.isInteger(parsed.c) || parsed.c < 0 || parsed.c > 3 ||
      parsed.a.some(x => typeof x !== 'string' || !x.trim())) return null;
  return { q: parsed.q.slice(0, 350), a: parsed.a.map(x => x.slice(0, 80)), c: parsed.c };
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

function findFunTarget(msg) {
  const replied=msg.reply_to_message?.from;
  if(replied&&!replied.is_bot&&replied.id!==msg.from.id)return replied;
  const entities=[...(msg.entities||[]),...(msg.caption_entities||[])];
  for(const entity of entities){
    if(entity.type==='text_mention'&&entity.user&&!entity.user.is_bot&&entity.user.id!==msg.from.id)return entity.user;
    if(entity.type==='mention'){
      const raw=String(msg.text||'').slice(entity.offset,entity.offset+entity.length);
      if(raw)return {id:0,username:raw.slice(1),first_name:raw};
    }
  }
  const raw=String(msg.text||'').match(/(?:^|\s)@([A-Za-z0-9_]{5,32})(?:\s|$)/);
  if(raw)return {id:0,username:raw[1],first_name:'@'+raw[1]};
  return null;
}
const FUN_MEDIA_COMMANDS=['hug','wave','highfive','cheer','kick','punch','slap'];
async function sendFunMedia(env,chatId,name,replyTo){
  const items=await kvGet(env,'piko_media:'+name,true);
  if(!Array.isArray(items)||!items.length){
    return {ok:false,reason:'No saved stickers found for /'+name+'. Configure the pack again in Piko DM using /set'+name+'.'};
  }
  if(!Number.isInteger(replyTo)||replyTo<=0){
    return {ok:false,reason:'I could not identify the original message. Reply directly to the member message.'};
  }
  const valid=items.filter(item=>item&&typeof item.file_id==='string'&&item.file_id&&['sticker','animation'].includes(item.type));
  if(!valid.length){
    return {ok:false,reason:'The saved /'+name+' pack has no valid Telegram file IDs. Please configure it again with /set'+name+'.'};
  }
  const item=valid[rand(0,valid.length-1)];
  const method=item.type==='animation'?'sendAnimation':'sendSticker';
  const mediaField=item.type==='animation'?'animation':'sticker';
  const result=await tg(env,method,{
    chat_id:chatId,
    [mediaField]:item.file_id,
    reply_to_message_id:replyTo
  });
  if(!result?.ok){
    const description=String(result?.description||'Unknown Telegram API error').slice(0,220);
    console.error('Piko fun media send failed:',{name,method,replyTo,error_code:result?.error_code,description});
    return {ok:false,reason:'Telegram rejected the saved media: '+description};
  }
  const actualReplyId=result.result?.reply_to_message?.message_id;
  if(Number.isInteger(actualReplyId)&&actualReplyId!==replyTo){
    console.error('Piko fun media reply mismatch:',{name,replyTo,actualReplyId});
    return {ok:false,reason:'Telegram sent the sticker but attached it to a different message. Please report this to the bot owner.'};
  }
  return {ok:true};
}
async function setFunMedia(env,msg,cmd){
  if(!isOwner(msg.from.id)){await reply(env,msg.chat.id,'⛔ Owner only.');return true;}
  if(msg.chat.type!=='private'){await reply(env,msg.chat.id,'Please configure media in Piko DM.');return true;}
  const name=cmd.name.slice(3);
  await kvPut(env,'piko_media_pending:'+msg.from.id,name,1800);
  const current=await kvGet(env,'piko_media:'+name,true);
  await reply(env,msg.chat.id,'📥 <b>Set /'+name+' media</b>\n\nSend a sticker or GIF/animation now. I will keep asking for more until you send /cancel.\n\nSaved items: <b>'+(Array.isArray(current)?current.length:0)+'</b>');
  return true;
}
async function handleFunMediaSetup(env,msg,cmd){
  if(!isOwner(msg.from.id))return false;
  const pending=await kvGet(env,'piko_media_pending:'+msg.from.id);
  if(!pending)return false;
  if(cmd?.name==='cancel'){
    await kvDel(env,'piko_media_pending:'+msg.from.id);
    await reply(env,msg.chat.id,'✅ Media setup cancelled. Previously saved media is kept.');
    return true;
  }
  const media=msg.sticker?{type:'sticker',file_id:msg.sticker.file_id}:msg.animation?{type:'animation',file_id:msg.animation.file_id}:null;
  if(!media){
    await reply(env,msg.chat.id,'Please send a Telegram sticker or GIF/animation. Send /cancel to finish.');
    return true;
  }
  const key='piko_media:'+pending;
  const items=await kvGet(env,key,true);
  const next=Array.isArray(items)?items:[];
  if(!next.some(x=>x.file_id===media.file_id))next.push(media);
  await kvPut(env,key,next);
  await reply(env,msg.chat.id,'✅ Added '+media.type+'. Total saved for /'+pending+': <b>'+next.length+'</b>\n\nSend another sticker/GIF, or /cancel when finished.');
  return true;
}
async function funCommand(env,msg,cmd){
  if(FUN_MEDIA_COMMANDS.includes(cmd.name)){
    // Only accept a direct reply; target the member's original message ID.
    const original=msg.reply_to_message;
    // The replied-to message can be text, sticker, photo, video, or another
    // Telegram message type. Only its message_id is needed to reply to it.
    if(!original||!Number.isInteger(original.message_id)||original.message_id<=0){
      return reply(env,msg.chat.id,'Reply directly to the message with /'+cmd.name+'.');
    }
    const sent=await sendFunMedia(env,msg.chat.id,cmd.name,original.message_id);
    if(!sent.ok)return reply(env,msg.chat.id,'❌ '+sent.reason,{reply_to_message_id:msg.message_id});
    return true;
  }
  const target=findFunTarget(msg);
  if(cmd.name==='ship'){
    if(!target)return reply(env,msg.chat.id,'Reply to someone or tag them: /ship @username');
    const score=rand(0,100);
    return reply(env,msg.chat.id,`💚 <b>Friendship percentage</b>\n${mention(msg.from)} + ${mention(target)}\n\n<b>${score}%</b> ${'💚'.repeat(Math.floor(score/20))}`,{reply_to_message_id:msg.message_id});
  }
  if(cmd.name==='roll'){
    return tg(env,'sendDice',{chat_id:msg.chat.id,emoji:'🎲',reply_to_message_id:msg.message_id});
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

const PIKO_COMMANDS=new Set(['sethug','setwave','sethighfive','setcheer','setkick','setpunch','setslap','credits','wallet','daily','work','crime','rob','pay','img','ship','roll','hug','slap','punch','kick','wave','highfive','cheer','welcome','setwelcome','delwelcome','save','stop','filters','ban','unban','admin','stats','addcredits','addcoins','gban','ungban']);
export async function handlePikoDM(msg,env,cmd){
  await ensureSchema(env);
  if(await handleFunMediaSetup(env,msg,cmd))return true;
  if(cmd&&cmd.name.startsWith('set')&&FUN_MEDIA_COMMANDS.includes(cmd.name.slice(3)))return setFunMedia(env,msg,cmd);
  if(await banned(env,msg.from.id))return true;
  if(cmd&&PIKO_COMMANDS.has(cmd.name)){
    await profile(env,msg.from);
    if(['credits','wallet','daily','work','crime','rob','pay'].includes(cmd.name)){await economy(env,msg,cmd);return true;}
    if(cmd.name==='img'){await imageCommand(env,msg,cmd);return true;}
    if(['ship','roll','hug','slap','punch','kick','wave','highfive','cheer'].includes(cmd.name)){await funCommand(env,msg,cmd);return true;}
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
  if(!msg.text||!['private','group','supergroup'].includes(msg.chat.type)||msg.from?.is_bot)return false;
  await ensureSchema(env);
  if(await banned(env,msg.from.id))return true;
  await profile(env,msg.from);
  const inGroup=msg.chat.type==='group'||msg.chat.type==='supergroup';
  // In groups, make it clear who Piko is answering and attach the answer
  // to the exact message that called Piko. HTML mention works even without username.
  const groupReply=inGroup?{reply_to_message_id:msg.message_id}: {};
  const prefix=inGroup?mention(msg.from)+' ':'';
  try{
    void tg(env,'sendChatAction',{chat_id:msg.chat.id,action:'typing'}).catch(()=>{});
    const answer=await groqChat(env,msg.from.id,msg.text);
    await reply(env,msg.chat.id,prefix+esc(answer),groupReply);
  }catch(e){
    console.error('Piko AI request failed:',e?.message||String(e));
    await reply(env,msg.chat.id,prefix+'Piko AI is temporarily unavailable. Please try again later.',groupReply);
  }
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
  if(cmd&&PIKO_COMMANDS.has(cmd.name)){
    if(['welcome','setwelcome','delwelcome','save','stop','filters','ban','unban'].includes(cmd.name)){
      await groupTools(env,msg,cmd);
      return true;
    }
    // Route every other Piko command through the same tested dispatcher used in DM.
    // This also gives a clear owner-only response instead of silently ignoring admin commands.
    await handlePikoDM(msg,env,cmd);
    return true;
  }
  if(!cmd&&msg.text){
    // Match both Piko's display name and Telegram username, including punctuation.
    // Use the known bot username as a fallback if getMe/cache is temporarily unavailable.
    let botInfo = null;
    try { botInfo = await getBotInfo(env); }
    catch (error) { console.error('Piko getMe lookup failed:', error?.message || String(error)); }
    const username = String(botInfo?.username || 'Piko_Pikobot').replace(/^@/, '').trim().toLowerCase();
    const botName = String(state.BOT_NAME || 'Piko').trim().toLowerCase();
    const text = String(msg.text);
    const lowerText = text.toLowerCase();
    const entities = Array.isArray(msg.entities) ? msg.entities : [];
    const escapedUsername = username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const usernameMention = !!username && (
      new RegExp('(^|[^a-z0-9_])@' + escapedUsername + '($|[^a-z0-9_])', 'i').test(text) ||
      entities.some(entity => entity.type === 'mention' &&
        text.slice(entity.offset, entity.offset + entity.length).toLowerCase() === '@' + username)
    );
    const escapedName = botName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const nameMention = !!botName && new RegExp('(^|[^\\p{L}\\p{N}_])' + escapedName + '($|[^\\p{L}\\p{N}_])', 'iu').test(text);
    const replied = msg.reply_to_message?.from;
    const repliedToPiko = !!(replied?.is_bot && (
      (botInfo?.id && Number(replied.id) === Number(botInfo.id)) ||
      (username && String(replied.username || '').toLowerCase() === username)
    ));
    if(usernameMention || nameMention || repliedToPiko){
      await handlePikoAI({...msg, text: text.trim() || 'Someone called your name. Reply naturally.'}, env);
      return true;
    }
    const chat = String(msg.chat.id);
    const f = await q(env, 'SELECT keyword,response FROM piko_filters WHERE chat_id=? ORDER BY LENGTH(keyword) DESC', [chat]);
    const match = f.rows.find(x => x.keyword && lowerText.includes(x.keyword.toLowerCase()));
    if(match) await reply(env, msg.chat.id, esc(match.response));
  }
  return false;
}

export async function pikoHelpText(){
 return '🤖 <b>Piko features</b>\n\nAI chat: send a DM\nVoice: send a voice message\n/credits — credits and coins\n/img prompt — generate an image (5 credits)\n/daily, /work, /crime, /rob, /pay\n/ship @username — friendship percentage\n/roll — Telegram rolling die 🎲\n/hug, /wave, /highfive, /cheer (reply or tag a member)\n/slap, /punch, /kick use playful cartoon sticker/GIF packs\nOwner media setup in DM: /sethug, /setwave, /sethighfive, /setcheer, /setkick, /setpunch, /setslap (send multiple stickers/GIFs, then /cancel)\nGroup admins: /welcome, /setwelcome, /save, /stop, /filters, /ban, /unban\nOwner: /admin, /stats, /addcredits, /addcoins, /gban, /ungban';
}
