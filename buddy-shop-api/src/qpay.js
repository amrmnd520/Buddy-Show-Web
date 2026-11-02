// QPay (merchant API v2): an invoice per website order, paid by QR or bank app.
// Secrets: QPAY_USERNAME, QPAY_PASSWORD, QPAY_INVOICE_CODE (from the QPay merchant contract).
// Optional var QPAY_URL: https://merchant.qpay.mn (default) or https://merchant-sandbox.qpay.mn for tests.
// A payment is never trusted from the callback alone: it is always confirmed with /payment/check.

const base = (env) => String(env.QPAY_URL || 'https://merchant.qpay.mn').replace(/\/+$/, '') + '/v2';
let tok = null; // { token, until } — kept while this worker instance lives

export const enabled = (env) => !!(env.QPAY_USERNAME && env.QPAY_PASSWORD && env.QPAY_INVOICE_CODE);

// base64 of UTF-8 (btoa alone fails on non-Latin letters)
const basic = (s) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));

async function token(env) {
  if (tok && Date.now() < tok.until) return tok.token;
  const res = await fetch(base(env) + '/auth/token', {
    method: 'POST', headers: { authorization: 'Basic ' + basic(`${String(env.QPAY_USERNAME).trim()}:${String(env.QPAY_PASSWORD).trim()}`) },
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok || !d.access_token) throw new Error('QPay нэвтрэлт амжилтгүй (' + (d.message || d.error || res.status) + ')');
  tok = { token: d.access_token, until: Date.now() + 50 * 60e3 };
  return tok.token;
}

async function call(env, path, body, method = 'POST') {
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(base(env) + path, {
      method, headers: { authorization: 'Bearer ' + (await token(env)), 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401 && attempt === 0) { tok = null; continue; } // token expired: once more
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error('QPay: ' + (d.message || d.error || res.status));
    return d;
  }
}

export function createInvoice(env, { number, amount, phone, callback }) {
  return call(env, '/invoice', {
    invoice_code: String(env.QPAY_INVOICE_CODE).trim(),
    sender_invoice_no: number,
    invoice_receiver_code: String(phone || 'terminal').replace(/\D/g, '') || 'terminal',
    invoice_description: `Buddy Shop ${number}`,
    amount,
    callback_url: callback,
  });
}

// total paid on an invoice (₮)
export async function paidAmount(env, invoiceId) {
  const d = await call(env, '/payment/check', { object_type: 'INVOICE', object_id: invoiceId, offset: { page_number: 1, page_limit: 100 } });
  const rows = Array.isArray(d.rows) ? d.rows : [];
  const sum = rows.filter((r) => String(r.payment_status || '').toUpperCase() === 'PAID').reduce((s, r) => s + Number(r.payment_amount || 0), 0);
  return sum || Number(d.paid_amount || 0);
}

export async function cancelInvoice(env, invoiceId) {
  try { await call(env, '/invoice/' + encodeURIComponent(invoiceId), null, 'DELETE'); } catch (e) { console.error('qpay cancel', e.message); }
}
