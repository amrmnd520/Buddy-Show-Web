import { ensureOrders, orderView } from './orders.js';
// Customer accounts for the Buddy Shop website (Cloudflare D1).
// Sign-in is by email: the customer types their address, we email a 6-digit code
// (via Resend, from info@buddyshop.mn), they type it back and get a token that
// keeps them signed in for 90 days on that browser. No passwords are stored.
//
// Stored per customer: email, name, phone, delivery address, saved products
// (wishlist), cart, and orders (empty until online ordering is added).

const CODE_MINUTES = 10;
const MAX_TRIES = 5;
const TOKEN_DAYS = 90;
const MAX_LIST = 200;
const enc = new TextEncoder();
let ready = false;

async function ensure(env) {
  if (ready) return;
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      name TEXT, phone TEXT, address TEXT,
      wishlist TEXT NOT NULL DEFAULT '[]',
      cart TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL, last_login TEXT, logins INTEGER NOT NULL DEFAULT 0)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS login_codes (
      email TEXT PRIMARY KEY, hash TEXT NOT NULL, expires INTEGER NOT NULL,
      tries INTEGER NOT NULL DEFAULT 0, sent_at INTEGER NOT NULL)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS rate_limits (
      key TEXT PRIMARY KEY, n INTEGER NOT NULL, window_start INTEGER NOT NULL)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL, created_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'new', total INTEGER NOT NULL DEFAULT 0,
      items TEXT NOT NULL DEFAULT '[]', note TEXT)`),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS orders_customer ON orders(customer_id, created_at)'),
  ]);
  const cols = await env.DB.prepare('PRAGMA table_info(customers)').all();
  const have = new Set((cols.results || []).map((c) => c.name));
  for (const col of ['pass_hash', 'addr']) {
    if (!have.has(col)) await env.DB.prepare(`ALTER TABLE customers ADD COLUMN ${col} TEXT`).run();
  }
  ready = true;
}

// ---------- passwords (PBKDF2-SHA256, random salt per customer) ----------
const PBKDF2_ITER = 100000; // Cloudflare Workers maximum
async function hashPassword(pw, saltB64) {
  const salt = saltB64 ? Uint8Array.from(atob(saltB64), (c) => c.charCodeAt(0)) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITER }, key, 256);
  const b64 = (u) => btoa(String.fromCharCode(...new Uint8Array(u)));
  return `pbkdf2$${PBKDF2_ITER}$${b64(salt)}$${b64(bits)}`;
}
async function checkPassword(pw, stored) {
  const [, , salt] = String(stored || '').split('$');
  if (!salt) return false;
  return same(await hashPassword(pw, salt), stored);
}
const passProblem = (pw) => (typeof pw !== 'string' || pw.length < 8 ? 'Нууц үг дор хаяж 8 тэмдэгт байна'
  : pw.length > 200 ? 'Нууц үг хэт урт байна' : null);

// ---------- helpers ----------
const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = (s) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)));
async function hmac(secret, data) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}
const sha = async (s) => b64url(await crypto.subtle.digest('SHA-256', enc.encode(s)));
const secret = (env) => (env.TOKEN_SECRET || '') + '|customer'; // separate from staff tokens
function same(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0;
}
const cleanEmail = (e) => String(e || '').trim().toLowerCase();
const validEmail = (e) => e.length <= 120 && /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(e);
const clip = (s, n) => (s == null ? null : String(s).trim().slice(0, n) || null);

async function makeToken(env, id) {
  const payload = b64url(enc.encode(JSON.stringify({ c: id, exp: Date.now() + TOKEN_DAYS * 864e5 })));
  return 'c.' + payload + '.' + (await hmac(secret(env), payload));
}
export async function customerId(request, env) {
  const auth = request.headers.get('authorization') || '';
  const [tag, payload, sig] = (auth.startsWith('Bearer ') ? auth.slice(7) : '').split('.');
  if (tag !== 'c' || !payload || !sig || !env.TOKEN_SECRET) return null;
  if (!same(sig, await hmac(secret(env), payload))) return null;
  try { const { c, exp } = JSON.parse(unb64(payload)); return c && Date.now() < exp ? c : null; } catch { return null; }
}

// fixed-window counter; returns false when over the limit
async function allow(env, key, limit, windowMs) {
  const now = Date.now();
  const row = await env.DB.prepare('SELECT n, window_start FROM rate_limits WHERE key = ?1').bind(key).first();
  if (!row || now - row.window_start > windowMs) {
    await env.DB.prepare('INSERT INTO rate_limits (key, n, window_start) VALUES (?1, 1, ?2) ON CONFLICT(key) DO UPDATE SET n = 1, window_start = ?2').bind(key, now).run();
    return true;
  }
  if (row.n >= limit) return false;
  await env.DB.prepare('UPDATE rate_limits SET n = n + 1 WHERE key = ?1').bind(key).run();
  return true;
}

function parseList(s) { try { const v = JSON.parse(s || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } }
function parseObj(s) { try { const v = JSON.parse(s || '{}'); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch { return {}; } }
// structured delivery address → also kept as one readable line in `address`
const ADDR = { city: 40, district: 40, khoroo: 10, complex: 80, building: 20, entrance: 10, floor: 10, door: 20, note: 200 };
function cleanAddr(a) {
  const o = {};
  for (const [k, n] of Object.entries(ADDR)) { const v = clip(a && a[k], n); if (v) o[k] = v; }
  return o;
}
function addrLine(a) {
  const num = (v, w) => (v ? (/^\d+$/.test(v) ? `${v}-р ${w}` : `${v} ${w}`) : '');
  const parts = [a.city, a.district, num(a.khoroo, a.city && a.city !== 'Улаанбаатар' ? 'баг' : 'хороо'), a.complex,
    num(a.building, 'байр'), num(a.entrance, 'орц'), num(a.floor, 'давхар'), a.door ? `${a.door} тоот` : ''].filter(Boolean);
  return (parts.join(', ') + (a.note ? `. ${a.note}` : '')).slice(0, 400);
}
function profile(row, orders = []) {
  return {
    email: row.email, hasPassword: !!row.pass_hash, name: row.name || '', phone: row.phone || '', address: row.address || '', addr: parseObj(row.addr),
    wishlist: parseList(row.wishlist), cart: parseList(row.cart), createdAt: row.created_at,
    orders: orders.map(orderView),
  };
}

// ---------- email ----------
async function sendCode(env, email, code) {
  if (!env.RESEND_API_KEY) throw new Error('Имэйл илгээх тохиргоо хийгдээгүй байна');
  const html = `<div style="font-family:Arial,sans-serif;max-width:460px;margin:auto;padding:24px;color:#10202c">
  <div style="font-weight:800;letter-spacing:1px;font-size:18px">▲ BUDDY SHOP</div>
  <p style="font-size:15px">Таны нэвтрэх код:</p>
  <div style="font-size:34px;font-weight:800;letter-spacing:8px;background:#f2f5f7;border-radius:8px;padding:14px 0;text-align:center">${code}</div>
  <p style="font-size:13px;color:#5a6a72">Код ${CODE_MINUTES} минутын турш хүчинтэй. Хэрэв та нэвтрэх гэж оролдоогүй бол энэ имэйлийг үл тоомсорлоно уу.</p>
  <p style="font-size:13px;color:#5a6a72">Buddy Shop · buddyshop.mn</p></div>`;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from: env.MAIL_FROM || 'Buddy Shop <info@buddyshop.mn>',
      reply_to: 'info@buddyshop.mn',
      to: [email],
      subject: `${code} — Buddy Shop нэвтрэх код`,
      html,
      text: `Buddy Shop нэвтрэх код: ${code}\nКод ${CODE_MINUTES} минутын турш хүчинтэй.`,
    }),
  });
  if (!res.ok) {
    console.error('resend', res.status, await res.text().catch(() => ''));
    throw new Error('Имэйл илгээж чадсангүй. Түр хүлээгээд дахин оролдоно уу.');
  }
}

// ---------- handlers (all return [status, body]) ----------
export async function requestCode(request, env) {
  await ensure(env);
  const { email: raw } = await request.json().catch(() => ({}));
  const email = cleanEmail(raw);
  if (!validEmail(email)) return [400, { error: 'Имэйл хаяг буруу байна' }];
  const ip = request.headers.get('cf-connecting-ip') || 'x';
  const ipKey = 'ip:' + (await sha(ip + secret(env))).slice(0, 16);
  const last = await env.DB.prepare('SELECT sent_at FROM login_codes WHERE email = ?1').bind(email).first();
  if (last && Date.now() - last.sent_at < 60e3) return [429, { error: 'Код саяхан илгээгдсэн. 1 минутын дараа дахин оролдоно уу.' }];
  if (!(await allow(env, 'mail:' + email, 6, 3600e3)) || !(await allow(env, ipKey, 12, 3600e3))) {
    return [429, { error: 'Хэт олон оролдлого. Нэг цагийн дараа дахин оролдоно уу.' }];
  }
  const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1e6).padStart(6, '0');
  await sendCode(env, email, code);
  await env.DB.prepare(`INSERT INTO login_codes (email, hash, expires, tries, sent_at) VALUES (?1, ?2, ?3, 0, ?4)
    ON CONFLICT(email) DO UPDATE SET hash = ?2, expires = ?3, tries = 0, sent_at = ?4`)
    .bind(email, await sha(email + ':' + code + ':' + secret(env)), Date.now() + CODE_MINUTES * 60e3, Date.now()).run();
  return [200, { ok: true }];
}

export async function verifyCode(request, env) {
  await ensure(env);
  const { email: raw, code: rawCode } = await request.json().catch(() => ({}));
  const email = cleanEmail(raw), code = String(rawCode || '').replace(/\D/g, '');
  const row = await env.DB.prepare('SELECT hash, expires, tries FROM login_codes WHERE email = ?1').bind(email).first();
  if (!row || Date.now() > row.expires) return [400, { error: 'Кодын хугацаа дууссан. Шинэ код авна уу.' }];
  if (row.tries >= MAX_TRIES) return [429, { error: 'Хэт олон буруу оролдлого. Шинэ код авна уу.' }];
  if (!same(row.hash, await sha(email + ':' + code + ':' + secret(env)))) {
    await env.DB.prepare('UPDATE login_codes SET tries = tries + 1 WHERE email = ?1').bind(email).run();
    await new Promise((r) => setTimeout(r, 400));
    return [400, { error: 'Код буруу байна' }];
  }
  await env.DB.prepare('DELETE FROM login_codes WHERE email = ?1').bind(email).run();
  const now = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO customers (email, created_at, last_login, logins) VALUES (?1, ?2, ?2, 1)
    ON CONFLICT(email) DO UPDATE SET last_login = ?2, logins = logins + 1`).bind(email, now).run();
  const c = await env.DB.prepare('SELECT * FROM customers WHERE email = ?1').bind(email).first();
  return [200, { token: await makeToken(env, c.id), account: profile(c), isNew: c.logins === 1 }];
}

