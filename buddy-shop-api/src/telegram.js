// Telegram alerts for new orders.
// The bot token is a secret (TELEGRAM_BOT_TOKEN). Which chats get the alerts is chosen in the
// admin page: staff write to the bot (or add it to a group), press «Чат хайх», then «Холбох».
// The chosen chats are kept in R2 (settings/telegram.json). TELEGRAM_CHAT_ID still works too.

const KEY = 'settings/telegram.json';
const api = (env, method, body) => fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}),
}).then((r) => r.json()).catch((e) => ({ ok: false, description: String(e) }));

async function saved(env) {
  const o = await env.IMAGES.get(KEY);
  if (!o) return { chats: [] };
  try { const d = JSON.parse(await o.text()); return { chats: Array.isArray(d.chats) ? d.chats : [] }; } catch { return { chats: [] }; }
}
const store = (env, d) => env.IMAGES.put(KEY, JSON.stringify(d), { httpMetadata: { contentType: 'application/json' } });

export async function chatIds(env) {
  const ids = new Set((await saved(env)).chats.map((c) => String(c.id)));
  if (env.TELEGRAM_CHAT_ID) String(env.TELEGRAM_CHAT_ID).split(',').map((s) => s.trim()).filter(Boolean).forEach((x) => ids.add(x));
  return [...ids];
}

export async function notify(env, text) {
  if (!env.TELEGRAM_BOT_TOKEN) return;
  const ids = await chatIds(env);
  await Promise.allSettled(ids.map(async (chat_id) => {
    const r = await api(env, 'sendMessage', { chat_id, text, disable_web_page_preview: true });
    if (!r.ok) console.error('telegram', chat_id, r.description);
  }));
}

// ---------- staff (admin page) ----------
export async function status(env) {
  if (!env.TELEGRAM_BOT_TOKEN) return { configured: false, chats: [] };
  const me = await api(env, 'getMe');
  return { configured: true, ok: !!me.ok, bot: me.ok ? me.result.username : null, error: me.ok ? null : me.description, chats: (await saved(env)).chats };
}

export async function findChats(env) {
  if (!env.TELEGRAM_BOT_TOKEN) return { error: 'TELEGRAM_BOT_TOKEN тохируулаагүй байна' };
  const r = await api(env, 'getUpdates', { limit: 100, allowed_updates: ['message', 'my_chat_member'] });
  if (!r.ok) return { error: r.description || 'Telegram-аас уншиж чадсангүй' };
  const map = new Map();
  for (const u of r.result || []) {
    const c = (u.message && u.message.chat) || (u.my_chat_member && u.my_chat_member.chat);
    if (!c) continue;
    const title = c.title || [c.first_name, c.last_name].filter(Boolean).join(' ') || c.username || String(c.id);
    map.set(String(c.id), { id: String(c.id), title, type: c.type });
  }
  return { chats: [...map.values()] };
}

export async function setChat(env, { id, title, on }) {
  if (!/^-?\d{3,20}$/.test(String(id || ''))) throw new Error('Чатын ID буруу');
  const d = await saved(env);
  d.chats = d.chats.filter((c) => String(c.id) !== String(id));
  if (on !== false) d.chats.push({ id: String(id), title: String(title || id).slice(0, 80) });
  await store(env, d);
  if (on !== false && env.TELEGRAM_BOT_TOKEN) {
    await api(env, 'sendMessage', { chat_id: id, text: '✅ Buddy Shop: энэ чат руу шинэ захиалгын мэдэгдэл ирнэ.' });
  }
  return d.chats;
}

export async function test(env) {
  if (!env.TELEGRAM_BOT_TOKEN) throw new Error('TELEGRAM_BOT_TOKEN тохируулаагүй байна');
  const ids = await chatIds(env);
  if (!ids.length) throw new Error('Холбогдсон чат алга');
  await notify(env, '🔔 Туршилт: Buddy Shop захиалгын мэдэгдэл ажиллаж байна.');
  return { sent: ids.length };
}
