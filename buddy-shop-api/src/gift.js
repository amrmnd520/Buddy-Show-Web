// Онлайнаар зарагдсан бэлгийн карт.
//
// Сайт дээр бэлгийн карт нь ердийн бараа (GIFT-100K … GIFT-1000K) — тул сагс, QPay,
// имэйл, админ бүгд хэвийн ажиллана. Энд байгаа нь зөвхөн ДАРААГИЙН алхам: төлбөр
// баталгаажмагц код үүсгэж, ERP-ийн `ops` хүснэгт руу `gift` үйлдэл бичнэ. Касс
// 25 секундын дотор татаж авч, тэр кодоор төлбөр хүлээн авах боломжтой болно.
//
// Хоёр зүйлийг тусад нь барьдаг:
//   1) код нь ҮРГЭЛЖ D1-д хадгалагдана — худалдан авагчийн эрх, Supabase унасан ч алдагдахгүй
//   2) ERP-д тавих нь дахин оролдож болдог (gift_synced = 0 бол дараагийн шалгалт/cron дээр ахиад)
// Иймээс Supabase унасан үед ч хэрэглэгч картаа авна, касс нь хоцроод хүлээн авна.
//
// Secrets: SUPABASE_URL, SUPABASE_KEY (service_role — зөвхөн Worker дээр).

// ERP-ийн giftNewCode()-тэй ЯГ адил алфавит: 0/O, 1/I/L, S/5, B/8 зэрэг хутгагддаг
// тэмдэгтүүд байхгүй — хүн гараар бичиж, уншиж байхад андуурахгүй.
const ALPHABET = 'ACDEFGHJKLMNPQRTUVWXY2346789';

export const GIFT_RE = /^GIFT-/i;

// Сагсны мөрүүдээс бэлгийн картуудыг салгана. Код нь серверийн каталогоос
// тавигддаг (serverPrices) учраас хэрэглэгчийн хөтөч үүнийг хуурч чадахгүй.
export function giftsIn(items) {
  return (Array.isArray(items) ? items : []).filter((i) => GIFT_RE.test(String(i.code || '')) && Number(i.price) > 0);
}

export const hasGift = (items) => giftsIn(items).length > 0;

function newCode() {
  const buf = new Uint32Array(8);
  crypto.getRandomValues(buf);
  let out = '';
  for (let i = 0; i < 8; i++) {
    if (i === 4) out += '-';
    out += ALPHABET[buf[i] % ALPHABET.length];
  }
  return 'BS-' + out; // BS-XXXX-XXXX
}

