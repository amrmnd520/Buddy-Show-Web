// Buddy Shop shared product API (Cloudflare Worker + D1 + R2).
// Stores products that were added, edited or deleted by staff on top of the
// site's catalog.js, and serves product photos uploaded from the admin page.

import { syncErp, getErp } from './erp.js';

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type',
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
      if (request.method === 'GET' && path === '/api/erp') {
        return new Response(await getErp(env), { headers: { ...JSON_HEADERS, ...CORS, 'cache-control': 'public, max-age=300' } });
      }
      if (request.method === 'GET' && path === '/api/erp/status') {
        const d = JSON.parse(await getErp(env));
        const e = await env.IMAGES.get('erp/error.json');
        return json({ updatedAt: d.updatedAt, count: d.count, ms: d.ms, lastError: e ? JSON.parse(await e.text()) : null }, 200, { 'cache-control': 'no-store' });
      }

      const user = await whoIs(request, env);
      if (!user) return fail(401, 'Дахин нэвтэрнэ үү');
      if (request.method === 'GET' && path === '/api/me') return json({ user });
      if (request.method === 'POST' && path === '/api/upload') return uploadImage(request, env, url, user);
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
    ctx.waitUntil(syncErp(env).then(
      async (r) => { console.log('erp sync', r); await env.IMAGES.delete('erp/error.json'); },
      (e) => saveErpError(env, e),
    ));
  },
};

async function saveErpError(env, e) {
  console.error('erp sync failed', e);
  await env.IMAGES.put('erp/error.json', JSON.stringify({ at: new Date().toISOString(), error: String(e && e.message || e) }),
    { httpMetadata: { contentType: 'application/json' } }).catch(() => {});
}
