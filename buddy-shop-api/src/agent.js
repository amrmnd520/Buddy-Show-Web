// Buddy Shop — агентад зориулсан нэгтгэсэн өгөгдөл.
//
// Яагаад энд байна вэ: агент нь 4,130 бараа, 36,538 борлуулалтын мөрийг
// татаад Claude руу явуулж чадахгүй — хэтэрхий том, үнэтэй, бас найдваргүй.
// Тиймээс СОНГОЛТЫГ энд, кодоор, тодорхой дүрмээр хийнэ. Claude зөвхөн
// гарсан жагсаалтыг тайлбарлана. Ингэснээр тоо нь ажиллуулах болгонд ижил
// гарна — LLM-ээр тоо бодуулбал ийм байдлыг хангахгүй.
//
// Хувийн мэдээлэл ОРОХГҮЙ: харилцагчийн нэр, утас, имэйл энд хэзээ ч
// сонгогдохгүй. Зөвхөн бараа, тоо, огноо.
//
// Нууц: AGENT_TOKEN (npx wrangler secret put AGENT_TOKEN) — buddy-shop-bot
// Worker ижил утгыг хадгална.

const PAGE = 1000;

function sb(env) {
  const url = String(env.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = env.SUPABASE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_KEY тохиргоо дутуу байна');
  return { url, key };
}

async function sbAll(env, path, cap = 20000) {
  const { url, key } = sb(env);
  const out = [];
  for (let from = 0; from < cap; from += PAGE) {
    const res = await fetch(`${url}/rest/v1/${path}`, {
      headers: {
        apikey: key,
        authorization: 'Bearer ' + key,
        accept: 'application/json',
        range: `${from}-${from + PAGE - 1}`,
        'range-unit': 'items',
      },
    });
    if (!res.ok) {
      const t = (await res.text()).replace(/\s+/g, ' ').slice(0, 200);
      throw new Error(`Supabase HTTP ${res.status}: ${t}`);
    }
    const rows = await res.json();
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

const num = (v) => (typeof v === 'number' ? v : Number(v) || 0);

// Өдрийн борлуулалтын хурд. 90 хоног нь улирлын хэлбэлзлийг барих хангалттай
// урт, харин 365 хоног нь хэтэрхий удаан хариу өгдөг — зуны бараа өвөл
// "сайн зарагддаг" мэт харагдана. 90 хоногт огт зарагдаагүйг нь жилээр нь үзнэ.
function velocity(p) {
  const q90 = num(p.q90), q365 = num(p.q365);
  if (q90 > 0) return q90 / 90;
  if (q365 > 0) return q365 / 365;
  return 0;
}

// Хэдэн хоногийн нөөцтэй вэ. Хурд 0 бол хязгааргүй.
function coverDays(p) {
  const v = velocity(p);
  if (v <= 0) return Infinity;
  return num(p.stock) / v;
}

async function products(env) {
  return sbAll(env, 'v_agent_products?select=*&order=id.asc');
}

// ── Долоо хоногийн тойм ──────────────────────────────────────────────────
export async function digest(env) {
  const [weeks, prods] = await Promise.all([
    sbAll(env, 'v_agent_weeks?select=*&limit=9', 9),
    products(env),
  ]);
  const w = weeks.map((x) => ({
    wk: x.wk, orders: num(x.orders), revenue: num(x.revenue),
    discount: num(x.discount), items: num(x.items),
  }));

  const sold30 = prods.filter((p) => num(p.q30) > 0);
  const top = sold30
    .map((p) => ({ sku: p.sku, name: p.name, brand: p.brand, cat: p.category,
                   qty: num(p.q30), stock: num(p.stock), price: num(p.price) }))
    .sort((a, b) => b.qty * b.price - a.qty * a.price)
    .slice(0, 12);

  // Зарагдаж байгаад ЗОГССОН: жилдээ зарагдсан ч сүүлийн 90 хоногт огт үгүй,
  // гэтэл үлдэгдэл нь хэвээр. Мөнгө хэвтэж байгаа газар.
  const stalled = prods
    .filter((p) => num(p.stock) > 0 && num(p.q90) === 0 && num(p.q365) >= 2)
    .map((p) => ({ sku: p.sku, name: p.name, brand: p.brand,
                   stock: num(p.stock), tied: num(p.stock) * num(p.cost),
                   last: p.last_sold }))
    .sort((a, b) => b.tied - a.tied)
    .slice(0, 12);

  // Хурдан зарагдаж байгаад ДУУССАН: хамгийн шууд алдагдал.
  const out = prods
    .filter((p) => num(p.stock) <= 0 && num(p.q90) >= 2)
    .map((p) => ({ sku: p.sku, name: p.name, brand: p.brand, vendor: p.vendor,
                   q90: num(p.q90), last: p.last_sold }))
    .sort((a, b) => b.q90 - a.q90)
    .slice(0, 12);

  return { weeks: w, top, stalled, out,
           counts: { products: prods.length, sold30: sold30.length } };
}

// ── Захиалгын санал ──────────────────────────────────────────────────────
// target: хэдэн хоногийн нөөцтэй байхыг хүсэж байна (анхдагч 120 хоног).
export async function reorder(env, target = 120) {
  const prods = await products(env);
  const rows = [];
  for (const p of prods) {
    const v = velocity(p);
    if (v <= 0) continue;                       // огт зарагддаггүй бараа
    if (num(p.q365) < 2) continue;              // санамсаргүй нэг удаагийн зарагдалт
    const cover = coverDays(p);
    if (cover >= 60) continue;                  // хангалттай нөөцтэй
    const need = Math.max(1, Math.ceil(v * target - num(p.stock)));
    rows.push({
      sku: p.sku, name: p.name, brand: p.brand, cat: p.category,
      vendor: p.vendor || '—', vendor_id: p.vendor_id,
      stock: num(p.stock), cover: Math.round(cover),
      q30: num(p.q30), q90: num(p.q90), q365: num(p.q365),
      need, cost: num(p.cost), spend: need * num(p.cost),
      // Өдөрт алдаж буй борлуулалт. Нөөц дууссан бол бүтэн, байгаа бол 0.
      lost: num(p.stock) <= 0 ? Math.round(v * num(p.price)) : 0,
      perDay: Math.round(v * 100) / 100,
      last: p.last_sold,
    });
  }
  // ⚠ Эрэмбийг НӨӨЦ ДУУСАХ ХОНОГООР хийж болохгүй: аль хэдийн 0 болсон бараа
  // бүгд 0 дээр тэнцэж, дундаас нь санамсаргүй сонгогддог. Тиймээс өдөрт
  // алдаж байгаа борлуулалтаар (хурд × үнэ) эрэмбэлнэ — хамгийн их мөнгө
  // алдуулж байгаа нь дээр гарна.
  rows.sort((a, b) => b.lost - a.lost || a.cover - b.cover);
  const byVendor = {};
  for (const r of rows) {
    const k = r.vendor;
    (byVendor[k] = byVendor[k] || { vendor: k, lines: 0, spend: 0 });
    byVendor[k].lines++;
    byVendor[k].spend += r.spend;
  }
  // Хоёр өөр яаралтай байдал: аль хэдийн ДУУССАН (өдөр бүр мөнгө алдаж
  // байна) ба ДУУСАХ ГЭЖ БУЙ (одоо захиалбал амжина). Нэг жагсаалтад
  // хольбол эхнийх нь хоёр дахийг нь дардаг.
  const gone = rows.filter((r) => r.stock <= 0);
  const low = rows.filter((r) => r.stock > 0).sort((a, b) => a.cover - b.cover);
  return {
    target,
    rows: rows.slice(0, 60),
    gone: gone.slice(0, 12),
    low: low.slice(0, 12),
    lostPerDay: gone.reduce((a, r) => a + r.lost, 0),
    totalLines: rows.length,
    goneCount: gone.length,
    lowCount: low.length,
    totalSpend: rows.reduce((a, r) => a + r.spend, 0),
    vendors: Object.values(byVendor).sort((a, b) => b.spend - a.spend),
  };
}

// ── Брэндийн зураглал (шинэ бүтээгдэхүүн хайхад) ─────────────────────────
export async function brands(env) {
  const prods = await products(env);
  const m = new Map();
  for (const p of prods) {
    const b = (p.brand || '').trim();
    if (!b) continue;
    const x = m.get(b) || { brand: b, products: 0, stock: 0, q365: 0, skus: [] };
    x.products++;
    x.stock += num(p.stock);
    x.q365 += num(p.q365);
    if (p.sku) x.skus.push(p.sku);
    m.set(b, x);
  }
  return {
    brands: [...m.values()]
      .sort((a, b) => b.q365 - a.q365)
      .map((x) => ({ ...x, skus: undefined, skuCount: x.skus.length })),
  };
}

// Нэг брэндийн бүх нэр, код — шинэ бүтээгдэхүүнийг тулгахад агент ашиглана.
export async function brandSkus(env, brand) {
  const prods = await products(env);
  const want = String(brand || '').trim().toLowerCase();
  return {
    brand,
    items: prods
      .filter((p) => (p.brand || '').trim().toLowerCase() === want)
      .map((p) => ({ sku: p.sku, name: p.name, price: num(p.price), stock: num(p.stock) })),
  };
}
