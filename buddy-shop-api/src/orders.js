import { notify } from './telegram.js';
import * as qpay from './qpay.js';
import * as storepay from './storepay.js';
import { getErp } from './erp.js';
// Orders placed from the website cart (Cloudflare D1, table "orders").
// A customer — signed in or not — sends the cart with name, phone and delivery
// address. Staff are told by email (info@buddyshop.mn) and, if configured, Telegram;
// the customer gets a confirmation email. Staff follow each order in the admin
// page and move it through the statuses below.
// Payment: «QPay-ээр төлөх» makes a QPay invoice (QR + bank apps). Such orders are announced to
// staff only once the payment is confirmed; «Дараа төлөх» orders are announced straight away.
// Prices are taken from the ERP by product code when the code is known (the site's price is only
// used for products without an ERP code — those lines are flagged for staff to check).

// Storepay / Pocket: «buy now, pay later» — staff sends the customer a Storepay/Pocket invoice by phone number.
export const BNPL = { storepay: 'Storepay', pocket: 'Pocket' };
// BNPL above names every instalment provider an order may already carry, so old Pocket orders
// still read correctly. OFFERED is the narrower list a new order may choose from: Pocket is off
// until its API is connected, and anything else asked for becomes a «pay later» order.
const OFFERED = new Set(['storepay']);
const payLabel = (m) => (m === 'qpay' ? 'QPay' : BNPL[m] ? BNPL[m] + ' (хуваан төлөх)' : 'Дараа төлөх');

