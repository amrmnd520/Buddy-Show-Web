/* Seasonal order of the categories: in season, the matching category moves to the front everywhere
   (top menu, category photos, «Ангилалаар харах», sidebar, category filter).
   Edit SEASONS to change months or which categories lead. Months: 1 = January … 12 = December. */
(() => {
  const SEASONS = [
    { months: [11, 12, 1, 2, 3], first: ['Өвлийн хэрэгсэл'] }, // winter: ice fishing
    // e.g. summer: { months: [6, 7, 8], first: ['Флай', 'Вейдер'] },
  ];
  const QUICK = { 'Спин': 'spinning', 'Флай': 'fly', 'Вейдер': 'waders', 'Өгөөш': 'lures', 'Цүнх': 'bags', 'Аксессуар': 'accessories', 'Өвлийн хэрэгсэл': 'winter' };
  const month = new Date().getMonth() + 1;
  const season = SEASONS.find((s) => s.months.includes(month));
  if (!season || !season.first.length) return;
  const lead = season.first;
  const rank = (name) => { const i = lead.indexOf(String(name || '').trim()); return i < 0 ? lead.length : i; };

  // move the leading items to the front of a container, keeping everyone else's order
  function front(container, items, nameOf, after) {
    if (!container) return;
    const hits = items.filter((el) => rank(nameOf(el)) < lead.length).sort((a, b) => rank(nameOf(a)) - rank(nameOf(b)));
    let anchor = after || null;
    hits.forEach((el) => {
      const ref = anchor ? anchor.nextSibling : container.firstChild;
      if (el !== ref) container.insertBefore(el, ref);
      anchor = el;
    });
  }
  const text = (el) => (el.textContent || '').replace('↗', '').trim();

  // 1. the category list used by filters and lists
  if (typeof cats !== 'undefined' && Array.isArray(cats)) {
    const rest = cats.slice(1).sort((a, b) => rank(a) - rank(b) || cats.indexOf(a) - cats.indexOf(b));
    cats.splice(1, cats.length - 1, ...rest);
  }
  // 2. sidebar tree
  if (Array.isArray(window.BUDDY_CATEGORY_TREE)) {
    const t = window.BUDDY_CATEGORY_TREE;
    t.sort((a, b) => rank(a.name) - rank(b.name) || 0);
    try { typeof renderSidebar === 'function' && renderSidebar(); } catch (e) {}
  }
  function arrange() {
    const nav = document.getElementById('nav');
    if (nav) {
      const btns = [...nav.querySelectorAll(':scope > button, :scope > a.nav-custom')];
      front(nav, btns, text, nav.querySelector('#nav-brand'));
    }
    const q = document.querySelector('.quick-categories');
    if (q) {
      const tiles = [...q.querySelectorAll(':scope > button')];
      const keyOf = (el) => { const m = (el.getAttribute('onclick') || '').match(/quickCategory\('(\w+)'\)/); return m ? Object.keys(QUICK).find((k) => QUICK[k] === m[1]) : ''; };
      front(q, tiles, keyOf, null);
    }
    const c = document.getElementById('categories');
    if (c) front(c, [...c.querySelectorAll(':scope > button')], (el) => text(el.querySelector('.category-label') || el), null);
  }
  arrange();
  // the menu is redrawn when site settings load — put the season first again
  const nav = document.getElementById('nav');
  if (nav) {
    let busy = false;
    new MutationObserver(() => { if (busy) return; busy = true; arrange(); setTimeout(() => { busy = false; }, 0); })
      .observe(nav, { childList: true });
  }
  try { typeof render === 'function' && render(); } catch (e) {}
})();