export async function passwordLogin(request, env) {
  await ensure(env);
  const { email: raw, password } = await request.json().catch(() => ({}));
  const email = cleanEmail(raw);
  if (!validEmail(email) || typeof password !== 'string' || !password) return [400, { error: 'Имэйл, нууц үгээ оруулна уу' }];
  const ip = request.headers.get('cf-connecting-ip') || 'x';
  const ipKey = 'pw-ip:' + (await sha(ip + secret(env))).slice(0, 16);
  if (!(await allow(env, 'pw:' + email, 10, 900e3)) || !(await allow(env, ipKey, 40, 3600e3))) {
    return [429, { error: 'Хэт олон оролдлого. 15 минутын дараа дахин оролдох эсвэл «Нууц үгээ мартсан» дээр дарна уу.' }];
  }
  const c = await env.DB.prepare('SELECT * FROM customers WHERE email = ?1').bind(email).first();
  if (c && !c.pass_hash) return [400, { error: 'Энэ бүртгэлд нууц үг тохируулаагүй байна. «Нууц үгээ мартсан уу?» дээр дарж имэйлээр код аваад нууц үгээ зохионо уу.' }];
  if (!c || !(await checkPassword(password, c.pass_hash))) {
    await new Promise((r) => setTimeout(r, 500));
    return [400, { error: 'Имэйл эсвэл нууц үг буруу байна' }];
  }
  const now = new Date().toISOString();
  await env.DB.prepare('UPDATE customers SET last_login = ?1, logins = logins + 1 WHERE id = ?2').bind(now, c.id).run();
  return [200, { token: await makeToken(env, c.id), account: profile(c) }];
}

