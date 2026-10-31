/* "Танд таалагдаж магадгүй" — suggestions at the bottom of the product window.
   Mixes (1) similar products: same type, near the same price (best when the item is sold out)
   and (2) products used together: rod → reel, line; fly rod → fly reel, fly line; wader → boots…
   Items with no stock in the ERP are never suggested. */
(() => {
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = n => (typeof money === 'function' ? money(n) : Number(n || 0).toLocaleString('en-US') + '₮');
  const all = () => (typeof products !== 'undefined' ? products : []);
  const tokens = p => String(p.subcategory || '').split('·').map(s => s.trim().toLowerCase()).filter(Boolean);
  const main = p => tokens(p)[0] || '';
  const inStock = p => !(typeof p.erpQty === 'number' && p.erpQty <= 0);
  const usable = p => p && p.image && Number(p.price) > 0 && inStock(p) && p.category !== 'Бэлгийн карт';
  const family = p => String(p.name || '').toLowerCase().replace(/[^a-zа-яөү0-9 ]/gi, ' ').split(/\s+/).filter(Boolean).slice(0, 3).join(' ');

  // what goes with what: keyword in the viewed product's type → types to suggest
  const PAIRS = [
    [/^флай уурга|флай комбо/, ['флай дамар', 'fly line флай утас', 'leader үзүүрийн утас', 'ялаа']],
    [/^флай дамар/, ['fly line флай утас', 'флай уурга', 'leader үзүүрийн утас']],
    [/fly line/, ['флай дамар', 'leader үзүүрийн утас', 'tippet']],
    [/^ялаа/, ['флай хайрцаг', 'tippet', 'leader үзүүрийн утас']],
    [/leader|tippet/, ['ялаа', 'флай аксессуар']],
    [/^флай аксессуар|газардуулагч/, ['ялаа', 'tippet', 'флай хайрцаг']],
    [/уурга/, ['дамар', 'утас', 'өгөөш']],
    [/^дамар/, ['уурга', 'утас']],
    [/^утас/, ['дамар', 'өгөөш', 'воблер']],
    [/өгөөш|воблер|хулгана/, ['утас', 'хямсаа', 'аксессуар']],
    [/вейдерийн гутал/, ['simms', 'vision', 'redington', 'оймс']],
    [/^(simms|vision|redington)$/, ['вейдерийн гутал', 'оймс', 'хантааз']],
    [/^хүрэм|^цамц|малгайтай цамц|^футболк|^хантааз/, ['малгай', 'бээлий', 'ороолт']],
    [/^малгай|^ороолт|^бээлий/, ['ороолт', 'бээлий', 'малгай']],
    [/^өрөм$/, ['өрөмний ир', 'шанага', 'өвлийн уурга']],
    [/өрөмний ир/, ['өрөм', 'шанага']],
    [/өвлийн уурга/, ['балансир', 'хайрцаг', 'өрөм']],
    [/^балансир|^хайрцаг|^шанага/, ['өвлийн уурга', 'өрөм', 'балансир']],
    [/^хувцас|^гутал/, ['гутал', 'хувцас', 'бээлий']],
  ];
  function partnerTypes(p) {
    const t = tokens(p), m = main(p);
    if (p.category === 'Вейдер') return (t.some(k => /гутал/.test(k)) || /boot|гутал/i.test(p.name)) ? ['simms', 'vision', 'redington', 'оймс'] : ['вейдерийн гутал', 'оймс'];
    for (const [re, list] of PAIRS) if (re.test(m)) return list;
    return [];
  }

  // winter gear is suggested only next to winter gear (clothes go anywhere)
  const winter = x => x.category === 'Өвлийн хэрэгсэл' && !/хувцас|гутал/.test(main(x));
  const sameWorld = (a, b) => winter(a) === winter(b);

  // stable small shuffle so the same product always shows the same picks
  const hash = s => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return (h >>> 0) / 4294967295; };

  function similar(p, n) {
    const t = new Set(tokens(p)), fam = family(p), price = Number(p.price) || 1;
    return all().filter(x => x.id !== p.id && usable(x) && family(x) !== fam && sameWorld(p, x)).map(x => {
      const xt = tokens(x);
      const shared = xt.filter(k => t.has(k)).length;
      let s = shared * 3 + (main(x) === main(p) && main(p) ? 4 : 0) + (x.category === p.category ? 2 : 0) + (x.brand === p.brand ? 1 : 0);
      s -= Math.min(3, Math.abs(Math.log((Number(x.price) || 1) / price)) * 2);
      return { x, s: s + hash(p.id + ':' + x.id) * 0.8 };
    }).filter(r => r.s > 3).sort((a, b) => b.s - a.s).slice(0, n).map(r => r.x);
  }
  function together(p, n, skip) {
    const want = partnerTypes(p); if (!want.length) return [];
    const price = Number(p.price) || 1, out = [];
    want.forEach((w, wi) => {
      const pool = all().filter(x => x.id !== p.id && usable(x) && !skip.has(x.id) && sameWorld(p, x) && (tokens(x).includes(w) || (w === 'вейдерийн гутал' && x.category === 'Вейдер' && /boot|гутал/i.test(x.name))))
        .map(x => ({ x, s: (x.brand === p.brand ? 1.5 : 0) - Math.abs(Math.log((Number(x.price) || 1) / price)) * 0.4 + hash(p.id + '+' + x.id) }))
        .sort((a, b) => b.s - a.s);
      pool.slice(0, wi === 0 ? 2 : 1).forEach(r => out.push(r.x));
    });
    return out.slice(0, n);
  }

  const st = document.createElement('style');
  st.textContent = `
.rec{grid-column:1/-1;margin-top:26px;padding-top:20px;border-top:1px solid #e3e7e9}
.rec h3{margin:0 0 12px;font-size:20px}
.rec-row{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(150px,1fr);gap:14px;overflow-x:auto;scroll-snap-type:x mandatory;padding-bottom:6px}
.rec-card{scroll-snap-align:start;border:1px solid #e3e7e9;border-radius:8px;background:#fff;padding:10px;cursor:pointer;text-align:left;font:inherit;color:inherit;display:flex;flex-direction:column;gap:4px;min-width:0}
.rec-card:hover{border-color:#10202c}
.rec-card img{width:100%;aspect-ratio:1;object-fit:contain;background:#fff}
.rec-card .b{font-size:11px;font-weight:700;letter-spacing:.5px;color:#b06a2f;text-transform:uppercase}
.rec-card .n{font-size:13px;line-height:1.35;font-weight:600;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;min-height:35px}
.rec-card .p{font-weight:800;font-size:15px}
.rec-card .t{font-size:11px;color:#1f5f3a;background:#eef7f0;border-radius:10px;padding:1px 7px;align-self:flex-start}
@media(max-width:700px){.rec-row{grid-auto-columns:42%}}`;
  document.head.appendChild(st);

  function paint() {
    const box = document.getElementById('detail-content');
    if (!box || typeof detailProductId === 'undefined' || detailProductId == null) return;
    const p = all().find(x => Number(x.id) === Number(detailProductId)); if (!p) return;
    const old = box.querySelector('.rec');
    if (old && old.dataset.pid === String(p.id)) return;
    if (old) old.remove();
    const sim = similar(p, inStock(p) ? 4 : 6);
    const tog = together(p, 4, new Set(sim.map(x => x.id)));
    // alternate: similar, used-together, similar … (sold-out items lean on similar ones)
    const picks = [], a = [...sim], b = [...tog];
    while (picks.length < 8 && (a.length || b.length)) { if (a.length) picks.push([a.shift(), 0]); if (b.length && picks.length < 8) picks.push([b.shift(), 1]); }
    if (!picks.length) return;
    const sec = document.createElement('section'); sec.className = 'rec'; sec.dataset.pid = String(p.id);
    sec.innerHTML = `<h3>${inStock(p) ? 'Танд таалагдаж магадгүй' : 'Оронд нь авч болох бараа'}</h3><div class="rec-row">${picks.map(([x, k]) => `
      <button type="button" class="rec-card" data-rec="${x.id}"><img src="${esc(x.image)}" alt="" loading="lazy"><span class="b">${esc(x.brand || '')}</span>
      <span class="n">${esc(x.name)}</span><span class="p">${fmt(x.price)}</span>${k ? '<span class="t">Хамт хэрэглэх</span>' : ''}</button>`).join('')}</div>`;
    sec.addEventListener('click', e => {
      const c = e.target.closest('[data-rec]'); if (!c) return;
      if (typeof openProduct === 'function') openProduct(Number(c.dataset.rec));
      const d = document.getElementById('product-detail');
      [d, d && d.firstElementChild, box].forEach(el => el && el.scrollTo && el.scrollTo({ top: 0, behavior: 'smooth' }));
    });
    box.appendChild(sec);
  }
  const box = document.getElementById('detail-content');
  if (box) new MutationObserver(() => { const r = box.querySelector('.rec'); if (!r || r.dataset.pid !== String(detailProductId)) paint(); }).observe(box, { childList: true });
  if (typeof window.openProduct === 'function') {
    const prev = window.openProduct;
    window.openProduct = function (...a) { const out = prev.apply(this, a); try { paint(); } catch (e) {} return out; };
  }
})();
