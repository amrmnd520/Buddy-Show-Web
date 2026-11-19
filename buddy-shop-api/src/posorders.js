// Вэбээс ирсэн, төлбөр нь ОРСОН захиалгыг кассанд хүргэх.
//
// Яагаад: онлайн захиалгыг кассчин гараар дахин бичиж байсан. Нэг бараа дутуу
// бичигдвэл үлдэгдэл буруудна, үнэ нь өөр бичигдвэл тайлан буруудна, огт
// бичигдэхгүй бол бараа нь агуулахад «байгаа» хэвээр үлдэж, дахиад зарагдана.
// Иймээс захиалга өөрөө кассанд жагсаж, ажилтан зөвхөн БАТАЛГААЖУУЛНА.
//
// Энд бүх хүсэлт x-pos-token шаардана (index.js дээр шалгагдсан байна).
//
// ⚠ ХАМГИЙН ЧУХАЛ: нэг захиалга ХОЁР УДАА кассанд ороход бараа хоёр дахин
// хасагдаж, борлуулалт хоёр дахин бичигдэнэ. Иймээс `pos_no` нь нэг л удаа
// бичигдэнэ — `WHERE pos_no IS NULL` нөхцөлтэй UPDATE нь энэ хамгаалалт.
// Касс нь борлуулалт үүсгэхийн ӨМНӨ энэ дуудлагыг хийнэ: сүлжээ тасарсан ч
// давхар зарагдахгүй, харин бүртгэгдээгүй захиалга дараалалдаа үлдэнэ.

import { STATUS, ensureOrders } from './orders.js';

const parse = (s, d) => { try { return JSON.parse(s) ?? d; } catch { return d; } };
const clip = (s, n) => (s == null ? '' : String(s).trim().slice(0, n));
const isGift = (i) => /^GIFT-/i.test(String(i.code || ''));

// Кассанд бүртгэсний дараа захиалга ямар төлөвт очих вэ.
// Хүргэлттэй бол шууд хүргэлтийн жагсаалтад; очиж авна гэсэн бол баталгаажсан
// хэвээр хүлээнэ (хүн ирээд авахад нь «Хүргэгдсэн» болгоно).
const afterPos = (row) => (row.delivery === 'pickup' ? 'confirmed' : 'shipping');

function view(row) {
  const items = parse(row.items, []);
  const gifts = items.filter(isGift);
  return {
    id: row.id,
    number: row.number || `BS${1000 + row.id}`,
    createdAt: row.created_at,
    status: row.status,
    statusText: STATUS[row.status] || row.status,
    total: row.total,
    paid: !!row.paid_at,
    paidAmount: row.paid_amount || 0,
    paidAt: row.paid_at || null,
    // Аль үйлчилгээгээр төлөгдсөн: markPaid нь updated_by-д бичдэг (QPay / Storepay / Pocket)
    via: row.updated_by || row.pay_method || '',
    payMethod: row.pay_method || 'later',
    name: row.name || '',
    phone: row.phone || '',
    email: row.email || '',
    delivery: row.delivery || 'delivery',
    address: row.address || '',
    note: row.note || '',
    staffNote: row.staff_note || '',
    priceCheck: row.price_check && row.price_check !== 'ok' ? row.price_check : null,
    // Кассанд зарагдах мөрүүд. Бэлгийн картыг ХАСНА: онлайн худалдан авсан
    // картын код төлбөр орсон даруйд issueGifts()-ээр үүсч, ERP рүү аль хэдийн
    // тавигдсан. Кассанд дахин зарвал нэг карт хоёр удаа бүртгэгдэнэ.
    items: items.filter((i) => !isGift(i)).map((i) => ({
      code: clip(i.code, 60), name: clip(i.name, 160), size: clip(i.size, 60),
      colorCode: clip(i.colorCode, 60), price: Math.round(Number(i.price) || 0),
      qty: Math.round(Number(i.qty) || 0),
    })),
    gifts: gifts.map((i) => ({ code: clip(i.code, 60), name: clip(i.name, 160), price: Math.round(Number(i.price) || 0), qty: Math.round(Number(i.qty) || 0) })),
    posNo: row.pos_no || null,
    posAt: row.pos_at || null,
    posBy: row.pos_by || null,
  };
}

// Зөвхөн бэлгийн картаас бүрдсэн захиалгад кассанд хийх ажил АЛГА: код нь
// имэйлээр хүрсэн, ERP дээр карт нь үүссэн, хүргэх бараа байхгүй.
const nothingToSell = (row) => {
  const items = parse(row.items, []);
  return !items.length || items.every(isGift);
};

async function rows(env, sql, ...bind) {
  const st = env.DB.prepare(sql);
  const { results } = await (bind.length ? st.bind(...bind) : st).all();
  return results || [];
}

