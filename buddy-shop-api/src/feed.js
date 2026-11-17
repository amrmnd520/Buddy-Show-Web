// Facebook / Instagram (Meta Commerce Manager) product feed.
//
// GET /feed/facebook.csv — every product on buddyshop.mn as Meta catalog CSV, built the same way
// the website builds its list:
//   catalog.js (base list)  →  staff edits/additions/deletions (D1)  →  ERP price + stock (Supabase, hourly)
// Commerce Manager → Catalog → Data sources → Data feed → Scheduled feed: paste this URL, hourly or daily.
//
// Nothing private is exposed: only what the public site already shows (name, price, stock state, photos).

import { getErp } from './erp.js';

const SHOP = 'https://buddyshop.mn';
const SKIP_CATEGORIES = new Set(['Бэлгийн карт']); // gift cards are not physical goods for Meta's catalog

const norm = (c) => String(c || '').trim().toUpperCase().replace(/\s+/g, ' ');

let cache = null; // { at, csv, count }

async function fetchSiteArray(env, file, open, close) {
  const site = String(env.SITE_URL || 'https://amrmnd520.github.io/Buddy-Show-Web').replace(/\/+$/, '');
  const res = await fetch(`${site}/${file}?t=${Math.floor(Date.now() / 3600e3)}`, { cf: { cacheTtl: 600 } });
  if (!res.ok) throw new Error(`${file} ${res.status}`);
  const text = await res.text();
  return JSON.parse(text.slice(text.indexOf(open), text.lastIndexOf(close) + 1));
}

async function staffRows(env) {
  const { results } = await env.DB.prepare('SELECT id, data, deleted FROM products').all().catch(() => ({ results: [] }));
  return results || [];
}

async function erpMap(env) {
  try {
    const d = JSON.parse(await getErp(env));
    const m = {};
    for (const [k, v] of Object.entries(d.items || {})) {
      const key = norm(k);
      m[key] = m[key] ? [m[key][0] || v[0], m[key][1] + v[1]] : [Number(v[0]) || 0, Number(v[1]) || 0];
    }
    return m;
  } catch { return {}; }
}

// Same code rules as erp-sync.js on the site.
function codesOf(code, erp) {
  const raw = norm(code);
  if (!raw) return [];
  if (erp[raw]) return [raw];
  if (/[|;,]/.test(raw)) return raw.split(/\s*[|;,]\s*/).filter(Boolean);
  return raw.split(' ').filter(Boolean);
}

const abs = (u) => {
  const s = String(u || '').trim();
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) return s;
  return SHOP + '/' + s.replace(/^\/+/, '').split('/').map(encodeURIComponent).join('/');
};

const plain = (t) => String(t || '')
  .replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/[ \t]+/g, ' ').replace(/\n\s*\n\s*\n+/g, '\n\n').trim();

const cell = (v) => {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

const COLUMNS = ['id', 'title', 'description', 'availability', 'condition', 'price', 'link', 'image_link',
  'additional_image_link', 'brand', 'product_type', 'item_group_id', 'size', 'inventory'];

async function build(env) {
  const [catalog, rows, erp, mn] = await Promise.all([
    fetchSiteArray(env, 'catalog.js', '[', ']'),
    staffRows(env),
    erpMap(env),
    fetchSiteArray(env, 'descriptions-mn-data.js', '{', '}').catch(() => ({})),
  ]);

  // catalog.js + staff edits, exactly like shop-sync.js does in the browser
  const byId = new Map(catalog.map((p) => [Number(p.id), p]));
  for (const r of rows) {
    const id = Number(r.id);
    if (r.deleted) { byId.delete(id); continue; }
    try { byId.set(id, { ...(byId.get(id) || {}), ...JSON.parse(r.data), id }); } catch { /* bad row */ }
  }

  const out = [COLUMNS.join(',')];
  let count = 0;
  for (const p of byId.values()) {
    if (!p || !p.name || SKIP_CATEGORIES.has(p.category)) continue;
    const image = abs(p.image || (p.images || [])[0]);
    if (!image) continue; // Meta rejects items without a photo

    // Mongolian description, same rule as descriptions-mn.js: only when staff have not rewritten it
    let desc = p.description || p.shortDescription || '';
    const m = mn[p.id];
    if (m) { const cur = String(desc).trim().length; if (cur === 0 || cur === m[1]) desc = m[0]; }
    desc = plain(desc) || p.name;

    const extra = [...new Set((p.images || []).map(abs).filter((u) => u && u !== image))].slice(0, 10).join(',');
    const type = [p.category, p.subcategory].filter(Boolean).join(' > ');
    const link = `${SHOP}/?p=${p.id}`;
    const base = {
      title: String(p.name).replace(/\s+/g, ' ').trim().slice(0, 150),
      description: desc.slice(0, 5000),
      condition: 'new',
      link,
      image_link: image,
      additional_image_link: extra,
      brand: String(p.brand || 'Buddy Shop').slice(0, 100),
      product_type: type,
    };

    const sizes = Array.isArray(p.sizes) ? p.sizes.filter((s) => s && s.label) : [];
    if (sizes.length) {
      for (const s of sizes) {
        const hits = [s.code, ...(s.extra || [])].map((c) => erp[norm(c)]).filter(Boolean);
        const price = Math.round((hits.find((h) => h[0] > 0) || [0])[0] || Number(s.price) || Number(p.price) || 0);
        if (!(price > 0)) continue;
        const qty = hits.length ? hits.reduce((t, h) => t + h[1], 0) : (Number(s.qty) || Number(p.stock) || 0);
        out.push(row({ ...base, id: `${p.id}-${s.label}`, item_group_id: String(p.id), size: s.label, price, qty }));
        count++;
      }
      continue;
    }

    const hits = codesOf(p.code, erp).map((c) => erp[c]).filter(Boolean);
    const erpPrice = (hits.find((h) => h[0] > 0) || [0])[0];
    const price = Math.round(erpPrice || Number(p.price) || 0);
    if (!(price > 0)) continue;
    const qty = hits.length ? hits.reduce((t, h) => t + h[1], 0) : Math.max(0, Number(p.stock) || 0);
    out.push(row({ ...base, id: String(p.id), item_group_id: '', size: '', price, qty }));
    count++;
  }
  return { csv: out.join('\n') + '\n', count };
}

function row(x) {
  const v = {
    ...x,
    availability: x.qty > 0 ? 'in stock' : 'out of stock',
    price: `${x.price} MNT`,
    inventory: Math.max(0, Math.floor(x.qty)),
  };
  return COLUMNS.map((c) => cell(v[c])).join(',');
}

export async function facebookFeed(env) {
  // The ERP refreshes hourly, so a 30-minute cache keeps the feed current without rebuilding it per request.
  if (!cache || Date.now() - cache.at > 30 * 60e3) cache = { at: Date.now(), ...(await build(env)) };
  return new Response(cache.csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': 'inline; filename="buddyshop-facebook.csv"',
      'cache-control': 'public, max-age=1800',
      'x-item-count': String(cache.count),
      'access-control-allow-origin': '*',
    },
  });
}
