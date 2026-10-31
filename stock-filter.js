/* Product list: «Зөвхөн үлдэгдэлтэй» switch in the catalog toolbar.
   - On: sold-out products (ERP stock 0) are hidden from the list.
   - Off: they are still shown, but after the products that are in stock.
   The choice is remembered in this browser. Sold-out products can still be opened from
   search links, suggestions and saved lists. */
(() => {
  if (typeof render !== 'function') return;
  const KEY = 'bs_only_stock';
  const ls = (v) => { try { if (v === undefined) return localStorage.getItem(KEY); localStorage.setItem(KEY, v); } catch (e) { return null; } };
  const out = p => typeof p.erpQty === 'number' && p.erpQty <= 0;
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
  const prev = window.render;
  window.render = function (...a) {
    const full = products;
    const soldOut = full.filter(out).length;
    const small = label.querySelector('small');
    if (small) small.textContent = soldOut ? `(${soldOut} дууссан)` : '';
    label.style.display = soldOut ? '' : 'none';
    const list = only ? full.filter(p => !out(p)) : [...full.filter(p => !out(p)), ...full.filter(out)];
    products = list;
    try { const r = prev.apply(this, a); cascade(); return r; }
    finally {
      products = full;
      const c = document.getElementById('catalog-count');
      if (c && only && soldOut) c.textContent = c.textContent.replace(/·\s*Нийт\s*\d+/, `· ${soldOut} дууссан бараа нуугдсан`);
    }
  };
  // Brand → Category → Sub-category: each list shows only what exists for the choices before it,
  // with how many products there are (sold-out ones not counted while the switch is on).
  function cascade() {
    const $ = id => document.getElementById(id);
    const bSel = $('brand'), cSel = $('category'), sSel = $('subcategory'); if (!bSel || !cSel || !sSel) return;
    const esc = t => String(t).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
    const B = bSel.value || 'Бүх брэнд', C = cSel.value || 'Бүгд', S = sSel.value || '';
    const inBrand = products.filter(p => B === 'Бүх брэнд' || p.brand === B);
    const catOk = (p, c) => (typeof categoryMatches === 'function' ? categoryMatches(p, c) : (c === 'Бүгд' || p.category === c));
    const subsOf = p => (typeof productSubcategories === 'function' ? productSubcategories(p) : []);
    // 1. brands: all, with counts
    const bc = new Map(); products.forEach(p => p.brand && bc.set(p.brand, (bc.get(p.brand) || 0) + 1));
    const brands = [...bc.keys()].sort((x, y) => x.localeCompare(y, 'en', { sensitivity: 'base' }));
    if (B !== 'Бүх брэнд' && !bc.has(B)) brands.unshift(B);
    bSel.innerHTML = `<option value="Бүх брэнд">Бүх брэнд (${products.length})</option>` + brands.map(b => `<option value="${esc(b)}">${esc(b)} (${bc.get(b) || 0})</option>`).join('');
    bSel.value = B;
    // 2. categories that this brand has
    const list = (typeof cats !== 'undefined' ? cats : ['Бүгд']).filter(c => c !== 'Бүгд');
    const cc = list.map(c => [c, inBrand.filter(p => catOk(p, c)).length]).filter(([c, n]) => n || c === C);
    cSel.innerHTML = `<option value="Бүгд">${B === 'Бүх брэнд' ? 'Бүх ангилал' : 'Бүх ангилал'} (${inBrand.length})</option>` + cc.map(([c, n]) => `<option value="${esc(c)}">${esc(c)} (${n})</option>`).join('');
    cSel.value = C;
    // 3. sub-categories inside brand + category
    const inCat = inBrand.filter(p => catOk(p, C));
    const sc = new Map(); inCat.forEach(p => subsOf(p).forEach(x => sc.set(x, (sc.get(x) || 0) + 1)));
    const subs = [...sc.keys()].sort((x, y) => x.localeCompare(y, 'mn'));
    if (S && !sc.has(S)) subs.unshift(S);
    sSel.innerHTML = `<option value="">${C === 'Бүгд' ? 'Бүх дэд ангилал' : 'Бүх дэд ангилал'} (${inCat.length})</option>` + subs.map(x => `<option value="${esc(x)}">${esc(x)} (${sc.get(x) || 0})</option>`).join('');
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
})();
