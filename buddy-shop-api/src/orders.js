// Orders placed from the website cart (Cloudflare D1, table "orders").
// A customer — signed in or not — sends the cart with name, phone and delivery
// address. Staff are told by email (info@buddyshop.mn) and, if configured, Telegram;
// the customer gets a confirmation email. Staff follow each order in the admin
// page and move it through the statuses below. Payment (QPay) comes later.

export const STATUS = {
  new: 'Шинэ', confirmed: 'Баталгаажсан', paid: 'Төлбөр төлөгдсөн', shipping: 'Хүргэлтэнд гарсан',
  done: 'Хүргэгдсэн', cancelled: 'Цуцалсан',
};
const COLS = { number: 'TEXT', name: 'TEXT', phone: 'TEXT', email: 'TEXT', address: 'TEXT', addr: 'TEXT',
  delivery: 'TEXT', staff_note: 'TEXT', updated_at: 'TEXT', updated_by: 'TEXT' };
let ready = false;

export async function ensureOrders(env) {
  if (ready) return;
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL, created_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'new', total INTEGER NOT NULL DEFAULT 0,
      items TEXT NOT NULL DEFAULT '[]', note TEXT)`).run();
  const have = new Set(((await env.DB.prepare('PRAGMA table_info(orders)').all()).results || []).map((c) => c.name));
  for (const [c, t] of Object.entries(COLS)) if (!have.has(c)) await env.DB.prepare(`ALTER TABLE orders ADD COLUMN ${c} ${t}`).run();
  await env.DB.prepare('CREATE INDEX IF NOT EXISTS orders_created ON orders(created_at)').run();
  ready = true;
}

const clip = (s, n) => (s == null ? '' : String(s).trim().slice(0, n));
const parse = (s, d) => { try { return JSON.parse(s) ?? d; } catch { return d; } };
const money = (n) => Number(n || 0).toLocaleString('en-US') + '₮';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function orderView(o) {
  return {
    id: o.id, number: o.number || `BS${1000 + o.id}`, createdAt: o.created_at, updatedAt: o.updated_at || null,
    status: o.status, statusText: STATUS[o.status] || o.status, total: o.total, items: parse(o.items, []),
    name: o.name || '', phone: o.phone || '', email: o.email || '', address: o.address || '',
    delivery: o.delivery || 'delivery', note: o.note || '', customerId: o.customer_id || null,
  };
}

async function allow(env, key, limit, windowMs) {
  const now = Date.now();
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, n INTEGER NOT NULL, window_start INTEGER NOT NULL)').run();
  const row = await env.DB.prepare('SELECT n, window_start FROM rate_limits WHERE key = ?1').bind(key).first();
  if (!row || now - row.window_start > windowMs) {
    await env.DB.prepare('INSERT INTO rate_limits (key, n, window_start) VALUES (?1, 1, ?2) ON CONFLICT(key) DO UPDATE SET n = 1, window_start = ?2').bind(key, now).run();
    return true;
  }
  if (row.n >= limit) return false;
  await env.DB.prepare('UPDATE rate_limits SET n = n + 1 WHERE key = ?1').bind(key).run();
  return true;
}

async function mail(env, to, subject, html, text) {
  if (!env.RESEND_API_KEY || !to) return;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: env.MAIL_FROM || 'Buddy Shop <info@buddyshop.mn>', reply_to: 'info@buddyshop.mn', to: [to], subject, html, text }),
  });
  if (!res.ok) console.error('resend', res.status, await res.text().catch(() => ''));
}
async function telegram(env, text) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return;
  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text, disable_web_page_preview: true }),
  });
  if (!res.ok) console.error('telegram', res.status, await res.text().catch(() => ''));
}

function itemLine(i) {
  return `${i.name}${i.size ? ` (${i.size})` : ''}${i.colorCode ? ` [өнгө ${i.colorCode}]` : ''}${i.code ? ` · код ${i.code}` : ''} — ${money(i.price)} × ${i.qty}`;
}
function orderHtml(o, intro) {
  return `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:24px;color:#10202c">
  <div style="font-weight:800;letter-spacing:1px;font-size:18px">▲ BUDDY SHOP</div>
  <p style="font-size:15px">${intro}</p>
  <table style="width:100%;border-collapse:collapse;font-size:14px">${o.items.map((i) => `<tr>
    <td style="padding:6px 0;border-bottom:1px solid #e3e7e9">${esc(i.name)}${i.size ? ` <span style="color:#5a6a72">(${esc(i.size)})</span>` : ''}${i.colorCode ? ` <span style="color:#5a6a72">[өнгө ${esc(i.colorCode)}]</span>` : ''}${i.code ? `<br><small style="color:#5a6a72">код ${esc(i.code)}</small>` : ''}</td>
    <td style="padding:6px 0;border-bottom:1px solid #e3e7e9;text-align:right;white-space:nowrap">${money(i.price)} × ${i.qty}</td></tr>`).join('')}
    <tr><td style="padding:10px 0;font-weight:800">Нийт</td><td style="padding:10px 0;text-align:right;font-weight:800">${money(o.total)}</td></tr></table>
  <p style="font-size:14px;line-height:1.6"><b>${esc(o.name)}</b> · ${esc(o.phone)}${o.email ? ` · ${esc(o.email)}` : ''}<br>
  ${o.delivery === 'pickup' ? 'Дэлгүүрээс очиж авна' : `Хүргэлт: ${esc(o.address)}`}${o.note ? `<br>Тайлбар: ${esc(o.note)}` : ''}</p>
  <p style="font-size:13px;color:#5a6a72">Buddy Shop · buddyshop.mn · info@buddyshop.mn</p></div>`;
}

// ---------- customer: place an order ----------
export async function createOrder(request, env, customerId) {
  await ensureOrders(env);
  const text = await request.text();
  if (text.length > 60000) return [413, { error: 'Захиалга хэт том байна' }];
  let b; try { b = JSON.parse(text); } catch { return [400, { error: 'JSON буруу' }]; }
  const ip = request.headers.get('cf-connecting-ip') || 'x';
  if (!(await allow(env, 'order:' + ip, 10, 3600e3))) return [429, { error: 'Хэт олон захиалга. Түр хүлээгээд дахин оролдоно уу эсвэл утсаар холбогдоно уу.' }];

  const items = (Array.isArray(b.items) ? b.items : []).slice(0, 60).map((i) => ({
    id: Number(i.id), name: clip(i.name, 160), code: clip(i.code, 60), brand: clip(i.brand, 60),
    size: clip(i.size, 60), colorCode: clip(i.colorCode, 60), image: clip(i.image, 300),
    price: Math.max(0, Math.round(Number(i.price) || 0)), qty: Math.min(99, Math.max(1, Math.round(Number(i.qty) || 1))),
  })).filter((i) => Number.isSafeInteger(i.id) && i.name);
  if (!items.length) return [400, { error: 'Сагс хоосон байна' }];
  const name = clip(b.name, 80), phone = clip(String(b.phone || '').replace(/[^\d+ ]/g, ''), 20);
  const email = clip(b.email, 120).toLowerCase(), note = clip(b.note, 500);
  const delivery = b.delivery === 'pickup' ? 'pickup' : 'delivery';
  const address = delivery === 'pickup' ? '' : clip(b.address, 400);
  if (!name) return [400, { error: 'Нэрээ оруулна уу' }];
  if (phone.replace(/\D/g, '').length < 8) return [400, { error: 'Утасны дугаараа зөв оруулна уу' }];
  if (email && !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) return [400, { error: 'Имэйл хаяг буруу байна' }];
  if (delivery === 'delivery' && address.length < 6) return [400, { error: 'Хүргэлтийн хаягаа оруулна уу' }];
  const total = items.reduce((s, i) => s + i.price * i.qty, 0);
  const now = new Date().toISOString();

  const r = await env.DB.prepare(`INSERT INTO orders (customer_id, created_at, updated_at, status, total, items, note, name, phone, email, address, addr, delivery)
    VALUES (?1, ?2, ?2, 'new', ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`)
    .bind(customerId || 0, now, total, JSON.stringify(items), note, name, phone, email, address,
      b.addr && typeof b.addr === 'object' ? JSON.stringify(b.addr).slice(0, 1000) : null, delivery).run();
  const id = r.meta.last_row_id, number = `BS${1000 + id}`;
  await env.DB.prepare('UPDATE orders SET number = ?1 WHERE id = ?2').bind(number, id).run();
  const o = orderView({ id, number, created_at: now, status: 'new', total, items: JSON.stringify(items), name, phone, email, address, delivery, note, customer_id: customerId });

  // notifications should never block the order itself
  const jobs = [
    mail(env, env.ORDER_NOTIFY || 'info@buddyshop.mn', `🛒 Шинэ захиалга ${number} — ${money(total)} — ${name}`,
      orderHtml(o, `Сайтаас шинэ захиалга ирлээ: <b>${number}</b>`), `${number}\n${items.map(itemLine).join('\n')}\nНийт ${money(total)}\n${name} ${phone}\n${address}`),
    telegram(env, `🛒 Шинэ захиалга ${number}\n${items.map(itemLine).join('\n')}\nНийт: ${money(total)}\n\n👤 ${name} · ${phone}${email ? ' · ' + email : ''}\n${delivery === 'pickup' ? '🏬 Дэлгүүрээс авна' : '🚚 ' + address}${note ? '\n📝 ' + note : ''}`),
  ];
  if (email) jobs.push(mail(env, email, `Таны захиалга ${number} хүлээн авлаа — Buddy Shop`,
    orderHtml(o, `Сайн байна уу${name ? ', ' + esc(name) : ''}! Таны <b>${number}</b> дугаартай захиалгыг хүлээн авлаа. Манай ажилтан удахгүй утсаар холбогдож, төлбөр болон хүргэлтийг баталгаажуулна.`),
    `Таны ${number} захиалгыг хүлээн авлаа. Нийт ${money(total)}. Манай ажилтан удахгүй холбогдоно.`));
  await Promise.allSettled(jobs);
  return [200, { ok: true, order: o }];
}

// ---------- staff ----------
export async function listOrders(env, url) {
  await ensureOrders(env);
  const status = url.searchParams.get('status');
  const q = status && STATUS[status]
    ? env.DB.prepare('SELECT * FROM orders WHERE status = ?1 ORDER BY id DESC LIMIT 500').bind(status)
    : env.DB.prepare('SELECT * FROM orders ORDER BY id DESC LIMIT 500');
  const { results } = await q.all();
  const counts = (await env.DB.prepare('SELECT status, COUNT(*) AS n FROM orders GROUP BY status').all()).results || [];
  return { items: (results || []).map((o) => ({ ...orderView(o), staffNote: o.staff_note || '', updatedBy: o.updated_by || '' })), counts, statuses: STATUS };
}

export async function updateOrder(request, env, id, user) {
  await ensureOrders(env);
  const b = await request.json().catch(() => ({}));
  const sets = [], vals = [];
  const put = (c, v) => { vals.push(v); sets.push(`${c} = ?${vals.length}`); };
  if (b.status !== undefined) { if (!STATUS[b.status]) return [400, { error: 'Төлөв буруу' }]; put('status', b.status); }
  if (b.staffNote !== undefined) put('staff_note', clip(b.staffNote, 1000));
  if (!sets.length) return [400, { error: 'Өөрчлөх зүйл алга' }];
  put('updated_at', new Date().toISOString()); put('updated_by', user);
  vals.push(id);
  await env.DB.prepare(`UPDATE orders SET ${sets.join(', ')} WHERE id = ?${vals.length}`).bind(...vals).run();
  const o = await env.DB.prepare('SELECT * FROM orders WHERE id = ?1').bind(id).first();
  if (!o) return [404, { error: 'Захиалга олдсонгүй' }];
  return [200, { ...orderView(o), staffNote: o.staff_note || '', updatedBy: o.updated_by || '' }];
}
