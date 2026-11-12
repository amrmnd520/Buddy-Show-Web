// Pocket (PocketZero — buy now, pay later): an invoice the customer pays in the Pocket app, by QR or deep link.
// Written against "Pocket Payment Gateway v2.0.3.1" (e-commerce).
//
// Secrets (npx wrangler secret put), from Pocket's «prod env credential» document:
//   POCKET_CLIENT_ID, POCKET_CLIENT_SECRET   — OAuth2 client_credentials
//   POCKET_TERMINAL_ID                        — the «Online web» terminal number
// Optional vars: POCKET_SSO (default https://sso.invescore.mn), POCKET_URL (default https://service.invescore.mn/merchant)
//   test environment: POCKET_SSO=https://sso-staging.pocket.mn  POCKET_URL=https://service-staging.pocket.mn/merchant
// A payment is never trusted from the webhook alone: it is always confirmed with /v2/invoicing/invoices/invoice-id.

const sso = (env) => String(env.POCKET_SSO || 'https://sso.invescore.mn').replace(/\/+$/, '');
const api = (env) => String(env.POCKET_URL || 'https://service.invescore.mn/merchant').replace(/\/+$/, '');
const REALM = 'invescore';
let tok = null;          // { token, until }
let hookSet = '';        // webhook URL already registered by this worker instance

export const enabled = (env) => !!(env.POCKET_CLIENT_ID && env.POCKET_CLIENT_SECRET && env.POCKET_TERMINAL_ID);
// PocketZero limits from the manual (API 3): 100,000₮ – 10,000,000₮
export const MIN = 100000, MAX = 10000000;

const t = (v) => String(v || '').trim();
const msgOf = (d) => (d && (d.message || d.error_description || d.error || d.title || (Array.isArray(d.errors) && d.errors[0] && (d.errors[0].message || d.errors[0])))) || '';

async function token(env) {
  if (tok && Date.now() < tok.until) return tok.token;
  const body = new URLSearchParams({ grant_type: 'client_credentials', client_id: t(env.POCKET_CLIENT_ID), client_secret: t(env.POCKET_CLIENT_SECRET) });
  // The manual says /realms/…; Pocket's own Postman collection says /auth/realms/… (older Keycloak). Try both.
  let res, d;
  for (const prefix of ['', '/auth']) {
    res = await fetch(`${sso(env)}${prefix}/realms/${REALM}/protocol/openid-connect/token`, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body,
    });
    d = await res.json().catch(() => ({}));
    if (res.status !== 404) break;
  }
  if (!res.ok || !d.access_token) throw new Error('Pocket нэвтрэлт амжилтгүй (' + (msgOf(d) || res.status) + ')');
  tok = { token: d.access_token, until: Date.now() + Math.max(30, (Number(d.expires_in) || 600) - 30) * 1000 };
  return tok.token;
}

async function call(env, path, body, method = 'POST') {
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(api(env) + path, {
      method, headers: { authorization: 'Bearer ' + (await token(env)), 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401 && attempt === 0) { tok = null; continue; }
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error('Pocket: ' + (msgOf(d) || res.status));
    return d;
  }
}

// terminal ids are 14-digit numbers: inside JavaScript's safe range, sent as a JSON number (Long)
const terminal = (env) => Number(t(env.POCKET_TERMINAL_ID));

// Pocket sends payment events to ONE webhook URL per merchant (API 6). Register ours before the
// first invoice of each worker instance; it is idempotent on Pocket's side.
export async function ensureWebhook(env, url) {
  if (hookSet === url) return;
  await call(env, '/pg/config', { fallBackUrl: url });
  hookSet = url;
}

// returns { id, qr, deeplink }
export async function createInvoice(env, { number, amount }) {
  const d = await call(env, '/v2/invoicing/generate-invoice', {
    terminalId: terminal(env), amount: Math.round(Number(amount) || 0),
    info: `Buddy Shop ${number}`.slice(0, 200), orderNumber: String(number).slice(0, 32),
    invoiceType: 'ZERO', channel: 'ecommerce',
  });
  if (!d || d.id === undefined || d.id === null) throw new Error('Pocket: нэхэмжлэхийн дугаар ирсэнгүй');
  return { id: String(d.id), qr: d.qr || '', deeplink: d.deeplink || (d.qr ? 'pckt://payment?qr=' + encodeURIComponent(d.qr) : '') };
}

// invoice state: 'paid' is the only paid state (pending, processing, processed = still waiting)
export async function invoiceState(env, invoiceId) {
  const d = await call(env, '/v2/invoicing/invoices/invoice-id', { terminalId: terminal(env), invoiceId: Number(invoiceId) });
  return { state: String(d.state || '').toLowerCase(), amount: Number(d.amount) || 0 };
}

// credentials check: token only — creates nothing
export async function ping(env) { tok = null; await token(env); return true; }
