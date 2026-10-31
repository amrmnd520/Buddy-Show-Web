// Visitor analytics for the Buddy Shop website (Cloudflare D1, table "events").
// The site sends small anonymous events to POST /api/t. No IP address, name or
// account is stored: a visitor is a random id kept in the visitor's own browser.
// Staff read the summary at GET /api/stats?days=30 (login required).

const TYPES = new Set(['pv', 'view', 'search', 'cat', 'cart', 'cartopen']);
const BOT = /bot|crawl|spider|slurp|preview|facebookexternalhit|headless|lighthouse|pingdom|monitor/i;
let ready = false;

async function ensure(env) {
  if (ready) return;
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      day TEXT NOT NULL, hour INTEGER NOT NULL, ts INTEGER NOT NULL,
      vid TEXT NOT NULL, type TEXT NOT NULL,
      pid INTEGER, q TEXT, cat TEXT, size TEXT, res INTEGER, ref TEXT, dev TEXT)`),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS events_day_type ON events(day, type)'),
  ]);
  ready = true;
}

// Ulaanbaatar time (UTC+8): the shop's own calendar day and hour.
const local = (ms) => { const d = new Date(ms + 8 * 3600e3); return { day: d.toISOString().slice(0, 10), hour: d.getUTCHours() }; };
const clip = (s, n) => (s == null ? null : String(s).slice(0, n));

export async function track(request, env) {
  if (BOT.test(request.headers.get('user-agent') || '')) return new Response(null, { status: 204 });
  const text = await request.text();
  if (text.length > 4000) return new Response(null, { status: 413 });
  let list; try { list = JSON.parse(text); } catch { return new Response(null, { status: 400 }); }
  if (!Array.isArray(list)) list = [list];
  const ua = request.headers.get('user-agent') || '';
  const dev = /ipad|tablet/i.test(ua) ? 'tablet' : /mobi|android|iphone/i.test(ua) ? 'mobile' : 'desktop';
  const now = Date.now(), { day, hour } = local(now);
  const rows = list.slice(0, 20).filter((e) => e && TYPES.has(e.t) && /^[a-z0-9]{8,32}$/i.test(String(e.v || '')));
  if (!rows.length) return new Response(null, { status: 204 });
  await ensure(env);
  await env.DB.batch(rows.map((e) => env.DB.prepare(
    'INSERT INTO events (day, hour, ts, vid, type, pid, q, cat, size, res, ref, dev) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)',
  ).bind(day, hour, now, String(e.v), e.t,
    Number.isFinite(Number(e.p)) && e.p != null ? Number(e.p) : null,
    clip(e.q && String(e.q).trim().toLowerCase(), 80), clip(e.c, 60), clip(e.z, 40),
    Number.isFinite(Number(e.n)) && e.n != null ? Number(e.n) : null,
    clip(e.r, 80), dev)));
  return new Response(null, { status: 204 });
}

export async function stats(env, days) {
  await ensure(env);
  days = Math.min(Math.max(Number(days) || 30, 1), 365);
  const today = local(Date.now()).day;
  const since = local(Date.now() - (days - 1) * 864e5).day;
  const all = (sql, ...b) => env.DB.prepare(sql).bind(...b).all().then((r) => r.results || []);
  const one = (sql, ...b) => env.DB.prepare(sql).bind(...b).first();
  const [daily, totals, todayRow, views, carts, searches, empty, cats, hours, devs, refs, funnel] = await Promise.all([
    all(`SELECT day, COUNT(DISTINCT vid) AS visitors, SUM(type='pv') AS pageviews, SUM(type='view') AS views, SUM(type='cart') AS carts
         FROM events WHERE day >= ?1 GROUP BY day ORDER BY day`, since),
    one(`SELECT COUNT(DISTINCT vid) AS visitors, SUM(type='pv') AS pageviews, SUM(type='view') AS views, SUM(type='cart') AS carts, SUM(type='search') AS searches
         FROM events WHERE day >= ?1`, since),
    one(`SELECT COUNT(DISTINCT vid) AS visitors, SUM(type='view') AS views, SUM(type='cart') AS carts FROM events WHERE day = ?1`, today),
    all(`SELECT pid, COUNT(*) AS n, COUNT(DISTINCT vid) AS people FROM events WHERE type='view' AND day >= ?1 AND pid IS NOT NULL
         GROUP BY pid ORDER BY n DESC LIMIT 40`, since),
    all(`SELECT pid, COUNT(*) AS n, COUNT(DISTINCT vid) AS people, GROUP_CONCAT(DISTINCT size) AS sizes FROM events
         WHERE type='cart' AND day >= ?1 AND pid IS NOT NULL GROUP BY pid ORDER BY n DESC LIMIT 40`, since),
    all(`SELECT q, COUNT(*) AS n, COUNT(DISTINCT vid) AS people, MIN(res) AS minres, MAX(res) AS maxres FROM events
         WHERE type='search' AND day >= ?1 AND q <> '' GROUP BY q ORDER BY n DESC LIMIT 40`, since),
    all(`SELECT q, COUNT(*) AS n, COUNT(DISTINCT vid) AS people FROM events
         WHERE type='search' AND day >= ?1 AND res = 0 AND q <> '' GROUP BY q ORDER BY n DESC LIMIT 30`, since),
    all(`SELECT cat, COUNT(*) AS n, COUNT(DISTINCT vid) AS people FROM events WHERE type='cat' AND day >= ?1 AND cat IS NOT NULL
         GROUP BY cat ORDER BY n DESC`, since),
    all(`SELECT hour, COUNT(DISTINCT vid || day) AS visits FROM events WHERE day >= ?1 GROUP BY hour ORDER BY hour`, since),
    all(`SELECT dev, COUNT(DISTINCT vid) AS people FROM events WHERE day >= ?1 GROUP BY dev ORDER BY people DESC`, since),
    all(`SELECT COALESCE(ref, '') AS ref, COUNT(DISTINCT vid) AS people FROM events WHERE type='pv' AND day >= ?1
         GROUP BY COALESCE(ref, '') ORDER BY people DESC LIMIT 12`, since),
    one(`SELECT COUNT(DISTINCT vid) AS visitors,
                COUNT(DISTINCT CASE WHEN type='view' THEN vid END) AS viewers,
                COUNT(DISTINCT CASE WHEN type='cart' THEN vid END) AS carters
         FROM events WHERE day >= ?1`, since),
  ]);
  return { days, since, today, daily, totals, todayRow, views, carts, searches, empty, cats, hours, devs, refs, funnel };
}

// Keep half a year of events (runs with the daily job).
export async function prune(env) {
  await ensure(env);
  await env.DB.prepare('DELETE FROM events WHERE day < ?1').bind(local(Date.now() - 183 * 864e5).day).run();
}
