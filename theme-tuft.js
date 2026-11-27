/* «Tuft» preview theme: buddyshop.mn/?theme=tuft turns it on (remembered in this browser),
   ?theme=classic turns it off. Builds the wordmark hero with product «pieces», and adds colour
   dots to product cards. Everything else (cart, checkout, admin, ERP) is the normal site. */
(() => {
  if (!document.documentElement.classList.contains('tuft')) return;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const all = () => (typeof products !== 'undefined' ? products : []);
  const find = id => all().find(p => Number(p.id) === Number(id));

  // collections for the hero: [product id, height in % of the stage]
  const COLLECTIONS = [
    { name: 'Өвлийн загасчлал', note: 'Дулаан, хөнгөн, найдвартай', items: [[17952368008864, 34], [17951594447435, 84], [17952372657345, 36], [747162, 52], [17952375790945, 38]] },
    { name: 'Флай ба вейдер', note: 'Голын эрэг дээр бүтэн өдөр', items: [[724246, 30], [907082, 92], [723048, 44], [907139, 34]] },
    { name: 'Спин', note: 'Дамар, өгөөш, бэлэн', items: [[876487, 60], [887479, 30], [876483, 56], [887446, 32], [726282, 38]] },
  ];

  function img(p) { const u = p && (p.image || (p.images || [])[0]); return u || ''; }

  /* ---------- hero: a rolling 3D ring that carries every in-stock product past the front ----------
     Slots sit on a circle (x = sin, depth = cos) and the circle keeps turning; a slot that reaches the
     back, where it is invisible, picks up the next product from the queue. Drag or swipe spins it.
     The maths is done here per piece instead of with a shared CSS perspective, because a 3D parent
     would isolate the pieces and bring back the white boxes around the photos (mix-blend-mode). */
  const whiteCache = new Map();
  function whiteBg(url) {   // true when all four corners of the photo are (near) white
    if (whiteCache.has(url)) return whiteCache.get(url);
    const pr = new Promise(resolve => {
      const im = new Image(); im.crossOrigin = 'anonymous';
      im.onload = () => {
        try {
          const c = document.createElement('canvas'); c.width = c.height = 24;
          const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(im, 0, 0, 24, 24);
          const ok = [[0, 0], [23, 0], [0, 23], [23, 23], [12, 0]].every(([px, py]) => { const d = x.getImageData(px, py, 1, 1).data; return d[3] < 20 || (d[0] > 236 && d[1] > 236 && d[2] > 236); });
          resolve(ok);
        } catch (e) { resolve(false); }
      };
      im.onerror = () => resolve(false);
      im.src = url;
    });
    whiteCache.set(url, pr); return pr;
  }

  function buildPool() {
    const stock = all().filter(p => p.category !== 'Бэлгийн карт' && img(p) && typeof p.erpQty === 'number' && p.erpQty > 0);
    const seed = COLLECTIONS.flatMap(c => c.items.map(x => find(x[0]))).filter(p => p && img(p));
    const src = stock.length ? stock : seed;
    // one from each category in turn, so the ring is a mix rather than twenty gloves in a row
    const by = new Map(); src.forEach(p => { if (!by.has(p.category)) by.set(p.category, []); by.get(p.category).push(p); });
    const lists = [...by.values()], out = [];
    for (let i = 0; lists.some(l => i < l.length); i++) lists.forEach(l => { if (i < l.length) out.push(l[i]); });
    const first = seed.filter(p => out.includes(p));
    return [...first, ...out.filter(p => !first.includes(p))];
  }

  let ring = null;
  function buildHero() {
    if (ring) { ring.refill(); return; }
    const anchor = document.querySelector('.hero'); if (!anchor) return;
    const sec = document.createElement('section'); sec.className = 'tf-hero tf-ring'; sec.setAttribute('aria-label', 'Бүх бараа');
    const small = matchMedia('(max-width:700px)').matches;
    const N = small ? 7 : 9;
    sec.innerHTML = `<div class="tf-top"><span><b>Buddy Shop</b> · Загас агнуурын дэлгүүр</span><span>Emart Chinggis B1 · Улаанбаатар</span></div>
      <div class="tf-word" aria-hidden="true">BUDDY</div>
      <div class="tf-stage">${Array.from({ length: N }, (_, i) => `<button class="tf-piece" data-slot="${i}" tabindex="-1"><img alt="" draggable="false"></button>`).join('')}</div>
      <div class="tf-foot"><div class="tf-info"><div class="tf-no">001</div><div class="tf-coll"><b>&nbsp;</b><span>&nbsp;</span></div></div>
        <div class="tf-arrows"><button data-step="-1" aria-label="Өмнөх бараа">←</button><button data-step="1" aria-label="Дараагийн бараа">→</button></div>
        <button class="tf-cta" onclick="document.getElementById('catalog').scrollIntoView({behavior:'smooth'})">Бүх бараа ↓</button></div>`;
    anchor.after(sec);
    const stage = sec.querySelector('.tf-stage'), pieces = [...sec.querySelectorAll('.tf-piece')];
    const noEl = sec.querySelector('.tf-no'), collEl = sec.querySelector('.tf-coll'), word = sec.querySelector('.tf-word');
    const STEP = Math.PI * 2 / N, AUTO = -(Math.PI * 2) / (small ? 34 : 46);   // one full turn in ~46 s
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let pool = [], next = 0, ready = [], filling = false;
    const slots = pieces.map(el => ({ el, p: null, idx: 0, fresh: true }));
    let rot = 0, vel = reduce ? 0 : AUTO, hover = false, drag = null, tween = null, front = -1, visible = true, lastT = 0;

    async function fill() {          // keep a few checked products waiting
      if (filling) return; filling = true;
      let guard = 0;
      while (ready.length < 4 && pool.length && guard++ < pool.length) {
        const idx = next % pool.length, p = pool[idx]; next++;
        if (slots.some(s => s.p === p) || ready.some(r => r.p === p)) continue;
        if (await whiteBg(img(p))) ready.push({ p, idx });
      }
      filling = false;
    }
    function put(slot) {
      const r = ready.shift(); if (!r) return false;
      slot.p = r.p; slot.idx = r.idx;
      const im = slot.el.querySelector('img'); im.src = img(r.p);
      slot.el.setAttribute('aria-label', r.p.name);
      fill(); return true;
    }
    async function refill() {
      pool = buildPool(); next = 0; ready = [];
      await fill();
      for (const s of slots) { if (!s.p || !pool.includes(s.p)) { if (!ready.length) await fill(); put(s); } }
    }

    function frame(t) {
      requestAnimationFrame(frame);
      const dt = Math.min(.05, (t - lastT) / 1000 || 0); lastT = t;
      if (!visible || document.hidden) return;
      if (drag && drag.moved) { /* rot follows the finger in pointermove */ }
      else if (tween) {
        const k = Math.min(1, (t - tween.t0) / tween.dur), e = 1 - Math.pow(1 - k, 3);
        rot = tween.from + (tween.to - tween.from) * e; if (k >= 1) { tween = null; vel = 0; }
      } else {
        const target = reduce ? 0 : AUTO * (hover ? .22 : 1);
        vel += (target - vel) * Math.min(1, dt * 1.6); rot += vel * dt;
      }
      if (ready.length < 2) fill();
      const W = stage.clientWidth, R = Math.min(W * (small ? .6 : .43), 600);
      let best = -2, bestI = -1;
      slots.forEach((s, i) => {
        const a = rot + i * STEP, z = Math.cos(a), x = Math.sin(a) * R;
        if (z > best) { best = z; bestI = i; }
        if (!s.p) put(s);                                             // a slot left empty at start-up
        else if (z < -.86) { if (!s.fresh) { s.fresh = put(s) || true; } } else if (z > 0) s.fresh = false;
        const depth = (z + 1) / 2;                                   // 0 back … 1 front
        const sc = .34 + .66 * Math.pow(depth, 1.5);
        const y = -(1 - depth) * (small ? 56 : 96);
        const op = Math.max(0, Math.min(1, (z + .62) / .5));
        const st = s.el.style;
        st.transform = `translate(-50%,0) translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0) perspective(900px) rotateY(${(-Math.sin(a) * 38).toFixed(1)}deg) scale(${sc.toFixed(3)})`;
        st.opacity = s.p ? op.toFixed(2) : '0'; st.zIndex = String(Math.round(z * 100) + 100);
        st.pointerEvents = op > .5 ? 'auto' : 'none';
      });
      if (bestI !== front && slots[bestI].p) {
        front = bestI; const p = slots[bestI].p;
        pieces.forEach((el, i) => el.classList.toggle('front', i === bestI));
        noEl.textContent = String(slots[bestI].idx + 1).padStart(3, '0');
        collEl.innerHTML = `<b>${esc(p.name)}</b><span>${esc(p.brand || '')} · ${typeof money === 'function' ? money(p.price) : p.price}</span>`;
      }
      if (word) word.style.transform = `translate(calc(-50% + ${(Math.sin(rot) * 1.2).toFixed(2)}vw),-56%)`;
    }

    const stepBy = d => { const from = rot, to = (Math.round(rot / STEP) - d) * STEP; tween = { from, to, t0: performance.now(), dur: 900 }; };
    sec.addEventListener('click', e => { const b = e.target.closest('[data-step]'); if (b) stepBy(Number(b.dataset.step)); });
    sec.addEventListener('mouseenter', () => { hover = true; }); sec.addEventListener('mouseleave', () => { hover = false; });
    stage.addEventListener('pointerdown', e => { drag = { x: e.clientX, rot, moved: false, t: performance.now(), lx: e.clientX, v: 0, target: e.target.closest('.tf-piece') }; tween = null; });
    window.addEventListener('pointermove', e => {
      if (!drag) return;
      const dx = e.clientX - drag.x;
      if (!drag.moved && Math.abs(dx) > 6) { drag.moved = true; sec.classList.add('dragging'); }
      if (!drag.moved) return;
      const R = Math.min(stage.clientWidth * (small ? .6 : .43), 600), now = performance.now();
      rot = drag.rot + dx / R;
      drag.v = (e.clientX - drag.lx) / R / Math.max(.008, (now - drag.t) / 1000); drag.lx = e.clientX; drag.t = now;
    }, { passive: true });
    const end = e => {
      if (!drag) return; const d = drag; drag = null; sec.classList.remove('dragging');
      if (d.moved) { vel = Math.max(-5, Math.min(5, d.v)); return; }
      const sl = d.target && slots[Number(d.target.dataset.slot)];
      if (sl && sl.p && e.type === 'pointerup') openProduct(Number(sl.p.id));
    };
    window.addEventListener('pointerup', end); window.addEventListener('pointercancel', end);
    sec.addEventListener('keydown', e => { if (e.key === 'ArrowRight') stepBy(1); if (e.key === 'ArrowLeft') stepBy(-1); });
    new IntersectionObserver(es => { visible = es[0].isIntersecting; }).observe(sec);

    ring = { refill };
    refill(); requestAnimationFrame(frame);
  }

  // colour dots / size count under each card
  const PALETTE = { black: '#1d1d1d', blk: '#1d1d1d', green: '#5d7a52', olive: '#6b6b45', grey: '#8d8f91', gray: '#8d8f91', blue: '#3e6aa8', red: '#b4372f', orange: '#d37a2f', brown: '#7a5236', tan: '#c3a77b', khaki: '#a39a6c', yellow: '#d9b43a', white: '#f4f2ee', pink: '#d99aa5', camo: '#6d6b4b', navy: '#24324a', silver: '#c4c6c8', gold: '#c9a54a', amber: '#c98a2b', rust: '#9c4a2a', sand: '#d6c6a2' };
  function dotsFor(p) {
    const labels = Array.isArray(p.sizes) && p.sizes.length ? p.sizes.map(s => s.label) : (p.colorOptions || []).map(o => o.name || o.code);
    if (!labels.length) return '';
    const cols = [...new Set(labels.map(l => { const k = Object.keys(PALETTE).find(c => new RegExp('\\b' + c, 'i').test(String(l))); return k && PALETTE[k]; }).filter(Boolean))].slice(0, 5);
    const word = p.sizeTitle === 'Өнгө' || (p.colorOptions || []).length ? 'өнгө' : (p.sizeTitle === 'Сонголт' ? 'сонголт' : 'хэмжээ');
    return `<div class="tf-sw">${cols.map(c => `<i style="background:${c}"></i>`).join('')}<span>${labels.length} ${word}</span></div>`;
  }
  function decorate() {
    document.querySelectorAll('.product').forEach(card => {
      if (card.querySelector('.tf-sw')) return;
      const m = (card.querySelector('[onclick*="openProduct("]')?.getAttribute('onclick') || '').match(/openProduct\((\d+)\)/);
      const p = m && find(m[1]); if (!p) return;
      const html = dotsFor(p); if (!html) return;
      (card.querySelector('.price') || card.querySelector('h3'))?.insertAdjacentHTML('afterend', html);
    });
  }
  new MutationObserver(() => decorate()).observe(document.body, { childList: true, subtree: true });


  // 3D tilt on product photos: cards and the product window lean toward the pointer (or finger)
  (() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let el = null, raf = 0, last = null;
    const SEL = '.product-image, .detail-gallery-main';
    const apply = () => {
      raf = 0; if (!el || !last) return;
      const r = el.getBoundingClientRect();
      const px = Math.max(-.5, Math.min(.5, (last.x - r.left) / r.width - .5));
      const py = Math.max(-.5, Math.min(.5, (last.y - r.top) / r.height - .5));
      el.style.setProperty('--px', px.toFixed(3)); el.style.setProperty('--py', py.toFixed(3));
    };
    const release = t => { if (!t) return; t.classList.remove('tf-tilt'); t.style.setProperty('--px', 0); t.style.setProperty('--py', 0); };
    document.addEventListener('pointermove', e => {
      const t = e.target.closest && e.target.closest(SEL);
      if (t !== el) { release(el); el = t; }
      if (!el) return;
      // phones: only the big photo in the product window follows the finger (cards keep scrolling free)
      if (e.pointerType !== 'mouse' && !el.classList.contains('detail-gallery-main')) { el = null; return; }
      el.classList.add('tf-tilt'); last = { x: e.clientX, y: e.clientY };
      if (!raf) raf = requestAnimationFrame(apply);
    }, { passive: true });
    document.addEventListener('pointerleave', () => { release(el); el = null; }, true);
    document.addEventListener('pointerup', e => { if (e.pointerType !== 'mouse') { release(el); el = null; } }, { passive: true });
    document.addEventListener('pointercancel', () => { release(el); el = null; }, { passive: true });
    document.addEventListener('scroll', () => { if (el) { release(el); el = null; } }, { passive: true, capture: true });
  })();

  function badge() {
    if (document.querySelector('.tf-badge')) return;
    const d = document.createElement('div'); d.className = 'tf-badge';
    d.innerHTML = 'Шинэ загвар · туршилт <a href="?theme=classic">Хуучин руу буцах</a>';
    document.body.prepend(d);
  }

  const start = () => { buildHero(); decorate(); badge(); };
  start();
  document.addEventListener('buddy:synced', () => { buildHero(); decorate(); });
})();
