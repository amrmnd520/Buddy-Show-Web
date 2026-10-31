/* Anonymous visitor statistics for the admin "Зочдын хяналт" panel.
   Sends small events to buddy-shop-api POST /api/t: page opened, product viewed, search
   (with the number of results), category chosen, added to cart, cart opened.
   A visitor is a random id kept only in this browser — no name, account or IP is stored.
   Signed-in staff are not counted. */
(() => {
  const API = String(window.BUDDY_API || '').replace(/\/+$/, '');
  if (!API) return;
  const ls = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } };
  const isStaff = () => !!ls('buddyshop_api_token');
  let vid = ls('bs_vid');
  if (!vid) { vid = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()) + Date.now()).replace(/[^a-z0-9]/gi, '').slice(0, 20); ls('bs_vid', vid); }
  vid = vid || Math.random().toString(36).slice(2, 14);

  let queue = [], timer = null;
  function flush() {
    if (isStaff()) { queue = []; return; } // signed in meanwhile: staff are not counted
    if (!queue.length) return;
    const body = JSON.stringify(queue.splice(0, 20));
    const blob = new Blob([body], { type: 'text/plain' }); // text/plain: no CORS pre-flight
    if (!(navigator.sendBeacon && navigator.sendBeacon(API + '/api/t', blob))) {
      fetch(API + '/api/t', { method: 'POST', body, keepalive: true, headers: { 'content-type': 'text/plain' } }).catch(() => {});
    }
    if (queue.length) flush();
  }
  function send(e) {
    if (isStaff()) return;
    queue.push(Object.assign({ v: vid }, e));
    clearTimeout(timer); timer = setTimeout(flush, 3000);
    if (queue.length >= 15) flush();
  }
  addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });

  // where the visitor came from
  let ref = '';
  try {
    const u = new URL(location.href);
    ref = u.searchParams.get('utm_source') || u.searchParams.get('fbclid') && 'facebook' || '';
    if (!ref && document.referrer) { const h = new URL(document.referrer).hostname.replace(/^www\.|^m\.|^l\./, ''); if (h && h !== location.hostname) ref = h; }
  } catch (e) {}
  send({ t: 'pv', r: ref || null });

  const wrap = (name, after) => {
    if (typeof window[name] !== 'function') return;
    const prev = window[name];
    window[name] = function (...a) { const before = typeof cart !== 'undefined' ? cart.length : 0; const out = prev.apply(this, a); try { after(a, before); } catch (e) {} return out; };
  };
  wrap('openProduct', ([id]) => send({ t: 'view', p: Number(id) }));
  const cartAdded = (before) => { if (typeof cart === 'undefined' || cart.length <= before) return; const it = cart[cart.length - 1]; send({ t: 'cart', p: Number(it.id), z: it.size || it.colorCode || null }); };
  wrap('add', (_, before) => cartAdded(before));
  wrap('addDetailProduct', (_, before) => cartAdded(before));
  wrap('showCart', () => send({ t: 'cartopen' }));
  wrap('choose', ([c]) => c && c !== 'Бүгд' && send({ t: 'cat', c }));
  wrap('quickCategory', () => { const c = document.getElementById('category')?.value; if (c && c !== 'Бүгд') send({ t: 'cat', c }); });
  wrap('selectSidebarCategory', ([c]) => c && send({ t: 'cat', c }));
  wrap('browseBrand', ([b]) => b && send({ t: 'cat', c: 'Брэнд: ' + b }));

  // searches: record what people typed once they stop typing, with how many products matched
  const box = document.getElementById('search');
  let st = null, last = '';
  box && box.addEventListener('input', () => {
    clearTimeout(st);
    st = setTimeout(() => {
      const q = box.value.trim().toLowerCase();
      if (q.length < 2 || q === last) return;
      last = q;
      const n = typeof products !== 'undefined' ? products.filter(p => (p.name + ' ' + p.brand + ' ' + p.subcategory + ' ' + (p.code || '')).toLowerCase().includes(q)).length : null;
      send({ t: 'search', q, n });
    }, 1200);
  });
})();
