/* Product links: https://buddyshop.mn/?p=<id> opens that product.
   - Old shop links (/products/<shop>/<id>, from Google) are sent here by _redirects.
   - Opening a product puts its link in the address bar (so it can be shared); closing it restores the page. */
(() => {
  if (typeof openProduct !== 'function') return;
  const baseTitle = document.title;
  const dlg = document.getElementById('product-detail');
  const find = id => (typeof products !== 'undefined' ? products : []).find(p => Number(p.id) === Number(id));
  const setUrl = (q) => { try { history.replaceState(history.state, '', location.pathname + q + (location.hash === '#admin' ? '#admin' : '')); } catch (e) {} };

  const prev = window.openProduct;
  window.openProduct = function (id, ...rest) {
    const r = prev.call(this, id, ...rest);
    const p = find(id);
    if (p) { setUrl('?p=' + Number(p.id)); document.title = `${p.name} — Buddy Shop`; }
    return r;
  };
  if (dlg) dlg.addEventListener('close', () => {
    if (new URLSearchParams(location.search).has('p')) setUrl('');
    document.title = baseTitle;
  });

  // ?p=123 or #p=123 on arrival
  const want = new URLSearchParams(location.search).get('p') || (location.hash.match(/^#p=(\d+)/) || [])[1];
  if (!want) return;
  let tries = 0;
  (function go() {
    if (find(want)) {
      const cat = document.getElementById('catalog');
      if (cat) cat.scrollIntoView();
      window.openProduct(Number(want));
    } else if (++tries < 40) setTimeout(go, 250);
    else setUrl('');
  })();
})();
