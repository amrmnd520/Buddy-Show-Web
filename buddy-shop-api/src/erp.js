// Odoo ERP → website: prices and stock of the shop warehouse.
// Runs every 15 minutes (cron in wrangler.toml) and on demand via POST /api/erp/sync.
// The result is kept in R2 as erp/stock.json and served at GET /api/erp.
//
// Settings (wrangler.toml [vars]):  ODOO_URL, ODOO_DB, ODOO_LOCATION_ID, ODOO_COMPANY_ID
// Secrets (npx wrangler secret put): ODOO_LOGIN, ODOO_PASSWORD

const KEY = 'erp/stock.json';

async function odoo(env, path, params, cookie) {
  const res = await fetch(env.ODOO_URL.replace(/\/+$/, '') + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'call', params }),
  });
  if (!res.ok) throw new Error(`Odoo HTTP ${res.status}: ${(await res.text()).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160)}`);
  const data = await res.json();
  if (data.error) throw new Error('Odoo: ' + (data.error.data?.message || data.error.message));
  return { result: data.result, res };
}

async function signIn(env) {
  if (!env.ODOO_URL || !env.ODOO_LOGIN || !env.ODOO_PASSWORD) throw new Error('ODOO_* тохиргоо дутуу байна');
  // Odoo 13 has no API keys, so a normal login session is used.
  const { result: session, res } = await odoo(env, '/web/session/authenticate', {
    db: env.ODOO_DB, login: env.ODOO_LOGIN, password: env.ODOO_PASSWORD,
  });
  if (!session || !session.uid) throw new Error('Odoo-д нэвтэрч чадсангүй (нэр/нууц үг?)');
  const sid = (res.headers.get('set-cookie') || '').match(/session_id=([^;]+)/);
  if (!sid) throw new Error('Odoo session cookie ирсэнгүй');
  return 'session_id=' + sid[1];
}

const call = (env, cookie, model, method, args, kwargs = {}) =>
  odoo(env, '/web/dataset/call_kw', { model, method, args, kwargs }, cookie).then((r) => r.result);

export async function syncErp(env) {
  const started = Date.now();
  const cookie = await signIn(env);

  // 2. Read every product with a code: sale price and on-hand quantity in the shop location.
  const location = Number(env.ODOO_LOCATION_ID || 8);
  const company = Number(env.ODOO_COMPANY_ID || 1);
  const { result: rows } = await odoo(env, '/web/dataset/call_kw', {
    model: 'product.product', method: 'search_read',
    args: [[['default_code', '!=', false]]],
    kwargs: {
      fields: ['default_code', 'lst_price', 'qty_available'],
      context: { location, allowed_company_ids: [company], force_company: company },
    },
  }, cookie);

  // 3. Compact map: CODE -> [price, qty]
  const items = {};
  for (const r of rows || []) {
    const code = String(r.default_code || '').trim().toUpperCase().replace(/\s+/g, ' ');
    if (!code) continue;
    const price = Math.round(Number(r.lst_price) || 0);
    const qty = Math.max(0, Math.floor(Number(r.qty_available) || 0));
    if (items[code]) items[code][1] += qty; // same code twice → add stock
    else items[code] = [price, qty];
  }

  await odoo(env, '/web/session/destroy', {}, cookie).catch(() => {});

  const out = { updatedAt: new Date().toISOString(), location, count: Object.keys(items).length, ms: Date.now() - started, items };
  await env.IMAGES.put(KEY, JSON.stringify(out), {
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
  });
  return { updatedAt: out.updatedAt, count: out.count, ms: out.ms };
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
  const cookie = await signIn(env);
  const company = Number(env.ODOO_COMPANY_ID || 1);
  const location = Number(env.ODOO_LOCATION_ID || 8);
  const ctx = { allowed_company_ids: [company], force_company: company };
  const since = new Date(Date.now() - days * 864e5).toISOString().slice(0, 19).replace('T', ' ');

  const groups = await call(env, cookie, 'pos.order.line', 'read_group',
    [[['order_id.date_order', '>=', since], ['order_id.state', 'in', ['paid', 'done', 'invoiced']]],
      ['qty:sum', 'price_subtotal_incl:sum'], ['product_id']], { lazy: false, context: ctx });
  const sold = new Map();
  for (const g of groups || []) if (g.product_id) sold.set(g.product_id[0], { qty: g.qty || 0, rev: g.price_subtotal_incl || 0 });

  const ids = [...sold.keys()];
  const prods = ids.length ? await call(env, cookie, 'product.product', 'read',
    [ids, ['default_code', 'name', 'lst_price', 'qty_available', 'categ_id']], { context: { ...ctx, location } }) : [];
  await odoo(env, '/web/session/destroy', {}, cookie).catch(() => {});

  const byBase = new Map();
  for (const p of prods) {
    const code = String(p.default_code || '').trim().replace(/\s+/g, ' ');
    if (!code) continue;
    const s = sold.get(p.id) || { qty: 0, rev: 0 };
    const key = baseName(p.name) || code.toLowerCase();
    let g = byBase.get(key);
    if (!g) byBase.set(key, g = { name: String(p.name).replace(/\s+/g, ' ').trim().split(' ').filter((t) => !SIZE.test(t.replace(/,$/, ''))).join(' ').replace(/[,\s-]+$/, ''), codes: [], categ: p.categ_id ? p.categ_id[1] : '', sold: 0, revenue: 0, price: 0, qty: 0 });
    g.codes.push(code);
    g.sold += s.qty; g.revenue += s.rev;
    g.price = Math.max(g.price, Math.round(p.lst_price || 0));
    g.qty += Math.max(0, Math.floor(p.qty_available || 0));
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
