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

  // ---- what the ring shows: categories → sub-categories → products ----
  const inCat = (p, c) => (typeof categoryMatches === 'function' ? categoryMatches(p, c) : p.category === c);
  const subsOf = p => (typeof productSubcategories === 'function' ? productSubcategories(p) : []);
  const sellable = list => { const s = list.filter(p => typeof p.erpQty === 'number' && p.erpQty > 0); return s.length ? s : list; };
  const pick = (c, sub) => all().filter(p => p.category !== 'Бэлгийн карт' && img(p) && (!c || inCat(p, c)) && (!sub || subsOf(p).includes(sub)));
  function mixed(src) {     // one from each sub-group in turn, so it is a mix rather than twenty gloves in a row
    const by = new Map(); src.forEach(p => { const k = p.category + '|' + (subsOf(p)[0] || ''); if (!by.has(k)) by.set(k, []); by.get(k).push(p); });
    const lists = [...by.values()], out = [];
    for (let i = 0; lists.some(l => i < l.length); i++) lists.forEach(l => { if (i < l.length) out.push(l[i]); });
    return out;
  }
  async function rep(list, used) {   // a photo on white to stand for a group
    for (const p of sellable(list).slice(0, 40)) { if (used && used.has(img(p))) continue; if (await whiteBg(img(p))) { used && used.add(img(p)); return img(p); } }
    return '';
  }
  const count = list => sellable(list).length;
  async function itemsFor(path) {
    if (!path.cat) {
      const names = (typeof cats !== 'undefined' ? cats : []).filter(c => c !== 'Бүгд' && c !== 'Бэлгийн карт');
      const used = new Set(), out = [];
      for (const c of names) { const l = pick(c); if (!l.length) continue; const im = await rep(l, used); if (im) out.push({ kind: 'cat', key: 'c:' + c, label: c, note: count(l) + ' бараа', img: im, n: count(l), go: { cat: c, sub: null, all: false } }); }
      return out;
    }
    const list = pick(path.cat);
    const subs = [...new Set(list.flatMap(subsOf))];
    if (!path.sub && !path.all && subs.length > 1) {
      const used = new Set(), out = [];
      const allImg = await rep(list, used);
      if (allImg) out.push({ kind: 'sub', key: 's:*', label: 'Бүгд', note: path.cat + ' · ' + count(list) + ' бараа', img: allImg, n: count(list), go: { cat: path.cat, sub: null, all: true } });
      const scored = subs.map(x => [x, pick(path.cat, x)]).sort((x, y) => count(y[1]) - count(x[1]));
      for (const [x, l] of scored) { const im = await rep(l, used); if (im) out.push({ kind: 'sub', key: 's:' + x, label: x, note: count(l) + ' бараа', img: im, n: count(l), go: { cat: path.cat, sub: x, all: false } }); }
      return out;
    }
    return mixed(sellable(pick(path.cat, path.sub))).map(p => ({ kind: 'prod', key: 'p:' + p.id, label: p.name, note: (p.brand || '') + ' · ' + (typeof money === 'function' ? money(p.price) : p.price), img: img(p), p }));
  }
  // keep the product list below in step with the ring (no scrolling)
  function syncFilters(path) {
    try {
      const $ = id => document.getElementById(id); if (!$('category')) return;
      try { sidebarCategory = ''; } catch (e) {}
      $('search').value = ''; $('brand').value = 'Бүх брэнд'; $('subcategory').value = '';
      syncFacets('brand'); $('category').value = path.cat || 'Бүгд'; syncFacets('category');
      if (path.sub) { $('subcategory').value = path.sub; syncFacets('subcategory'); }
      render();
    } catch (e) {}
  }

  let ring = null;
  function buildHero() {
    if (ring) { ring.reload(); return; }
    const anchor = document.querySelector('.hero'); if (!anchor) return;
    const sec = document.createElement('section'); sec.className = 'tf-hero tf-ring'; sec.setAttribute('aria-label', 'Ангилал ба бараа');
    const small = matchMedia('(max-width:700px)').matches;
    const N = small ? 7 : 9;
    sec.innerHTML = `<div class="tf-top"><span class="tf-path"></span><span>Emart Chinggis B1 · Улаанбаатар</span></div>
      <div class="tf-word" aria-hidden="true">BUDDY</div>
      <div class="tf-stage">${Array.from({ length: 12 }, (_, i) => `<button class="tf-piece" data-slot="${i}" tabindex="-1"><img alt="" draggable="false"><span class="tf-label"></span></button>`).join('')}</div>
      <div class="tf-foot"><div class="tf-info"><div class="tf-no">&nbsp;</div><div class="tf-coll"><b>&nbsp;</b><span>&nbsp;</span></div></div>
        <div class="tf-arrows"><button data-step="-1" aria-label="Өмнөх">←</button><button data-step="1" aria-label="Дараагийн">→</button></div>
        <button class="tf-cta" onclick="document.getElementById('catalog').scrollIntoView({behavior:'smooth'})">Жагсаалтаар харах ↓</button></div>`;
    anchor.after(sec);
    const stage = sec.querySelector('.tf-stage'), pieces = [...sec.querySelectorAll('.tf-piece')];
    const noEl = sec.querySelector('.tf-no'), collEl = sec.querySelector('.tf-coll'), word = sec.querySelector('.tf-word'), pathEl = sec.querySelector('.tf-path');
    const AUTO = -(Math.PI * 2) / (small ? 34 : 46);   // one full turn in ~46 s
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let path = { cat: null, sub: null, all: false };
    let pool = [], next = 0, ready = [], filling = false, n = N, STEP = Math.PI * 2 / N, gen = 0;
    const slots = pieces.map(el => ({ el, it: null, idx: 0, fresh: true }));
    let rot = 0, vel = reduce ? 0 : AUTO, hover = false, drag = null, tween = null, front = -1, visible = true, lastT = 0, fade = 0, fadeTo = 1;

    async function fill() {          // keep a few checked items waiting
      if (filling || pool.length <= n) return; filling = true; const g = gen;
      let guard = 0;
      while (g === gen && ready.length < 4 && guard++ < pool.length) {
        const idx = next % pool.length, it = pool[idx]; next++;
        if (slots.some(s => s.it === it) || ready.some(r => r.it === it)) continue;
        if (it.kind !== 'prod' || await whiteBg(it.img)) { if (g === gen) ready.push({ it, idx }); }
      }
      filling = false;
    }
    function set(slot, it, idx) {
      slot.it = it; slot.idx = idx;
      slot.el.querySelector('img').src = it.img;
      slot.el.querySelector('.tf-label').textContent = it.kind === 'prod' ? '' : it.label;
      slot.el.classList.toggle('group', it.kind !== 'prod');
      slot.el.setAttribute('aria-label', it.label);
    }
    function put(slot) { const r = ready.shift(); if (!r) return false; set(slot, r.it, r.idx); fill(); return true; }

    function crumbs() {
      const parts = [`<button data-path="root">Ангилал</button>`];
      if (path.cat) parts.push(`<button data-path="cat">${esc(path.cat)}</button>`);
      if (path.sub) parts.push(`<b>${esc(path.sub)}</b>`); else if (path.cat && path.all) parts.push('<b>Бүгд</b>');
      pathEl.innerHTML = (path.cat ? '<button class="tf-back" data-path="up" aria-label="Буцах">←</button>' : '') + parts.join('<i>›</i>');
    }
    async function load(newPath, quiet) {
      const g = ++gen; if (newPath) path = newPath;
      if (!quiet) { fadeTo = 0; await new Promise(r => setTimeout(r, 380)); }
      let items = await itemsFor(path);
      if (g !== gen) return;
      if (!items.length && path.cat) { path = { cat: null, sub: null, all: false }; items = await itemsFor(path); if (g !== gen) return; }
      pool = items; next = 0; ready = []; filling = false; front = -1;
      // groups (categories, sub-categories) all sit on the ring at once, up to 12; products roll through N places
      n = Math.max(1, Math.min(pool[0] && pool[0].kind !== 'prod' ? 12 : N, pool.length)); STEP = Math.PI * 2 / n;
      slots.forEach(s => { s.it = null; s.fresh = true; });
      if (pool.length <= n) pool.forEach((it, i) => set(slots[i], it, i));     // few: all of them sit on the ring
      else { next = 0; await fill(); for (let i = 0; i < n; i++) { if (!ready.length) await fill(); if (g !== gen) return; put(slots[i]); } }
      crumbs();
      if (!quiet) { rot = STEP * 1.6; vel = reduce ? 0 : AUTO * 9; }           // the new set spins in
      fadeTo = 1;
    }
    const enter = it => { if (it.kind === 'prod') return openProduct(Number(it.p.id)); syncFilters(it.go); load(it.go); };
    const up = to => {
      const p = to !== 'root' && (to === 'cat' || path.sub || path.all) ? { cat: path.cat, sub: null, all: false } : { cat: null, sub: null, all: false };
      syncFilters(p); load(p);
    };

    function frame(t) {
      requestAnimationFrame(frame);
      const dt = Math.min(.05, (t - lastT) / 1000 || 0); lastT = t;
      if (!visible || document.hidden) return;
      fade += (fadeTo - fade) * Math.min(1, dt * 7);
      if (drag && drag.moved) { /* rot follows the finger in pointermove */ }
      else if (tween) {
        const k = Math.min(1, (t - tween.t0) / tween.dur), e = 1 - Math.pow(1 - k, 3);
        rot = tween.from + (tween.to - tween.from) * e; if (k >= 1) { tween = null; vel = 0; }
      } else {
        const target = reduce ? 0 : AUTO * (hover ? .22 : 1) * (n < 3 ? .5 : 1);
        vel += (target - vel) * Math.min(1, dt * 1.6); rot += vel * dt;
      }
      if (ready.length < 2) fill();
      const W = stage.clientWidth, R = Math.min(W * (small ? .6 : .43), 600) * (n < 4 ? .7 : 1);
      let best = -2, bestI = -1;
      slots.forEach((s, i) => {
        const st = s.el.style;
        if (i >= n) { st.opacity = '0'; st.pointerEvents = 'none'; return; }
        const a = rot + i * STEP, z = Math.cos(a), x = Math.sin(a) * R;
        if (z > best && s.it) { best = z; bestI = i; }
        if (pool.length > n) {
          if (!s.it) put(s);
          else if (z < -.86) { if (!s.fresh) { s.fresh = put(s) || true; } } else if (z > 0) s.fresh = false;
        }
        const depth = (z + 1) / 2;                                   // 0 back … 1 front
        const sc = .34 + .66 * Math.pow(depth, 1.5);
        const y = -(1 - depth) * (small ? 56 : 96);
        const op = Math.max(0, Math.min(1, (z + .62) / .5)) * fade;
        st.transform = `translate(-50%,0) translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0) perspective(900px) rotateY(${(-Math.sin(a) * 38).toFixed(1)}deg) scale(${sc.toFixed(3)})`;
        st.opacity = s.it ? op.toFixed(2) : '0'; st.zIndex = String(Math.round(z * 100) + 100);
        st.pointerEvents = op > .5 ? 'auto' : 'none';
      });
      if (bestI >= 0 && (bestI !== front || slots[bestI].it !== frame.last)) {
        front = bestI; const it = slots[bestI].it; frame.last = it;
        pieces.forEach((el, i) => el.classList.toggle('front', i === bestI));
        noEl.textContent = it.kind === 'prod' ? String(slots[bestI].idx + 1).padStart(3, '0') + ' / ' + pool.length : String(it.n);
        collEl.innerHTML = `<b>${esc(it.label)}</b><span>${esc(it.note)}${it.kind === 'prod' ? '' : ' · дарж нээнэ'}</span>`;
      }
      if (word) word.style.transform = `translate(calc(-50% + ${(Math.sin(rot) * 1.2).toFixed(2)}vw),${small ? '-50%' : '-56%'})`;
    }

    const stepBy = d => { const from = rot, to = (Math.round(rot / STEP) - d) * STEP; tween = { from, to, t0: performance.now(), dur: 900 }; };
    sec.addEventListener('click', e => {
      const b = e.target.closest('[data-step]'); if (b) return stepBy(Number(b.dataset.step));
      const c = e.target.closest('[data-path]'); if (c) return up(c.dataset.path === 'root' ? 'root' : c.dataset.path === 'cat' ? 'cat' : 'up');
    });
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
      if (sl && sl.it && e.type === 'pointerup') enter(sl.it);
    };
    window.addEventListener('pointerup', end); window.addEventListener('pointercancel', end);
    sec.addEventListener('keydown', e => { if (e.key === 'ArrowRight') stepBy(1); if (e.key === 'ArrowLeft') stepBy(-1); if (e.key === 'Escape' && path.cat) up('up'); });
    new IntersectionObserver(es => { visible = es[0].isIntersecting; }).observe(sec);

    ring = { reload: () => load(null, true) };
    load(null, true); requestAnimationFrame(frame);
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
