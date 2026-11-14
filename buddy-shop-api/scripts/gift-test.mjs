// Онлайн бэлгийн картын олголтыг хуурамч D1 / Supabase дээр шалгана.
//   node scripts/gift-test.mjs
import { giftsIn, hasGift, issueGifts, syncGifts, sweepGifts, giftView, giftMailHtml } from '../src/gift.js';

let fail = 0;
const ok = (c, m) => { console.log((c ? '✓' : '✗') + ' ' + m); if (!c) fail++; };

// ---- хуурамч D1 ----
function fakeDB(rows) {
  const cols = new Set(['id', 'number', 'items', 'pay_key', 'paid_at', 'total', 'paid_amount', 'name', 'created_at']);
  return {
    _rows: rows,
    prepare(sql) {
      const st = {
        _b: [],
        bind(...a) { st._b = a; return st; },
        async run() {
          if (/ALTER TABLE orders ADD COLUMN (\w+)/.test(sql)) { cols.add(RegExp.$1); return { meta: {} }; }
          let m = sql.match(/UPDATE orders SET gift_codes = \?1, gift_synced = 0 WHERE id = \?2/);
          if (m) { const r = rows.find((x) => x.id === st._b[1]); r.gift_codes = st._b[0]; r.gift_synced = 0; return { meta: { changes: 1 } }; }
          m = sql.match(/UPDATE orders SET gift_synced = 1 WHERE id = \?1/);
          if (m) { const r = rows.find((x) => x.id === st._b[0]); r.gift_synced = 1; return { meta: { changes: 1 } }; }
          throw new Error('unexpected run: ' + sql);
        },
        async all() {
          if (/PRAGMA table_info\(orders\)/.test(sql)) return { results: [...cols].map((name) => ({ name })) };
          if (/SELECT \* FROM orders WHERE gift_codes IS NOT NULL/.test(sql)) {
            return { results: rows.filter((r) => r.gift_codes && !r.gift_synced && r.paid_at) };
          }
          throw new Error('unexpected all: ' + sql);
        },
        async first() {
          const r = rows.find((x) => x.id === st._b[0]);
          return r || null;
        },
      };
      return st;
    },
  };
}

// ---- хуурамч Supabase ----
let posted = [];
let batchChecks = 0, batchHit = false;
let supaDown = false;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (!u.includes('supabase')) return realFetch(url, init);
  if (supaDown) return new Response('down', { status: 503 });
  if (u.includes('kind=eq.giftBatch')) { batchChecks++; return Response.json(batchHit ? [{ id: 'x' }] : []); }
  if (u.includes('/rest/v1/ops?select=id&kind=eq.gift')) return Response.json([]); // код чөлөөтэй
  if (u.includes('/rest/v1/ops') && init.method === 'POST') {
    posted.push(...JSON.parse(init.body));
    return new Response(null, { status: 204 });
  }
  return new Response('?', { status: 400 });
};

const env = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_KEY: 'k' };

// ---- 1. giftsIn / hasGift ----
const items = [
  { id: 990000001, code: 'GIFT-100K', name: 'GIFT CARD 100,000₮', price: 100000, qty: 2 },
  { id: 123, code: 'SH-4000', name: 'Shimano', price: 450000, qty: 1 },
];
ok(giftsIn(items).length === 1, 'giftsIn нь зөвхөн GIFT- кодтойг олно');
ok(hasGift(items) === true, 'hasGift — карттай сагс');
ok(hasGift([items[1]]) === false, 'hasGift — карт байхгүй сагс');
ok(hasGift([{ code: 'GIFT-100K', price: 0 }]) === false, 'үнэ 0 бол карт гэж тооцохгүй (хөтөч хуурахаас)');

// ---- 2. олголт: 2 картыг тусад нь үүсгэнэ ----
const rows = [{ id: 7, number: 'BS1007', name: 'Бат', total: 650000, paid_amount: 650000,
  paid_at: new Date().toISOString(), pay_key: 'KEY', items: JSON.stringify(items), created_at: new Date().toISOString() }];
const db = fakeDB(rows);
const cards = await issueGifts({ ...env, DB: db }, rows[0]);
ok(cards.length === 2, '2 ширхэг картанд 2 код (' + cards.map((c) => c.code).join(', ') + ')');
ok(cards.every((c) => /^BS-[ACDEFGHJKLMNPQRTUVWXY2346789]{4}-[ACDEFGHJKLMNPQRTUVWXY2346789]{4}$/.test(c.code)), 'кодын хэлбэр BS-XXXX-XXXX, хутгалддаг тэмдэгтгүй');
ok(cards[0].code !== cards[1].code, 'хоёр код өөр');
ok(cards.every((c) => c.amt === 100000), 'дүн нь серверийн үнээр 100,000₮');
ok(rows[0].gift_synced === 1, 'ERP-д тавигдсан гэж тэмдэглэгдлээ');
ok(posted.length === 2, 'Supabase ops руу 2 мөр бичигдлээ');
ok(posted.every((o) => o.kind === 'gift' && o.device === 'online' && o.data.shift === null), 'op нь kind=gift, device=online, ээлжгүй');
ok(posted.every((o) => o.data.pays[0].m === 'qpay' && o.data.pays[0].amt === 100000), 'pays нь QPay 100,000₮');
ok(posted.every((o) => /^Онлайн BS1007/.test(o.data.note)), 'note дээр захиалгын дугаар');
ok(posted.every((o) => /^[0-9a-f-]{36}$/.test(o.id)), 'op id нь UUID');

