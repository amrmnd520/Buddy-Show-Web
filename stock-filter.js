/* Product list: «Зөвхөн үлдэгдэлтэй» switch in the catalog toolbar.
   - On: sold-out products (ERP stock 0) are hidden from the list.
   - Off: they are still shown, but after the products that are in stock.
   The choice is remembered in this browser. Sold-out products can still be opened from
   search links, suggestions and saved lists. */
(() => {
  if (typeof render !== 'function') return;
  // Вейдер category: the waders themselves get the sub-category «Вейдер» (boots already have «Вейдерийн Гутал»)
  if (typeof productSubcategories === 'function') {
    const baseSubs = productSubcategories;
    const isWader = p => p.category === 'Вейдер' && /wader|stockingfoot|вейдер/i.test(p.name || '')
      && !/boot|shoe|гутал|vest/i.test(p.name || '') && !/гутал/i.test(p.subcategory || '');
    window.productSubcategories = function (p) {
      const subs = baseSubs(p);
      return isWader(p) && !subs.includes('Вейдер') ? ['Вейдер', ...subs] : subs;
    };
  }
  const KEY = 'bs_only_stock';
  const ls = (v) => { try { if (v === undefined) return localStorage.getItem(KEY); localStorage.setItem(KEY, v); } catch (e) { return null; } };
  const out = p => typeof p.erpQty === 'number' && p.erpQty <= 0;
  // product counts are for staff only; customers see plain lists
  const staff = () => document.body.classList.contains('staff-signed-in');
  const n = k => (staff() ? ` (${k})` : '');
  let only = ls() === '1';

  const st = document.createElement('style');
  st.textContent = `.stock-toggle{display:inline-flex;align-items:center;gap:8px;padding:0 12px;border:1px solid #cfd6da;border-radius:20px;background:#fff;cursor:pointer;font-size:14px;font-weight:600;white-space:nowrap;min-height:40px;user-select:none}
.stock-toggle input{position:absolute;opacity:0;pointer-events:none}
.stock-toggle .sw{width:34px;height:20px;border-radius:10px;background:#cfd6da;position:relative;transition:background .2s;flex:none}
.stock-toggle .sw::after{content:'';position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;transition:left .2s}
.stock-toggle input:checked + .sw{background:#1f5f3a}.stock-toggle input:checked + .sw::after{left:16px}
.stock-toggle input:focus-visible + .sw{outline:2px solid #203746;outline-offset:2px}
.stock-toggle small{font-weight:400;color:#5a6a72}`;
  document.head.appendChild(st);

  const toolbar = document.querySelector('#catalog .toolbar');
  const label = document.createElement('label'); label.className = 'stock-toggle';
  label.innerHTML = '<input type="checkbox" aria-label="Зөвхөн үлдэгдэлтэй бараа харуулах"><span class="sw"></span><span>Зөвхөн үлдэгдэлтэй <small></small></span>';
  const box = label.querySelector('input'); box.checked = only;
  const resetBtn = toolbar && [...toolbar.querySelectorAll('button')].find(b => /Цэвэрлэх/.test(b.textContent));
  if (resetBtn) resetBtn.before(label); else toolbar && toolbar.appendChild(label);
  box.addEventListener('change', () => { only = box.checked; ls(only ? '1' : '0'); render(); });

  // the catalog list is drawn by render(), which reads the global `products`:
  // hand it the in-stock-first (or in-stock-only) list for the length of that call.
  // Norfin winter suits → Өвлийн хэрэгсэл › Өвлийн хослол (also new Norfin «… Suit» products)
  const SUIT_IDS = new Set([783599, 783596, 746037, 726176, 726173, 726172, 726171]);
  const isSuit = p => SUIT_IDS.has(Number(p.id)) || (p.brand === 'Norfin' && /\bsuit\b/i.test(p.name || ''));
  // Аксессуар sorted into clear sub-categories; hats, bags, a wading shoe moved to their own categories (2026-11-09)
  const RECAT = {"351484": ["Аксессуар", "Нарны шил"], "105517": ["Аксессуар", "Нарны шил"], "105515": ["Аксессуар", "Нарны шил"], "105516": ["Аксессуар", "Нарны шил"], "239389": ["Аксессуар", "Нарны шил"], "105527": ["Аксессуар", "Нарны шил"], "105526": ["Аксессуар", "Нарны шил"], "239408": ["Аксессуар", "Нарны шил"], "907160": ["Аксессуар", "Нарны шил"], "907161": ["Аксессуар", "Нарны шил"], "907162": ["Аксессуар", "Нарны шил"], "239407": ["Аксессуар", "Нарны шил"], "105663": ["Аксессуар", ""], "664623": ["Аксессуар", ""], "105657": ["Аксессуар", ""], "105658": ["Аксессуар", ""], "105619": ["Аксессуар", ""], "105728": ["Аксессуар", ""], "239624": ["Аксессуар", ""], "726704": ["Аксессуар", ""], "725037": ["Аксессуар", ""], "726723": ["Аксессуар", ""], "728263": ["Аксессуар", ""], "726703": ["Аксессуар", ""], "105647": ["Аксессуар", "Хутга"], "105645": ["Аксессуар", "Хутга"], "105641": ["Аксессуар", "Хутга"], "105642": ["Аксессуар", "Хутга"], "105639": ["Аксессуар", "Хутга"], "105638": ["Аксессуар", ""], "105620": ["Аксессуар", ""], "105632": ["Аксессуар", ""], "105707": ["Аксессуар", ""], "105621": ["Аксессуар", ""], "105623": ["Аксессуар", ""], "129639": ["Аксессуар", ""], "728228": ["Аксессуар", ""], "105653": ["Аксессуар", ""], "105644": ["Аксессуар", ""], "726731": ["Аксессуар", ""], "726700": ["Аксессуар", ""], "726799": ["Аксессуар", ""], "726702": ["Аксессуар", ""], "129647": ["Аксессуар", ""], "129648": ["Аксессуар", ""], "129649": ["Аксессуар", ""], "129650": ["Аксессуар", ""], "129651": ["Аксессуар", ""], "728224": ["Аксессуар", ""], "105618": ["Аксессуар", ""], "730574": ["Аксессуар", ""], "114930": ["Аксессуар", ""], "114929": ["Аксессуар", ""], "114927": ["Аксессуар", ""], "728222": ["Аксессуар", ""], "105676": ["Аксессуар", ""], "105674": ["Аксессуар", ""], "114923": ["Аксессуар", ""], "657587": ["Аксессуар", ""], "728255": ["Аксессуар", ""], "105585": ["Спин", ""], "105584": ["Спин", ""], "105651": ["Спин", ""], "105634": ["Спин", ""], "105648": ["Спин", ""], "105656": ["Аксессуар", "Эргүүлэг, цагираг"], "105652": ["Аксессуар", "Эргүүлэг, цагираг"], "105628": ["Аксессуар", "Эргүүлэг, цагираг"], "726743": ["Аксессуар", "Флай хэрэгсэл"], "726738": ["Аксессуар", "Флай хэрэгсэл"], "105555": ["Аксессуар", "Флай хэрэгсэл"], "728258": ["Аксессуар", "Флай хэрэгсэл"], "114926": ["Аксессуар", "Бусад"], "114924": ["Аксессуар", "Бусад"], "728261": ["Аксессуар", "Бусад"], "105654": ["Цүнх", ""], "105650": ["Цүнх", ""], "105649": ["Цүнх", ""], "105690": ["Цүнх", ""], "105667": ["Цүнх", ""], "105525": ["Цүнх", ""], "105521": ["Цүнх", ""], "105520": ["Цүнх", ""], "105583": ["Хувцас", "Ороолт"], "105678": ["Хувцас", "Ороолт"], "105636": ["Хувцас", "Ороолт"], "726209": ["Хувцас", "Малгай"], "907136": ["Вейдер", "Вейдерийн Гутал"]};
  const fixSuits = list => list.forEach(p => { const r = RECAT[p.id]; if (r) { p.category = r[0]; p.subcategory = r[1]; } if (isSuit(p)) { p.category = 'Өвлийн хэрэгсэл'; p.subcategory = 'Өвлийн хослол'; } });
  const prev = window.render;
  window.render = function (...a) {
    const full = products;
    fixSuits(full);
    const soldOut = full.filter(out).length;
    const small = label.querySelector('small');
    if (small) small.textContent = soldOut && staff() ? `(${soldOut} дууссан)` : '';
    label.style.display = soldOut ? '' : 'none';
    const list = only ? full.filter(p => !out(p)) : [...full.filter(p => !out(p)), ...full.filter(out)];
    products = list;
    try { const r = prev.apply(this, a); cascade(); return r; }
    finally {
      products = full;
      const c = document.getElementById('catalog-count');
      if (c && !staff()) c.textContent = c.textContent.replace(/\s*·\s*Нийт\s*\d+/, '');
      if (c && staff() && only && soldOut) c.textContent = c.textContent.replace(/·\s*Нийт\s*\d+/, `· ${soldOut} дууссан бараа нуугдсан`);
    }
  };
  // Brand → Category → Sub-category: each list shows only what exists for the choices before it,
  // with how many products there are (sold-out ones not counted while the switch is on).
  function cascade() {
    const $ = id => document.getElementById(id);
    const bSel = $('brand'), cSel = $('category'), sSel = $('subcategory'); if (!bSel || !cSel || !sSel) return;
    const esc = t => String(t).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
    const B = bSel.value || 'Бүх брэнд', C = cSel.value || 'Бүгд', S = sSel.value || '';
    const catOk = (p, c) => (typeof categoryMatches === 'function' ? categoryMatches(p, c) : (c === 'Бүгд' || p.category === c));
    const subsOf = p => (typeof productSubcategories === 'function' ? productSubcategories(p) : []);
    // each list only offers what exists together with the other two choices (any order works)
    const okB = p => B === 'Бүх брэнд' || p.brand === B;
    const okC = p => catOk(p, C);
    const okS = p => !S || subsOf(p).includes(S);
    // 1. brands inside the chosen category / sub-category
    const forB = products.filter(p => okC(p) && okS(p));
    const bc = new Map(); forB.forEach(p => p.brand && bc.set(p.brand, (bc.get(p.brand) || 0) + 1));
    const brands = [...bc.keys()].sort((x, y) => x.localeCompare(y, 'en', { sensitivity: 'base' }));
    if (B !== 'Бүх брэнд' && !bc.has(B)) brands.unshift(B);
    bSel.innerHTML = `<option value="Бүх брэнд">Бүх брэнд${n(forB.length)}</option>` + brands.map(b => `<option value="${esc(b)}">${esc(b)}${n(bc.get(b) || 0)}</option>`).join('');
    bSel.value = B;
    // 2. categories that this brand has
    const inBrand = products.filter(okB);
    const list = (typeof cats !== 'undefined' ? cats : ['Бүгд']).filter(c => c !== 'Бүгд');
    const cc = list.map(c => [c, inBrand.filter(p => catOk(p, c)).length]).filter(([c, k]) => k || c === C);
    cSel.innerHTML = `<option value="Бүгд">Бүх ангилал${n(inBrand.length)}</option>` + cc.map(([c, k]) => `<option value="${esc(c)}">${esc(c)}${n(k)}</option>`).join('');
    cSel.value = C;
    // 3. sub-categories inside brand + category
    const inCat = inBrand.filter(okC);
    const sc = new Map(); inCat.forEach(p => subsOf(p).forEach(x => sc.set(x, (sc.get(x) || 0) + 1)));
    const subs = [...sc.keys()].sort((x, y) => x.localeCompare(y, 'mn'));
    if (S && !sc.has(S)) subs.unshift(S);
    sSel.innerHTML = `<option value="">Бүх дэд ангилал${n(inCat.length)}</option>` + subs.map(x => `<option value="${esc(x)}">${esc(x)}${n(sc.get(x) || 0)}</option>`).join('');
    sSel.value = S;
    sSel.disabled = !subs.length;
  }

  // one row on wide screens: Brand · Category · Sub-category · Sort · In stock · Clear
  const lay = document.createElement('style');
  lay.textContent = `@media(min-width:1101px){#catalog .toolbar{grid-template-columns:minmax(0,1.1fr) minmax(0,1fr) minmax(0,1.1fr) minmax(0,.9fr) auto auto!important;align-items:center}}
@media(max-width:1100px) and (min-width:601px){#catalog .toolbar{grid-template-columns:repeat(3,minmax(0,1fr))!important}}
#catalog .toolbar select:disabled{opacity:.55}`;
  document.head.appendChild(lay);
  render();
  // redraw when staff sign in or out
  let was = staff();
  new MutationObserver(() => { if (staff() !== was) { was = staff(); render(); } }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
})();
