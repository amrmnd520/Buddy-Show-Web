/* Admin: "Эрэлттэй, сайтад байхгүй бараа"
   Products that sell in the shop (Odoo POS, last 90 days) but are not on the website.
   Data: buddy-shop-api GET /api/erp/top (refreshed daily 06:00, or with the button here).
   - "+ Сайтад нэмэх" creates the product with its ERP codes, price and stock; staff then add photos.
   - "Кодыг холбох" puts the codes on a similar website product that has no code yet.
   - "Нуух" hides a suggestion for everyone. Visible to signed-in staff only. */
(() => {
  const API = String(window.BUDDY_API || '').replace(/\/+$/, '');
  if (!API) return;
  const TOKEN_KEY = 'buddyshop_api_token';
  const token = () => { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; } };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = n => Number(n || 0).toLocaleString('en-US');
  const norm = c => String(c || '').trim().toUpperCase().replace(/\s+/g, ' ');
  const SIZE = /^(xxs|xs|s|m|l|xl|xxl|2xl|3xl|4xl|mk|lk|xlk|lxl|sm|mxl|\d{1,2})$/i;
  const toks = s => new Set(String(s || '').toLowerCase().replace(/[’']/g, '').split(/[^a-z0-9а-яөүё.]+/i)
    .filter(t => t.length > 1 && !SIZE.test(t) && !['the', 'and', 'for', 'with'].includes(t)));
  const list = () => (typeof products !== 'undefined' ? products : []);

  // Same rules as erp-sync.js: "|" separates codes; a space-separated row counts as several
  // codes only when every part contains a digit ("1623118 1623120", not "MAGNET KEEPER").
  function codesOf(code) {
    const raw = norm(code); if (!raw) return [];
    if (/[|;,]/.test(raw)) return raw.split(/\s*[|;,]\s*/).filter(Boolean);
    const parts = raw.split(' ');
    return parts.length > 1 && parts.every(t => /\d/.test(t)) ? parts : [raw];
  }
  function siteCodes() {
    const set = new Set();
    for (const p of list()) { const raw = norm(p.code); if (raw) set.add(raw); codesOf(p.code).forEach(c => set.add(c)); }
    return set;
  }

  const CAT_RULES = [
    ['Өвлийн хэрэгсэл', /norfin|\bice\b|winter|helios|torvi|nisus|өвл/i],
    ['Вейдер', /wader|wading|stockingfoot|вейдер/i],
    ['Флай', /\bfly\b|nymph|tippet|leader|backing|fips|\bnts\b|\brio\b|redington|loop|floatant|streamer|dubbing/i],
    ['Цүнх', /\bbag\b|backpack|dry ?bag|hip ?pack|sling|\bcase\b|\bbox\b|цүнх/i],
    ['Хувцас', /jacket|hoodie|hoody|\bcap\b|glove|shirt|t-shirt|tee\b|pant|\bhat\b|sock|gaiter|vest|beanie|toque|trucker|underwear|хувцас/i],
    ['Спин', /lure|jig|mepps|spinner|spoon|crank|minnow|shad|\brod\b|reel|\bline\b|braid|mono|fluoro|hook|swivel|snap|\bpure\b|ar-s|d-s line|savage|duo|shimano|daiwa|abu|berkley|penn|smith/i],
  ];
  const guessCat = (name, categ) => (CAT_RULES.find(([, re]) => re.test(name + ' ' + categ)) || ['Аксессуар'])[0];
  const brands = () => [...new Set(list().map(p => p.brand).filter(b => b && b !== 'Бусад'))].sort((a, b) => b.length - a.length);
  const guessBrand = name => brands().find(b => new RegExp('\\b' + b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i').test(name)) || '';

  function similarCodeless(name) {
    const a = toks(name); let best = null, score = 0;
    for (const p of list()) {
      if (norm(p.code)) continue;
      const b = toks(p.name + ' ' + (p.brand || ''));
      let i = 0; for (const t of a) if (b.has(t)) i++;
      const j = i / ((a.size + b.size - i) || 1);
      if (j > score) { score = j; best = p; }
    }
    return score >= 0.45 ? best : null;
  }

  let data = null, loading = false, err = '';
  let q = '', sort = 'revenue', inStockOnly = true, showHidden = false, page = 0, flash = '';
  const PER = 10;

  const st = document.createElement('style');
  st.textContent = `.erps-panel{margin-bottom:22px}.erps-tools{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:12px 0}
.erps-tools input[type=search]{flex:1;min-width:180px}.erps-tools label{display:flex;gap:6px;align-items:center;font-size:13px}
.erps-list{display:grid;gap:8px}.erps-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:center;border:1px solid #e3e7e9;border-radius:6px;padding:10px 12px;background:#fff}
.erps-row.hidden-item{opacity:.55}.erps-name{font-weight:700;font-size:14px}.erps-meta{font-size:12px;color:#5a6a72;margin-top:3px;line-height:1.5;font-variant-numeric:tabular-nums}
.erps-codes{font-family:ui-monospace,Menlo,monospace;font-size:11px;color:#203746;word-break:break-word}.erps-sold{display:inline-block;background:#fdf0e6;color:#a75c29;font-weight:800;border-radius:3px;padding:1px 6px;margin-right:6px}
.erps-zero{color:#b42318;font-weight:700}.erps-hint{font-size:12px;margin-top:6px;color:#1f5f3a;background:#eef7f0;border-radius:4px;padding:5px 8px;display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.erps-act{display:flex;flex-direction:column;gap:6px;align-items:stretch;min-width:150px}.erps-act select{font-size:12px;padding:6px}
.erps-act button,.erps-hint button,.erps-tools button{border:1px solid #c8d1d5;background:#fff;border-radius:4px;padding:7px 10px;cursor:pointer;font:inherit;font-size:13px;font-weight:600}
.erps-act button.add-it{background:#203746;color:#fff;border-color:#203746}.erps-hint button{background:#1f5f3a;color:#fff;border-color:#1f5f3a;padding:4px 8px;font-size:12px}
.erps-pager{display:flex;gap:10px;align-items:center;justify-content:center;flex-wrap:wrap;margin:14px 0 4px;font-size:13px;color:#5a6a72;font-variant-numeric:tabular-nums}
.erps-pager button{border:1px solid #c8d1d5;background:#fff;border-radius:4px;padding:8px 14px;font:inherit;font-weight:700;cursor:pointer;color:#203746}.erps-pager button:disabled{opacity:.4;cursor:default}
.erps-flash{background:#eef7f0;color:#1f5f3a;border-radius:4px;padding:8px 12px;font-size:13px;margin:8px 0}.erps-err{background:#fdecea;color:#b42318;border-radius:4px;padding:8px 12px;font-size:13px}
@media(max-width:650px){.erps-row{grid-template-columns:1fr}.erps-act{flex-direction:row;flex-wrap:wrap;min-width:0}}`;
  document.head.appendChild(st);

  const panel = document.createElement('div');
  panel.className = 'admin-panel erps-panel'; panel.id = 'erp-suggest-admin';

  async function api(path, opts = {}) {
    const res = await fetch(API + path, Object.assign({}, opts, { headers: Object.assign({ authorization: 'Bearer ' + token() }, opts.headers || {}) }));
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || ('Алдаа ' + res.status));
    return d;
  }
  async function load(force) {
    if (!token() || loading) return;
    loading = true; err = ''; draw();
    try {
      if (force) await api('/api/erp/top/refresh', { method: 'POST' });
      data = await api('/api/erp/top', { cache: 'no-store' });
      if (!data.updatedAt && !force) { await api('/api/erp/top/refresh', { method: 'POST' }); data = await api('/api/erp/top', { cache: 'no-store' }); }
    } catch (e) { err = e.message; }
    loading = false; draw();
  }

  function rows() {
    if (!data) return [];
    const have = siteCodes(), hidden = new Set((data.dismissed || []).map(norm));
    const qq = q.trim().toLowerCase();
    return data.items
      .map(it => ({ ...it, key: norm(it.codes[0]), hidden: it.codes.some(c => hidden.has(norm(c))) }))
      .filter(it => !it.codes.some(c => have.has(norm(c))))
      .filter(it => showHidden ? it.hidden : !it.hidden)
      .filter(it => !inStockOnly || it.qty > 0)
      .filter(it => !qq || (it.name + ' ' + it.codes.join(' ') + ' ' + it.categ).toLowerCase().includes(qq))
      .sort((a, b) => sort === 'sold' ? b.sold - a.sold : b.revenue - a.revenue);
  }

  function draw() {
    const signedIn = !!token();
    const r = rows();
    const catOpts = (typeof cats !== 'undefined' ? cats : ['Бүгд', 'Спин', 'Флай', 'Вейдер', 'Цүнх', 'Хувцас', 'Аксессуар', 'Өвлийн хэрэгсэл']).slice(1).filter(c => c !== 'Өгөөш' && c !== 'Бэлгийн карт');
    const d0 = data && data.updatedAt ? new Date(data.updatedAt) : null, pad = n => String(n).padStart(2, '0');
    const upd = d0 ? `${d0.getFullYear()}-${pad(d0.getMonth() + 1)}-${pad(d0.getDate())} ${pad(d0.getHours())}:${pad(d0.getMinutes())}` : '—';
    panel.innerHTML = `<div class="eyebrow">ERP · БОРЛУУЛАЛТ</div><h2>Эрэлттэй, сайтад байхгүй бараа ${data ? `<small style="font-size:16px;color:#5a6a72">(${r.length})</small>` : ''}</h2>
      <p class="site-help">Сүүлийн ${data ? data.days : 90} хоногт дэлгүүрт (Odoo POS) зарагдсан ч сайт дээр кодоороо байхгүй бараа, борлуулалтаар эрэмбэлсэн. Өдөр бүр 06:00-д шинэчлэгдэнэ. Сүүлд шинэчилсэн: ${esc(upd)}</p>
      ${!signedIn ? '<p class="site-help">Харахын тулд дээрх «Ажилтан нэвтрэх» хэсгээр нэвтэрнэ үү.</p>' : `
      <div class="erps-tools">
        <input type="search" id="erps-q" placeholder="Нэр, код, ERP ангиллаар хайх…" value="${esc(q)}">
        <select id="erps-sort" aria-label="Эрэмбэ"><option value="revenue" ${sort === 'revenue' ? 'selected' : ''}>Орлогоор</option><option value="sold" ${sort === 'sold' ? 'selected' : ''}>Зарагдсан тоогоор</option></select>
        <label><input type="checkbox" id="erps-stock" ${inStockOnly ? 'checked' : ''}> Үлдэгдэлтэйг л</label>
        <label><input type="checkbox" id="erps-hidden" ${showHidden ? 'checked' : ''}> Нуусныг харах</label>
        <button type="button" data-a="sizes-any">Хэмжээ тохируулах…</button>
        <button type="button" data-a="refresh">${loading ? 'Ачаалж байна…' : '↻ Одоо шинэчлэх'}</button>
      </div>
      ${flash ? `<div class="erps-flash">${flash}</div>` : ''}
      ${err ? `<div class="erps-err">⚠ ${esc(err)}</div>` : ''}
      <div class="erps-list">${(() => { const pages = Math.max(1, Math.ceil(r.length / PER)); if (page >= pages) page = pages - 1; return r.slice(page * PER, page * PER + PER); })().map(it => {
        const sim = similarCodeless(it.name);
        const cat = guessCat(it.name, it.categ);
        return `<div class="erps-row ${it.hidden ? 'hidden-item' : ''}" data-key="${esc(it.key)}">
          <div style="min-width:0">
            <div class="erps-name">${esc(it.name)}</div>
            <div class="erps-meta"><span class="erps-sold">${fmt(it.sold)} ш зарагдсан</span>орлого ${fmt(it.revenue)}₮ · үнэ ${fmt(it.price)}₮ · Emart үлдэгдэл <span class="${it.qty ? '' : 'erps-zero'}">${fmt(it.qty)}</span>${it.categ ? ' · ERP: ' + esc(it.categ) : ''}</div>
            <div class="erps-codes">${esc(it.codes.join(' | '))}</div>
            ${sim ? `<div class="erps-hint">Сайтад кодгүй төстэй бараа байна: <b>${esc(sim.name)}</b> <button type="button" data-a="link" data-pid="${Number(sim.id)}">Кодыг холбох</button><button type="button" data-a="sizes" data-pid="${Number(sim.id)}">Хэмжээгээр холбох</button></div>` : ''}
          </div>
          <div class="erps-act">
            <select aria-label="Ангилал" data-cat>${catOpts.map(c => `<option ${c === cat ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
            <button type="button" class="add-it" data-a="add">+ Сайтад нэмэх</button>
            <button type="button" data-a="${it.hidden ? 'unhide' : 'hide'}">${it.hidden ? 'Буцааж харуулах' : 'Нуух'}</button>
          </div></div>`;
      }).join('') || `<p class="site-help">${loading ? 'Ачаалж байна…' : data ? 'Санал болгох бараа алга.' : ''}</p>`}</div>
      ${r.length > PER ? `<div class="erps-pager"><button type="button" data-a="prev" ${page === 0 ? 'disabled' : ''}>‹ Өмнөх</button><span>${page * PER + 1}–${Math.min(r.length, page * PER + PER)} / ${r.length} · Хуудас ${page + 1} / ${Math.ceil(r.length / PER)}</span><button type="button" data-a="next" ${(page + 1) * PER >= r.length ? 'disabled' : ''}>Дараах ›</button></div>` : ''}`}`;
  }

  const findItem = key => data && data.items.find(it => norm(it.codes[0]) === key);
  function finish(msg) { flash = msg; if (typeof refresh === 'function') refresh(); draw(); }

  panel.addEventListener('click', async e => {
    const b = e.target.closest('[data-a]'); if (!b) return;
    const a = b.dataset.a, row = b.closest('.erps-row'), it = row && findItem(row.dataset.key);
    if (a === 'refresh') return load(true);
    if (a === 'prev' || a === 'next') { page = Math.max(0, page + (a === 'next' ? 1 : -1)); draw(); panel.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
    if (a === 'sizes-any') return window.openSizeEditor && window.openSizeEditor(null);
    if (!it) return;
    if (a === 'add') {
      const cat = row.querySelector('[data-cat]').value;
      const id = Date.now() * 10 + Math.floor(Math.random() * 10);
      const p = { id, code: it.codes.join(' | '), name: it.name, brand: guessBrand(it.name), category: cat, subcategory: '',
        price: it.price, regularPrice: it.price, stock: it.qty, erpQty: it.qty, image: '', featured: false, featuredLure: false, description: '' };
      products.unshift(p);
      return finish(`«${esc(it.name)}» сайтад нэмэгдлээ (${esc(cat)}). Доорх «Бүтээгдэхүүн удирдах» хүснэгтийн эхний мөрөнд 📷 Зураг нэмэх товчоор зургаа оруулна уу.`);
    }
    if (a === 'sizes') return window.openSizeEditor && window.openSizeEditor(Number(b.dataset.pid), it.name);
    if (a === 'link') {
      const p = list().find(x => Number(x.id) === Number(b.dataset.pid)); if (!p) return;
      if (b.dataset.armed !== '1') { b.dataset.armed = '1'; b.textContent = 'Дахин дарж баталгаажуул'; setTimeout(() => { if (b.isConnected) { b.dataset.armed = ''; b.textContent = 'Кодыг холбох'; } }, 4000); return; }
      p.code = it.codes.join(' | ');
      p.price = it.price || p.price; p.regularPrice = p.price; p.stock = it.qty; p.erpQty = it.qty;
      return finish(`«${esc(p.name)}» бараанд ${it.codes.length} код холбогдлоо. Үнэ, үлдэгдэл нь цаашид ERP-ээс шинэчлэгдэнэ.`);
    }
    if (a === 'hide' || a === 'unhide') {
      try { const d = await api('/api/erp/dismiss', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: it.codes[0], hide: a === 'hide' }) }); data.dismissed = d.dismissed; flash = ''; }
      catch (er) { err = er.message; }
      draw();
    }
  });
  panel.addEventListener('input', e => { if (e.target.id === 'erps-q') { q = e.target.value; page = 0; const pos = e.target.selectionStart; draw(); const el = panel.querySelector('#erps-q'); el.focus(); el.setSelectionRange(pos, pos); } });
  panel.addEventListener('change', e => {
    if (e.target.id === 'erps-sort') { sort = e.target.value; draw(); }
    if (e.target.id === 'erps-stock') { inStockOnly = e.target.checked; page = 0; draw(); }
    if (e.target.id === 'erps-hidden') { showHidden = e.target.checked; page = 0; draw(); }
  });

  window.addEventListener('sizes-saved', e => {
    const p = list().find(x => Number(x.id) === Number(e.detail.id));
    flash = p ? `«${esc(p.name)}» бараанд ${e.detail.count} хэмжээ холбогдлоо. Барааны хуудсанд хэмжээ сонгох товчнууд гарна.` : '';
    draw();
  });
  const adminSection = document.getElementById('admin');
  if (adminSection) adminSection.prepend(panel);
  draw();
  // Load when staff are signed in (shop-sync.js toggles this class on <body>).
  const check = () => { if (document.body.classList.contains('staff-signed-in') && !data && !loading) load(false); else if (!document.body.classList.contains('staff-signed-in')) { data = null; draw(); } };
  new MutationObserver(check).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  check();
})();
