// Nightly copy of the whole Supabase database into R2.
//
// Supabase's free plan keeps no automatic backups and offers no point-in-time recovery, and the
// row-level policy lets any authenticated device write — and delete — every table. One wrong
// statement, or one device token that walks out of the shop, could erase five years of sales
// with nothing to restore from. This is the missing copy.
//
// Reads through PostgREST with the SUPABASE_KEY that erp.js already uses, so there is no new
// secret to store. The dump holds product cost and every customer's name, phone and order
// history, so it is served only against a token, never cached, and never publicly.
//
// Everything here is shaped by one hard limit: a Worker may make only ~50 subrequests per
// invocation on the free plan, and calls to R2 count too. PostgREST caps a normal select at
// 1000 rows, so paging 60,000 rows would need 60+ requests and the job died half way through.
//
// Instead each table is read through the backup_dump() function (sql/08_backup.sql), which
// returns the whole table as one row of NDJSON text — one row, so the 1000-row cap does not
// apply. That is exactly one request per table no matter how far the shop grows, and the whole
// night goes into a single R2 object rather than eighteen.

const KEEP_DAYS = 30;
const PREFIX = 'backup/';
const FILE = 'all.ndjson.gz';

// `ops` leads because it is the source of truth: the database triggers materialize every other
// sales table from it, so a restore that replays ops rebuilds them. The rest are copied anyway —
// replaying every operation just to read last year's figures would be absurd.
export const TABLES = [
  'ops', 'settings', 'vendors', 'products', 'customers',
  'sales', 'sale_lines', 'sale_payments', 'returns', 'return_lines',
  'receipts', 'receipt_lines', 'stocktakes', 'stocktake_lines',
  'shifts', 'cash_moves', 'audit_log', 'staff',
];

function sbBase(env) {
  const url = String(env.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = env.SUPABASE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_KEY тохиргоо дутуу байна');
  return { url, key };
}

// One whole table as NDJSON text, in one request.
//
// The reply is asked for as JSON, not text/plain: PostgREST serves a scalar function as a JSON
// string and refuses text/plain outright (PGRST107). So the body arrives JSON-escaped and
// res.json() hands back the plain string.
async function sbTable(env, table) {
  const { url, key } = sbBase(env);
  const res = await fetch(`${url}/rest/v1/rpc/backup_dump`, {
    method: 'POST',
    headers: {
      apikey: key,
      authorization: 'Bearer ' + key,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({ tbl: table }),
  });
  if (!res.ok) {
    const t = (await res.text()).replace(/\s+/g, ' ').slice(0, 200);
    if (res.status === 404) {
      throw new Error('backup_dump функц олдсонгүй — sql/08_backup.sql-ийг Supabase дээр '
        + `нэг удаа ажиллуулна уу. (${table}: HTTP 404: ${t})`);
    }
    throw new Error(`${table}: Supabase HTTP ${res.status}: ${t}`);
  }
  const out = await res.json();
  return typeof out === 'string' ? out : '';
}

// Every table, gzipped into one object. Sections are marked with a line that cannot collide
// with a row, since every row is a JSON object and so always starts with '{'.
const MARK = '#table ';

async function dumpAll(env, dir) {
  const { readable, writable } = new TransformStream();
  const reader = readable.pipeThrough(new CompressionStream('gzip')).getReader();

  // R2 refuses a stream whose length it cannot know, and gzip has no length until it ends, so
  // the compressed chunks are collected and stored as one sized buffer. Draining has to happen
  // while writing or a full pipe would block the writer for ever.
  const chunks = [];
  let gz = 0;
  const drain = (async () => {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value); gz += value.length;
    }
  })();

  const w = writable.getWriter();
  const enc = new TextEncoder();
  const tables = {};
  let raw = 0;
  const write = async (s) => { const b = enc.encode(s); raw += b.length; await w.write(b); };

  try {
    for (const table of TABLES) {
      const body = await sbTable(env, table);
      const text = body.length && !body.endsWith('\n') ? body + '\n' : body;
      await write(MARK + table + '\n');
      if (text) await write(text);
      // Every row is one line; an empty table returns an empty string.
      let rows = 0;
      for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) rows++;
      tables[table] = { rows };
    }
    await w.close();
  } catch (e) {
    try { await w.abort(e); } catch { /* already closed */ }
    await drain.catch(() => {});
    throw e;
  }
  await drain;

  const body = new Uint8Array(gz);
  let at = 0;
  for (const c of chunks) { body.set(c, at); at += c.length; }
  await env.IMAGES.put(`${PREFIX}${dir}/${FILE}`, body, {
    httpMetadata: { contentType: 'application/x-ndjson', contentEncoding: 'gzip' },
  });
  return { tables, raw, stored: gz };
}

// Keep the last KEEP_DAYS dated folders; drop the rest.
async function prune(env, keepDir) {
  const cutoff = new Date(Date.now() - KEEP_DAYS * 864e5).toISOString().slice(0, 10);
  const dead = [];
  let cursor;
  do {
    const page = await env.IMAGES.list({ prefix: PREFIX, cursor, limit: 1000 });
    for (const o of page.objects) {
      const dir = o.key.slice(PREFIX.length).split('/')[0];
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dir)) continue;   // never touch manifest.json
      if (dir !== keepDir && dir < cutoff) dead.push(o.key);
    }
    cursor = page.truncated ? page.cursor : null;
  } while (cursor);
  for (const k of dead) await env.IMAGES.delete(k);
  return dead.length;
}

