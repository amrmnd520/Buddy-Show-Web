// Buddy Shop ERP (Supabase) → website: prices and shop stock.
// Runs every 15 minutes (cron in wrangler.toml) and on demand via POST /api/erp/sync.
// The result is kept in R2 as erp/stock.json and served at GET /api/erp.
//
// Replaces the former Odoo reader. The output shape is unchanged, so erp-sync.js,
// stock-filter.js and the staff tools keep working without any edit.
//
// Secrets (npx wrangler secret put): SUPABASE_URL, SUPABASE_KEY
//   SUPABASE_KEY is the service_role key. It stays on the Worker — never in the browser.
//   Cost is never selected here, so /api/erp cannot leak it.

const KEY = 'erp/stock.json';
const CATALOG_KEY = 'erp/catalog.json';
const PRODUCTS_KEY = 'erp/products.json';
const PAGE = 1000;

function sbBase(env) {
  const url = String(env.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = env.SUPABASE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_KEY тохиргоо дутуу байна');
  return { url, key };
}

// One page of a PostgREST query.
async function sbPage(env, path, from, to) {
  const { url, key } = sbBase(env);
  const res = await fetch(`${url}/rest/v1/${path}`, {
    headers: {
      apikey: key,
      authorization: 'Bearer ' + key,
      accept: 'application/json',
      range: `${from}-${to}`,
      'range-unit': 'items',
    },
  });
  if (!res.ok) {
    const t = (await res.text()).replace(/\s+/g, ' ').slice(0, 200);
    throw new Error(`Supabase HTTP ${res.status}: ${t}`);
  }
  return res.json();
}

// Every row, a page at a time (PostgREST caps a single response).
async function sbAll(env, path, cap = 20000) {
  const out = [];
  for (let from = 0; from < cap; from += PAGE) {
    const rows = await sbPage(env, path, from, from + PAGE - 1);
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

export async function syncErp(env) {
  const started = Date.now();

  // Only what the website may see: code, name, brand, category, sale price, stock. Never cost.
  const rows = await sbAll(env, 'products?select=sku,name,brand,category,price,qty,active&sku=not.is.null&order=id.asc');

  // Compact map: CODE -> [price, qty] (public, small) + names for staff tools
  // + the public product list for the iPhone app (active products only).
  const items = {};
  const named = [];
  const listed = new Map();
  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  for (const r of rows) {
    const code = String(r.sku || '').trim().toUpperCase().replace(/\s+/g, ' ');
    if (!code) continue;
    const price = Math.round(Number(r.price) || 0);
    const qty = Math.max(0, Math.floor(Number(r.qty) || 0));
    if (items[code]) items[code][1] += qty;   // same code twice → add stock
    else items[code] = [price, qty];
    named.push([
      String(r.sku).trim().replace(/\s+/g, ' '),
      String(r.name || '').replace(/\s+/g, ' ').trim(),
      price,
      qty,
    ]);
    if (r.active !== false && price > 0) {
      const had = listed.get(code);
      if (had) had[5] += qty;                  // same code twice → one product, stock added
      else listed.set(code, [clean(r.sku), clean(r.name), clean(r.brand), clean(r.category), price, qty]);
    }
  }

  if (!Object.keys(items).length) throw new Error('Supabase-ээс бараа ирсэнгүй — хуучин өгөгдлийг хэвээр үлдээв');

  const out = {
    updatedAt: new Date().toISOString(),
    source: 'supabase',
    count: Object.keys(items).length,
    ms: Date.now() - started,
    items,
  };
  await env.IMAGES.put(KEY, JSON.stringify(out), {
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
  });
  await env.IMAGES.put(CATALOG_KEY, JSON.stringify({ updatedAt: out.updatedAt, items: named }), {
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
  });
  await env.IMAGES.put(PRODUCTS_KEY, JSON.stringify({
    updatedAt: out.updatedAt,
    fields: ['code', 'name', 'brand', 'category', 'price', 'qty'],
    count: listed.size,
    items: [...listed.values()],
  }), { httpMetadata: { contentType: 'application/json; charset=utf-8' } });
  return { updatedAt: out.updatedAt, count: out.count, ms: out.ms };
}

// Every active ERP product with a price — public, for the iPhone app. Same fields the
// website already shows (no cost, no supplier, no sales). Refreshed with the price sync.
export async function getProducts(env) {
  const obj = await env.IMAGES.get(PRODUCTS_KEY);
  return obj ? obj.text() : JSON.stringify({ updatedAt: null, fields: [], count: 0, items: [] });
}

// Every ERP product with its name — for staff tools only (served behind login).
export async function getCatalog(env) {
  const obj = await env.IMAGES.get(CATALOG_KEY);
  return obj ? obj.text() : JSON.stringify({ updatedAt: null, items: [] });
}

export async function getErp(env) {
  const obj = await env.IMAGES.get(KEY);
  return obj ? obj.text() : JSON.stringify({ updatedAt: null, count: 0, items: {} });
}

// ---------- best sellers that are not on the website ----------
// Once a day: POS sales of the last N days, grouped so that sizes of one product
// ("... L", "... M", "-XL") become one suggestion with several codes.
const TOP_KEY = 'erp/top.json';
const DISMISS_KEY = 'erp/dismissed.json';
const SIZE = /^(xxs|xs|s|m|l|xl|xxl|2xl|3xl|4xl|5xl|mk|lk|xlk|lxl|sm|mxl|\d{1,2}|р\.\d+)$/i;
const baseName = (n) => String(n || '').toLowerCase().replace(/[’']/g, '').replace(/[,]/g, ' ').replace(/\s+/g, ' ').trim()
  .split(' ').filter((t) => !SIZE.test(t)).join(' ');

export async function syncTop(env, days = 90) {
  const started = Date.now();
  const since = new Date(Date.now() - days * 864e5).toISOString();

  // Sold lines in the window, with the product behind each one.
  const lines = await sbAll(
    env,
    'sale_lines?select=qty,returned,subtotal,product_id,sales!inner(t)' +
      `&sales.t=gte.${encodeURIComponent(since)}&product_id=not.is.null&order=id.asc`,
    60000,
  );

  const sold = new Map();                       // product_id -> { qty, rev }
  for (const l of lines) {
    const id = l.product_id;
    const q = (Number(l.qty) || 0) - (Number(l.returned) || 0);
    if (q <= 0) continue;
    const g = sold.get(id) || { qty: 0, rev: 0 };
    g.qty += q;
    g.rev += Number(l.subtotal) || 0;
    sold.set(id, g);
  }
  if (!sold.size) {
    const empty = { updatedAt: new Date().toISOString(), days, count: 0, ms: Date.now() - started, items: [] };
    await env.IMAGES.put(TOP_KEY, JSON.stringify(empty), { httpMetadata: { contentType: 'application/json; charset=utf-8' } });
    return { updatedAt: empty.updatedAt, count: 0, ms: empty.ms };
  }

  // The products themselves (cost is never selected).
  const prods = await sbAll(env, 'products?select=id,sku,name,price,qty,category&sku=not.is.null&order=id.asc');

  const byBase = new Map();
  for (const p of prods) {
    const s = sold.get(p.id);
    if (!s) continue;
    const code = String(p.sku || '').trim().replace(/\s+/g, ' ');
    if (!code) continue;
    const key = baseName(p.name) || code.toLowerCase();
    let g = byBase.get(key);
    if (!g) {
      byBase.set(key, g = {
        name: String(p.name || '').replace(/\s+/g, ' ').trim().split(' ')
          .filter((t) => !SIZE.test(t.replace(/,$/, ''))).join(' ').replace(/[,\s-]+$/, ''),
        codes: [], categ: p.category || '', sold: 0, revenue: 0, price: 0, qty: 0,
      });
    }
    g.codes.push(code);
    g.sold += s.qty;
    g.revenue += s.rev;
    g.price = Math.max(g.price, Math.round(Number(p.price) || 0));
    g.qty += Math.max(0, Math.floor(Number(p.qty) || 0));
  }

  const items = [...byBase.values()].filter((g) => g.sold > 0)
    .map((g) => ({ ...g, sold: Math.round(g.sold), revenue: Math.round(g.revenue) }))
    .sort((a, b) => b.revenue - a.revenue).slice(0, 400);

  const out = { updatedAt: new Date().toISOString(), days, count: items.length, ms: Date.now() - started, items };
  await env.IMAGES.put(TOP_KEY, JSON.stringify(out), { httpMetadata: { contentType: 'application/json; charset=utf-8' } });
  return { updatedAt: out.updatedAt, count: out.count, ms: out.ms };
}

export async function getTop(env) {
  const [t, d] = await Promise.all([env.IMAGES.get(TOP_KEY), env.IMAGES.get(DISMISS_KEY)]);
  const top = t ? JSON.parse(await t.text()) : { updatedAt: null, days: 90, count: 0, items: [] };
  top.dismissed = d ? JSON.parse(await d.text()) : [];
  return top;
}

// Staff can hide a suggestion ("сайтад хэрэггүй"); the list is shared by everyone.
export async function setDismissed(env, code, hide) {
  const d = await env.IMAGES.get(DISMISS_KEY);
  const set = new Set(d ? JSON.parse(await d.text()) : []);
  const key = String(code || '').trim().toUpperCase();
  if (!key) throw new Error('Код хоосон');
  if (hide) set.add(key); else set.delete(key);
  await env.IMAGES.put(DISMISS_KEY, JSON.stringify([...set]), { httpMetadata: { contentType: 'application/json' } });
  return [...set];
}
