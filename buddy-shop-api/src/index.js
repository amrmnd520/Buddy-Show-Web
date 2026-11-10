// Buddy Shop shared product API (Cloudflare Worker + D1 + R2).
// Stores products that were added, edited or deleted by staff on top of the
// site's catalog.js, and serves product photos uploaded from the admin page.

import { syncErp, getErp, getCatalog, syncTop, getTop, setDismissed } from './erp.js';
import { track, stats, prune } from './stats.js';
import * as tg from './telegram.js';
import * as qpay from './qpay.js';
import * as storepay from './storepay.js';
import { posAuthed, posInvoice, posCheck, posCancel, posLoan, posLoanCheck } from './pos.js';
import { createOrder, listOrders, updateOrder, qpayCallback, storepayCallback, payStatus, staffCheck, customerCancel } from './orders.js';
import { customerId, requestCode, verifyCode, passwordLogin, getAccount, updateAccount, deleteAccount, listCustomers, pruneCodes } from './customers.js';
import { runBackup, listBackups, getBackupFile, backupNotice, latestText } from './backup.js';

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type, x-pos-token, x-backup-token',
  'access-control-max-age': '86400',
};
const TOKEN_DAYS = 30;
const MAX_PRODUCT_BYTES = 200 * 1024;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const IMAGE_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif' };

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), { status, headers: { ...JSON_HEADERS, ...CORS, ...extra } });
}
const fail = (status, error) => json({ error }, status);

// ---------- auth ----------
function users(env) {
  try { return JSON.parse(env.USERS || '{}'); } catch { return {}; }
}
const enc = new TextEncoder();
const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlText = (s) => b64url(enc.encode(s));
const unb64urlText = (s) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)));

