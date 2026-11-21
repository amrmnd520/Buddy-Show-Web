/* Brand logos: staff add or change a brand's logo in admin («Брэндийн лого» button next to «+ Шинэ бараа»).
   The picture is uploaded like a product photo; the brand → logo list lives on the server (/api/brands),
   so every visitor sees it in the brand strip and the sidebar. Logos built into the site
   (sidebar-data.js) stay unless staff replace them. */
(() => {
  const API = String(window.BUDDY_API || '').replace(/\/+$/, '');
  if (!API) return;
  const TOKEN_KEY = 'buddyshop_api_token';
  const token = () => { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; } };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const base = Object.assign({}, window.BUDDY_BRAND_LOGOS || {});   // the logos shipped with the site
  let custom = {};                                                    // from the server, by brand name

  const nameOf = b => (typeof brandName === 'function' ? brandName(b) : String(b || '').trim());
  const logoFor = b => custom[b] || Object.entries(base).find(([k, v]) => v && nameOf(k) === b)?.[1] || '';

  function apply() {
    const merged = Object.assign({}, base);
    for (const [b, url] of Object.entries(custom)) {
      for (const k of Object.keys(merged)) if (nameOf(k) === b) delete merged[k];   // staff logo wins
      if (url) merged[b] = url;
    }
    window.BUDDY_BRAND_LOGOS = merged;
    try { typeof renderBrandLinks === 'function' && renderBrandLinks(); } catch (e) {}
    try { typeof renderSidebar === 'function' && renderSidebar(); } catch (e) {}
  }

  fetch(API + '/api/brands', { cache: 'no-store' }).then(r => r.ok ? r.json() : null)
    .then(d => { if (d && d.logos) { custom = d.logos; apply(); } }).catch(() => {});

  /* ---------- admin dialog ---------- */
  const st = document.createElement('style');
  st.textContent = `#brand-logo-dlg{border:0;border-radius:10px;padding:0;width:min(720px,94vw);max-height:86vh}
#brand-logo-dlg .bl-head{display:flex;justify-content:space-between;align-items:center;padding:16px 20px;border-bottom:1px solid #e3e8eb;position:sticky;top:0;background:#fff;z-index:1}
#brand-logo-dlg .bl-head h3{margin:0;font-size:18px}
#brand-logo-dlg .bl-list{padding:8px 20px 20px}
#brand-logo-dlg .bl-row{display:grid;grid-template-columns:1fr 120px auto;gap:12px;align-items:center;padding:10px 0;border-bottom:1px solid #f0f3f4}
#brand-logo-dlg .bl-pic{height:44px;display:flex;align-items:center;justify-content:center;background:#f4f1ea;border:1px solid #e3e8eb;border-radius:6px;padding:4px}
#brand-logo-dlg .bl-pic img{max-height:36px;max-width:110px}
#brand-logo-dlg .bl-pic span{color:#8a9aa2;font-size:11px}
#brand-logo-dlg button{padding:7px 10px;border-radius:6px;border:1px solid #cfd6da;background:#f0f3f4;font-weight:600;cursor:pointer}
#brand-logo-dlg .bl-btns{display:flex;gap:6px}
#brand-logo-dlg .bl-help{font-size:12px;color:#5a6a72;margin:10px 20px 0}
#brand-logo-dlg .bl-status{display:block;font-size:14px;font-weight:700;color:#1f5f3a;min-height:18px;margin-top:6px}`;
  document.head.appendChild(st);

  function brands() {
    const list = (typeof products !== 'undefined' ? products : []).map(p => p.brand).filter(Boolean);
    return [...new Set([...list, ...Object.keys(custom)])].sort((a, b) => a === 'Бусад' ? 1 : b === 'Бусад' ? -1 : a.localeCompare(b, 'en', { sensitivity: 'base' }));
  }

  let dlg;
  function draw(msg) {
    if (!dlg) {
      dlg = document.createElement('dialog'); dlg.id = 'brand-logo-dlg'; document.body.appendChild(dlg);
      dlg.addEventListener('click', e => {
        if (e.target === dlg) return dlg.close();
        const b = e.target.closest('[data-bl]'); if (!b) return;
        if (b.dataset.bl === 'close') return dlg.close();
        if (b.dataset.bl === 'up') return upload(b.dataset.brand);
        if (b.dataset.bl === 'rm') return save(b.dataset.brand, '');
      });
    }
    dlg.innerHTML = `<div class="bl-head"><h3>Брэндийн лого</h3><button data-bl="close" aria-label="Хаах">✕</button></div>
      <p class="bl-help">PNG (тунгалаг фонтой) лого хамгийн сайн харагдана. Сайт дээр цайвар фон дээр гардаг тул өнгөт эсвэл бараан лого сонгоорой. <span class="bl-status" role="status">${esc(msg || '')}</span></p>
      <div class="bl-list">${brands().map(b => {
        const url = logoFor(b);
        return `<div class="bl-row"><b>${esc(b)}</b><div class="bl-pic">${url ? `<img src="${esc(url)}" alt="${esc(b)} лого">` : '<span>Лого алга</span>'}</div>
          <div class="bl-btns"><button data-bl="up" data-brand="${esc(b)}">${url ? 'Солих' : 'Лого оруулах'}</button>${custom[b] ? `<button data-bl="rm" data-brand="${esc(b)}">Арилгах</button>` : ''}</div></div>`;
      }).join('')}</div>`;
  }

  async function call(path, opts) {
    const res = await fetch(API + path, Object.assign({}, opts, { headers: Object.assign({ authorization: 'Bearer ' + token() }, (opts && opts.headers) || {}) }));
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || res.status);
    return d;
  }

  // keep transparency: scale down to at most 600px and send as PNG
  function toPng(file) {
    return new Promise(resolve => {
      const img = new Image(), url = URL.createObjectURL(file);
      img.onload = () => {
        const k = Math.min(1, 600 / Math.max(img.width, img.height));
        const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
        c.toBlob(b => resolve(b || file), 'image/png');
      };
      img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
      img.src = url;
    });
  }

  function upload(brand) {
    const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/png,image/jpeg,image/webp';
    input.onchange = async () => {
      const f = input.files[0]; if (!f) return;
      draw(`${brand}: зураг илгээж байна…`);
      try {
        const blob = await toPng(f);
        const { url } = await call('/api/upload', { method: 'POST', headers: { 'content-type': blob.type || 'image/png' }, body: blob });
        await save(brand, url);
      } catch (e) { fail(e); }
    };
    input.click();
  }

  async function save(brand, image) {
    try {
      const d = await call('/api/brands', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ brand, image }) });
      custom = d.logos || custom; apply();
      draw(image ? `${brand}: лого хадгалагдлаа ✓` : `${brand}: лого арилгалаа`);
    } catch (e) { fail(e); }
  }

  function fail(e) {
    const m = /^(404|401|Not found)$/i.test(String(e.message)) ? 'Сервер шинэчлэгдээгүй байна (worker deploy хийх хэрэгтэй).' : e.message;
    draw('⚠ Алдаа: ' + m); alert('Лого хадгалагдсангүй: ' + m);
  }

  window.openBrandLogos = function () {
    if (!token()) return alert('Эхлээд ажилтнаар нэвтэрнэ үү.');
    draw(); dlg.showModal();
  };

  // «Брэндийн лого» button next to «+ Шинэ бараа»
  function addButton() {
    const nb = [...document.querySelectorAll('button')].find(b => b.getAttribute('onclick') === 'newProduct()');
    if (!nb || document.getElementById('brand-logo-btn')) return;
    nb.insertAdjacentHTML('afterend', ' <button id="brand-logo-btn" onclick="openBrandLogos()">🏷 Брэндийн лого</button>');
  }
  addButton();
})();
