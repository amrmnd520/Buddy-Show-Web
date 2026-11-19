// Ээлж хаагдаагүй байвал 18:00 цагт Telegram-аар сануулах.
//
// Яагаад хэрэгтэй вэ: ээлж хаагдалгүй шөнөжин үлдвэл маргаашийн борлуулалт
// нь тэр ээлж рүү ороод, кассын тооцоо хоёр өдрийг нийлүүлж утгагүй болно.
// Мөн тухайн өдрийн тайлангийн имэйл илгээгдэхгүй.
//
// Шинэ cron ҮҮСГЭХГҮЙ: Cloudflare-ийн үнэгүй багц нэг дансанд 5 cron л
// зөвшөөрдөг бөгөөд аль хэдийн 5 нь ашиглагдсан. Энэ Worker «0 2-12 * * *»
// (УБ-аар 10:00–20:00, цаг тутам) дээр ажилладаг тул 10:00 UTC = 18:00 УБ
// дээр нь залгав.

import * as tg from './telegram.js';

const HOUR_UTC = 10;          // 18:00 Улаанбаатар
const KEY = 'shift/openwarn.json';

function sb(env) {
  const url = String(env.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = env.SUPABASE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_KEY тохиргоо дутуу байна');
  return { url, key };
}

// УБ-ийн цаг, огноо. Сервер UTC дээр ажиллана.
function ubParts(ms) {
  const d = new Date(ms + 8 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return {
    day: `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`,
    hm: `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`,
  };
}

// Лавлах хугацааг ДАМЖУУЛНА, Date.now()-г шууд хэрэглэхгүй: цагийн шалгалт
// нэг эх сурвалжаас, «хэдэн цаг болов» нөгөөгөөс бодогдвол тестэд ч, зуны
// цагийн шилжилтэд ч хоёр өөр хариу гарна.
const hours = (ms, ref) => Math.floor((ref - ms) / 3600000);

export async function checkOpenShifts(env, now = new Date()) {
  if (now.getUTCHours() !== HOUR_UTC) return { ok: true, skipped: 'цаг нь биш' };

  const { url, key } = sb(env);
  const res = await fetch(
    `${url}/rest/v1/shifts?select=id,opened_at,opened_by&closed_at=is.null&order=opened_at.asc`,
    { headers: { apikey: key, authorization: 'Bearer ' + key, accept: 'application/json' } },
  );
  if (!res.ok) throw new Error(`Supabase HTTP ${res.status}`);
  const open = await res.json();
  if (!open.length) {
    await env.IMAGES.delete(KEY).catch(() => {});
    return { ok: true, open: 0 };
  }

  // Нэг ээлжийн талаар өдөрт нэг л удаа сануулна — өдөр бүр дахин сануулна,
  // учир нь хаагдаагүй ээлж урт байх тусам асуудал нь томорно.
  const today = ubParts(now.getTime()).day;
  let seen = {};
  try {
    const o = await env.IMAGES.get(KEY);
    if (o) seen = JSON.parse(await o.text());
  } catch (e) { /* анх удаа */ }

  const fresh = open.filter((s) => seen[s.id] !== today);
  if (!fresh.length) return { ok: true, open: open.length, already: true };

  const lines = ['⏰ ЭЭЛЖ ХААГДААГҮЙ БАЙНА'];
  for (const s of open) {
    const t = Date.parse(s.opened_at);
    const p = ubParts(t);
    const h = hours(t, now.getTime());
    lines.push(`· ${s.opened_by || '—'} · ${p.day} ${p.hm}-аас нээлттэй${h >= 24 ? ` · ${Math.floor(h / 24)} хоног` : ` · ${h} цаг`}`);
  }
  lines.push('');
  lines.push('Ээлжээ хаахгүй бол маргаашийн борлуулалт энэ ээлж рүү орж, кассын тооцоо хоёр өдрийг нийлүүлнэ. Тухайн өдрийн тайлан ч илгээгдэхгүй.');
  await tg.notify(env, lines.join('\n'));

  const next = {};
  for (const s of open) next[s.id] = today;
  await env.IMAGES.put(KEY, JSON.stringify(next), { httpMetadata: { contentType: 'application/json' } });
  return { ok: true, open: open.length, notified: fresh.length };
}
