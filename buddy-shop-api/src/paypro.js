// PayPRO «Push ECR» — the shop's card terminal, driven from the till.
//
// The terminal runs on a mobile-data SIM, so there is no cable and no shared network: PayPRO's
// own server pushes the amount down to it. That makes this the same shape as QPay and Storepay —
// the Worker holds the credentials and the till only ever talks to the Worker.
//
// Secrets (npx wrangler secret put), issued by Ламбда ХХК when the integration is set up:
//   PAYPRO_URL        — API_BASE_URL
//   PAYPRO_TERMINAL   — terminalId
//   PAYPRO_CLIENT_ID  — x-client-id
//   PAYPRO_API_KEY    — x-api-key
//
// Documented at https://payprohq.github.io/apis/?doc=push (v. 2026-11-11).

const base = (env) => String(env.PAYPRO_URL || '').replace(/\/+$/, '');
const t = (v) => String(v || '').trim();

export const enabled = (env) => !!(env.PAYPRO_URL && env.PAYPRO_TERMINAL && env.PAYPRO_CLIENT_ID && env.PAYPRO_API_KEY);

// Төлбөрийн хэрэгсэл: 1 карт, 4 SocialPay QR, 7 Monpay QR
export const METHODS = { card: 1, social: 4, monpay: 7 };

async function call(env, path, body, ms) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms || 25000);
  let res;
  try {
    res = await fetch(base(env) + path, {
      method: 'POST', signal: ctl.signal,
      headers: { 'content-type': 'application/json', 'x-client-id': t(env.PAYPRO_CLIENT_ID), 'x-api-key': t(env.PAYPRO_API_KEY) },
      body: JSON.stringify({ terminalId: t(env.PAYPRO_TERMINAL), ...body }),
    });
  } catch (e) {
    clearTimeout(timer);
    // A purchase that times out here is NOT a failure: the customer may still be tapping. The
    // till keeps asking /inquiry with the same referralcode, which is what that call is for.
    throw Object.assign(new Error(e.name === 'AbortError' ? 'Терминалын хариу хүлээгдсээр байна' : e.message), { pending: true });
  }
  clearTimeout(timer);
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.message || ('PayPRO: ' + res.status));
  return d;
}

// Гүйлгээ эхлүүлнэ — терминал дээр дүн гарч ирнэ. Хариу нь хүн картаа уншуулахыг хүлээнэ.
export function purchase(env, { amount, payment, ref }) {
  // skipPrint нь үргэлж true: баримт нэг л удаа, ERP-ийн принтерээс гарна (эзний шийдвэр,
  // 2026-11-11). Терминал өөрөө цаас гаргавал үйлчлүүлэгч хоёр баримт барих болно.
  return call(env, '/payment/purchase', { amount, payment, referralcode: ref, skipPrint: true }, 28000);
}

// Хариу алдагдсан үед гүйлгээ бүтсэн эсэхийг лавлана. Энэ нь давхар төлөлтөөс сэргийлнэ.
export const inquiry = (env, ref) => call(env, '/payment/inquiry', { referralcode: ref }, 12000);

export const cancel = (env) => call(env, '/payment/cancel', {}, 12000);

// Буцаалт — борлуулалтад хадгалсан traceno-гоор
export const voidTx = (env, { traceno }) => call(env, '/payment/void', { traceno, skipPrint: true }, 25000);

export const health = (env) => call(env, '/payment/healthcheck', {}, 12000);

// Нэг гүйлгээний хариунаас ERP-д хэрэгтэй талбаруудыг л гаргана — картын дугаар бүтнээр
// хэзээ ч ирдэггүй (maskedPAN), гэхдээ хэрэггүй зүйлийг ч дамжуулахгүй.
export const view = (d) => ({
  ok: d.succeed === true,
  amount: Number(d.amount) || 0,
  traceno: d.traceno || '',
  approveCode: d.approveCode || '',
  maskedPAN: d.maskedPAN || '',
  systemRef: d.systemRef || '',
  date: d.date || d.transactionAt || '',
  message: d.message || '',
});