function sb(env) {
  const url = String(env.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = env.SUPABASE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_KEY тохиргоо дутуу байна');
  return { url, key };
}

async function sbFetch(env, path, init = {}) {
  const { url, key } = sb(env);
  const res = await fetch(url + path, {
    ...init,
    headers: {
      apikey: key,
      authorization: 'Bearer ' + key,
      'content-type': 'application/json',
      accept: 'application/json',
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    const t = (await res.text()).replace(/\s+/g, ' ').slice(0, 200);
    throw new Error(`Supabase HTTP ${res.status}: ${t}`);
  }
  return res.status === 204 ? null : res.json().catch(() => null);
}

// Ийм код аль хэдийн байгаа эсэх. 28^8 ≈ 3.8·10^11 тул давхцал бараг боломжгүй,
// гэхдээ давхцвал ERP-ийн applyOp тэр картыг ЧИМЭЭГҮЙ хаядаг (нэг код хоёр удаа
// олгогдохгүй) — хэрэглэгч төлбөр төлчихөөд картгүй үлдэнэ. Тиймээс шалгана.
// Хоёр газар шалгана:
//   kind=gift      — аль хэдийн олгогдсон карт
//   kind=giftBatch — хэвлэлийн газарт өгсөн, хараахан зараагүй карт. Эдгээр нь
//                    ERP-ийн S.gcards дотор сууж байгаа бөгөөс давхцвал тэр
//                    хэвлэсэн карт онлайн картын мөнгийг өмчилж, зарагдахаа болино.
async function taken(env, code) {
  const c = encodeURIComponent(code);
  const q = [
    `/rest/v1/ops?select=id&kind=eq.gift&data->>code=eq.${c}&limit=1`,
    // giftBatch-ийн data.codes нь массив тул jsonb «агуулсан эсэх» шалгалт
    `/rest/v1/ops?select=id&kind=eq.giftBatch&data->codes=cs.${encodeURIComponent(JSON.stringify([code]))}&limit=1`,
  ];
  for (const path of q) {
    // Хоёр дахь шалгалт PostgREST дээр алдвал олголтыг зогсоохгүй — давхцал
    // 28^8 ≈ 3.8·10^11-д нэг тул эхний шалгалт дангаараа ч хангалттай.
    let rows;
    try { rows = await sbFetch(env, path); }
    catch (e) { if (path === q[0]) throw e; console.error('gift batch check', e.message); continue; }
    if (Array.isArray(rows) && rows.length) return true;
  }
  return false;
}

async function freeCode(env) {
  for (let i = 0; i < 5; i++) {
    const c = newCode();
    try { if (!(await taken(env, c))) return c; } catch (e) { return c; } // шалгаж чадсангүй — явуулъя, давхцал бараг боломжгүй
  }
  return newCode();
}

// Тогтмол текстээс тогтмол UUID (v4-ийн хэлбэрт оруулсан SHA-256). Нэг uid үргэлж
// нэг л UUID болно — тиймээс дахин тавих оролдлого шинэ мөр үүсгэхгүй.
async function uuidFrom(s) {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('buddy-gift:' + s)));
  h[6] = (h[6] & 0x0f) | 0x40; h[8] = (h[8] & 0x3f) | 0x80;
  const x = [...h.slice(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}

const COLS = { gift_codes: 'TEXT', gift_synced: 'INTEGER' };
let cols = false;
export async function ensureGiftCols(env) {
  if (cols) return;
  const have = new Set(((await env.DB.prepare('PRAGMA table_info(orders)').all()).results || []).map((c) => c.name));
  for (const [c, t] of Object.entries(COLS)) if (!have.has(c)) await env.DB.prepare(`ALTER TABLE orders ADD COLUMN ${c} ${t}`).run();
  cols = true;
}

const parse = (s, d) => { try { return JSON.parse(s) ?? d; } catch { return d; } };

// Төлбөр баталгаажсаны ДАРАА нэг л удаа дуудагдана (markPaid дотроос, paid_at
// бичигдсэний дараа). Картуудыг үүсгэж D1-д хадгална, дараа нь ERP-д тавихыг оролдоно.
// Хариу: [{code, amt}] эсвэл бэлгийн карт байхгүй бол null.
export async function issueGifts(env, row, via = 'QPay') {
  const items = parse(row.items, []);
  const gifts = giftsIn(items);
  if (!gifts.length) return null;
  await ensureGiftCols(env);

  // Аль хэдийн олгогдсон бол (markPaid хоёр удаа дуудагдвал) хуучныг буцаана
  const already = parse(row.gift_codes, null);
  if (Array.isArray(already) && already.length) return already;

  const cards = [];
  for (const g of gifts) {
    const qty = Math.min(20, Math.max(1, Math.round(Number(g.qty) || 1)));
    for (let n = 0; n < qty; n++) cards.push({ code: await freeCode(env), amt: Math.round(Number(g.price)), name: String(g.name || '') });
  }

  // Эхлээд D1 — хэрэглэгчийн эрх хаана ч алдагдахгүй байх ёстой
  await env.DB.prepare('UPDATE orders SET gift_codes = ?1, gift_synced = 0 WHERE id = ?2')
    .bind(JSON.stringify(cards), row.id).run();

  await syncGifts(env, { ...row, gift_codes: JSON.stringify(cards), gift_synced: 0 }, via).catch((e) => console.error('gift sync', e.message));
  return cards;
}

// Картуудыг ERP-ийн ops руу тавина. Дахин оролдож болно: `id` нь тогтмол (uid)
// учраас ignore-duplicates-аар хоёр дахь оролдлого юу ч давхардуулахгүй.
export async function syncGifts(env, row, via = 'QPay') {
  const cards = parse(row.gift_codes, null);
  if (!Array.isArray(cards) || !cards.length || row.gift_synced) return false;
  const number = row.number || `BS${1000 + row.id}`;
  const t = new Date(row.paid_at || Date.now()).toISOString();
  const payM = via === 'Storepay' ? 'loan' : via === 'Pocket' ? 'qpay' : 'qpay';

  const ops = await Promise.all(cards.map(async (c, n) => {
    // uid нь захиалгаас гаралтай — ижил захиалгыг хоёр удаа тавихад ERP нь uid-аар таних
    const uid = `gift-${row.id}-${n}-${c.code}`;
    return {
      // Мөр бүрийн id нь uid-аас гаралтай тогтмол UUID: дахин оролдоход Supabase өөрөө
      // давхардлыг хаяна (ignore-duplicates), ERP хоёр удаа татахгүй.
      id: await uuidFrom(uid),
      t,
      device: 'online',
      staff: 'Онлайн',
      kind: 'gift',
      data: {
        uid,
        code: c.code,
        amt: c.amt,
        t: Date.parse(t),
        user: 'Онлайн',
        shift: null,              // кассын ээлжид биш — мөнгө нь онлайнаар орсон
        note: `Онлайн ${number}${row.name ? ' · ' + String(row.name).slice(0, 40) : ''}`,
        pays: [{ m: payM, app: null, amt: c.amt }],
      },
    };
  }));

  await sbFetch(env, '/rest/v1/ops', {
    method: 'POST',
    headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
    body: JSON.stringify(ops),
  });
  await env.DB.prepare('UPDATE orders SET gift_synced = 1 WHERE id = ?1').bind(row.id).run();
  return true;
}

// ERP-д тавигдаагүй үлдсэн картуудыг цэвэрлэнэ (cron болон төлбөрийн шалгалт дээр).
// Supabase хэдэн минут унасан ч карт нь кассанд өөрөө орж ирнэ.
export async function sweepGifts(env, limit = 20) {
  await ensureGiftCols(env);
  const { results } = await env.DB.prepare(
    `SELECT * FROM orders WHERE gift_codes IS NOT NULL AND COALESCE(gift_synced, 0) = 0
       AND paid_at IS NOT NULL AND created_at > ?1 ORDER BY id DESC LIMIT ?2`,
  ).bind(new Date(Date.now() - 30 * 864e5).toISOString(), limit).all().catch(() => ({ results: [] }));
  let n = 0;
  for (const row of results || []) {
    try { if (await syncGifts(env, row)) n++; } catch (e) { console.error('gift sweep', row.id, e.message); }
  }
  return n;
}

// Худалдан авагчид харуулах: /api/gift/<id>?k=<payKey>
export async function giftView(env, id, key) {
  await ensureGiftCols(env);
  const row = await env.DB.prepare('SELECT id, number, pay_key, paid_at, total, paid_amount, gift_codes, gift_synced FROM orders WHERE id = ?1').bind(id).first();
  if (!row || !row.pay_key || row.pay_key !== String(key || '')) return [404, { error: 'Захиалга олдсонгүй' }];
  const cards = parse(row.gift_codes, null);
  if (!row.paid_at) return [200, { paid: false, cards: [] }];
  if (!Array.isArray(cards) || !cards.length) return [200, { paid: true, cards: [], pending: true }];
  // ERP-д хүрээгүй байвал энд ахиад оролдоно — хэрэглэгч дэлгэц хараад байх зуур засагдана
  if (!row.gift_synced) { try { await syncGifts(env, row); } catch (e) { console.error('gift view sync', e.message); } }
  return [200, {
    paid: true, number: row.number || `BS${1000 + row.id}`,
    cards: cards.map((c) => ({ code: c.code, amt: c.amt })),
  }];
}

export function giftMailHtml(cards, number) {
  const money = (n) => Number(n || 0).toLocaleString('en-US') + '₮';
  return `<div style="font:15px/1.6 -apple-system,Segoe UI,Roboto,sans-serif;color:#1a1a1a">
    <p>Таны <b>${number}</b> захиалгын бэлгийн карт бэлэн боллоо. Доорх кодыг дэлгүүрт үзүүлээд
    худалдан авалтаа төлнө үү — бүтэн дүнгээр нь ч, хэсэгчлэн ч зарцуулж болно.</p>
    ${cards.map((c) => `<div style="border:2px dashed #0a6;border-radius:12px;padding:16px;margin:14px 0;text-align:center">
      <div style="font-size:13px;color:#666;letter-spacing:.08em">BUDDY SHOP БЭЛГИЙН КАРТ</div>
      <div style="font-size:26px;font-weight:700;letter-spacing:.12em;margin:8px 0">${c.code}</div>
      <div style="font-size:20px;font-weight:600;color:#0a6">${money(c.amt)}</div>
    </div>`).join('')}
    <p style="font-size:13px;color:#666">Баркодтой хувилбарыг худалдан авалтын дэлгэцээс хадгалж авч болно.
    Дэлгүүр: Улаанбаатар · <a href="https://www.buddyshop.mn">buddyshop.mn</a></p>
  </div>`;
}