export async function getAccount(env, id) {
  await ensure(env);
  const c = await env.DB.prepare('SELECT * FROM customers WHERE id = ?1').bind(id).first();
  if (!c) return [401, { error: 'Дахин нэвтэрнэ үү' }];
  await ensureOrders(env);
  const { results } = await env.DB.prepare('SELECT * FROM orders WHERE customer_id = ?1 ORDER BY created_at DESC LIMIT 100').bind(id).all();
  return [200, profile(c, results || [])];
}

export async function updateAccount(request, env, id) {
  await ensure(env);
  const text = await request.text();
  if (text.length > 60000) return [413, { error: 'Мэдээлэл хэт том байна' }];
  let b; try { b = JSON.parse(text); } catch { return [400, { error: 'JSON буруу' }]; }
  const sets = [], vals = [];
  const put = (col, v) => { vals.push(v); sets.push(`${col} = ?${vals.length}`); };
  if ('name' in b) put('name', clip(b.name, 80));
  if ('phone' in b) put('phone', clip(String(b.phone || '').replace(/[^\d+ ]/g, ''), 20));
  if (b.addr && typeof b.addr === 'object') {
    const a = cleanAddr(b.addr);
    put('addr', JSON.stringify(a)); put('address', addrLine(a) || null);
  } else if ('address' in b) put('address', clip(b.address, 400));
  if ('wishlist' in b && Array.isArray(b.wishlist)) put('wishlist', JSON.stringify([...new Set(b.wishlist.map(Number).filter(Number.isSafeInteger))].slice(0, MAX_LIST)));
  if ('cart' in b && Array.isArray(b.cart)) {
    const cart = b.cart.slice(0, MAX_LIST).filter((x) => x && Number.isSafeInteger(Number(x.id))).map((x) => {
      const o = { id: Number(x.id), colorCode: clip(x.colorCode, 60) || '' };
      if (x.size) o.size = clip(x.size, 60);
      if (Number(x.price) > 0) o.price = Number(x.price);
      if (x.image) o.image = clip(x.image, 300);
      return o;
    });
    put('cart', JSON.stringify(cart));
  }
  if ('password' in b) {
    const bad = passProblem(b.password);
    if (bad) return [400, { error: bad }];
    put('pass_hash', await hashPassword(b.password));
  }
  if (!sets.length) return [400, { error: 'Өөрчлөх зүйл алга' }];
  vals.push(id);
  await env.DB.prepare(`UPDATE customers SET ${sets.join(', ')} WHERE id = ?${vals.length}`).bind(...vals).run();
  return getAccount(env, id);
}

