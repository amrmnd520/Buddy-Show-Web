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
    try { return prev.apply(this, a); }
    finally {
      products = full;
      const c = document.getElementById('catalog-count');
      if (c && only && soldOut) c.textContent = c.textContent.replace(/·\s*Нийт\s*\d+/, `· ${soldOut} дууссан бараа нуугдсан`);
    }
  };
  render();
})();
