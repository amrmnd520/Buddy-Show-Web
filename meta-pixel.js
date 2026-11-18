/* Meta Pixel (dataset «Buddy Shop Website») — feeds the Facebook / Instagram catalogue ads.
   Events, with content_ids that match the catalogue feed (buddy-shop-api /feed/facebook.csv):
     PageView          every visit
     ViewContent       product page opened (sized products: the whole product group)
     AddToCart         an item lands in the cart (sized items: "<id>-<size>", the feed's own id)
     InitiateCheckout  «Захиалга өгөх →» in the cart
     Purchase          order completed (the "✅" screen), once per order number
   Signed-in staff are not tracked. Loaded last, so it wraps the final versions of the shop functions. */
(() => {
  const PIXEL_ID = '2270696457123299';
  const isStaff = () => { try { return !!localStorage.getItem('buddyshop_api_token'); } catch (e) { return false; } };
  if (isStaff()) return;

  /* Meta's base code */
  !function (f, b, e, v, n, t, s) {
    if (f.fbq) return; n = f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); };
    if (!f._fbq) f._fbq = n; n.push = n; n.loaded = !0; n.version = '2.0'; n.queue = [];
    t = b.createElement(e); t.async = !0; t.src = v; s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s);
  }(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
  fbq('init', PIXEL_ID);
  fbq('track', 'PageView');

  const CUR = 'MNT';
  const list = () => (typeof products !== 'undefined' ? products : []);
  const findP = id => list().find(p => Number(p.id) === Number(id));
  const hasSizes = p => p && Array.isArray(p.sizes) && p.sizes.length > 0;
  const itemId = it => (it.size ? `${it.id}-${it.size}` : String(it.id));
  const track = (ev, data) => { try { if (!isStaff()) fbq('track', ev, data); } catch (e) {} };

  const wrap = (name, after) => {
    if (typeof window[name] !== 'function') return;
    const prev = window[name];
    window[name] = function (...a) {
      const before = typeof cart !== 'undefined' ? cart.length : 0;
      const out = prev.apply(this, a);
      try { after(a, before); } catch (e) {}
      return out;
    };
  };

  wrap('openProduct', ([id]) => {
    const p = findP(id); if (!p) return;
    track('ViewContent', {
      content_ids: [String(p.id)], content_type: hasSizes(p) ? 'product_group' : 'product',
      content_name: p.name, content_category: p.category, value: Number(p.price) || 0, currency: CUR,
    });
  });

  const added = (before) => {
    if (typeof cart === 'undefined' || cart.length <= before) return;
    const it = cart[cart.length - 1], p = findP(it.id);
    const price = Number(it.price || it.unitPrice) || (p && Number(p.price)) || 0;
    track('AddToCart', { content_ids: [itemId(it)], content_type: 'product', content_name: p ? p.name : undefined, value: price, currency: CUR });
  };
  wrap('add', (_, before) => added(before));
  wrap('addDetailProduct', (_, before) => added(before));

  document.addEventListener('click', e => {
    if (!e.target.closest || !e.target.closest('[data-co="checkout"]') || typeof cart === 'undefined' || !cart.length) return;
    const value = cart.reduce((s, it) => s + ((Number(it.price || it.unitPrice) || (findP(it.id) || {}).price || 0) * (Number(it.qty) || 1)), 0);
    track('InitiateCheckout', { content_ids: cart.map(itemId), content_type: 'product', num_items: cart.length, value, currency: CUR });
  }, true);

  /* Purchase: remember the order the API returns, report it once the "✅" screen shows */
  let lastOrder = null;
  const reported = new Set();
  const realFetch = window.fetch;
  window.fetch = function (input, init) {
    const p = realFetch.apply(this, arguments);
    try {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      if (/\/api\/orders\/?$/.test(url) && init && String(init.method || '').toUpperCase() === 'POST') {
        p.then(r => r.ok && r.clone().json().then(d => { if (d && d.order) lastOrder = d.order; })).catch(() => {});
      }
    } catch (e) {}
    return p;
  };
  new MutationObserver(() => {
    const o = lastOrder;
    if (!o || reported.has(o.number) || !document.querySelector('.co-ok')) return;
    reported.add(o.number);
    const items = Array.isArray(o.items) ? o.items : [];
    track('Purchase', {
      content_ids: items.map(itemId), content_type: 'product',
      contents: items.map(i => ({ id: itemId(i), quantity: Number(i.qty) || 1, item_price: Number(i.price) || 0 })),
      num_items: items.reduce((s, i) => s + (Number(i.qty) || 1), 0), value: Number(o.total) || 0, currency: CUR,
    });
  }).observe(document.body, { childList: true, subtree: true });
})();
