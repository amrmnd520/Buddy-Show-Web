/* Prices and Emart stock from the Odoo ERP (via buddy-shop-api /api/erp, refreshed every 15 min).
   - Products are matched by their code (p.code). A row with several codes ("1623118 1623120")
     adds up the stock of all of them; the price comes from the first code that has one.
   - Price and stock from the ERP always win over catalog.js and admin edits.
   - Out-of-stock products still look normal in lists. Inside the product page the order
     area shows "Үлдэгдэлгүй" and the cart button is disabled. */
(() => {
  const API = String(window.BUDDY_API || '').replace(/\/+$/, '');
  if (!API) return;
  let erp = null;            // { CODE: [price, qty] }
  let loading = null;

  const codesOf = p => String(p.code || '').trim().toUpperCase().split(/\s+/).filter(Boolean);
  const erpQty = p => (p && typeof p.erpQty === 'number') ? p.erpQty : null;
  const noStock = p => erpQty(p) === 0;

  function load() {
    if (!loading) loading = fetch(API + '/api/erp').then(r => r.ok ? r.json() : null)
      .then(d => { erp = d && d.items && Object.keys(d.items).length ? d.items : null; window.BUDDY_ERP_UPDATED = d && d.updatedAt; })
      .catch(() => { erp = null; });
    return loading;
  }

  // Called by shop-sync.js after staff changes are applied and BEFORE it takes its
  // "saved" snapshot, so ERP values are never mistaken for unsaved staff edits.
  window.applyErp = async function (list) {
    await load();
    if (!erp) return 0;
    let n = 0;
    for (const p of list) {
      const hits = codesOf(p).map(c => erp[c]).filter(Boolean);
      if (!hits.length) continue;
      const price = (hits.find(h => h[0] > 0) || [0])[0];
      const qty = hits.reduce((s, h) => s + h[1], 0);
      if (price > 0) { p.price = price; p.regularPrice = price; }
      p.stock = qty; p.erpQty = qty;
      n++;
    }
    return n;
  };

  /* ---------- product page: "Үлдэгдэлгүй" ---------- */
  const st = document.createElement('style');
  st.textContent = '.erp-nostock-note{display:inline-block;background:#5a6a72;color:#fff;font-weight:700;padding:6px 12px;border-radius:4px;margin:0 0 10px;letter-spacing:.3px}' +
    '.add.erp-nostock{background:#9aa6ac!important;cursor:not-allowed}';
  document.head.appendChild(st);

  const findP = id => (typeof products !== 'undefined' ? products : []).find(x => Number(x.id) === Number(id));

  if (typeof openProduct === 'function') {
    const prevOpen = openProduct;
    openProduct = function (id) {
      prevOpen(id);
      const p = findP(id);
      const box0 = document.getElementById('detail-content');
      if (box0 && erpQty(p) !== null) box0.querySelectorAll('p,div,small,span').forEach(el => {
        if (!el.children.length && /импортолсон/.test(el.textContent)) el.textContent = 'Үнэ, үлдэгдэл ERP-ээс автоматаар шинэчлэгддэг.';
      });
      if (!noStock(p)) return;
      const box = document.getElementById('detail-content'); if (!box) return;
      if (box.querySelector('.detail-sold-note')) return; // already marked "Дууссан" by staff
      box.querySelector('.price')?.insertAdjacentHTML('beforebegin', '<div class="erp-nostock-note">Үлдэгдэлгүй</div>');
      box.querySelectorAll('.add').forEach(b => { if (/Сагсанд/.test(b.textContent)) { b.textContent = 'Үлдэгдэлгүй'; b.disabled = true; b.classList.add('erp-nostock'); } });
    };
  }
  if (typeof add === 'function') {
    const prevAdd = add;
    add = function (id) { if (noStock(findP(id))) return openProduct(id); return prevAdd(id); };
  }
  if (typeof addDetailProduct === 'function') {
    const prevDetail = addDetailProduct;
    addDetailProduct = function () { if (typeof detailProductId !== 'undefined' && noStock(findP(detailProductId))) return; return prevDetail(); };
  }

  load();
})();