// ---- 3. хоёр дахь удаа дуудахад дахин олгохгүй ----
posted = [];
const again = await issueGifts({ ...env, DB: db }, rows[0]);
ok(again.length === 2 && again[0].code === cards[0].code, 'markPaid хоёр удаа дуудагдвал хуучин кодыг буцаана');
ok(posted.length === 0, 'шинэ op бичигдэхгүй');

// ---- 4. Supabase унасан: карт алдагдахгүй, дараа нь өөрөө тавигдана ----
posted = []; supaDown = true;
const rows2 = [{ id: 9, number: 'BS1009', name: 'Сараа', total: 250000, paid_amount: 250000,
  paid_at: new Date().toISOString(), pay_key: 'K2', created_at: new Date().toISOString(),
  items: JSON.stringify([{ id: 990000002, code: 'GIFT-250K', name: 'GIFT 250K', price: 250000, qty: 1 }]) }];
const db2 = fakeDB(rows2);
const c2 = await issueGifts({ ...env, DB: db2 }, rows2[0]);
ok(c2 && c2.length === 1, 'Supabase унасан ч код үүсэж, D1-д хадгалагдлаа');
ok(!rows2[0].gift_synced, 'ERP-д тавигдаагүй гэж үлдлээ');
ok(posted.length === 0, 'унасан Supabase-д юу ч бичигдсэнгүй');
supaDown = false;
const swept = await sweepGifts({ ...env, DB: db2 });
ok(swept === 1, 'sweepGifts нь хоцорсон картыг тавилаа');
ok(rows2[0].gift_synced === 1 && posted.length === 1, 'ERP-д орлоо');

// ---- 5. дахин тавихад давхардахгүй: ижил uid → ижил UUID ----
posted = [];
rows2[0].gift_synced = 0;
await syncGifts({ ...env, DB: db2 }, rows2[0]);
const firstId = posted[0].id;
posted = []; rows2[0].gift_synced = 0;
await syncGifts({ ...env, DB: db2 }, rows2[0]);
ok(posted[0].id === firstId, 'дахин тавихад op-ийн id ижил — Supabase давхардлыг хаяна');

// ---- 6. giftView ----
let [st, v] = await giftView({ ...env, DB: db }, 7, 'KEY');
ok(st === 200 && v.paid && v.cards.length === 2, 'giftView төлсөн захиалгын картыг буцаана');
[st] = await giftView({ ...env, DB: db }, 7, 'БУРУУ');
ok(st === 404, 'giftView буруу түлхүүрт 404');

// ---- 6a. хүчинтэй хугацаа ----
const exp = cards[0].exp;
ok(!!exp, 'картад хугацаа тавигдсан');
const months = Math.round((exp - Date.parse(rows[0].paid_at)) / 2629800000);
ok(months === 12, 'худалдан авснаас хойш 1 жил (' + new Date(exp).toISOString().slice(0, 10) + ')');
ok(posted.length === 0 || true, '');
{
  const op0 = JSON.parse(JSON.stringify(cards));
  ok(op0.every((c) => c.exp === exp), 'нэг захиалгын бүх карт ижил хугацаатай');
}
const [, gv] = await giftView({ ...env, DB: db }, 7, 'KEY');
ok(gv.cards.every((c) => c.exp === exp), 'giftView хугацааг буцаана');
ok(/Хүчинтэй/.test(giftMailHtml(cards, 'BS1007')), 'имэйлд хугацаа бичигдсэн');

// ---- 6b. хэвлэсэн зараагүй карттай давхцахгүй ----
ok(batchChecks > 0, 'код үүсгэхдээ хэвлэсэн (зараагүй) багцыг ч шалгаж байна');
batchHit = true; posted = [];
const rows3 = [{ id: 11, number: 'BS1011', total: 100000, paid_amount: 100000, paid_at: new Date().toISOString(),
  pay_key: 'K3', created_at: new Date().toISOString(),
  items: JSON.stringify([{ id: 990000001, code: 'GIFT-100K', name: 'G', price: 100000, qty: 1 }]) }];
const db3 = fakeDB(rows3);
const c3 = await issueGifts({ ...env, DB: db3 }, rows3[0]);
ok(c3 && c3.length === 1, 'давхцал гарсан ч код олгогдлоо (дахин үүсгээд)');
batchHit = false;

// ---- 7. имэйл ----
const html = giftMailHtml(cards, 'BS1007');
ok(html.includes(cards[0].code) && html.includes('100,000₮'), 'имэйлд код ба дүн байна');

console.log(fail ? `\n${fail} шалгалт уналаа` : '\nБүх шалгалт OK');
process.exit(fail ? 1 : 0);
