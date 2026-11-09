// Nightly copy of the whole Supabase database into R2.
//
// Supabase's free plan keeps no automatic backups and offers no point-in-time recovery, and the
// row-level policy lets any authenticated device write — and delete — every table. One wrong
// statement, or one device token that walks out of the shop, could erase five years of sales
// with nothing to restore from. This is the missing copy.
//
// Runs on the daily cron. Reads through PostgREST with the SUPABASE_KEY that erp.js already
// uses, so there is no new secret to store. Each table is streamed into R2 as gzipped NDJSON a
// page at a time, so a large table never has to sit in the Worker's memory in one piece.
//
// The dump holds product cost and every customer's name, phone and order history, so it is
// served only to a signed-in staff member, never cached, and never without a token.

// Big pages on purpose: a Worker may only make so many subrequests per invocation, and 18 tables
// paged a thousand rows at a time would run into that ceiling and stop half way through.
const PAGE = 10000;
const MAX_PAGES = 200;        // a runaway loop must not spend the whole request budget
const KEEP_DAYS = 30;
const PREFIX = 'backup/';

// `ops` leads because it is the source of truth: the database triggers materialize every other
// sales table from it, so a restore that replays ops rebuilds them. The rest are copied anyway —
// replaying 100k ops to read last year's figures would be absurd.
export const TABLES = [
  'ops', 'settings', 'vendors', 'products', 'customers',
  'sales', 'sale_lines', 'sale_payments', 'returns', 'return_lines',
  'receipts', 'receipt_lines', 'stocktakes', 'stocktake_lines',
  'shifts', 'cash_moves', 'audit_log', 'staff',
];

// Paging needs a stable sort, and these three do not all have the same key.
const ORDER = { ops: 'seq', settings: 'key' };
const orderBy = (t) => ORDER[t] || 'id';

function sbBase(env) {
  const url = String(env.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = env.SUPABASE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_KEY тохиргоо дутуу байна');
  return { url, key };
}

async function sbPage(env, table, from, to) {
  const { url, key } = sbBase(env);
  const res = await fetch(`${url}/rest/v1/${table}?select=*&order=${orderBy(table)}.asc`, {
    headers: {
      apikey: key,
      authorization: 'Bearer ' + key,
      accept: 'application/json',
      range: `${from}-${to}`,
      'range-unit': 'items',
    },
  });
  if (!res.ok) {
    const t = (await res.text()).replace(/\s+/g, ' ').slice(0, 200);
    throw new Error(`${table}: Supabase HTTP ${res.status}: ${t}`);
  }
  return res.json();
}

// One table → one gzipped NDJSON object in R2. Rows are written as they arrive.
async function dumpTable(env, table, dir) {
  const key = `${PREFIX}${dir}/${table}.ndjson.gz`;
  const { readable, writable } = new TransformStream();
  const put = env.IMAGES.put(key, readable.pipeThrough(new CompressionStream('gzip')), {
    httpMetadata: { contentType: 'application/x-ndjson', contentEncoding: 'gzip' },
  });

  const w = writable.getWriter();
  const enc = new TextEncoder();
  let rows = 0, raw = 0;
  try {
    // Advance by what actually came back, and stop only on an empty page. PostgREST may return
    // fewer rows than asked for — Supabase can cap the page size server-side — and treating a
    // short page as the end would silently truncate the table and leave a useless backup.
    let from = 0, pages = 0;
    for (;;) {
      if (++pages > MAX_PAGES) throw new Error(`${table}: ${MAX_PAGES} хуудаснаас хэтэрлээ`);
      const batch = await sbPage(env, table, from, from + PAGE - 1);
      if (!batch.length) break;
      let chunk = '';
      for (const r of batch) chunk += JSON.stringify(r) + '\n';
      const bytes = enc.encode(chunk);
      raw += bytes.length;
      await w.write(bytes);
      rows += batch.length;
      from += batch.length;
    }
    await w.close();
  } catch (e) {
    // Abort so the put rejects instead of silently storing a half table.
    try { await w.abort(e); } catch { /* already closed */ }
    await put.catch(() => {});
    throw e;
  }
  const obj = await put;
  return { rows, raw, stored: (obj && obj.size) || 0 };
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
  sbBase(env);                  // fail on a misconfigured deploy, not with 18 identical errors
  const dir = new Date().toISOString().slice(0, 10);
  const tables = {};
  const failed = [];

  for (const t of TABLES) {
    try {
      tables[t] = await dumpTable(env, t, dir);
    } catch (e) {
      failed.push({ table: t, error: String((e && e.message) || e) });
    }
  }

  // A backup that lost a table is not a backup — say so loudly rather than overwriting the
  // manifest with a cheerful one.
  const total = Object.values(tables).reduce((s, t) => s + t.rows, 0);
  const report = {
    date: dir,
    at: new Date().toISOString(),
    ms: Date.now() - started,
    ok: failed.length === 0,
    rows: total,
    tables,
    failed,
  };

  const old = await env.IMAGES.get(PREFIX + 'manifest.json');
  const history = old ? JSON.parse(await old.text()).history || [] : [];
  await env.IMAGES.put(PREFIX + 'manifest.json',
    JSON.stringify({ latest: report, history: [report, ...history].slice(0, KEEP_DAYS) }, null, 1),
    { httpMetadata: { contentType: 'application/json; charset=utf-8' } });

  report.pruned = await prune(env, dir).catch(() => 0);
  if (failed.length) throw new Error(`Нөөцлөлт дутуу: ${failed.map((f) => f.table).join(', ')}`);
  return report;
}

export async function listBackups(env) {
  const m = await env.IMAGES.get(PREFIX + 'manifest.json');
  if (!m) return { latest: null, history: [], tables: TABLES };
  return { ...JSON.parse(await m.text()), tables: TABLES };
}

// Hands back one table's gzipped NDJSON. Staff-only; the caller checks the token.
export async function getBackupFile(env, date, table) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !TABLES.includes(table)) return null;
  return env.IMAGES.get(`${PREFIX}${date}/${table}.ndjson.gz`);
}