export const STATUS = {
  new: 'Шинэ', confirmed: 'Баталгаажсан', paid: 'Төлбөр төлөгдсөн', shipping: 'Хүргэлтэнд гарсан',
  done: 'Хүргэгдсэн', cancelled: 'Цуцалсан',
};
const COLS = { number: 'TEXT', name: 'TEXT', phone: 'TEXT', email: 'TEXT', address: 'TEXT', addr: 'TEXT',
  delivery: 'TEXT', staff_note: 'TEXT', updated_at: 'TEXT', updated_by: 'TEXT',
  pay_method: 'TEXT', pay_key: 'TEXT', qpay_invoice: 'TEXT', sp_loan: 'TEXT', sp_phone: 'TEXT', paid_amount: 'INTEGER', paid_at: 'TEXT', checked_at: 'INTEGER', price_check: 'TEXT' };
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
    payMethod: o.pay_method || 'later', spLoan: o.sp_loan || null, spPhone: o.sp_phone || '',
    paid: !!o.paid_at, paidAmount: o.paid_amount || 0, paidAt: o.paid_at || null,
    priceCheck: o.price_check || null,
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
const telegram = (env, text) => notify(env, text);

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
  // The Storepay account is often in another name or another number than the one the order is
  // delivered to — a spouse's phone, a second SIM. The customer may give that number separately;
  // left empty it falls back to the order's phone.
  const spPhone = clip(String(b.spPhone || '').replace(/[^\d+ ]/g, ''), 20);
  const email = clip(b.email, 120).toLowerCase(), note = clip(b.note, 500);
  const delivery = b.delivery === 'pickup' ? 'pickup' : 'delivery';
  const address = delivery === 'pickup' ? '' : clip(b.address, 400);
  if (!name) return [400, { error: 'Нэрээ оруулна уу' }];
  if (phone.replace(/\D/g, '').length < 8) return [400, { error: 'Утасны дугаараа зөв оруулна уу' }];
  if (email && !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) return [400, { error: 'Имэйл хаяг буруу байна' }];
  if (delivery === 'delivery' && address.length < 6) return [400, { error: 'Хүргэлтийн хаягаа оруулна уу' }];
  // prices are decided here, never by the browser: ERP price by the product's own code, otherwise
  // the price in the site catalog / staff edits
  let priced;
  try { priced = await serverPrices(env, items); } catch (e) { console.error('prices', e); return [503, { error: 'Үнэ шалгаж чадсангүй. Түр хүлээгээд дахин оролдоно уу.' }]; }
  if (priced.missing.length) return [400, { error: 'Сагсанд сайтаас хасагдсан бараа байна. Сагсаа шинэчлээд дахин оролдоно уу.' }];
  const changed = items.filter((i) => i.sitePrice !== undefined && i.sitePrice !== i.price).length;
  const priceCheck = changed ? `${changed} барааны үнэ хэрэглэгчийн харснаас өөр байсан — серверийн үнээр тооцов` : 'ok';
  const total = items.reduce((s, i) => s + i.price * i.qty, 0);
  const now = new Date().toISOString();
  const payQ = b.pay === 'qpay' && qpay.enabled(env) && total > 0;
  const method = payQ ? 'qpay' : (OFFERED.has(b.pay) ? b.pay : 'later');
  const payKey = crypto.randomUUID().replace(/-/g, '');
  const paySP = method === 'storepay' && storepay.enabled(env) && total > 0;
  // Storepay's own terms of use, 3.1.1: one purchase is between 100,000₮ and 10,000,000₮.
  // Outside that Storepay refuses the loan, so the order must not be taken as a Storepay order.
  const spMin = Number(env.STOREPAY_MIN) || 100000, spMax = Number(env.STOREPAY_MAX) || 10000000;
  if (paySP && (total < spMin || total > spMax)) {
    return [400, { error: total < spMin
      ? `Storepay-ээр ${money(spMin)}-с доош захиалга хийх боломжгүй (одоогийн дүн ${money(total)}). QPay сонгох эсвэл дүнгээ нэмнэ үү.`
      : `Storepay-ээр ${money(spMax)}-с дээш захиалга хийх боломжгүй. QPay сонгоно уу.` }];
  }
  const loanPhone = spPhone.replace(/\D/g, '').length >= 8 ? spPhone : phone;
  if (paySP) {
    if (spPhone && spPhone.replace(/\D/g, '').length < 8) return [400, { error: 'Storepay-д бүртгэлтэй утасны дугаараа зөв оруулна уу' }];
    // Tell the customer early if their Storepay limit is too small — but only on a positive
    // answer. /user/possibleAmount is not in the merchant manual, and it answered 0 for a number
    // that does have credit, so a zero here means «no answer», not «no credit». Blocking on it
    // turned real customers away. Anything other than a positive shortfall goes through and lets
    // the loan request itself be the judge: that reply is authoritative and reaches the customer.
    let limit = null;
    try { limit = await storepay.possibleAmount(env, loanPhone); } catch (e) { console.error('storepay limit', e.message); }
    if (limit !== null && limit > 0 && limit < total) {
      return [400, { error: `Таны Storepay-ийн боломжит эрх ${money(limit)} — ${money(total)}-д хүрэлцэхгүй байна. QPay эсвэл Pocket сонгоно уу.` }];
    }
  }

  const r = await env.DB.prepare(`INSERT INTO orders (customer_id, created_at, updated_at, status, total, items, note, name, phone, email, address, addr, delivery, pay_method, pay_key, price_check, sp_phone)
    VALUES (?1, ?2, ?2, 'new', ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)`)
    .bind(customerId || 0, now, total, JSON.stringify(items), note, name, phone, email, address,
      b.addr && typeof b.addr === 'object' ? JSON.stringify(b.addr).slice(0, 1000) : null, delivery, method, payKey, priceCheck,
      loanPhone === phone ? null : loanPhone).run();
  const id = r.meta.last_row_id, number = `BS${1000 + id}`;
  await env.DB.prepare('UPDATE orders SET number = ?1 WHERE id = ?2').bind(number, id).run();
  const row = { id, number, created_at: now, status: 'new', total, items: JSON.stringify(items), name, phone, email, address, delivery, note,
    customer_id: customerId, pay_method: method, price_check: priceCheck, sp_phone: loanPhone === phone ? null : loanPhone };
  const o = orderView(row);

  if (payQ) {
    // QPay: staff hear about it when the money arrives (markPaid); the customer gets the QR now
    try {
      const callback = `${new URL(request.url).origin}/api/qpay/callback?o=${id}&k=${payKey}`;
      const inv = await qpay.createInvoice(env, { number, amount: total, phone, callback });
      await env.DB.prepare('UPDATE orders SET qpay_invoice = ?1 WHERE id = ?2').bind(String(inv.invoice_id), id).run();
      return [200, { ok: true, order: o, payKey, qpay: {
        qr: inv.qr_image ? 'data:image/png;base64,' + inv.qr_image : null, text: inv.qr_text || '', link: inv.qPay_shortUrl || '',
        banks: (Array.isArray(inv.urls) ? inv.urls : []).map((u) => ({ name: u.description || u.name, logo: u.logo, link: u.link })),
      } }];
    } catch (e) {
      // invoice failed: keep the order as «pay later» so it is not lost
      console.error('qpay invoice', e.message);
      await env.DB.prepare("UPDATE orders SET pay_method = 'later', staff_note = ?1 WHERE id = ?2").bind('QPay нэхэмжлэх үүсгэж чадсангүй: ' + e.message, id).run();
      o.payMethod = 'later'; o.qpayError = 'QPay түр ажиллахгүй байна. Захиалга тань бүртгэгдсэн — ажилтан холбогдож төлбөрийг тохирно.';
    }
  }

  if (paySP) {
    // Storepay: the customer confirms the loan in the Storepay app; staff hear about it when it is confirmed
    try {
      const callback = `${new URL(request.url).origin}/api/storepay/callback?o=${id}&k=${payKey}`;
      const loan = await storepay.createLoan(env, { number, amount: total, phone: loanPhone, callback });
      await env.DB.prepare('UPDATE orders SET sp_loan = ?1 WHERE id = ?2').bind(loan, id).run();
      return [200, { ok: true, order: o, payKey, storepay: { loan, phone: loanPhone } }];
    } catch (e) {
      // request failed: keep the order; staff send the Storepay invoice by hand
      console.error('storepay loan', e.message);
      await env.DB.prepare('UPDATE orders SET staff_note = ?1 WHERE id = ?2').bind('Storepay хүсэлт автоматаар үүссэнгүй: ' + e.message, id).run();
      o.storepayError = `Storepay хүсэлт автоматаар илгээгдсэнгүй (${e.message.replace(/^Storepay:\s*/, '')}). Захиалга тань бүртгэгдсэн — манай ажилтан Storepay нэхэмжлэхийг гараар илгээнэ.`;
    }
  }

  // notifications should never block the order itself
  const jobs = [
    mail(env, env.ORDER_NOTIFY || 'info@buddyshop.mn', `🛒 Шинэ захиалга ${number} — ${money(total)} — ${name}`,
      orderHtml(o, `Сайтаас шинэ захиалга ирлээ: <b>${number}</b>`), `${number}\n${items.map(itemLine).join('\n')}\nНийт ${money(total)}\n${name} ${phone}\n${address}`),
    telegram(env, tgText(o, `🛒 Шинэ захиалга ${number} · ${BNPL[method] ? '🧾 ' + BNPL[method] + ' — нэхэмжлэх илгээх' : '⏳ төлбөр хийгдээгүй'}`)),
  ];
  if (email) jobs.push(mail(env, email, `Таны захиалга ${number} хүлээн авлаа — Buddy Shop`,
    orderHtml(o, `Сайн байна уу${name ? ', ' + esc(name) : ''}! Таны <b>${number}</b> дугаартай захиалгыг хүлээн авлаа. ${BNPL[method] ? `Та <b>${BNPL[method]}</b>-ээр хуваан төлөхийг сонгосон. Манай ажилтан удахгүй таны <b>${esc(loanPhone)}</b> дугаар руу ${BNPL[method]} нэхэмжлэх илгээнэ — апп дээрээ баталгаажуулна уу.` : 'Манай ажилтан удахгүй утсаар холбогдож, төлбөр болон хүргэлтийг баталгаажуулна.'}`),
    `Таны ${number} захиалгыг хүлээн авлаа. Нийт ${money(total)}. Манай ажилтан удахгүй холбогдоно.`));
  await Promise.allSettled(jobs);
  return [200, { ok: true, order: o }];
}