export async function deleteAccount(env, id) {
  await ensure(env);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM orders WHERE customer_id = ?1').bind(id),
    env.DB.prepare('DELETE FROM customers WHERE id = ?1').bind(id),
  ]);
  return [200, { ok: true }];
}

// staff: list of registered customers
export async function listCustomers(env) {
  await ensure(env);
  const { results } = await env.DB.prepare(`SELECT c.id, c.email, c.name, c.phone, c.address, c.created_at, c.last_login, c.logins,
      c.wishlist, c.cart, (SELECT COUNT(*) FROM orders o WHERE o.customer_id = c.id) AS orders
    FROM customers c ORDER BY c.created_at DESC LIMIT 5000`).all();
  return (results || []).map((r) => ({
    id: r.id, email: r.email, name: r.name || '', phone: r.phone || '', address: r.address || '',
    createdAt: r.created_at, lastLogin: r.last_login, logins: r.logins, orders: r.orders,
    wishlist: parseList(r.wishlist), cart: parseList(r.cart).length,
  }));
}

export async function pruneCodes(env) {
  await ensure(env);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM login_codes WHERE expires < ?1').bind(Date.now() - 864e5),
    env.DB.prepare('DELETE FROM rate_limits WHERE window_start < ?1').bind(Date.now() - 864e5),
  ]);
}
