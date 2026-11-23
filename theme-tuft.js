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

  function buildHero() {
    if (document.querySelector('.tf-hero')) return;
    const anchor = document.querySelector('.hero'); if (!anchor) return;
    const sec = document.createElement('section'); sec.className = 'tf-hero'; sec.setAttribute('aria-label', 'Онцлох цуглуулга');
    const slides = COLLECTIONS.map((c, i) => {
      const pieces = c.items.map(([id, h], k) => {
        const p = find(id); if (!p || !img(p)) return '';
        return `<button class="tf-piece" style="--h:${h}%;--k:${k};--z:${(0.5 + (k % 3) * 0.35).toFixed(2)}" onclick="openProduct(${Number(p.id)})" aria-label="${esc(p.name)}"><img src="${esc(img(p))}" alt="" style="height:100%"><span class="tf-tag">${esc(p.name)} · ${typeof money === 'function' ? money(p.price) : p.price}</span></button>`;
      }).join('');
      return `<div class="tf-slide" data-i="${i}">${pieces}</div>`;
    }).join('');
    sec.innerHTML = `<div class="tf-top"><span><b>Buddy Shop</b> · Загас агнуурын дэлгүүр</span><span>Emart Chinggis B1 · Улаанбаатар</span></div>
      <div class="tf-word" aria-hidden="true">BUDDY</div>
      <div class="tf-stage">${slides}</div>
      <div class="tf-foot"><div><div class="tf-no">01</div><div class="tf-coll"><b>${esc(COLLECTIONS[0].name)}</b><span>${esc(COLLECTIONS[0].note)}</span></div></div>
        <div class="tf-dots">${COLLECTIONS.map((c, i) => `<button aria-label="${esc(c.name)}" class="${i === 0 ? 'on' : ''}" data-go="${i}"></button>`).join('')}</div>
        <button class="tf-cta" onclick="document.getElementById('catalog').scrollIntoView({behavior:'smooth'})">Бүх бараа ↓</button></div>`;
    anchor.after(sec);
    requestAnimationFrame(() => requestAnimationFrame(() => sec.querySelector('.tf-slide[data-i="0"]').classList.add('on')));
    let cur = 0, timer;
    let busy = 0;
    const show = (i, dir) => {
      const next = (i + COLLECTIONS.length) % COLLECTIONS.length;
      if (next === cur) return;
      const back = dir != null ? dir < 0 : (next < cur && !(cur === COLLECTIONS.length - 1 && next === 0)) || (cur === 0 && next === COLLECTIONS.length - 1);
      sec.classList.toggle('back', back);
      const old = sec.querySelector(`.tf-slide[data-i="${cur}"]`), neu = sec.querySelector(`.tf-slide[data-i="${next}"]`);
      sec.querySelectorAll('.tf-slide.out').forEach(s => s.classList.remove('out'));
      // start the new set from its side before turning it in
      neu.classList.remove('on'); void neu.offsetWidth;
      old.classList.remove('on'); old.classList.add('out');
      requestAnimationFrame(() => neu.classList.add('on'));
      clearTimeout(busy); busy = setTimeout(() => old.classList.remove("out"), 1500);
      sec.classList.add('moving'); setTimeout(() => sec.classList.remove('moving'), 900);
      cur = next;
      sec.querySelectorAll('.tf-dots button').forEach(b => b.classList.toggle('on', Number(b.dataset.go) === cur));
      sec.querySelector('.tf-no').textContent = String(cur + 1).padStart(2, '0');
      sec.querySelector('.tf-coll').innerHTML = `<b>${esc(COLLECTIONS[cur].name)}</b><span>${esc(COLLECTIONS[cur].note)}</span>`;
      const w = sec.querySelector('.tf-word'); if (w) w.style.transform = `translate(calc(-50% + ${(back ? 1 : -1) * 2}vw),-56%)`;
      setTimeout(() => { if (w) w.style.transform = ''; }, 700);
    };
    // the pieces lean a little toward the pointer
    sec.addEventListener('pointermove', e => {
      if (e.pointerType !== 'mouse') return;
      const r = sec.getBoundingClientRect();
      sec.style.setProperty('--mx', ((e.clientX - r.left) / r.width - .5).toFixed(3));
      sec.style.setProperty('--my', ((e.clientY - r.top) / r.height - .5).toFixed(3));
    });
    sec.addEventListener('pointerleave', () => { sec.style.setProperty('--mx', 0); sec.style.setProperty('--my', 0); });
    const auto = () => { clearInterval(timer); if (!matchMedia('(prefers-reduced-motion: reduce)').matches) timer = setInterval(() => show(cur + 1, 1), 6000); };
    sec.addEventListener('click', e => { const b = e.target.closest('[data-go]'); if (b) { const g = Number(b.dataset.go); show(g, g < cur ? -1 : 1); auto(); } });
    let x0 = null;
    sec.addEventListener('touchstart', e => { x0 = e.touches[0].clientX; }, { passive: true });
    sec.addEventListener('touchend', e => { if (x0 == null) return; const dx = e.changedTouches[0].clientX - x0; if (Math.abs(dx) > 40) { show(cur + (dx < 0 ? 1 : -1), dx < 0 ? 1 : -1); auto(); } x0 = null; });
    sec.addEventListener('mouseenter', () => clearInterval(timer)); sec.addEventListener('mouseleave', auto);
    auto();
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

  function badge() {
    if (document.querySelector('.tf-badge')) return;
    const d = document.createElement('div'); d.className = 'tf-badge';
    d.innerHTML = 'Шинэ загвар · туршилт <a href="?theme=classic">Хуучин руу буцах</a>';
    document.body.prepend(d);
  }

  const start = () => { buildHero(); decorate(); badge(); };
  start();
  document.addEventListener('buddy:synced', () => { document.querySelector('.tf-hero')?.remove(); buildHero(); decorate(); });
})();