// ---------- prices: ERP > staff edits (D1) > site catalog ----------
const norm = (c) => String(c || '').toUpperCase().replace(/\s+/g, ' ').trim();
const codesOf = (code) => { const c = norm(code); return c ? [c, ...c.split(/\s*[|;,]\s*/).map(norm)].filter(Boolean) : []; };
let catalogCache = null; // { at, map: Map(id → product) }

async function siteCatalog(env) {
  if (catalogCache && Date.now() - catalogCache.at < 3600e3) return catalogCache.map;
  const site = String(env.SITE_URL || 'https://amrmnd520.github.io/Buddy-Show-Web').replace(/\/+$/, '');
  const res = await fetch(`${site}/catalog.js?t=${Math.floor(Date.now() / 3600e3)}`, { cf: { cacheTtl: 600 } });
  if (!res.ok) throw new Error('catalog ' + res.status);
  const text = await res.text();
  const list = JSON.parse(text.slice(text.indexOf('['), text.lastIndexOf(']') + 1));
  const map = new Map(list.map((p) => [Number(p.id), p]));
  catalogCache = { at: Date.now(), map };
  return map;
}
async function erpPrices(env) {
  try {
    const d = JSON.parse(await getErp(env));
    const m = new Map();
    for (const [k, v] of Object.entries(d.items || {})) if (Array.isArray(v) && Number(v[0]) > 0) m.set(norm(k), Number(v[0]));
    return m;
  } catch { return new Map(); }
}
async function serverPrices(env, items) {
  const [cat, erp] = await Promise.all([siteCatalog(env), erpPrices(env)]);
  const ids = [...new Set(items.map((i) => i.id))];
  const staff = new Map();
  if (ids.length) {
    const { results } = await env.DB.prepare(`SELECT id, data, deleted FROM products WHERE id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all().catch(() => ({ results: [] }));
    for (const r of results || []) staff.set(Number(r.id), r.deleted ? null : (() => { try { return JSON.parse(r.data); } catch { return null; } })());
  }
  const missing = [];
  for (const i of items) {
    const p = staff.has(i.id) ? staff.get(i.id) : cat.get(i.id);
    if (!p) { missing.push(i.id); continue; }
    const size = i.size && Array.isArray(p.sizes) ? p.sizes.find((s) => s.label === i.size) : null;
    if (i.size && Array.isArray(p.sizes) && p.sizes.length && !size) { missing.push(i.id); continue; }
    const codes = size ? codesOf(size.code) : codesOf(p.code);
    const fromErp = codes.map((c) => erp.get(c)).find((x) => x > 0);
    const price = Math.round(fromErp || (size && Number(size.price)) || Number(p.price) || 0);
    if (!(price > 0)) { missing.push(i.id); continue; }
    i.sitePrice = i.price; // what the customer saw
    i.price = price; i.name = String(p.name || i.name).slice(0, 160); i.brand = String(p.brand || '').slice(0, 60);
    i.code = (size && size.code) || codes[1] || codes[0] || '';
    i.priceFrom = fromErp ? 'erp' : 'site';
  }
  return { missing };
}

function tgText(o, head) {
  return `${head}\n${o.items.map(itemLine).join('\n')}\nНийт: ${money(o.total)}${o.priceCheck && o.priceCheck !== 'ok' ? '\n⚠ ' + o.priceCheck : ''}\n\n👤 ${o.name} · ${o.phone}${o.email ? ' · ' + o.email : ''}\n${o.delivery === 'pickup' ? '🏬 Дэлгүүрээс авна' : '🚚 ' + o.address}${o.note ? '\n📝 ' + o.note : ''}\n💰 Төлбөр: ${payLabel(o.payMethod)}`;
}

// ---------- QPay: confirm a payment ----------
// QPay's rules: no repeated/cron polling of /payment/check. A payment is checked when QPay calls
// the callback, or once when the customer (or staff) presses «Төлбөр шалгах» (at most every 10 s).
async function markPaid(env, row, amount, via = 'QPay') {
  const now = new Date().toISOString();
  const r = await env.DB.prepare(`UPDATE orders SET paid_amount = ?1, paid_at = ?2, updated_at = ?2, updated_by = ?4,
      status = CASE WHEN status = 'new' AND ?1 >= total THEN 'paid' ELSE status END WHERE id = ?3 AND paid_at IS NULL`).bind(amount, now, row.id, via).run();
  if (!r.meta.changes) return; // already recorded
  const o = orderView({ ...row, paid_amount: amount, paid_at: now, status: row.status === 'new' && amount >= row.total ? 'paid' : row.status });
  const short = amount < o.total ? `\n⚠ Дутуу төлсөн: ${money(amount)} / ${money(o.total)}` : '';
  await Promise.allSettled([
    telegram(env, tgText(o, `${via === 'QPay' ? '💳 Төлбөр орлоо' : '🟣 Storepay баталгаажлаа'} · ${o.number} · ${money(amount)}`) + short),
    mail(env, env.ORDER_NOTIFY || 'info@buddyshop.mn', `💳 Төлбөртэй захиалга ${o.number} — ${money(amount)} — ${o.name}`,
      orderHtml(o, `${via}-ээр төлбөр орлоо: <b>${o.number}</b> · ${money(amount)}${short ? ' (дутуу!)' : ''}`), `${o.number} төлөгдлөө ${money(amount)}`),
    o.email ? mail(env, o.email, `Төлбөр баталгаажлаа — ${o.number} — Buddy Shop`,
      orderHtml(o, `Сайн байна уу${o.name ? ', ' + esc(o.name) : ''}! Таны <b>${o.number}</b> захиалгын <b>${money(amount)}</b> төлбөр ${via === 'QPay' ? 'амжилттай орлоо' : via + '-ээр баталгаажлаа'}. ${o.delivery === 'pickup' ? 'Бараагаа дэлгүүрээс авах цагийг' : 'Хүргэлтийн цагийг'} манай ажилтан утсаар мэдэгдэнэ.`),
      `${o.number} төлбөр ${money(amount)} орлоо. Баярлалаа!`) : null,
  ]);
}

async function checkRow(env, row, force) {
  if (row.paid_at) return;
  const sp = row.sp_loan && storepay.enabled(env), q = row.qpay_invoice && qpay.enabled(env);
  if (!sp && !q) return;
  if (!force && row.checked_at && Date.now() - row.checked_at < 10000) return;
  await env.DB.prepare('UPDATE orders SET checked_at = ?1 WHERE id = ?2').bind(Date.now(), row.id).run();
  if (sp) { if (await storepay.confirmed(env, row.sp_loan)) await markPaid(env, row, row.total, 'Storepay'); return; }
  const amount = await qpay.paidAmount(env, row.qpay_invoice);
  if (amount > 0) await markPaid(env, row, amount);
}

async function rowByKey(env, id, key) {
  await ensureOrders(env);
  const row = await env.DB.prepare('SELECT * FROM orders WHERE id = ?1').bind(id).first();
  if (!row || !row.pay_key || row.pay_key !== String(key || '')) return null;
  return row;
}

// QPay calls this when an invoice is paid (GET or POST). Answer "SUCCESS".
export async function qpayCallback(env, url) {
  const row = await rowByKey(env, Number(url.searchParams.get('o')), url.searchParams.get('k'));
  if (row) { try { await checkRow(env, row, true); } catch (e) { console.error('qpay callback', e.message); } }
  return new Response('SUCCESS', { status: 200, headers: { 'content-type': 'text/plain' } });
}

// Storepay calls this when the customer confirms (or the loan changes); confirmed again with loan/check.
export async function storepayCallback(env, url) {
  // Storepay calls the merchant URL with the loan number in an `id` parameter. Our URL already
  // carries ?o=&k=, and the manual's example has none — so if Storepay replaces the query string
  // instead of appending to it, those are gone. The loan id alone is enough to find the order.
  let row = await rowByKey(env, Number(url.searchParams.get('o')), url.searchParams.get('k'));
  const loan = String(url.searchParams.get('id') || '').trim();
  if (!row && loan) {
    row = await env.DB.prepare('SELECT * FROM orders WHERE sp_loan = ?1').bind(loan).first();
  }
  if (row) { try { await checkRow(env, row, true); } catch (e) { console.error('storepay callback', e.message); } }
  return new Response(JSON.stringify({ status: 'Success' }), { status: 200, headers: { 'content-type': 'application/json' } });
}

// The checkout page asks our database every few seconds whether the callback has arrived;
// QPay itself is asked only when the customer presses «Төлбөр шалгах» (check=1).
export async function payStatus(env, id, key, check) {
  let row = await rowByKey(env, id, key);
  if (!row) return [404, { error: 'Захиалга олдсонгүй' }];
  if (check && !row.paid_at) {
    try { await checkRow(env, row, false); } catch (e) { console.error('qpay check', e.message); }
    row = await env.DB.prepare('SELECT * FROM orders WHERE id = ?1').bind(id).first();
  }
  return [200, { paid: !!row.paid_at && row.paid_amount >= row.total, short: !!row.paid_at && row.paid_amount < row.total, paidAmount: row.paid_amount || 0, total: row.total, status: row.status }];
}

// customer: «Захиалга цуцлах» / «Төлбөрийн арга солих» on the payment screen (only while unpaid)
export async function customerCancel(env, id, key) {
  let row = await rowByKey(env, id, key);
  if (!row) return [404, { error: 'Захиалга олдсонгүй' }];
  if (!row.paid_at) { try { await checkRow(env, row, true); } catch (e) { console.error('cancel check', e.message); } }
  row = await env.DB.prepare('SELECT * FROM orders WHERE id = ?1').bind(id).first();
  if (row.paid_at) return [409, { error: 'Төлбөр аль хэдийн орсон тул цуцлах боломжгүй. Манай ажилтантай холбогдоно уу.', paid: true }];
  if (row.status !== 'new') return [409, { error: 'Захиалгыг цуцлах боломжгүй. Манай ажилтантай холбогдоно уу.' }];
  await env.DB.prepare(`UPDATE orders SET status = 'cancelled', updated_at = ?1, updated_by = 'Хэрэглэгч',
      staff_note = TRIM(COALESCE(staff_note, '') || ' Хэрэглэгч төлбөрийн дэлгэцээс цуцалсан.') WHERE id = ?2`).bind(new Date().toISOString(), id).run();
  if (row.qpay_invoice && qpay.enabled(env)) await qpay.cancelInvoice(env, row.qpay_invoice);
  return [200, { ok: true }];
}

// staff: «QPay шалгах» on one order
export async function staffCheck(env, id) {
  await ensureOrders(env);
  const row = await env.DB.prepare('SELECT * FROM orders WHERE id = ?1').bind(id).first();
  if (!row) return [404, { error: 'Захиалга олдсонгүй' }];
  if (!row.qpay_invoice && !row.sp_loan) return [400, { error: 'QPay/Storepay нэхэмжлэхгүй захиалга' }];
  try { await checkRow(env, row, true); } catch (e) { return [502, { error: e.message }]; }
  const o = await env.DB.prepare('SELECT * FROM orders WHERE id = ?1').bind(id).first();
  return [200, { ...orderView(o), staffNote: o.staff_note || '', updatedBy: o.updated_by || '' }];
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
