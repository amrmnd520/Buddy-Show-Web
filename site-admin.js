/* Website settings editor: logo, hero, menu, layout, colors. 26 October 2026. */
(() => {
  const KEY = 'buddyshop_site_settings';
  const SECTIONS = [
    ['quick', '.quick-categories', 'Үндсэн ангиллын зургууд'],
    ['featured', '.featured-lures', 'Онцлох бараа'],
    ['categories', '.secondary-categories', 'Ангилалаар харах'],
    ['catalog', '#catalog', 'Бүтээгдэхүүний жагсаалт'],
    ['brands', '.brands', 'Брэндүүд']
  ];
  const DEFAULTS = {
    announcement: { show: true, text: 'BUDDY SHOP · PREMIUM FISHING & OUTDOOR · OFFLINE DEMO' },
    logo: { image: '', height: 48, text: '▲ BUDDY SHOP', subtitle: 'FISHING & OUTDOOR', showText: true },
    hero: { image: '', title: 'ЗАГАСЧЛАЛ БОЛ ЗӨВХӨН ХОББИ БИШ.\nАМЬДРАЛЫН ХЭВ МАЯГ.', titleSize: 14, button: 'БҮТЭЭГДЭХҮҮН ҮЗЭХ ↗', showButton: true, height: 420, darkness: 65, align: 'left', position: 55 },
    menu: { showCategories: true, items: [] },
    layout: { order: SECTIONS.map(s => s[0]), hidden: [], columns: 4 },
    colors: { header: '#101c26', accent: '#d77a35', background: '#f5f3ee' }
  };
  const clone = o => JSON.parse(JSON.stringify(o));
  function merge(base, extra) {
    const out = clone(base);
    for (const [k, v] of Object.entries(extra || {})) {
      out[k] = v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' && !Array.isArray(out[k]) ? merge(out[k], v) : clone(v);
    }
    return out;
  }
  let stored = {};
  try { stored = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { stored = {}; }
  const published = () => merge(DEFAULTS, window.BUDDY_SITE_SETTINGS || {});
  let S = merge(published(), stored);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(S)); setStatus('Хадгалагдлаа (энэ browser дээр). Бүх хүнд харуулахын тулд «Тохиргоо татах» дарна уу.'); }
    catch (e) { setStatus('Хадгалж чадсангүй: зураг хэт том байна. Жижиг зураг сонгоно уу.', true); }
  }
  function setStatus(t, err) { const el = document.getElementById('site-status'); if (el) { el.textContent = t; el.style.color = err ? '#a52323' : '#3c6b4f'; } }

  /* ---------- apply settings to the page ---------- */
  const style = document.createElement('style'); style.id = 'site-settings-style'; document.head.appendChild(style);
  function applyMenu() {
    const nav = document.getElementById('nav'); if (!nav) return;
    nav.querySelectorAll('.nav-custom').forEach(e => e.remove());
    nav.querySelectorAll(':scope > button').forEach(b => { b.style.display = S.menu.showCategories ? '' : 'none'; });
    for (const [i, item] of (S.menu.items || []).entries()) {
      if (!item.label) continue;
      const b = document.createElement(item.type === 'url' ? 'a' : 'button');
      b.className = 'nav-custom'; b.textContent = item.label;
      if (item.type === 'url') { b.href = item.value || '#'; if (/^https?:/i.test(item.value || '')) { b.target = '_blank'; b.rel = 'noopener'; } }
      else b.onclick = () => menuGo(item);
      nav.appendChild(b);
    }
  }
  function menuGo(item) {
    if (item.type === 'category') return choose(item.value);
    if (item.type === 'brand') return browseBrand(item.value);
    if (item.type === 'section') { const s = SECTIONS.find(x => x[0] === item.value); document.querySelector(s ? s[1] : '#catalog')?.scrollIntoView({behavior:'smooth'}); }
  }
  function apply() {
    const c = S.colors, h = S.hero, L = S.logo;
    const heroImg = h.image ? `url("${h.image.replace(/"/g, '%22')}")` : 'url("assets/dji-river-hero.jpg")';
    const dark = Math.max(0, Math.min(95, Number(h.darkness))) / 100;
    style.textContent = `:root{--navy:${c.header};--orange:${c.accent};--sand:${c.background}}
body{background:${c.background}}
.announcement{background:${c.accent}}
.nav{background:${c.header}}
.hero{background:linear-gradient(90deg,rgba(5,15,23,${dark}),rgba(5,15,23,${dark * .1}) 70%),${heroImg} center ${Number(h.position)}%/cover no-repeat;min-height:${Number(h.height)}px;justify-content:${h.align === 'center' ? 'center' : 'flex-start'};text-align:${h.align}}
.hero p{font-size:${Number(h.titleSize)}px;line-height:1.35}
.logo img{height:${Number(L.height)}px;width:auto;display:block}
.logo.has-img{display:flex;align-items:center;gap:12px}
.nav .nav-custom{background:transparent;color:white;border:0;white-space:nowrap;padding:6px 12px;font:inherit;font-size:20px;text-decoration:none;cursor:pointer}
@media(max-width:900px){.nav .nav-custom{font-size:15px}}
@media(min-width:1000px){.catalog-results .grid{grid-template-columns:repeat(${Number(S.layout.columns)},minmax(0,1fr))}}`;
    const ann = document.querySelector('.announcement');
    if (ann) { ann.style.display = S.announcement.show ? '' : 'none'; ann.textContent = S.announcement.text; }
    const logo = document.querySelector('.header .logo');
    if (logo) {
      logo.classList.toggle('has-img', !!L.image);
      logo.innerHTML = (L.image ? `<img src="${esc(L.image)}" alt="${esc(L.text || 'Лого')}">` : '') +
        (!L.image || L.showText ? `<div>${esc(L.text)}<small>${esc(L.subtitle)}</small></div>` : '');
      logo.style.cursor = 'pointer'; logo.onclick = () => window.scrollTo({top: 0, behavior: 'smooth'});
    }
    const p = document.querySelector('.hero p'); if (p) p.innerHTML = esc(h.title).replace(/\n/g, '<br>');
    const cta = document.querySelector('.hero .cta'); if (cta) { cta.textContent = h.button; cta.style.display = h.showButton ? '' : 'none'; }
    const admin = document.getElementById('admin');
    const order = [...S.layout.order.filter(k => SECTIONS.some(s => s[0] === k)), ...SECTIONS.map(s => s[0]).filter(k => !S.layout.order.includes(k))];
    for (const k of order) {
      const el = document.querySelector(SECTIONS.find(s => s[0] === k)[1]);
      if (el && admin) { admin.before(el); el.style.display = S.layout.hidden.includes(k) ? 'none' : ''; }
    }
    applyMenu();
    if (window.__featReady) renderFeaturedLures();
  }
  const oldMenus = menus;
  menus = function() { oldMenus(); applyMenu(); };

  /* ---------- image upload (resized so it fits in the browser) ---------- */
  function readImage(file, maxW, maxH, type, cb) {
    if (!file) return;
    if (file.type === 'image/svg+xml') { const r = new FileReader(); r.onload = () => cb(r.result); r.readAsDataURL(file); return; }
    const img = new Image(); const url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, maxW / img.width, maxH / img.height);
      const cv = document.createElement('canvas'); cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height); URL.revokeObjectURL(url);
      cb(cv.toDataURL(type, .85));
    };
    img.onerror = () => setStatus('Энэ файлыг зураг гэж уншиж чадсангүй.', true);
    img.src = url;
  }

  /* ---------- admin panel ---------- */
  const panel = document.createElement('div');
  panel.className = 'admin-panel site-settings'; panel.id = 'site-settings';
  const css = document.createElement('style');
  css.textContent = `.site-settings{margin-bottom:22px}.site-tabs{display:flex;gap:6px;flex-wrap:wrap;margin:10px 0 16px}.site-tabs button{border:1px solid #c8d1d5;background:#f4f6f7;border-radius:20px;padding:9px 16px;font:inherit;font-weight:700;cursor:pointer}.site-tabs button[aria-selected=true]{background:#10202c;color:#fff;border-color:#10202c}
.site-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px 22px;align-items:start}.site-grid label{display:block;font-weight:700;font-size:14px}.site-grid label>input:not([type=checkbox]):not([type=color]),.site-grid label>select,.site-grid label>textarea{display:block;width:100%;margin-top:6px;box-sizing:border-box;font:inherit;font-weight:400}
.site-grid input[type=range]{width:100%}.site-check{display:flex!important;gap:8px;align-items:center}.site-preview{max-width:100%;max-height:120px;border:1px dashed #b8c4cb;border-radius:6px;padding:6px;background:repeating-conic-gradient(#eee 0 25%,#fff 0 50%) 0 0/16px 16px}
.site-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:8px;border:1px solid #e3e7e9;border-radius:6px;margin-bottom:8px}.site-row input,.site-row select{flex:1 1 140px}.site-row button,.site-btn{border:1px solid #c8d1d5;background:#fff;border-radius:4px;padding:8px 12px;cursor:pointer;font:inherit}.site-btn.primary{background:#10202c;color:#fff;border-color:#10202c;font-weight:700}
.site-grid input[type=color]{display:block;width:76px;height:44px;padding:3px;margin-top:6px;border:1px solid #c8d1d5;border-radius:6px;background:#fff;cursor:pointer}.site-settings{margin-top:22px}.site-status{font-size:14px;min-height:20px;margin:10px 0 0}.site-help{font-size:13px;color:#5a6a72;line-height:1.5}`;
  document.head.appendChild(css);
  let tab = 'logo';
  const TABS = [['logo','Лого'],['hero','Нүүр зураг'],['menu','Цэс'],['layout','Зохион байгуулалт'],['colors','Өнгө ба мэдэгдэл']];
  const field = (label, html) => `<label>${label}${html}</label>`;
  const inp = (path, type = 'text', extra = '') => `<input type="${type}" data-path="${path}" value="${esc(get(path))}" ${extra}>`;
  const chk = (path, label) => `<label class="site-check"><input type="checkbox" data-path="${path}" ${get(path) ? 'checked' : ''}>${label}</label>`;
  function get(path) { return path.split('.').reduce((o, k) => o?.[k], S); }
  function set(path, v) { const ks = path.split('.'); const last = ks.pop(); ks.reduce((o, k) => o[k], S)[last] = v; }
  function body() {
    if (tab === 'logo') return `<div class="site-grid">
      <div><label>Лого зураг (PNG, JPG, SVG)</label><input type="file" accept="image/*" id="site-logo-file" style="margin:8px 0">
      ${S.logo.image ? `<img class="site-preview" src="${esc(S.logo.image)}" alt="Лого"><br><button class="site-btn" data-act="logo-clear">Зураг арилгах</button>` : '<p class="site-help">Зураг оруулаагүй бол доорх бичвэр лого болно.</p>'}</div>
      ${field('Логоны өндөр: <b>' + S.logo.height + 'px</b>', inp('logo.height', 'range', 'min="24" max="110"'))}
      ${field('Лого бичвэр', inp('logo.text'))}${field('Доод жижиг бичвэр', inp('logo.subtitle'))}
      ${chk('logo.showText', 'Зурагтай үед бичвэрийг бас харуулах')}</div>`;
    if (tab === 'hero') return `<div class="site-grid">
      <div><label>Нүүр (том) зураг</label><input type="file" accept="image/*" id="site-hero-file" style="margin:8px 0">
      <img class="site-preview" src="${esc(S.hero.image || 'assets/dji-river-hero.jpg')}" alt="Нүүр зураг">
      ${S.hero.image ? '<br><button class="site-btn" data-act="hero-clear">Анхны зураг руу буцаах</button>' : ''}</div>
      ${field('Гарчиг (шинэ мөр = Enter)', `<textarea rows="3" data-path="hero.title">${esc(S.hero.title)}</textarea>`)}
      ${field('Гарчгийн хэмжээ: <b>' + S.hero.titleSize + 'px</b>', inp('hero.titleSize', 'range', 'min="12" max="64"'))}
      ${field('Товчны бичвэр', inp('hero.button'))}${chk('hero.showButton', 'Товч харуулах')}
      ${field('Өндөр: <b>' + S.hero.height + 'px</b>', inp('hero.height', 'range', 'min="220" max="760" step="10"'))}
      ${field('Зургийн бараан байдал: <b>' + S.hero.darkness + '%</b>', inp('hero.darkness', 'range', 'min="0" max="90"'))}
      ${field('Зургийн босоо байрлал: <b>' + S.hero.position + '%</b>', inp('hero.position', 'range', 'min="0" max="100"'))}
      ${field('Бичвэрийн байрлал', `<select data-path="hero.align"><option value="left" ${S.hero.align === 'left' ? 'selected' : ''}>Зүүн</option><option value="center" ${S.hero.align === 'center' ? 'selected' : ''}>Голд</option></select>`)}</div>`;
    if (tab === 'menu') {
      const catOpts = (typeof cats !== 'undefined' ? cats : ['Бүгд','Спин','Флай','Өгөөш','Вейдер','Цүнх','Хувцас','Аксессуар','Өвлийн хэрэгсэл']).slice(1);
      const brands = [...new Set(products.map(p => p.brand).filter(Boolean))].sort();
      const valueField = (it, i) => it.type === 'category' ? `<select data-menu="${i}" data-key="value">${catOpts.map(c => `<option ${c === it.value ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>`
        : it.type === 'brand' ? `<select data-menu="${i}" data-key="value">${brands.map(b => `<option ${b === it.value ? 'selected' : ''}>${esc(b)}</option>`).join('')}</select>`
        : it.type === 'section' ? `<select data-menu="${i}" data-key="value">${SECTIONS.map(s => `<option value="${s[0]}" ${s[0] === it.value ? 'selected' : ''}>${esc(s[2])}</option>`).join('')}</select>`
        : `<input data-menu="${i}" data-key="value" placeholder="https://… эсвэл #catalog" value="${esc(it.value)}">`;
      return `${chk('menu.showCategories', 'Үндсэн ангиллын цэсийг харуулах (Спин, Флай, Өгөөш…)')}
      <h3 style="margin:16px 0 8px">Нэмэлт цэс</h3>
      ${(S.menu.items || []).map((it, i) => `<div class="site-row"><input data-menu="${i}" data-key="label" placeholder="Цэсний нэр" value="${esc(it.label)}">
        <select data-menu="${i}" data-key="type">${[['category','Ангилал'],['brand','Брэнд'],['section','Хуудасны хэсэг'],['url','Холбоос (URL)']].map(([v, l]) => `<option value="${v}" ${v === it.type ? 'selected' : ''}>${l}</option>`).join('')}</select>
        ${valueField(it, i)}<button data-act="menu-up" data-i="${i}" aria-label="Дээш">↑</button><button data-act="menu-down" data-i="${i}" aria-label="Доош">↓</button><button data-act="menu-del" data-i="${i}" aria-label="Устгах">✕</button></div>`).join('') || '<p class="site-help">Нэмэлт цэс алга байна.</p>'}
      <button class="site-btn" data-act="menu-add">+ Цэс нэмэх</button>`;
    }
    if (tab === 'layout') return `<p class="site-help">Хэсгүүдийн дарааллыг ↑↓ товчоор солино. Чагтыг авбал тухайн хэсэг нуугдана.</p>
      ${S.layout.order.map((k, i) => { const s = SECTIONS.find(x => x[0] === k); return s ? `<div class="site-row"><label class="site-check" style="flex:1"><input type="checkbox" data-hide="${k}" ${S.layout.hidden.includes(k) ? '' : 'checked'}>${esc(s[2])}</label><button data-act="sec-up" data-i="${i}" aria-label="Дээш">↑</button><button data-act="sec-down" data-i="${i}" aria-label="Доош">↓</button></div>` : ''; }).join('')}
      <div class="site-grid" style="margin-top:14px">${field('Компьютер дээр нэг мөрөнд харагдах бараа: <b>' + S.layout.columns + '</b>', inp('layout.columns', 'range', 'min="2" max="6"'))}</div>`;
    return `<div class="site-grid">${field('Толгой хэсэг ба цэсний өнгө', inp('colors.header', 'color'))}${field('Онцлох өнгө (дээд мэдэгдлийн мөр)', inp('colors.accent', 'color'))}${field('Хуудасны арын өнгө', inp('colors.background', 'color'))}
      ${chk('announcement.show', 'Дээд мэдэгдлийн мөр харуулах')}${field('Мэдэгдлийн бичвэр', inp('announcement.text'))}</div>`;
  }
  function draw() {
    panel.innerHTML = `<div class="eyebrow">WEBSITE SETTINGS</div><h2>Вэбсайтын тохиргоо</h2>
      <div class="site-tabs" role="tablist">${TABS.map(([k, l]) => `<button role="tab" aria-selected="${k === tab}" data-tab="${k}">${l}</button>`).join('')}</div>
      <div id="site-body">${body()}</div>
      <div class="admin-actions" style="margin-top:18px"><button class="site-btn primary" data-act="export">↓ Тохиргоо татах (site-settings.js)</button><button class="site-btn" data-act="import">↑ Тохиргоо оруулах</button><button class="site-btn" data-act="reset">Нийтэлсэн хувилбар руу буцаах</button><input hidden type="file" id="site-import" accept=".js,.json"></div>
      <p class="site-help">Өөрчлөлт шууд харагдаж, энэ browser дээр хадгалагдана. Бусад хүмүүст харагдуулахын тулд «Тохиргоо татах» дарж, татагдсан site-settings.js файлыг вэбсайтын хавтас дахь ижил нэртэй файлын оронд хуулаад GitHub Desktop-оор Commit → Push хийнэ.</p>
      <p class="site-status" id="site-status" role="status"></p>`;
  }
  function changed(redraw) { apply(); save(); if (redraw) { const y = window.scrollY; draw(); window.scrollTo(0, y); } }
  panel.addEventListener('click', e => {
    const t = e.target.closest('[data-tab],[data-act]'); if (!t) return;
    if (t.dataset.tab) { tab = t.dataset.tab; draw(); return; }
    const a = t.dataset.act, i = Number(t.dataset.i), m = S.menu.items, o = S.layout.order;
    const swap = (arr, x, y) => { if (y < 0 || y >= arr.length) return; [arr[x], arr[y]] = [arr[y], arr[x]]; };
    if (a === 'logo-clear') S.logo.image = '';
    else if (a === 'hero-clear') S.hero.image = '';
    else if (a === 'menu-add') m.push({label: 'Шинэ цэс', type: 'category', value: 'Өгөөш'});
    else if (a === 'menu-del') m.splice(i, 1);
    else if (a === 'menu-up') swap(m, i, i - 1);
    else if (a === 'menu-down') swap(m, i, i + 1);
    else if (a === 'sec-up') swap(o, i, i - 1);
    else if (a === 'sec-down') swap(o, i, i + 1);
    else if (a === 'export') { exportSettings(); return; }
    else if (a === 'import') { document.getElementById('site-import').click(); return; }
    else if (a === 'reset') { if (!confirm('Энэ browser дээрх тохиргооны өөрчлөлтийг устгаж, нийтэлсэн хувилбар руу буцаах уу?')) return; S = published(); try { localStorage.removeItem(KEY); } catch (e) {} apply(); draw(); setStatus('Нийтэлсэн хувилбар руу буцлаа.'); return; }
    else return;
    changed(true);
  });
  panel.addEventListener('input', e => {
    const t = e.target;
    if (t.dataset.path && t.type !== 'checkbox' && t.type !== 'file') {
      set(t.dataset.path, t.type === 'range' ? Number(t.value) : t.value);
      if (t.type === 'range') { const b = t.parentElement.querySelector('b'); if (b) b.textContent = t.value + (/columns/.test(t.dataset.path) ? '' : /darkness|position/.test(t.dataset.path) ? '%' : 'px'); }
      apply();
    }
    if (t.dataset.menu && t.dataset.key === 'label') { S.menu.items[Number(t.dataset.menu)].label = t.value; apply(); }
  });
  panel.addEventListener('change', e => {
    const t = e.target;
    if (t.id === 'site-logo-file') return readImage(t.files[0], 900, 300, 'image/png', url => { S.logo.image = url; changed(true); });
    if (t.id === 'site-hero-file') return readImage(t.files[0], 2000, 1400, 'image/jpeg', url => { S.hero.image = url; changed(true); });
    if (t.id === 'site-import') return importSettings(t.files[0]);
    if (t.dataset.path) { set(t.dataset.path, t.type === 'checkbox' ? t.checked : t.type === 'range' ? Number(t.value) : t.value); return changed(t.type === 'checkbox'); }
    if (t.dataset.menu) {
      const it = S.menu.items[Number(t.dataset.menu)]; it[t.dataset.key] = t.value;
      if (t.dataset.key === 'type') it.value = t.value === 'category' ? 'Өгөөш' : t.value === 'brand' ? (products[0]?.brand || '') : t.value === 'section' ? 'catalog' : '';
      return changed(t.dataset.key === 'type');
    }
    if (t.dataset.hide) { const h = new Set(S.layout.hidden); t.checked ? h.delete(t.dataset.hide) : h.add(t.dataset.hide); S.layout.hidden = [...h]; return changed(false); }
  });
  function exportSettings() {
    const text = '/* Buddy Shop website settings, exported ' + new Date().toISOString().slice(0, 10) + '. */\nwindow.BUDDY_SITE_SETTINGS = ' + JSON.stringify(S, null, 2) + ';\n';
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], {type: 'text/javascript'})); a.download = 'site-settings.js'; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    const fs = document.querySelector('#featured-admin .site-help:last-child'); if (fs) fs.textContent = 'site-settings.js татагдлаа (Downloads хавтас). Үүнийг вэбсайтын хавтсанд хуулаад Commit → Push хийнэ үү.';
    setStatus('site-settings.js татагдлаа (Downloads хавтас). Үүнийг вэбсайтын хавтсанд хуулаад Commit → Push хийнэ үү.');
  }
  function importSettings(file) {
    if (!file) return;
    const r = new FileReader();
    r.onload = () => {
      try { const t = String(r.result); const json = t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1); S = merge(DEFAULTS, JSON.parse(json)); apply(); save(); draw(); setStatus('Тохиргоо орууллаа.'); }
      catch (e) { setStatus('Файл буруу байна.', true); }
    };
    r.readAsText(file);
  }
  /* ---------- featured products (Онцлох бараа) ---------- */
  const fx = document.createElement('style');
  fx.textContent = `.feat-panel{margin-bottom:22px}.feat-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:12px;margin:12px 0 20px}
.feat-card{border:1px solid #dde3e6;border-radius:8px;padding:10px;background:#fff;display:flex;flex-direction:column;gap:6px}.feat-card img{width:100%;height:110px;object-fit:contain;background:#fff}
.feat-card .n{font-weight:700;font-size:14px;line-height:1.3}.feat-card .b{font-size:11px;letter-spacing:1px;color:#a75c29;font-weight:800;text-transform:uppercase}.feat-card .pr{font-weight:800}
.feat-tools{display:flex;gap:6px}.feat-tools button{flex:1;border:1px solid #c8d1d5;background:#f4f6f7;border-radius:4px;padding:7px 0;cursor:pointer;font:inherit}.feat-tools button.del{color:#a52323}
.feat-search{display:flex;gap:8px;flex-wrap:wrap}.feat-search input,.feat-search select{flex:1 1 200px;padding:11px;font:inherit}
.feat-results{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:8px;margin-top:12px;max-height:520px;overflow:auto}
.feat-res{display:flex;gap:10px;align-items:center;border:1px solid #e3e7e9;border-radius:6px;padding:8px;background:#fff}.feat-res img{width:56px;height:56px;object-fit:contain;flex:none}.feat-res div{flex:1;font-size:13px;line-height:1.35}
.feat-res button{border:0;background:#10202c;color:#fff;border-radius:4px;padding:8px 10px;cursor:pointer;font:inherit;font-weight:700;white-space:nowrap}.feat-res button[disabled]{background:#c9d2d6;cursor:default}`;
  document.head.appendChild(fx);
  const featIds = () => Array.isArray(S.featured) ? S.featured : products.filter(p => p.featuredLure).map(p => p.id);
  function applyFeatured() {
    if (!Array.isArray(S.featured)) return;
    const ids = new Set(S.featured.map(Number));
    for (const p of products) p.featuredLure = ids.has(Number(p.id));
  }
  renderFeaturedLures = function() {
    applyFeatured();
    const order = featIds().map(Number);
    const list = products.filter(p => p.featuredLure).sort((a, b) => order.indexOf(Number(a.id)) - order.indexOf(Number(b.id)));
    document.getElementById('featured-lures').innerHTML = list.map(p => `<article class="product"><div class="product-image" role="button" tabindex="0" aria-label="${esc(p.name)} — Дэлгэрэнгүй" onclick="openProduct(${Number(p.id)})" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();openProduct(${Number(p.id)})}"><img src="${esc(p.image)}" alt="${esc(p.name)}" loading="lazy"></div><div class="product-content"><div class="brand">${esc(p.brand)}</div><h3><button onclick="openProduct(${Number(p.id)})">${esc(p.name)}</button></h3><div class="price">${money(p.price)}</div><button class="add" onclick="add(${Number(p.id)})">Сагсанд нэмэх +</button></div></article>`).join('');
  };
  const oldEdit = edit;
  edit = function(id, k, v) {
    if (k === 'featuredLure') {
      const ids = featIds().map(Number).filter(x => x !== Number(id));
      if (v) ids.push(Number(id));
      S.featured = ids; save(); drawFeat();
    }
    return oldEdit(id, k, v);
  };
  const feat = document.createElement('div');
  feat.className = 'admin-panel feat-panel'; feat.id = 'featured-admin';
  let fq = '', fcat = '';
  function drawFeat() {
    const ids = featIds().map(Number);
    const chosen = ids.map(id => products.find(p => Number(p.id) === id)).filter(Boolean);
    const catList = (typeof cats !== 'undefined' ? cats : ['Бүгд']).slice(1);
    feat.innerHTML = `<div class="eyebrow">FEATURED PRODUCTS</div><h2>Онцлох бараа <small style="font-size:16px;color:#5a6a72">(${chosen.length})</small></h2>
      <p class="site-help">Нүүр хуудасны «Онцлох бараа» хэсэгт харагдах бараа. ← → товчоор дарааллыг сольж, ✕ товчоор хасна. Доороос хайж шинэ бараа нэмнэ.</p>
      <div class="feat-list">${chosen.map((p, i) => `<div class="feat-card"><img src="${esc(p.image)}" alt="" loading="lazy"><div class="b">${esc(p.brand)}</div><div class="n">${esc(p.name)}</div><div class="pr">${money(p.price)}</div>
        <div class="feat-tools"><button data-f="left" data-i="${i}" aria-label="Өмнө нь">←</button><button data-f="right" data-i="${i}" aria-label="Дараа нь">→</button><button class="del" data-f="del" data-i="${i}" aria-label="Хасах">✕</button></div></div>`).join('') || '<p class="site-help">Онцлох бараа алга. Доороос нэмнэ үү.</p>'}</div>
      <h3 style="margin:0 0 10px">Бараа нэмэх</h3>
      <div class="feat-search"><input id="feat-q" placeholder="Нэр, брэнд, кодоор хайх…" value="${esc(fq)}"><select id="feat-cat"><option value="">Бүх ангилал</option>${catList.map(c => `<option ${c === fcat ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></div>
      <div class="feat-results" id="feat-results"></div>
      <div class="admin-actions" style="margin-top:16px"><button class="site-btn primary" data-f="export">↓ Хадгалж нийтлэх файл татах (site-settings.js)</button></div>
      <p class="site-help">Өөрчлөлт энэ browser дээр шууд харагдана. Бүх хүнд харуулахын тулд дээрх товчоор файл татаж, вэбсайтын хавтсанд хуулаад Commit → Push хийнэ.</p>`;
    drawResults();
  }
  function drawResults() {
    const box = feat.querySelector('#feat-results'); if (!box) return;
    const ids = new Set(featIds().map(Number)); const q = fq.trim().toLowerCase();
    if (!q && !fcat) { box.innerHTML = '<p class="site-help">Хайх үг бичих эсвэл ангилал сонгоно уу.</p>'; return; }
    const res = products.filter(p => (!fcat || categoryMatches(p, fcat)) && (!q || (p.name + ' ' + p.brand + ' ' + (p.code || '')).toLowerCase().includes(q))).slice(0, 60);
    box.innerHTML = res.map(p => `<div class="feat-res"><img src="${esc(p.image)}" alt="" loading="lazy"><div><b>${esc(p.name)}</b><br>${esc(p.brand)} · ${money(p.price)}</div><button data-f="add" data-id="${Number(p.id)}" ${ids.has(Number(p.id)) ? 'disabled' : ''}>${ids.has(Number(p.id)) ? 'Нэмсэн' : '+ Нэмэх'}</button></div>`).join('') || '<p class="site-help">Илэрц олдсонгүй.</p>';
  }
  function featChanged(ids) { S.featured = ids; save(); renderFeaturedLures(); drawFeat(); }
  feat.addEventListener('click', e => {
    const t = e.target.closest('[data-f]'); if (!t) return;
    const ids = featIds().map(Number), i = Number(t.dataset.i);
    if (t.dataset.f === 'export') return exportSettings();
    if (t.dataset.f === 'add') { ids.push(Number(t.dataset.id)); return featChanged(ids); }
    if (t.dataset.f === 'del') ids.splice(i, 1);
    if (t.dataset.f === 'left' && i > 0) [ids[i - 1], ids[i]] = [ids[i], ids[i - 1]];
    if (t.dataset.f === 'right' && i < ids.length - 1) [ids[i + 1], ids[i]] = [ids[i], ids[i + 1]];
    featChanged(ids);
  });
  feat.addEventListener('input', e => { if (e.target.id === 'feat-q') { fq = e.target.value; drawResults(); } });
  feat.addEventListener('change', e => { if (e.target.id === 'feat-cat') { fcat = e.target.value; drawResults(); } });

  const adminSection = document.getElementById('admin');
  if (adminSection) { adminSection.prepend(feat); adminSection.append(panel); }
  window.__featReady = true;
  draw(); drawFeat(); apply();
})();
