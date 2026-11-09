// Storepay (buy now, pay later): a loan request to the customer's phone; the customer confirms it in the Storepay app.
// Secrets (npx wrangler secret put), from the Storepay merchant contract:
//   STOREPAY_APP_USERNAME, STOREPAY_APP_PASSWORD  — OAuth user
//   STOREPAY_USERNAME, STOREPAY_PASSWORD          — Basic auth (client id / secret)
//   STOREPAY_STORE_ID                             — merchant store id
// Optional vars (if Storepay gives other addresses): STOREPAY_AUTH_URL, STOREPAY_URL
// A loan is never trusted from the callback alone: it is always confirmed with /merchant/loan/check.

const authUrl = (env) => String(env.STOREPAY_AUTH_URL || 'https://auth.storepay.mn').replace(/\/+$/, '');
const apiUrl = (env) => String(env.STOREPAY_URL || 'https://api.storepay.mn').replace(/\/+$/, '');
let tok = null; // { token, until }

export const enabled = (env) => !!(env.STOREPAY_APP_USERNAME && env.STOREPAY_APP_PASSWORD && env.STOREPAY_USERNAME
  && env.STOREPAY_PASSWORD && env.STOREPAY_STORE_ID);

const basic = (s) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
const t = (v) => String(v || '').trim();
const msgOf = (d) => (d && Array.isArray(d.msgList) && d.msgList[0] && d.msgList[0].text) || (d && (d.message || d.error_description || d.error || d.status)) || '';

async function token(env) {
  if (tok && Date.now() < tok.until) return tok.token;
  const q = new URLSearchParams({ grant_type: 'password', username: t(env.STOREPAY_APP_USERNAME), password: t(env.STOREPAY_APP_PASSWORD) });
  const res = await fetch(`${authUrl(env)}/oauth/token?${q}`, {
    method: 'POST', headers: { authorization: 'Basic ' + basic(`${t(env.STOREPAY_USERNAME)}:${t(env.STOREPAY_PASSWORD)}`) },
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok || !d.access_token) throw new Error('Storepay нэвтрэлт амжилтгүй (' + (msgOf(d) || res.status) + ')');
  tok = { token: d.access_token, until: Date.now() + Math.max(60, (Number(d.expires_in) || 3600) - 60) * 1000 };
  return tok.token;
}

async function call(env, path, body) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(apiUrl(env) + path, {
      method: body ? 'POST' : 'GET',
      headers: { authorization: 'Bearer ' + (await token(env)), ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401 && attempt === 0) { tok = null; continue; }
    const d = await res.json().catch(() => ({}));
    if (!res.ok || d.status !== 'Success') throw new Error('Storepay: ' + (msgOf(d) || res.status));
    return d.value;
  }
}

const mobile = (phone) => String(phone || '').replace(/\D/g, '').slice(-8);

// how much this customer can borrow right now (₮); null if Storepay does not say
export async function possibleAmount(env, phone) {
  const v = await call(env, '/user/possibleAmount', { mobileNumber: mobile(phone) });
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// returns the loan id
export async function createLoan(env, { number, amount, phone, callback }) {
  const id = await call(env, '/merchant/loan', {
    storeId: t(env.STOREPAY_STORE_ID), mobileNumber: mobile(phone), description: `Buddy Shop ${number}`,
    amount: Number(amount).toFixed(2), callbackUrl: callback,
  });
  if (id === undefined || id === null || id === '') throw new Error('Storepay: зээлийн дугаар ирсэнгүй');
  return String(id);
}

// true once the customer has confirmed the loan in the Storepay app
export async function confirmed(env, loanId) {
  return (await call(env, '/merchant/loan/check/' + encodeURIComponent(loanId))) === true;
}
