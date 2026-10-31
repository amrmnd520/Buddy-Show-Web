/* Admin → «Бүтээгдэхүүн удирдах»: filter and sort the product table by category, and fix
   products that have no category / sub-category.
   - "Ангилал" filter: every category with its count, plus «⚠ Ангилалгүй» and «⚠ Дэд ангилалгүй».
   - "Эрэмбэ": newest, by category, by name, by price.
   - Rows without a category show a suggested category · sub-category (from the product name,
     and from similar products that already have one) with a one-click «Зөвшөөрөх» button,
     and «Бүх саналыг зөвшөөрөх» for the whole filtered list.
   - A product with no category no longer looks like «Спин» in the table: it shows «— Ангилалгүй —». */
(() => {
  if (typeof adminVisible !== 'function' || typeof adminRender !== 'function') return;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const CATS = () => (typeof cats !== 'undefined' ? cats.slice(1) : []);
  const noCat = p => !p.category || !CATS().includes(p.category);
  const noSub = p => !noCat(p) && !String(p.subcategory || '').trim() && !['Бэлгийн карт', 'Цүнх'].includes(p.category);
  let filter = '', sort = 'new';

  // ---------- guessing a category ----------
  const RULES = [
    [/fly\s*line|флай утас|sink tip|shooting head/i, 'Флай', 'Fly Line Флай утас'],
    [/tippet/i, 'Флай', 'Tippet'], [/leader/i, 'Флай', 'Leader Үзүүрийн утас'],
    [/fly\s*box|флай хайрцаг/i, 'Аксессуар', 'Флай хайрцаг'],
    [/landing net|газардуулагч|\bnet\b/i, 'Флай', 'Газардуулагч тор'],
    [/fly\s*(rod|уурга)|флай уурга/i, 'Флай', 'Флай уурга'],
    [/fly\s*reel|флай дамар/i, 'Флай', 'Флай дамар'],
    [/combo|outfit|комбо/i, 'Флай', 'Флай Комбо'],
    [/stockingfoot|bootfoot|wader|вейдер/i, 'Вейдер', ''],
    [/wading\s*(boot|shoe)|вейдерийн гутал/i, 'Вейдер', 'Вейдерийн Гутал'],
    [/auger blade|өрөмний ир/i, 'Өвлийн хэрэгсэл', 'Өрөмний ир'],
    [/ice auger|өрөм/i, 'Өвлийн хэрэгсэл', 'Өрөм'],
    [/ice (rod|fishing rod)|өвлийн уурга/i, 'Өвлийн хэрэгсэл', 'Өвлийн уурга'],
    [/balancer|балансир/i, 'Өвлийн хэрэгсэл', 'Балансир'],
    [/skimmer|шанага/i, 'Өвлийн хэрэгсэл', 'Шанага'],
    [/winter suit|winter boot|өвлийн/i, 'Өвлийн хэрэгсэл', 'Хувцас'],
    [/hood(y|ie)|малгайтай цамц/i, 'Хувцас', 'Малгайтай цамц'],
    [/trucker|\bcap\b|\bhat\b|beanie|малгай/i, 'Хувцас', 'Малгай'],
    [/gaiter|buff|ороолт/i, 'Хувцас', 'Ороолт'],
    [/glove|mitt|бээлий/i, 'Хувцас', 'Бээлий'],
    [/sock|оймс/i, 'Хувцас', 'Оймс'],
    [/t-?shirt|\btee\b|футболк/i, 'Хувцас', 'Футболк'],
    [/vest|хантааз/i, 'Хувцас', 'Хантааз'],
    [/jacket|parka|shell|хүрэм/i, 'Хувцас', 'Хүрэм'],
    [/shirt|crew|цамц/i, 'Хувцас', 'Цамц'],
    [/backpack|sling|hip ?pack|chest ?pack|duffel|tote|\bbag\b|pouch|wallet|цүнх/i, 'Цүнх', ''],
    [/sunglass|polar|нарны шил/i, 'Аксессуар', 'Нарны шил'],
    [/wading belt|support belt|\bbelt\b|бүс/i, 'Аксессуар', 'Бүс'],
    [/\bcube\b|piramida|pyramid|\btent\b|майхан/i, 'Өвлийн хэрэгсэл', 'Майхан'],
    [/rod (sleeve|tube|case|sock)|уурганы гэр/i, 'Аксессуар', 'Уурганы гэр'],
    [/plier|хямсаа|бахь/i, 'Аксессуар', 'Хямсаа'],
    [/carabiner|zinger|retractor/i, 'Аксессуар', 'Carabiner'],
    [/braid|mono|fluoro|mainline|line\b|утас/i, 'Спин', 'Утас'],
    [/\breel\b|дамар|\d{4}\s*(hg|xg|pg|fd|s)?\b/i, 'Спин', 'Дамар'],
    [/\brod\b|уурга|spinning/i, 'Спин', 'Уурга'],
    [/minnow|crank|jerk|wobbl|воблер/i, 'Спин', 'Өгөөш · Воблер'],
    [/mouse|хулгана/i, 'Спин', 'Хулгана'],
    [/shad|grub|soft|worm|t-tail|зөөлөн/i, 'Спин', 'Өгөөш · Зөөлөн өгөөш'],
    [/spoon|spinner|lure|mepps|өгөөш/i, 'Спин', 'Өгөөш'],
  ];
  const words = s => String(s || '').toLowerCase().replace(/[^a-zа-яөүё0-9]+/gi, ' ').split(' ').filter(w => w.length >= 3 && !/^\d+$/.test(w));
  let index = null;
  function buildIndex() {
    const known = products.filter(p => !noCat(p) && String(p.subcategory || '').trim());
    const df = new Map();
    const docs = known.map(p => { const w = new Set([...words(p.name), ...words(p.brand)]); w.forEach(x => df.set(x, (df.get(x) || 0) + 1)); return { p, w }; });
    index = { docs, df, n: docs.length };
  }
  function guess(p) {
    const text = p.name;
    for (const [re, c, s] of RULES) {
      if (re.test(text)) {
        const sub = c === 'Вейдер' && !s && ['Simms', 'Vision', 'Redington'].includes(p.brand) && p.name.toLowerCase().includes(p.brand.toLowerCase()) ? p.brand : s;
        return { category: c, subcategory: sub, why: 'нэрээр' };
      }
    }
    if (!index) buildIndex();
    const w = new Set([...words(p.name), ...words(p.brand)]); if (!w.size) return null;
    const votes = new Map();
    index.docs.forEach(({ p: q, w: qw }) => {
      if (!noCat(p) && q.category !== p.category) return;
      let s = 0; w.forEach(x => { if (qw.has(x)) s += Math.log(1 + index.n / index.df.get(x)); });
      if (s <= 3) return;
      const k = q.category + '|' + q.subcategory; votes.set(k, (votes.get(k) || 0) + s);
    });
    const best = [...votes.entries()].sort((a, b) => b[1] - a[1])[0];
    if (!best || best[1] < 4) return null;
    const [category, subcategory] = best[0].split('|');
    return { category, subcategory, why: 'төстэй бараагаар' };
  }

  // ---------- filtering / sorting the table ----------
  const prevVisible = adminVisible;
  const matches = q => p => !q || (p.name + ' ' + p.brand + ' ' + (p.code || '')).toLowerCase().includes(q);
  window.adminVisible = function (q) {
    if (!filter && sort === 'new') return prevVisible(q);
    let all = products.filter(matches(q)).filter(p => !filter ? true : filter === '__none' ? noCat(p) : filter === '__nosub' ? noSub(p) : p.category === filter);
    const by = {
      cat: (a, b) => (CATS().indexOf(a.category) - CATS().indexOf(b.category)) || String(a.subcategory || '').localeCompare(String(b.subcategory || ''), 'mn') || a.name.localeCompare(b.name),
      name: (a, b) => a.name.localeCompare(b.name), up: (a, b) => a.price - b.price, down: (a, b) => b.price - a.price,
    }[sort];
    if (by) all = all.slice().sort(by);
    const lim = adminShowAll ? all.length : Math.max(30, adminLimit);
    const n = document.getElementById('admin-list-note');
    const btn = (t, js) => `<button type="button" class="admin-list-btn primary" onclick="${js};adminRender()">${t}</button>`;
    if (n) n.innerHTML = all.length ? `${all.length} бараа${all.length > lim ? `, эхний ${lim}-ийг харуулж байна ` + btn('Цааш харах', 'adminLimit=Math.max(30,adminLimit)+30') + btn(`Бүгдийг харах (${all.length})`, 'adminShowAll=true') : ''}` : 'Ийм бараа алга. 🎉';
    return all.slice(0, lim);
  };

  // ---------- toolbar ----------
  const search = document.getElementById('admin-search');
  const bar = document.createElement('div'); bar.className = 'af-bar';
  const st = document.createElement('style');
  st.textContent = `.af-bar{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin:-4px 0 10px}
.af-bar select{padding:9px 10px;border:1px solid #cfd6da;border-radius:6px;font:inherit;background:#fff;min-width:200px}
.af-bar .af-warn{color:#8a5300;font-size:13px}.af-bar button{padding:9px 14px;border-radius:6px;border:0;background:#1f5f3a;color:#fff;font-weight:700;cursor:pointer}
tr.af-sug td{background:#f3faf5;font-size:13px;padding:6px 10px!important;border-top:0}
tr.af-sug button{margin-left:8px;padding:4px 10px;border:0;border-radius:5px;background:#1f5f3a;color:#fff;font-weight:700;cursor:pointer}
tr.af-sug .none{color:#8a5300}
tr.af-missing td{background:#fffaf2}`;
  document.head.appendChild(st);
  if (search) search.after(bar);
  function drawBar() {
    const c = n => products.filter(n).length;
    const nc = c(noCat), ns = c(noSub);
    bar.innerHTML = `<select data-af="filter" aria-label="Ангиллаар шүүх"><option value="">Бүх ангилал (${products.length})</option>
        ${CATS().map(k => `<option value="${esc(k)}" ${filter === k ? 'selected' : ''}>${esc(k)} (${c(p => p.category === k)})</option>`).join('')}
        <option value="__none" ${filter === '__none' ? 'selected' : ''}>⚠ Ангилалгүй (${nc})</option>
        <option value="__nosub" ${filter === '__nosub' ? 'selected' : ''}>⚠ Дэд ангилалгүй (${ns})</option></select>
      <select data-af="sort" aria-label="Эрэмбэлэх">${[['new', 'Сүүлд нэмсэн'], ['cat', 'Ангиллаар'], ['name', 'Нэрээр А→Я'], ['up', 'Үнэ ↑'], ['down', 'Үнэ ↓']]
        .map(([k, l]) => `<option value="${k}" ${sort === k ? 'selected' : ''}>Эрэмбэ: ${l}</option>`).join('')}</select>
      ${(filter === '__none' || filter === '__nosub') ? '<button type="button" data-af="all" title="Зөвхөн нэрээр тодорхой таарсан саналуудыг. «Төстэй бараагаар» гэснийг нэг нэгээр шалгаж зөвшөөрнө.">✓ Нэрээр таарсан саналуудыг зөвшөөрөх</button>' : (nc + ns ? `<span class="af-warn">⚠ ${nc} бараа ангилалгүй, ${ns} бараа дэд ангилалгүй байна</span>` : '')}`;
  }
  bar.addEventListener('change', e => {
    const k = e.target.dataset.af;
    if (k === 'filter') filter = e.target.value; else if (k === 'sort') sort = e.target.value; else return;
    adminLimit = 30; adminShowAll = false; adminRender();
  });
  bar.addEventListener('click', e => {
    if (e.target.dataset.af !== 'all') return;
    const rows = [...document.querySelectorAll('#adminrows tr.af-sug[data-sure]')];
    if (!rows.length) return;
    if (!e.target.dataset.armed) { e.target.dataset.armed = '1'; e.target.textContent = `Дахин дарж ${rows.length} барааг ангилах`; setTimeout(() => { e.target.dataset.armed = ''; drawBar(); }, 4000); return; }
    rows.forEach(r => apply(Number(r.dataset.id), r.dataset.c, r.dataset.s, true));
    index = null; adminRender();
  });

  function apply(id, c, s, quiet) {
    const p = products.find(x => Number(x.id) === id); if (!p) return;
    p.category = c; if (s) p.subcategory = s;
    if (typeof persist === 'function') persist();
    if (!quiet) { index = null; adminRender(); }
    if (typeof menus === 'function') try { menus(); } catch (e) {}
    if (typeof render === 'function') try { render(); } catch (e) {}
  }

  // ---------- decorate the rendered table ----------
  const prevRender = adminRender;
  window.adminRender = function (...a) {
    const out = prevRender.apply(this, a);
    try { decorate(); drawBar(); } catch (e) { console.error(e); }
    return out;
  };
  function decorate() {
    document.querySelectorAll('#adminrows > tr').forEach(tr => {
      const m = (tr.querySelector('button[onclick^="del("]')?.getAttribute('onclick') || '').match(/del\((\d+)/);
      if (!m) return;
      const p = products.find(x => Number(x.id) === Number(m[1])); if (!p) return;
      const sel = tr.querySelector('select[onchange*="\'category\'"]');
      if (sel && noCat(p)) { sel.insertAdjacentHTML('afterbegin', '<option value="" selected>— Ангилалгүй —</option>'); sel.value = ''; }
      if (!noCat(p) && !noSub(p)) return;
      tr.classList.add('af-missing');
      const g = guess(p);
      const row = document.createElement('tr'); row.className = 'af-sug'; row.dataset.id = p.id;
      if (g) { row.dataset.c = g.category; row.dataset.s = g.subcategory || ''; if (g.why === 'нэрээр') row.dataset.sure = '1'; }
      row.innerHTML = `<td colspan="${tr.children.length}">${noCat(p) ? '⚠ Ангилал сонгогдоогүй.' : '⚠ Дэд ангилалгүй.'} ${g
        ? `Санал (${g.why}): ${!noCat(p) && g.category !== p.category ? `<s>${esc(p.category)}</s> → ` : ''}<b>${esc(g.category)}${g.subcategory ? ' · ' + esc(g.subcategory) : ''}</b><button type="button" data-ok>✓ Зөвшөөрөх</button>`
        : '<span class="none">Санал олдсонгүй — дээрх талбараас гараар сонгоно уу.</span>'}</td>`;
      tr.after(row);
    });
  }
  document.getElementById('adminrows')?.addEventListener('click', e => {
    if (!e.target.matches('tr.af-sug [data-ok]')) return;
    const r = e.target.closest('tr'); apply(Number(r.dataset.id), r.dataset.c, r.dataset.s);
  });
  drawBar();
})();
