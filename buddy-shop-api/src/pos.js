// The till (pos.buddyshop.mn) talking to QPay through this Worker.
//
// The till is one HTML file served whole to the browser, so it cannot hold the QPay merchant
// password — it calls these endpoints instead. They authenticate with POS_TOKEN, which is baked
// into that HTML. That is deliberate and safe enough: the file is already behind Cloudflare
// Access, and the only thing this token can do is create a QR that pays INTO the shop's own
// account, or read whether one has been paid. Nothing here moves money out.
//
// Deliberately stateless: no row is written anywhere. A till sale lives in Supabase `ops`, and
// payment is confirmed by asking QPay directly rather than trusting a callback, so there is no
// second copy of the truth to keep in step.
import * as qpay from './qpay.js';
import * as storepay from './storepay.js';
import * as paypro from './paypro.js';
import { allow } from './orders.js';

const MAX = 10000000;   // QPay-ийн нэг нэхэмжлэхийн дээд дүн
// Storepay-ийн үйлчилгээний нөхцөл 3.1.1 — вэбсайттай ижил хязгаар
const spMin = (env) => Number(env.STOREPAY_MIN) || 100000;
const spMax = (env) => Number(env.STOREPAY_MAX) || 10000000;
const money = (n) => Number(n || 0).toLocaleString('en-US') + '₮';

// Constant-time compare so a wrong token cannot be guessed byte by byte from response times.
function same(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export function posAuthed(env, request) {
  const want = String(env.POS_TOKEN || '').trim();
  const got = String(request.headers.get('x-pos-token') || '').trim();
  return !!want && same(want, got);
}

// POST /api/pos/qpay/invoice  { amount, ref }  → { id, qr, link, banks }
export async function posInvoice(request, env) {
  if (!qpay.enabled(env)) return [503, { error: 'QPay тохируулаагүй байна' }];
  const ip = request.headers.get('cf-connecting-ip') || 'x';
  if (!(await allow(env, 'posqp:' + ip, 120, 3600e3))) return [429, { error: 'Хэт олон хүсэлт. Түр хүлээнэ үү.' }];
  const b = await request.json().catch(() => ({}));
  const amount = Math.round(Number(b.amount) || 0);
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > MAX) return [400, { error: 'Дүн буруу байна' }];
  const ref = String(b.ref || '').replace(/[^\w-]/g, '').slice(0, 40) || ('POS' + Date.now());
  try {
    const inv = await qpay.createInvoice(env, {
      number: ref, amount, phone: '',
      callback: `${new URL(request.url).origin}/api/pos/qpay/callback?ref=${encodeURIComponent(ref)}`,
    });
    return [200, {
      id: String(inv.invoice_id), ref,
      qr: inv.qr_image ? 'data:image/png;base64,' + inv.qr_image : null,
      text: inv.qr_text || '', link: inv.qPay_shortUrl || '',
      banks: (Array.isArray(inv.urls) ? inv.urls : []).map((u) => ({ name: u.description || u.name, logo: u.logo, link: u.link })),
    }];
  } catch (e) { return [502, { error: e.message }]; }
}

// GET /api/pos/qpay/check?id=…  → { paid, amount }
export async function posCheck(request, env, id) {
  if (!qpay.enabled(env)) return [503, { error: 'QPay тохируулаагүй байна' }];
  if (!id) return [400, { error: 'id алга' }];
  try {
    const paid = await qpay.paidAmount(env, id);
    return [200, { amount: paid, paid: paid > 0 }];
  } catch (e) { return [502, { error: e.message }]; }
}

// POST /api/pos/storepay/loan  { amount, phone, ref }  → { id, phone }
// The request lands on the customer's own phone; they approve it in the Storepay app, exactly
// as on the website. No limit pre-check here: /user/possibleAmount is not in the merchant manual
// and answers 0 for numbers that do have credit, so the loan request itself is the judge.
export async function posLoan(request, env) {
  if (!storepay.enabled(env)) return [503, { error: 'Storepay тохируулаагүй байна' }];
  const ip = request.headers.get('cf-connecting-ip') || 'x';
  if (!(await allow(env, 'possp:' + ip, 60, 3600e3))) return [429, { error: 'Хэт олон хүсэлт. Түр хүлээнэ үү.' }];
  const b = await request.json().catch(() => ({}));
  const amount = Math.round(Number(b.amount) || 0);
  const phone = String(b.phone || '').replace(/\D/g, '').slice(-8);
  if (phone.length < 8) return [400, { error: 'Storepay-д бүртгэлтэй утасны дугаараа зөв оруулна уу' }];
  if (amount < spMin(env)) return [400, { error: `Storepay-ээр ${money(spMin(env))}-с доош худалдан авалт хийх боломжгүй (одоогийн дүн ${money(amount)})` }];
  if (amount > spMax(env)) return [400, { error: `Storepay-ээр ${money(spMax(env))}-с дээш худалдан авалт хийх боломжгүй` }];
  const ref = String(b.ref || '').replace(/[^\w-]/g, '').slice(0, 40) || ('POS' + Date.now());
  try {
    const id = await storepay.createLoan(env, {
      number: ref, amount, phone,
      callback: `${new URL(request.url).origin}/api/pos/storepay/callback?ref=${encodeURIComponent(ref)}`,
    });
    return [200, { id, phone }];
  } catch (e) { return [502, { error: e.message.replace(/^Storepay:\s*/, '') }]; }
}

