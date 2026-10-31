/* Admin: "Зочдын хяналт" — visitors, what they look at, search and add to the cart.
   Data: buddy-shop-api GET /api/stats?days=N (staff only). Product names, prices and
   Emart stock come from the site's own product list (ERP-synced). */
(() => {
  const API = String(window.BUDDY_API || '').replace(/\/+$/, '');
  if (!API) return;
  const token = () => { try { return localStorage.getItem('buddyshop_api_token') || ''; } catch (e) { return ''; } };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = n => Number(n || 0).toLocaleString('en-US');
  const pct = (a, b) => b ? Math.round(a / b * 100) + '%' : '—';
  const P = id => (typeof products !== 'undefined' ? products : []).find(p => Number(p.id) === Number(id));

  let days = 30, data = null, loading = false, err = '', tab = 'products';

  const st = document.createElement('style');
  st.textContent = `.an-panel{margin-bottom:22px;--an-ink:#10202c;--an-muted:#5a6a72;--an-line:#e3e7e9;--an-bar:#203746;--an-soft:#eef3f6}
.an-head{display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end;justify-content:space-between}.an-range{display:flex;gap:6px}
.an-range button,.an-tabs button{border:1px solid #c8d1d5;background:#fff;border-radius:4px;padding:7px 12px;font:inherit;font-size:13px;font-weight:700;cursor:pointer;color:var(--an-ink)}
.an-range button[aria-pressed=true],.an-tabs button[aria-pressed=true]{background:var(--an-bar);border-color:var(--an-bar);color:#fff}
.an-tiles{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px;margin:16px 0}
.an-tile{border:1px solid var(--an-line);border-radius:6px;padding:12px 14px}.an-tile b{display:block;font-size:26px;font-variant-numeric:tabular-nums;color:var(--an-ink);line-height:1.15}
.an-tile span{font-size:12px;color:var(--an-muted)}.an-tile small{display:block;font-size:11px;color:var(--an-muted);margin-top:2px}
.an-charts{display:grid;grid-template-columns:2fr 1fr;gap:14px}.an-card{border:1px solid var(--an-line);border-radius:6px;padding:12px 14px;min-width:0}
.an-card h3{margin:0 0 8px;font-size:14px}.an-card .an-sub{font-size:12px;color:var(--an-muted);margin:-4px 0 8px}
.an-chart{position:relative}.an-chart svg{display:block;width:100%;height:auto;overflow:visible}.an-chart rect.hit{fill:transparent}
.an-chart rect.bar{fill:var(--an-bar)}.an-chart rect.bar.dim{fill:#9fb0ba}.an-chart text{font-size:10px;fill:var(--an-muted)}.an-chart line{stroke:var(--an-line)}
.an-tip{position:absolute;pointer-events:none;background:#10202c;color:#fff;font-size:12px;padding:6px 8px;border-radius:4px;white-space:nowrap;transform:translate(-50%,-110%);display:none;font-variant-numeric:tabular-nums}
.an-tabs{display:flex;flex-wrap:wrap;gap:6px;margin:16px 0 10px}
.an-table{width:100%;border-collapse:collapse;font-size:13px}.an-table th,.an-table td{text-align:left;padding:7px 8px;border-bottom:1px solid var(--an-line);vertical-align:middle}
.an-table th{font-size:12px;color:var(--an-muted);font-weight:700}.an-table td.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.an-table a{color:var(--an-ink);text-decoration:none;font-weight:600}.an-table a:hover{text-decoration:underline}
.an-table img{width:36px;height:36px;object-fit:contain;background:#fff;border:1px solid var(--an-line);border-radius:4px;vertical-align:middle;margin-right:8px}
.an-flag{display:inline-block;font-size:11px;font-weight:700;border-radius:3px;padding:1px 6px;margin-left:6px}.an-flag.out{background:#fdecea;color:#b42318}.an-flag.low{background:#fff4e5;color:#8a5300}
.an-meter{height:6px;background:var(--an-soft);border-radius:3px;overflow:hidden;min-width:60px}.an-meter i{display:block;height:100%;background:var(--an-bar);border-radius:3px}
.an-tip-box{background:#eef7f0;color:#1f5f3a;border-radius:6px;padding:10px 12px;font-size:13px;line-height:1.5;margin:6px 0 4px}
.an-empty{color:var(--an-muted);font-size:13px;padding:10px 0}.an-err{background:#fdecea;color:#b42318;border-radius:4px;padding:8px 12px;font-size:13px}
@media(max-width:900px){.an-tiles{grid-template-columns:repeat(2,minmax(0,1fr))}.an-charts{grid-template-columns:1fr}}`;
  document.head.appendChild(st);

  const panel = document.createElement('div');
  panel.className = 'admin-panel an-panel'; panel.id = 'stats-admin';

  async function load() {
    if (!token() || loading) return;
    loading = true; err = ''; draw();
    try {
      const res = await fetch(`${API}/api/stats?days=${days}`, { headers: { authorization: 'Bearer ' + token() }, cache: 'no-store' });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || ('Алдаа ' + res.status));
      data = d;
    } catch (e) { err = e.message; }
    loading = false; draw();
  }

  // Bar chart: one series, one axis, 4px rounded tops anchored to the baseline, hover tooltip.
  function bars(rows, { w = 640, h = 150, label, value, tip, every = 1, dimIf }) {
    if (!rows.length) return '<div class="an-empty">Одоогоор мэдээлэл алга.</div>';
    const max = Math.max(1, ...rows.map(value)), padB = 18, padT = 6, gap = 2;
    const step = w / rows.length, bw = Math.max(2, step - gap);
    const nice = max <= 5 ? max : Math.ceil(max / 5) * 5;
    const y = v => padT + (h - padB - padT) * (1 - v / nice);
    let s = `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(label)}">`;
    s += `<line x1="0" x2="${w}" y1="${y(0)}" y2="${y(0)}"></line><line x1="0" x2="${w}" y1="${y(nice)}" y2="${y(nice)}" stroke-dasharray="2 3"></line>`;
    s += `<text x="${w}" y="${y(nice) - 2}" text-anchor="end">${num(nice)}</text>`;
    rows.forEach((r, i) => {
      const v = value(r), x = i * step + gap / 2, top = y(v), base = y(0), hh = Math.max(0, base - top);
      const rr = Math.min(4, bw / 2, hh);
      if (hh > 0) s += `<path class="bar" d="M${x},${base} V${top + rr} Q${x},${top} ${x + rr},${top} H${x + bw - rr} Q${x + bw},${top} ${x + bw},${top + rr} V${base} Z" fill="${dimIf && dimIf(r) ? '#9fb0ba' : 'var(--an-bar)'}"></path>`;
      s += `<rect class="hit" x="${i * step}" y="0" width="${step}" height="${h}" data-tip="${esc(tip(r))}" data-x="${x + bw / 2}" data-y="${top}"></rect>`;
      if (i % every === 0) s += `<text x="${x + bw / 2}" y="${h - 4}" text-anchor="middle">${esc(label(r))}</text>`;
    });
    return `<div class="an-chart">${s}</svg><div class="an-tip"></div></div>`;
  }

  function fillDays(daily) {
    const map = new Map(daily.map(d => [d.day, d])), out = [];
    const end = new Date(data.today + 'T00:00:00Z');
    for (let i = data.days - 1; i >= 0; i--) {
      const d = new Date(end - i * 864e5).toISOString().slice(0, 10);
      out.push(map.get(d) || { day: d, visitors: 0, pageviews: 0, views: 0, carts: 0 });
    }
    return out;
  }

  function productRow(r, cols) {
    const p = P(r.pid);
    const name = p ? p.name : `Устгагдсан бараа (#${r.pid})`;
    const qty = p && typeof p.erpQty === 'number' ? p.erpQty : (p ? p.stock : null);
    const flag = qty === 0 ? '<span class="an-flag out">Үлдэгдэлгүй</span>' : (qty != null && qty <= 2 ? `<span class="an-flag low">${qty} үлдсэн</span>` : '');
    return `<tr><td>${p && p.image ? `<img src="${esc(p.image)}" alt="" loading="lazy">` : ''}<a href="#" data-open="${Number(r.pid)}">${esc(name)}</a>${flag}</td>${cols.map(c => `<td class="n">${c}</td>`).join('')}<td class="n">${p ? num(p.price) + '₮' : '—'}</td><td class="n">${qty == null ? '—' : num(qty)}</td></tr>`;
  }

  function tabBody() {
    const d = data;
    if (tab === 'products') {
      const max = Math.max(1, ...d.views.map(r => r.n));
      return d.views.length ? `<table class="an-table"><thead><tr><th>Бараа</th><th class="n">Үзсэн</th><th class="n">Хүн</th><th></th><th class="n">Үнэ</th><th class="n">Emart</th></tr></thead><tbody>
        ${d.views.slice(0, 25).map(r => productRow(r, [num(r.n), num(r.people), `<div class="an-meter"><i style="width:${Math.round(r.n / max * 100)}%"></i></div>`])).join('')}</tbody></table>` : '<div class="an-empty">Одоогоор бараа үзсэн мэдээлэл алга.</div>';
    }
    if (tab === 'cart') {
      return d.carts.length ? `<table class="an-table"><thead><tr><th>Бараа</th><th class="n">Сагсанд</th><th class="n">Хүн</th><th class="n">Сонголт</th><th class="n">Үнэ</th><th class="n">Emart</th></tr></thead><tbody>
        ${d.carts.slice(0, 25).map(r => productRow(r, [num(r.n), num(r.people), esc(r.sizes || '—')])).join('')}</tbody></table>` : '<div class="an-empty">Одоогоор сагсанд нэмсэн бараа алга.</div>';
    }
    if (tab === 'restock') {
      const list = d.views.map(r => ({ r, p: P(r.pid) })).filter(x => x.p && (x.p.erpQty === 0 || (typeof x.p.erpQty === 'number' && x.p.erpQty <= 2)));
      return `<div class="an-tip-box">Зочид сонирхож үзсэн ч Emart-д дууссан эсвэл 2-оос бага үлдсэн бараа. Дэлгүүрийн захиалга, нөөц нэмэхэд ашиглана уу.</div>` + (list.length ? `<table class="an-table"><thead><tr><th>Бараа</th><th class="n">Үзсэн</th><th class="n">Хүн</th><th class="n">Үнэ</th><th class="n">Emart</th></tr></thead><tbody>
        ${list.map(x => productRow(x.r, [num(x.r.n), num(x.r.people)])).join('')}</tbody></table>` : '<div class="an-empty">Сонирхолтой ч дууссан бараа алга.</div>');
    }
    if (tab === 'search') {
      return `<table class="an-table"><thead><tr><th>Хайсан үг</th><th class="n">Удаа</th><th class="n">Хүн</th><th class="n">Олдсон бараа</th></tr></thead><tbody>
        ${d.searches.map(r => `<tr><td>${esc(r.q)}${r.maxres === 0 ? '<span class="an-flag out">Олдоогүй</span>' : ''}</td><td class="n">${num(r.n)}</td><td class="n">${num(r.people)}</td><td class="n">${r.maxres == null ? '—' : num(r.maxres)}</td></tr>`).join('') || '<tr><td colspan="4" class="an-empty">Хайлт алга.</td></tr>'}</tbody></table>`;
    }
    if (tab === 'missing') {
      return `<div class="an-tip-box">Зочид хайсан ч сайтаас юу ч олдоогүй үгс. Дэлгүүрт авах, эсвэл сайтад нэмэх барааны санаа.</div>` + (d.empty.length ? `<table class="an-table"><thead><tr><th>Хайсан үг</th><th class="n">Удаа</th><th class="n">Хүн</th></tr></thead><tbody>
        ${d.empty.map(r => `<tr><td>${esc(r.q)}</td><td class="n">${num(r.n)}</td><td class="n">${num(r.people)}</td></tr>`).join('')}</tbody></table>` : '<div class="an-empty">Олдоогүй хайлт алга.</div>');
    }
    if (tab === 'more') {
      const refName = r => r ? r.replace(/^(.+)\.(com|mn|net|org)$/, '$1') : 'Шууд / тодорхойгүй';
      const devName = { mobile: 'Утас', desktop: 'Компьютер', tablet: 'Таблет' };
      const sumDev = d.devs.reduce((s, x) => s + x.people, 0), sumRef = d.refs.reduce((s, x) => s + x.people, 0);
      return `<div class="an-charts" style="grid-template-columns:repeat(3,minmax(0,1fr))">
        <div class="an-card"><h3>Ангилал</h3><table class="an-table"><tbody>${d.cats.slice(0, 12).map(c => `<tr><td>${esc(c.cat)}</td><td class="n">${num(c.people)} хүн</td></tr>`).join('') || '<tr><td class="an-empty">Алга</td></tr>'}</tbody></table></div>
        <div class="an-card"><h3>Төхөөрөмж</h3><table class="an-table"><tbody>${d.devs.map(x => `<tr><td>${esc(devName[x.dev] || x.dev)}</td><td class="n">${num(x.people)}</td><td class="n">${pct(x.people, sumDev)}</td></tr>`).join('') || '<tr><td class="an-empty">Алга</td></tr>'}</tbody></table></div>
        <div class="an-card"><h3>Хаанаас ирсэн</h3><table class="an-table"><tbody>${d.refs.map(x => `<tr><td>${esc(refName(x.ref))}</td><td class="n">${num(x.people)}</td><td class="n">${pct(x.people, sumRef)}</td></tr>`).join('') || '<tr><td class="an-empty">Алга</td></tr>'}</tbody></table></div></div>`;
    }
    return '';
  }

  function draw() {
    const signed = !!token();
    let body = '';
    if (!signed) body = '<p class="site-help">Харахын тулд дээрх «Ажилтан нэвтрэх» хэсгээр нэвтэрнэ үү.</p>';
    else if (err) body = `<div class="an-err">⚠ ${esc(err)}</div>`;
    else if (!data) body = `<div class="an-empty">${loading ? 'Ачаалж байна…' : ''}</div>`;
    else {
      const t = data.totals || {}, td = data.todayRow || {}, f = data.funnel || {};
      const daysRows = fillDays(data.daily || []);
      const hours = Array.from({ length: 24 }, (_, h) => ({ hour: h, visits: (data.hours.find(x => x.hour === h) || {}).visits || 0 }));
      const busiest = hours.reduce((a, b) => b.visits > a.visits ? b : a, hours[0]);
      body = `<div class="an-tiles">
          <div class="an-tile"><span>Өнөөдөр зочид</span><b>${num(td.visitors)}</b><small>${num(td.views)} бараа үзсэн · ${num(td.carts)} сагсанд</small></div>
          <div class="an-tile"><span>${data.days} хоногт зочид</span><b>${num(t.visitors)}</b><small>өдөрт дунджаар ${((t.visitors || 0) / data.days) < 10 ? ((t.visitors || 0) / data.days).toFixed(1) : num(Math.round((t.visitors || 0) / data.days))}</small></div>
          <div class="an-tile"><span>Бараа үзсэн</span><b>${num(t.views)}</b><small>${num(f.viewers)} хүн бараа нээсэн</small></div>
          <div class="an-tile"><span>Сагсанд нэмсэн</span><b>${num(t.carts)}</b><small>${num(f.carters)} хүн</small></div>
          <div class="an-tile"><span>Сагс хүртэл хөрвөлт</span><b>${pct(f.carters, f.visitors)}</b><small>зочдын хэд нь сагсанд нэмсэн</small></div>
        </div>
        <div class="an-charts">
          <div class="an-card"><h3>Өдөр тутмын зочид</h3><p class="an-sub">Өдөр бүр сайтад орсон өөр өөр хүн</p>
            ${bars(daysRows, { label: r => r.day.slice(5).replace('-', '/'), value: r => r.visitors, every: Math.ceil(daysRows.length / 10), tip: r => `${r.day}: ${num(r.visitors)} зочин · ${num(r.views)} үзсэн · ${num(r.carts)} сагс` })}</div>
          <div class="an-card"><h3>Цагаар</h3><p class="an-sub">Хамгийн идэвхтэй: ${busiest.visits ? busiest.hour + ':00–' + (busiest.hour + 1) + ':00' : '—'} (Улаанбаатарын цаг)</p>
            ${bars(hours, { w: 320, label: r => String(r.hour), value: r => r.visits, every: 3, tip: r => `${r.hour}:00–${r.hour + 1}:00: ${num(r.visits)} зочилт` })}</div>
        </div>
        <div class="an-tabs" role="tablist">${[['products', 'Хамгийн их үзсэн'], ['cart', 'Сагсанд нэмсэн'], ['restock', 'Сонирхолтой ч дууссан'], ['search', 'Хайлт'], ['missing', 'Олдоогүй хайлт'], ['more', 'Ангилал · Төхөөрөмж · Эх сурвалж']]
          .map(([k, l]) => `<button type="button" role="tab" data-tab="${k}" aria-pressed="${tab === k}">${l}</button>`).join('')}</div>
        ${tabBody()}`;
    }
    panel.innerHTML = `<div class="an-head"><div><div class="eyebrow">ANALYTICS</div><h2 style="margin-bottom:0">Зочдын хяналт</h2></div>
      ${signed ? `<div class="an-range" role="group" aria-label="Хугацаа">${[1, 7, 30, 90].map(n => `<button type="button" data-days="${n}" aria-pressed="${days === n}">${n === 1 ? 'Өнөөдөр' : n + ' хоног'}</button>`).join('')}<button type="button" data-reload title="Шинэчлэх">↻</button></div>` : ''}</div>
      <p class="site-help" style="margin:6px 0 0">Сайтын зочдын нэргүй статистик. Хувийн мэдээлэл, IP хаяг хадгалахгүй; нэвтэрсэн ажилтныг тоолохгүй. «Сагсанд нэмсэн» нь онлайн төлбөр нэмэгдэх хүртэл худалдан авах сонирхлыг харуулна.</p>${body}`;
  }

  panel.addEventListener('click', e => {
    const b = e.target.closest('[data-days],[data-reload],[data-tab],[data-open]'); if (!b) return;
    if (b.dataset.days) { days = Number(b.dataset.days); return load(); }
    if (b.hasAttribute('data-reload')) return load();
    if (b.dataset.tab) { tab = b.dataset.tab; return draw(); }
    if (b.dataset.open) { e.preventDefault(); typeof openProduct === 'function' && openProduct(Number(b.dataset.open)); }
  });
  panel.addEventListener('mousemove', e => {
    const hit = e.target.closest('rect.hit'), chart = e.target.closest('.an-chart'); if (!chart) return;
    const tip = chart.querySelector('.an-tip');
    if (!hit) { tip.style.display = 'none'; return; }
    const svg = chart.querySelector('svg'), k = svg.getBoundingClientRect().width / svg.viewBox.baseVal.width;
    tip.textContent = hit.dataset.tip; tip.style.display = 'block';
    tip.style.left = (Number(hit.dataset.x) * k) + 'px'; tip.style.top = (Number(hit.dataset.y) * k) + 'px';
  });
  panel.addEventListener('mouseleave', () => panel.querySelectorAll('.an-tip').forEach(t => t.style.display = 'none'));

  const adminSection = document.getElementById('admin');
  if (adminSection) adminSection.prepend(panel);
  draw();
  const check = () => { if (document.body.classList.contains('staff-signed-in')) { if (!data && !loading) load(); } else { data = null; draw(); } };
  new MutationObserver(check).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  check();
})();
