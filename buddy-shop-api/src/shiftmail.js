// Ээлж хаахад тайланг имэйлээр илгээх.
//
// Кассаас (pos.buddyshop.mn) бэлэн тоо ирнэ — энд дахин юу ч бодохгүй.
// Шалтгаан: ээлжийн тоог ERP өөрөө бодож, дэлгэц дээр үзүүлж, Excel-д
// гаргадаг. Хоёр дахь удаа сервер дээр бодвол хоёр өөр тоо гарах эрсдэлтэй.
//
// Хүлээн авагч: SHIFT_REPORT_TO (таслалаар олон хаяг), эс бөгөөс
// info@buddyshop.mn. Хаягийг КАСС сонгохгүй — POS_TOKEN алдагдвал тайланг
// хаашаа ч илгээх зам нээгдэхээс сэргийлж, серверийн тохиргоогоор л өгнө.

import { mail } from './orders.js';

const num = (v) => Math.round(Number(v) || 0);
const money = (v) => num(v).toLocaleString('en-US') + '₮';
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Улаанбаатарын цагаар — сервер UTC дээр ажилладаг тул заавал хөрвүүлнэ
function ub(ms) {
  if (!ms) return '—';
  const d = new Date(Number(ms) + 8 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}
const hm = (ms) => (ms ? ub(ms).slice(11) : '—');
const day = (ms) => (ms ? ub(ms).slice(0, 10) : '—');

const row = (label, value, opt = {}) =>
  `<tr><td style="padding:5px 0;color:#444">${esc(label)}</td>` +
  `<td style="padding:5px 0;text-align:right;white-space:nowrap;${opt.bold ? 'font-weight:700;' : ''}${opt.color ? `color:${opt.color};` : ''}">${esc(value)}</td></tr>`;

function html(b) {
  const pays = Object.entries(b.by || {})
    .filter(([, v]) => num(v))
    .sort((a, c) => c[1] - a[1])
    .map(([k, v]) => row(k, money(v)))
    .join('') || row('Төлбөр алга', '—');

  const moves = (b.moves || [])
    .map((m) => row(`${m.type === 'in' ? '+ Касс орлого' : '− Касс зарлага'}${m.note ? ' · ' + m.note : ''}`,
                    money(m.type === 'in' ? m.amt : -m.amt)))
    .join('');

  const items = (b.items || []).map((it) => {
    const profit = num(it.amount) - num(it.cost);
    const pct = num(it.amount) ? Math.round((profit / num(it.amount)) * 100) + '%' : '';
    return `<tr>
      <td style="padding:6px 8px;border-top:1px solid #eee">${esc(it.name)}<br><span style="color:#888;font-size:12px">${esc(it.sku || 'кодгүй')}</span></td>
      <td style="padding:6px 8px;border-top:1px solid #eee;text-align:right">${esc(it.qty)}</td>
      <td style="padding:6px 8px;border-top:1px solid #eee;text-align:right;white-space:nowrap">${money(it.amount)}</td>
      <td style="padding:6px 8px;border-top:1px solid #eee;text-align:right;white-space:nowrap">${money(it.cost)}</td>
      <td style="padding:6px 8px;border-top:1px solid #eee;text-align:right;white-space:nowrap;color:${profit < 0 ? '#b3261e' : '#0a7a55'}">${money(profit)}<br><span style="color:#888;font-size:12px">${pct}</span></td>
    </tr>`;
  }).join('') || '<tr><td colspan="5" style="padding:10px;color:#888">Борлуулалт алга.</td></tr>';

  const tQty = (b.items || []).reduce((a, x) => a + Number(x.qty || 0), 0);
  const tAmt = (b.items || []).reduce((a, x) => a + num(x.amount), 0);
  const tCost = (b.items || []).reduce((a, x) => a + num(x.cost), 0);

  const diffColor = num(b.diff) === 0 ? '#0a7a55' : '#b3261e';

  return `<div style="font:14px/1.6 -apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#1a1a1a;max-width:720px;margin:0 auto;padding:16px">
  <h2 style="margin:0 0 2px;font-size:20px">Ээлжийн тайлан · ${esc(day(b.openT))}</h2>
  <div style="color:#666;font-size:13px;margin-bottom:16px">
    ${esc(hm(b.openT))} – ${esc(hm(b.closeT))} · Нээсэн: ${esc(b.openUser || '—')} · Хаасан: ${esc(b.closeUser || '—')}
  </div>

  <table style="width:100%;border-collapse:collapse;margin-bottom:18px">
    ${row('Борлуулалт', `${num(b.n)} ширхэг баримт`)}
    ${num(b.ret) ? row('Буцаалт', '−' + money(b.ret), { color: '#b3261e' }) : ''}
    ${num(b.disc) ? row('Хөнгөлөлт', '−' + money(b.disc), { color: '#b3261e' }) : ''}
    ${row('Цэвэр борлуулалт', money(b.net), { bold: true })}
    ${row('Барааны өртөг', money(b.cost))}
    ${row('Ашиг', money(b.profit) + (num(b.net) ? ` · ${Math.round((num(b.profit) / num(b.net)) * 100)}%` : ''), { bold: true, color: '#0a7a55' })}
  </table>

  <h3 style="margin:0 0 6px;font-size:15px">Төлбөрийн хэлбэр</h3>
  <table style="width:100%;border-collapse:collapse;margin-bottom:18px">${pays}</table>

  ${num(b.giftSold) ? `<h3 style="margin:0 0 4px;font-size:15px">Бэлгийн карт зарсан · ${num(b.giftN)} ш</h3>
  <div style="color:#666;font-size:13px;margin-bottom:6px">Энэ нь борлуулалт БИШ — дэлгүүрийн өр. Орлого нь карт хэрэглэгдэх үед бий болно.</div>
  <table style="width:100%;border-collapse:collapse;margin-bottom:18px">${row('Нийт', money(b.giftSold), { bold: true })}</table>` : ''}

  <h3 style="margin:0 0 6px;font-size:15px">Бэлэн мөнгө</h3>
  <table style="width:100%;border-collapse:collapse;margin-bottom:18px">
    ${row('Эхний бэлэн', money(b.start))}
    ${row('+ Бэлэн борлуулалт', money(b.cashSales))}
    ${num(b.giftCash) ? row('+ Бэлгийн карт (бэлнээр)', money(b.giftCash)) : ''}
    ${num(b.cashRet) ? row('− Бэлэн буцаалт', '−' + money(b.cashRet)) : ''}
    ${moves}
    ${row('Байх ёстой', money(b.expected), { bold: true })}
    ${row('Тоолсон', money(b.counted))}
    ${row('Зөрүү', money(b.diff), { bold: true, color: diffColor })}
  </table>

  <h3 style="margin:0 0 6px;font-size:15px">Бараа · ${(b.items || []).length} нэр төрөл</h3>
  <table style="width:100%;border-collapse:collapse;font-size:13px">
    <thead><tr style="background:#f3f5f5">
      <th style="padding:6px 8px;text-align:left">Бараа</th>
      <th style="padding:6px 8px;text-align:right">Ширхэг</th>
      <th style="padding:6px 8px;text-align:right">Дүн</th>
      <th style="padding:6px 8px;text-align:right">Өртөг</th>
      <th style="padding:6px 8px;text-align:right">Ашиг</th>
    </tr></thead>
    <tbody>${items}</tbody>
    <tfoot><tr style="background:#f3f5f5;font-weight:700">
      <td style="padding:6px 8px">НИЙТ</td>
      <td style="padding:6px 8px;text-align:right">${tQty}</td>
      <td style="padding:6px 8px;text-align:right">${money(tAmt)}</td>
      <td style="padding:6px 8px;text-align:right">${money(tCost)}</td>
      <td style="padding:6px 8px;text-align:right">${money(tAmt - tCost)}</td>
    </tr></tfoot>
  </table>

  <div style="color:#888;font-size:12px;margin-top:18px">
    Энэ тайланг касс ээлж хаахад автоматаар илгээв. Дүнг ERP өөрөө бодсон.
  </div>
</div>`;
}

function text(b) {
  return [
    `Ээлжийн тайлан ${day(b.openT)} ${hm(b.openT)}–${hm(b.closeT)}`,
    `Нээсэн: ${b.openUser || '—'} · Хаасан: ${b.closeUser || '—'}`,
    '',
    `Борлуулалт: ${num(b.n)}`,
    `Цэвэр борлуулалт: ${money(b.net)}`,
    `Ашиг: ${money(b.profit)}`,
    `Байх ёстой: ${money(b.expected)} · Тоолсон: ${money(b.counted)} · Зөрүү: ${money(b.diff)}`,
  ].join('\n');
}

export async function shiftReport(env, body) {
  if (!body || !body.openT) return { ok: false, error: 'Ээлжийн мэдээлэл дутуу' };
  if (!env.RESEND_API_KEY) return { ok: false, error: 'RESEND_API_KEY тавиагүй байна' };

  const to = String(env.SHIFT_REPORT_TO || 'info@buddyshop.mn')
    .split(',').map((x) => x.trim()).filter(Boolean);
  if (!to.length) return { ok: false, error: 'Хүлээн авагч тохируулаагүй' };

  const diff = num(body.diff);
  const subject = `Ээлжийн тайлан · ${day(body.openT)} ${hm(body.openT)}–${hm(body.closeT)}`
    + ` · ${money(body.net)}`
    + (diff === 0 ? '' : ` · зөрүү ${money(diff)}`);

  for (const addr of to) await mail(env, addr, subject, html(body), text(body));
  return { ok: true, sent: to.length };
}
