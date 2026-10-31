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
  if (!res.ok) throw new Error(`Odoo HTTP ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error('Odoo: ' + (data.error.data?.message || data.error.message));
  return { result: data.result, res };
}

export async function syncErp(env) {
  if (!env.ODOO_URL || !env.ODOO_LOGIN || !env.ODOO_PASSWORD) throw new Error('ODOO_* тохиргоо дутуу байна');
  const started = Date.now();

  // 1. Sign in (Odoo 13 has no API keys, so a normal login session is used).
  const { result: session, res } = await odoo(env, '/web/session/authenticate', {
    db: env.ODOO_DB, login: env.ODOO_LOGIN, password: env.ODOO_PASSWORD,
  });
  if (!session || !session.uid) throw new Error('Odoo-д нэвтэрч чадсангүй (нэр/нууц үг?)');
  const sid = (res.headers.get('set-cookie') || '').match(/session_id=([^;]+)/);
  if (!sid) throw new Error('Odoo session cookie ирсэнгүй');
  const cookie = 'session_id=' + sid[1];

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
    const code = String(r.default_code || '').trim().toUpperCase();
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