// GET /api/pos/orders
// Гурван жагсаалт:
//   queue    — төлбөр бүрэн орсон, кассанд хараахан бүртгэгдээгүй (хийх ажил)
//   pending  — вэбээс ирсэн ч төлбөр нь хараахан ороогүй (7 хоног)
//   shipping — кассанд бүртгэгдсэн, хүргэлтэнд яваа
export async function posOrders(env) {
  await ensureOrders(env);
  const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString();

  const paid = await rows(env, `SELECT * FROM orders
      WHERE paid_at IS NOT NULL AND paid_amount >= total AND total > 0
        AND pos_no IS NULL AND status <> 'cancelled'
      ORDER BY paid_at ASC LIMIT 100`);

  const pending = await rows(env, `SELECT * FROM orders
      WHERE paid_at IS NULL AND status IN ('new','confirmed') AND created_at >= ?1
      ORDER BY created_at DESC LIMIT 50`, weekAgo);

  const shipping = await rows(env, `SELECT * FROM orders
      WHERE status = 'shipping' ORDER BY COALESCE(pos_at, updated_at) DESC LIMIT 50`);

  return {
    queue: paid.filter((r) => !nothingToSell(r)).map(view),
    // Зөвхөн картын захиалгыг дараалалд оруулахгүй ч нуухгүй: кассчин «юу болов»
    // гэж гайхахгүйн тулд тусад нь харуулна.
    giftOnly: paid.filter(nothingToSell).map(view),
    pending: pending.map(view),
    shipping: shipping.map(view),
  };
}

// POST /api/pos/orders/:id/record   { no, user, status? }
// Касс борлуулалтаа үүсгэхийн ӨМНӨ дуудна. Амжилттай бол л касс зарна.
export async function posRecordOrder(env, id, body) {
  await ensureOrders(env);
  const no = clip(body && body.no, 20);
  const user = clip(body && body.user, 60) || 'Касс';
  if (!no) return [400, { error: 'Баримтын дугаар алга' }];

  const row = await env.DB.prepare('SELECT * FROM orders WHERE id = ?1').bind(id).first();
  if (!row) return [404, { error: 'Захиалга олдсонгүй' }];
  if (row.pos_no) return [409, { error: `Энэ захиалга аль хэдийн кассанд бүртгэгдсэн (баримт #${row.pos_no})`, posNo: row.pos_no, posAt: row.pos_at, posBy: row.pos_by }];
  if (!row.paid_at || (row.paid_amount || 0) < row.total) return [409, { error: 'Төлбөр бүрэн ороогүй захиалга' }];
  if (row.status === 'cancelled') return [409, { error: 'Цуцлагдсан захиалга' }];
  if (nothingToSell(row)) return [409, { error: 'Энэ захиалгад кассанд бүртгэх бараа алга (зөвхөн бэлгийн карт)' }];

  const status = STATUS[clip(body && body.status, 20)] ? clip(body.status, 20) : afterPos(row);
  const now = new Date().toISOString();
  const r = await env.DB.prepare(`UPDATE orders
      SET pos_no = ?1, pos_at = ?2, pos_by = ?3, status = ?4, updated_at = ?2, updated_by = ?3
      WHERE id = ?5 AND pos_no IS NULL`).bind(no, now, user, status, id).run();
  // Хоёр касс нэг зэрэг дарсан бол хожимдсон нь энд таарахгүй — зарахгүй.
  if (!r.meta.changes) {
    const o = await env.DB.prepare('SELECT pos_no, pos_at, pos_by FROM orders WHERE id = ?1').bind(id).first();
    return [409, { error: `Энэ захиалга дөнгөж сая өөр кассанд бүртгэгдлээ (баримт #${o && o.pos_no})`, posNo: o && o.pos_no }];
  }
  const o = await env.DB.prepare('SELECT * FROM orders WHERE id = ?1').bind(id).first();
  return [200, { ok: true, order: view(o) }];
}

// POST /api/pos/orders/:id/status   { status, user }
// «Хүргэгдсэн», «Цуцалсан» гэх мэт — кассанд бүртгэсний дараах явц.
export async function posOrderStatus(env, id, body) {
  await ensureOrders(env);
  const status = clip(body && body.status, 20);
  const user = clip(body && body.user, 60) || 'Касс';
  if (!STATUS[status]) return [400, { error: 'Төлөв буруу' }];
  const row = await env.DB.prepare('SELECT * FROM orders WHERE id = ?1').bind(id).first();
  if (!row) return [404, { error: 'Захиалга олдсонгүй' }];
  await env.DB.prepare('UPDATE orders SET status = ?1, updated_at = ?2, updated_by = ?3 WHERE id = ?4')
    .bind(status, new Date().toISOString(), user, id).run();
  const o = await env.DB.prepare('SELECT * FROM orders WHERE id = ?1').bind(id).first();
  return [200, { ok: true, order: view(o) }];
}