export async function runBackup(env) {
  const started = Date.now();
  sbBase(env);                  // fail on a misconfigured deploy, not once per table
  const dir = new Date().toISOString().slice(0, 10);

  const { tables, raw, stored } = await dumpAll(env, dir);

  // Each table arrives whole or not at all, so there is no partial-table case left to check;
  // a database with no products at all, though, means something is badly wrong.
  const short = tables.products && tables.products.rows === 0 ? ['products 0'] : [];

  const report = {
    date: dir,
    at: new Date().toISOString(),
    ms: Date.now() - started,
    ok: short.length === 0,
    rows: Object.values(tables).reduce((s, t) => s + t.rows, 0),
    raw,
    stored,
    file: `${dir}/${FILE}`,
    tables,
    short,
  };

  const old = await env.IMAGES.get(PREFIX + 'manifest.json');
  const history = old ? JSON.parse(await old.text()).history || [] : [];
  await env.IMAGES.put(PREFIX + 'manifest.json',
    JSON.stringify({ latest: report, history: [report, ...history].slice(0, KEEP_DAYS) }, null, 1),
    { httpMetadata: { contentType: 'application/json; charset=utf-8' } });

  report.pruned = await prune(env, dir).catch(() => 0);
  if (short.length) throw new Error(`Нөөцлөлт дутуу: ${short.join(', ')}`);
  return report;
}

// A backup nobody looks at is one that quietly stopped working months ago, so the Worker writes
// to the owner itself: on every failure, and once a month to say it is still running. The mail
// carries counts and dates only — never a row of the data.
async function mail(env, subject, html) {
  const to = env.BACKUP_NOTIFY || env.ORDER_NOTIFY || 'info@buddyshop.mn';
  if (!env.RESEND_API_KEY || !to) return;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: env.MAIL_FROM || 'Buddy Shop <info@buddyshop.mn>', to: [to], subject, html }),
  });
  if (!res.ok) console.error('backup mail', res.status, await res.text().catch(() => ''));
}

const wrap = (title, body) => `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:24px;color:#10202c">
  <div style="font-weight:800;letter-spacing:1px;font-size:18px">▲ BUDDY SHOP</div>
  <h2 style="font-size:17px">${title}</h2>${body}</div>`;

export async function backupNotice(env, report, err) {
  if (err) {
    return mail(env, '⚠ Buddy Shop — нөөцлөлт амжилтгүй', wrap('Өгөгдлийн нөөцлөлт бүтсэнгүй', `
      <p style="font-size:15px">Шөнийн нөөцлөлт алдаа өглөө. Supabase-ийн үнэгүй багцад өөр
         нөөц байхгүй тул үүнийг удаан орхиж болохгүй.</p>
      <pre style="background:#f5f3ee;padding:12px;border-radius:6px;font-size:13px;white-space:pre-wrap">${
        String((err && err.message) || err).slice(0, 500)}</pre>`));
  }
  // Ulaanbaatar is UTC+8 and the job runs at 19:30 UTC, so the local date is what counts.
  const localDay = new Date(Date.now() + 8 * 3600e3).getUTCDate();
  if (localDay !== 1) return;
  const rows = Object.entries(report.tables)
    .sort((a, b) => b[1].rows - a[1].rows)
    .map(([t, v]) => `<tr><td style="padding:3px 10px 3px 0">${t}</td>
      <td style="text-align:right;padding:3px 0">${v.rows.toLocaleString('en-US')}</td></tr>`).join('');
  await mail(env, 'Buddy Shop — сарын нөөцлөлтийн тайлан', wrap('Нөөцлөлт хэвийн ажиллаж байна', `
    <p style="font-size:15px">Сүүлийн нөөцлөлт <b>${report.date}</b>,
       нийт <b>${report.rows.toLocaleString('en-US')}</b> мөр
       (${Math.round(report.stored / 1024)} КБ шахсан). Сүүлийн 30 хоног хадгалагдаж байна.</p>
    <table style="font-size:14px;border-collapse:collapse">${rows}</table>
    <p style="font-size:13px;color:#5a6b76">Файлыг компьютер дээрээ татаж авах скрипт сард нэг
       удаа ажилладаг. Хавтас хоосон байвал надад хэлээрэй.</p>`));
}

export async function listBackups(env) {
  const m = await env.IMAGES.get(PREFIX + 'manifest.json');
  if (!m) return { latest: null, history: [], tables: TABLES };
  return { ...JSON.parse(await m.text()), tables: TABLES };
}

// What the download script on the Mac reads: date, file and total rows, one per line. Plain
// text on purpose — a shell script picking JSON apart with sed breaks the first time the shape
// changes, and this script's whole job is to be dependable.
export async function latestText(env) {
  const m = await listBackups(env);
  if (!m.latest) return 'none\n';
  return `${m.latest.date}\n${m.latest.file}\n${m.latest.rows}\n`;
}

// Hands back a dated dump. The caller checks the token.
export async function getBackupFile(env, date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  return env.IMAGES.get(`${PREFIX}${date}/${FILE}`);
}