async function hmac(secret, data) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}
function sameText(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
async function makeToken(env, user) {
  const payload = b64urlText(JSON.stringify({ u: user, exp: Date.now() + TOKEN_DAYS * 864e5 }));
  return payload + '.' + (await hmac(env.TOKEN_SECRET, payload));
}
async function whoIs(request, env) {
  const auth = request.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const [payload, sig] = token.split('.');
  if (!payload || !sig || !env.TOKEN_SECRET) return null;
  if (!sameText(sig, await hmac(env.TOKEN_SECRET, payload))) return null;
  try {
    const { u, exp } = JSON.parse(unb64urlText(payload));
    if (!u || Date.now() > exp || !(u in users(env))) return null; // removed users lose access
    return u;
  } catch { return null; }
}

// ---------- handlers ----------
async function login(request, env) {
  const { user, password } = await request.json().catch(() => ({}));
  const list = users(env);
  const name = String(user || '').trim().toLowerCase();
  if (!name || !(name in list) || !sameText(String(password || ''), String(list[name]))) {
    await new Promise((r) => setTimeout(r, 600));
    return fail(401, 'Нэр эсвэл нууц үг буруу байна');
  }
  return json({ token: await makeToken(env, name), user: name });
}

async function listProducts(env) {
  const { results } = await env.DB.prepare('SELECT id, data, deleted, updated_at, updated_by FROM products').all();
  const items = [], deleted = [];
  for (const r of results) {
    if (r.deleted) deleted.push(r.id);
    else {
      try { items.push({ ...JSON.parse(r.data), _updatedAt: r.updated_at, _updatedBy: r.updated_by }); } catch { /* skip bad row */ }
    }
  }
  return json({ items, deleted }, 200, { 'cache-control': 'no-store' });
}

function productId(raw) {
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

async function saveProduct(request, env, id, user) {
  const text = await request.text();
  if (text.length > MAX_PRODUCT_BYTES) return fail(413, 'Барааны мэдээлэл хэт том байна');
  let p;
  try { p = JSON.parse(text); } catch { return fail(400, 'JSON буруу'); }
  if (!p || typeof p !== 'object' || Array.isArray(p)) return fail(400, 'Бараа буруу');
  if (Number(p.id) !== id) return fail(400, 'ID таарахгүй байна');
  if (typeof p.name !== 'string' || !p.name.trim()) return fail(400, 'Барааны нэр хоосон байна');
  delete p._updatedAt; delete p._updatedBy;
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO products (id, data, deleted, updated_at, updated_by) VALUES (?1, ?2, 0, ?3, ?4)
     ON CONFLICT(id) DO UPDATE SET data = excluded.data, deleted = 0, updated_at = excluded.updated_at, updated_by = excluded.updated_by`
  ).bind(id, JSON.stringify(p), now, user).run();
  return json({ ok: true, id, updatedAt: now });
}

async function deleteProduct(env, id, user) {
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO products (id, data, deleted, updated_at, updated_by) VALUES (?1, '{}', 1, ?2, ?3)
     ON CONFLICT(id) DO UPDATE SET deleted = 1, updated_at = excluded.updated_at, updated_by = excluded.updated_by`
  ).bind(id, now, user).run();
  return json({ ok: true, id });
}

async function uploadImage(request, env, url, user) {
  const type = (request.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const ext = IMAGE_TYPES[type];
  if (!ext) return fail(415, 'Зөвхөн JPG, PNG, WEBP зураг оруулна уу');
  const body = await request.arrayBuffer();
  if (!body.byteLength) return fail(400, 'Зураг хоосон байна');
  if (body.byteLength > MAX_IMAGE_BYTES) return fail(413, 'Зураг 8MB-аас их байна');
  const key = `products/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.${ext}`;
  await env.IMAGES.put(key, body, { httpMetadata: { contentType: type, cacheControl: 'public, max-age=31536000, immutable' }, customMetadata: { by: user } });
  return json({ ok: true, url: `${url.origin}/img/${key}` });
}

async function serveImage(env, key) {
  if (!key || key.includes('..')) return new Response('Not found', { status: 404, headers: CORS });
  const obj = await env.IMAGES.get(key);
  if (!obj) return new Response('Not found', { status: 404, headers: CORS });
  const headers = new Headers(CORS);
  obj.writeHttpMetadata(headers);
  headers.set('etag', obj.httpEtag);
  if (!headers.has('cache-control')) headers.set('cache-control', 'public, max-age=31536000, immutable');
  return new Response(obj.body, { headers });
}

// ---------- router ----------
export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    try {
      if (path === '/' || path === '/api/health') return json({ ok: true, service: 'buddy-shop-api' });
      if (request.method === 'GET' && path.startsWith('/img/')) return serveImage(env, decodeURIComponent(path.slice(5)));
      if (request.method === 'GET' && path === '/api/products') return listProducts(env);
      if (request.method === 'POST' && path === '/api/login') return login(request, env);
      if (request.method === 'POST' && path === '/api/t') return track(request, env).then((r) => { for (const [k, v] of Object.entries(CORS)) r.headers.set(k, v); return r; });
      if (request.method === 'GET' && path === '/api/erp') {
        return new Response(await getErp(env), { headers: { ...JSON_HEADERS, ...CORS, 'cache-control': 'public, max-age=300' } });
      }
      if (request.method === 'GET' && path === '/api/erp/status') {
        const d = JSON.parse(await getErp(env));
        const e = await env.IMAGES.get('erp/error.json');
        return json({ updatedAt: d.updatedAt, count: d.count, ms: d.ms, lastError: e ? JSON.parse(await e.text()) : null }, 200, { 'cache-control': 'no-store' });
      }

      // ---- Касс (pos.buddyshop.mn) → QPay ----
      // POST бүр x-pos-token шаардана; callback нь QPay-д хүчинтэй хаяг хэрэгтэй учраас л байгаа —
      // төлбөрийг үргэлж QPay-ээс шууд асууж баталгаажуулдаг тул энд хийх зүйл байхгүй.
      if (path === '/api/pos/qpay/callback' || path === '/api/pos/storepay/callback') return json({ ok: true });
      if (path.startsWith('/api/pos/')) {
        if (!posAuthed(env, request)) return fail(401, 'Кассын эрх алга');
        if (request.method === 'POST' && path === '/api/pos/qpay/invoice') {
          const r = await posInvoice(request, env); return json(r[1], r[0], { 'cache-control': 'no-store' });
        }
        if (request.method === 'GET' && path === '/api/pos/qpay/check') {
          const r = await posCheck(request, env, url.searchParams.get('id')); return json(r[1], r[0], { 'cache-control': 'no-store' });
        }
        if (request.method === 'POST' && path === '/api/pos/qpay/cancel') {
          const r = await posCancel(request, env); return json(r[1], r[0], { 'cache-control': 'no-store' });
        }
        if (request.method === 'POST' && path === '/api/pos/storepay/loan') {
          const r = await posLoan(request, env); return json(r[1], r[0], { 'cache-control': 'no-store' });
        }
        if (request.method === 'GET' && path === '/api/pos/storepay/check') {
          const r = await posLoanCheck(request, env, url.searchParams.get('id')); return json(r[1], r[0], { 'cache-control': 'no-store' });
        }
        return fail(404, 'Not found');
      }

      // ---- QPay ----
      if (path === '/api/qpay/callback') return qpayCallback(env, url);
      if (path === '/api/storepay/callback') return storepayCallback(env, url);
      if (path === '/api/qpay/status') return json({ enabled: qpay.enabled(env), storepay: storepay.enabled(env) }, 200, { 'cache-control': 'no-store' });
      const pm = path.match(/^\/api\/orders\/(\d+)\/pay$/);
      if (pm && request.method === 'GET') {
        const r = await payStatus(env, Number(pm[1]), url.searchParams.get('k'), url.searchParams.get('check') === '1');
        return json(r[1], r[0], { 'cache-control': 'no-store' });
      }
      const cm = path.match(/^\/api\/orders\/(\d+)\/cancel$/);
      if (cm && request.method === 'POST') {
        const r = await customerCancel(env, Number(cm[1]), url.searchParams.get('k'));
        return json(r[1], r[0], { 'cache-control': 'no-store' });
      }
      // ---- orders from the website cart (signed-in customer optional) ----
      if (request.method === 'POST' && path === '/api/orders') {
        const r = await createOrder(request, env, await customerId(request, env));
        return json(r[1], r[0], { 'cache-control': 'no-store' });
      }
      // ---- customer accounts (email code sign-in) ----
      if (path.startsWith('/api/account')) {
        const out = (r) => json(r[1], r[0], { 'cache-control': 'no-store' });
        if (request.method === 'POST' && path === '/api/account/code') {
          try { return out(await requestCode(request, env)); } catch (e) { return fail(502, e.message); }
        }
        if (request.method === 'POST' && path === '/api/account/verify') return out(await verifyCode(request, env));
        if (request.method === 'POST' && path === '/api/account/login') return out(await passwordLogin(request, env));
        const cid = await customerId(request, env);
        if (!cid) return fail(401, 'Дахин нэвтэрнэ үү');
        if (path === '/api/account' && request.method === 'GET') return out(await getAccount(env, cid));
        if (path === '/api/account' && request.method === 'PUT') return out(await updateAccount(request, env, cid));
        if (path === '/api/account' && request.method === 'DELETE') return out(await deleteAccount(env, cid));
        return fail(404, 'Not found');
      }

      // Are the Storepay secrets not just present but correct? Logs in and stops there — no loan
      // is created — so this is safe to run as often as you like. Takes the same two credentials
      // as the backup routes: BACKUP_TOKEN already downloads the whole database, so letting it
      // ask whether a login works widens nothing, and it saves the setup script a password
      // prompt it kept getting wrong.
      if (request.method === 'GET' && path === '/api/storepay/ping') {
        const bt = request.headers.get('x-backup-token') || '';
        const byToken = !!env.BACKUP_TOKEN && sameText(bt, env.BACKUP_TOKEN);
        if (!byToken && !(await whoIs(request, env))) return fail(401, 'Дахин нэвтэрнэ үү');
        if (!storepay.enabled(env)) return json({ ok: false, error: 'Storepay түлхүүр тавиагүй байна' }, 200, { 'cache-control': 'no-store' });
        try { await storepay.ping(env); return json({ ok: true }, 200, { 'cache-control': 'no-store' }); }
        catch (e) { return json({ ok: false, error: e.message }, 200, { 'cache-control': 'no-store' }); }
      }

      // ---- database backups ----
      // These files hold product cost and every customer's details, so they never leave without
      // a credential. Two are accepted: a signed-in staff token, or BACKUP_TOKEN — a secret of
      // its own for the monthly download script on the owner's Mac, so that script never has to
      // keep a staff password and the secret can be rotated alone if the machine is lost.
      if (path === '/api/backup' || path.startsWith('/api/backup/')) {
        const bt = request.headers.get('x-backup-token') || '';
        const byToken = !!env.BACKUP_TOKEN && sameText(bt, env.BACKUP_TOKEN);
        if (!byToken && !(await whoIs(request, env))) return fail(401, 'Дахин нэвтэрнэ үү');

        if (path === '/api/backup' && request.method === 'GET') {
          const b = await listBackups(env);
          const e = await env.IMAGES.get('backup/error.json');
          return json({ ...b, lastError: e ? JSON.parse(await e.text()) : null }, 200, { 'cache-control': 'no-store' });
        }
        if (path === '/api/backup/latest.txt' && request.method === 'GET') {
          return new Response(await latestText(env), { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
        }
        if (path === '/api/backup/run' && request.method === 'POST') {
          try { return json(await runBackup(env), 200, { 'cache-control': 'no-store' }); }
          catch (e) { return fail(500, e.message); }
        }
        const bf = path.match(/^\/api\/backup\/(\d{4}-\d{2}-\d{2})$/);
        if (bf && request.method === 'GET') {
          const obj = await getBackupFile(env, bf[1]);
          if (!obj) return fail(404, 'Тийм нөөц алга');
          return new Response(obj.body, { headers: {
            'content-type': 'application/x-ndjson', 'content-encoding': 'gzip',
            'content-disposition': `attachment; filename="buddy-${bf[1]}.ndjson.gz"`,
            'cache-control': 'no-store',
          } });
        }
        return fail(404, 'Not found');
      }

      const user = await whoIs(request, env);
      if (!user) return fail(401, 'Дахин нэвтэрнэ үү');
      if (request.method === 'GET' && path === '/api/me') return json({ user });
      if (request.method === 'POST' && path === '/api/upload') return uploadImage(request, env, url, user);
      if (path.startsWith('/api/telegram')) {
        try {
          if (request.method === 'GET' && path === '/api/telegram') return json(await tg.status(env), 200, { 'cache-control': 'no-store' });
          if (request.method === 'GET' && path === '/api/telegram/find') return json(await tg.findChats(env), 200, { 'cache-control': 'no-store' });
          if (request.method === 'POST' && path === '/api/telegram/chats') return json({ chats: await tg.setChat(env, await request.json().catch(() => ({}))) });
          if (request.method === 'POST' && path === '/api/telegram/test') return json(await tg.test(env));
        } catch (e) { return fail(400, e.message); }
      }
      if (request.method === 'GET' && path === '/api/orders') return json(await listOrders(env, url), 200, { 'cache-control': 'no-store' });
      const qc = path.match(/^\/api\/orders\/(\d+)\/qpay-check$/);
      if (qc && request.method === 'POST') { const r = await staffCheck(env, Number(qc[1])); return json(r[1], r[0]); }
      const om = path.match(/^\/api\/orders\/(\d+)$/);
      if (om && request.method === 'PUT') { const r = await updateOrder(request, env, Number(om[1]), user); return json(r[1], r[0]); }
      if (request.method === 'GET' && path === '/api/customers') return json({ items: await listCustomers(env) }, 200, { 'cache-control': 'no-store' });
      if (request.method === 'GET' && path === '/api/stats') return json(await stats(env, url.searchParams.get('days')), 200, { 'cache-control': 'no-store' });
      if (request.method === 'GET' && path === '/api/erp/catalog') {
        return new Response(await getCatalog(env), { headers: { ...JSON_HEADERS, ...CORS, 'cache-control': 'no-store' } });
      }
      if (request.method === 'GET' && path === '/api/erp/top') return json(await getTop(env), 200, { 'cache-control': 'no-store' });
      if (request.method === 'POST' && path === '/api/erp/top/refresh') {
        try { return json({ ok: true, ...(await syncTop(env, Number(url.searchParams.get('days')) || 90)) }); }
        catch (e) { await saveErpError(env, e); return fail(502, e.message); }
      }
      if (request.method === 'POST' && path === '/api/erp/dismiss') {
        const { code, hide } = await request.json().catch(() => ({}));
        try { return json({ ok: true, dismissed: await setDismissed(env, code, hide !== false) }); }
        catch (e) { return fail(400, e.message); }
      }
      if (request.method === 'POST' && path === '/api/erp/sync') {
        try { return json({ ok: true, ...(await syncErp(env)) }); }
        catch (e) { await saveErpError(env, e); return fail(502, e.message); }
      }
      const m = path.match(/^\/api\/products\/(\d+)$/);
      if (m) {
        const id = productId(m[1]);
        if (!id) return fail(400, 'ID буруу');
        if (request.method === 'PUT') return saveProduct(request, env, id, user);
        if (request.method === 'DELETE') return deleteProduct(env, id, user);
      }
      return fail(404, 'Not found');
    } catch (err) {
      console.error(err);
      return fail(500, 'Серверийн алдаа');
    }
  },

  // Every 15 minutes: copy prices and shop stock from Odoo (see erp.js).
  async scheduled(event, env, ctx) {
    // Daily (06:00 Ulaanbaatar): POS best sellers for the admin suggestions.
    if (event.cron === '0 22 * * *') {
      ctx.waitUntil(syncTop(env).then((r) => console.log('erp top', r), (e) => saveErpError(env, e)));
      ctx.waitUntil(prune(env).catch((e) => console.error('prune', e)));
      ctx.waitUntil(pruneCodes(env).catch((e) => console.error('prune codes', e)));
      return;
    }
    // 03:30 Ulaanbaatar, in an invocation of its own: Supabase's free plan backs up nothing,
    // so this is the only copy of the shop's history.
    if (event.cron === '30 19 * * *') {
      ctx.waitUntil(runBackup(env).then(
        async (r) => {
          console.log('backup', r.date, r.rows, 'rows', r.ms + 'ms');
          await env.IMAGES.delete('backup/error.json');
          await backupNotice(env, r, null).catch((e) => console.error('backup mail', e));
        },
        async (e) => { await saveBackupError(env, e); await backupNotice(env, null, e).catch(() => {}); },
      ));
      return;
    }
    // Hourly while the shop is open (10:00–20:00 Ulaanbaatar). Named rather than left as the
    // fallback so that adding a cron later cannot silently turn into a price sync.
    if (event.cron === '0 2-12 * * *') {
      ctx.waitUntil(syncErp(env).then(
        async (r) => { console.log('erp sync', r); await env.IMAGES.delete('erp/error.json'); },
        (e) => saveErpError(env, e),
      ));
    }
  },
};

async function saveBackupError(env, e) {
  console.error('backup failed', e);
  await env.IMAGES.put('backup/error.json', JSON.stringify({ at: new Date().toISOString(), error: String((e && e.message) || e) }),
    { httpMetadata: { contentType: 'application/json' } }).catch(() => {});
}

async function saveErpError(env, e) {
  console.error('erp sync failed', e);
  await env.IMAGES.put('erp/error.json', JSON.stringify({ at: new Date().toISOString(), error: String(e && e.message || e) }),
    { httpMetadata: { contentType: 'application/json' } }).catch(() => {});
}