// GET /api/pos/storepay/check?id=…  → { confirmed }
export async function posLoanCheck(request, env, id) {
  if (!storepay.enabled(env)) return [503, { error: 'Storepay тохируулаагүй байна' }];
  if (!id) return [400, { error: 'id алга' }];
  try { return [200, { confirmed: await storepay.confirmed(env, id) }]; }
  catch (e) { return [502, { error: e.message.replace(/^Storepay:\s*/, '') }]; }
}

// ── Карт терминал (PayPRO Push ECR) ────────────────────────────────────────────────────────
// purchase нь хүн картаа уншуулахыг хүлээж байж хариу буцаадаг. Тэр хүлээлт Worker дээр
// тасрах эрсдэлтэй тул касс зэрэгцээд /inquiry-г дууддаг: аль нь түрүүлнэ тэр нь шийднэ.
// Хоёулаа ижил referralcode ашигладаг учир давхар төлөлт үүсэхгүй.

// POST /api/pos/card/purchase  { amount, ref, method }  → { ok, traceno, approveCode, … }
export async function posCard(request, env) {
  if (!paypro.enabled(env)) return [503, { error: 'Карт терминал тохируулаагүй байна' }];
  const ip = request.headers.get('cf-connecting-ip') || 'x';
  if (!(await allow(env, 'poscard:' + ip, 200, 3600e3))) return [429, { error: 'Хэт олон хүсэлт. Түр хүлээнэ үү.' }];
  const b = await request.json().catch(() => ({}));
  const amount = Math.round(Number(b.amount) || 0);
  const payment = paypro.METHODS[String(b.method || 'card')];
  if (!payment) return [400, { error: 'Төлбөрийн хэрэгсэл буруу' }];
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > MAX) return [400, { error: 'Дүн буруу байна' }];
  const ref = String(b.ref || '').replace(/[^\w-]/g, '').slice(0, 40);
  if (!ref) return [400, { error: 'ref алга' }];
  try {
    const d = paypro.view(await paypro.purchase(env, { amount, payment, ref }));
    return [200, d.ok ? d : { ...d, error: d.message || 'Гүйлгээ амжилтгүй' }];
  } catch (e) {
    // Хүлээлт тасарсан нь амжилтгүй гэсэн үг биш — касс /inquiry-гаар үргэлжлүүлнэ.
    return [e.pending ? 202 : 502, { pending: !!e.pending, error: e.message }];
  }
}

// GET /api/pos/card/inquiry?ref=…  → { ok, done, … }
export async function posCardInquiry(request, env, ref) {
  if (!paypro.enabled(env)) return [503, { error: 'Карт терминал тохируулаагүй байна' }];
  if (!ref) return [400, { error: 'ref алга' }];
  try {
    const d = paypro.view(await paypro.inquiry(env, ref));
    return [200, { ...d, done: d.ok }];
  } catch (e) { return [e.pending ? 202 : 502, { pending: !!e.pending, error: e.message }]; }
}

// POST /api/pos/card/cancel — кассчин болив; терминал дээрх хүлээгдэж буй хүсэлтийг авна
export async function posCardCancel(request, env) {
  if (!paypro.enabled(env)) return [503, { error: 'Карт терминал тохируулаагүй байна' }];
  try { await paypro.cancel(env); return [200, { ok: true }]; }
  catch (e) { return [200, { ok: false, error: e.message }]; }   // цуцлалт бүтэхгүй нь касс зогсоох шалтгаан биш
}

// POST /api/pos/card/void  { traceno } — ERP-ийн буцаалттай хамт дуудагдана
export async function posCardVoid(request, env) {
  if (!paypro.enabled(env)) return [503, { error: 'Карт терминал тохируулаагүй байна' }];
  const b = await request.json().catch(() => ({}));
  const traceno = String(b.traceno || '').trim();
  if (!traceno) return [400, { error: 'traceno алга' }];
  try {
    const d = paypro.view(await paypro.voidTx(env, { traceno }));
    return [200, d.ok ? d : { ...d, error: d.message || 'Буцаалт амжилтгүй' }];
  } catch (e) { return [502, { error: e.message }]; }
}

// GET /api/pos/card/health — өдрийн эхэнд терминал холбогдсон эсэхийг шалгана
export async function posCardHealth(request, env) {
  if (!paypro.enabled(env)) return [200, { on: false }];
  try { const d = await paypro.health(env); return [200, { on: d.succeed === true, message: d.message || '' }]; }
  catch (e) { return [200, { on: false, message: e.message }]; }
}

// POST /api/pos/qpay/cancel  { id } — the cashier backed out; let QPay drop the invoice.
export async function posCancel(request, env) {
  const b = await request.json().catch(() => ({}));
  const id = String(b.id || '').trim();
  if (!id) return [400, { error: 'id алга' }];
  await qpay.cancelInvoice(env, id);     // never throws
  return [200, { ok: true }];
}
