/* Shared product editing for Buddy Shop.
   Loads staff changes from the Buddy Shop API on top of catalog.js, saves every
   admin edit to the server automatically, and uploads product photos.
   Does nothing when window.BUDDY_API is empty. */
(() => {
  const API = String(window.BUDDY_API || '').replace(/\/+$/, '');
  if (!API) return;

  const TOKEN_KEY = 'buddyshop_api_token';
  const USER_KEY = 'buddyshop_api_user';
  let token = '';
  let user = '';
  try { token = localStorage.getItem(TOKEN_KEY) || ''; user = localStorage.getItem(USER_KEY) || ''; } catch (e) {}

  let base = new Map();      // id -> JSON last known to be on the server
  let ready = false;         // overlay loaded, baseline taken
  let timer = null, saving = false, again = false, failed = 0;

  const snapshot = () => new Map(products.map(p => [Number(p.id), JSON.stringify(p)]));
  const dirtyCount = () => {
    const now = snapshot(); let n = 0;
    for (const [id, j] of now) if (base.get(id) !== j) n++;
    for (const id of base.keys()) if (!now.has(id)) n++;
    return n;
  };

  async function api(path, opts = {}) {
    const headers = Object.assign({}, opts.headers || {});
    if (token) headers.authorization = 'Bearer ' + token;
    const res = await fetch(API + path, Object.assign({}, opts, { headers }));
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && path !== '/api/login') { signOut(true); }
    if (!res.ok) throw new Error(data.error || ('Алдаа ' + res.status));
    return data;
  }

  /* ---------- load staff changes on top of catalog.js ---------- */
  function applyOverlay(data) {
    const gone = new Set((data.deleted || []).map(Number));
    const byId = new Map(products.map((p, i) => [Number(p.id), i]));
    const fresh = [];
    for (const item of data.items || []) {
      const p = Object.assign({}, item);
      delete p._updatedAt; delete p._updatedBy;
      const i = byId.get(Number(p.id));
      if (i == null) fresh.push(p); else products[i] = p;
    }
    products = fresh.reverse().concat(products).filter(p => !gone.has(Number(p.id)));
  }

  function redraw() {
    const y = window.scrollY;
    menus(); render(true); renderFeaturedLures(); adminRender();
    window.scrollTo(0, y);
  }

  async function loadOverlay() {
    const data = await api('/api/products', { cache: 'no-store' });
    applyOverlay(data);
    // ERP prices/stock (erp-sync.js) go in before the baseline so they never count as unsaved edits.
    if (window.applyErp) { try { await window.applyErp(products); } catch (e) {} }
    base = snapshot();
    ready = true;
    redraw();
  }

  /* ---------- automatic saving ---------- */
  function queue() {
    if (!ready || !token) return;
    clearTimeout(timer);
    setStatus('saving');
    timer = setTimeout(flush, 700);
  }

  async function flush() {
    if (!ready || !token) return;
    if (saving) { again = true; return; }
    saving = true;
    const now = snapshot();
    const jobs = [];
    for (const [id, j] of now) if (base.get(id) !== j) jobs.push(['PUT', id, j]);
    for (const id of base.keys()) if (!now.has(id)) jobs.push(['DELETE', id]);
    let errors = 0, lastError = '';
    for (const [method, id, j] of jobs) {
      try {
        await api('/api/products/' + id, method === 'PUT'
          ? { method, headers: { 'content-type': 'application/json' }, body: j }
          : { method });
        if (method === 'PUT') base.set(id, j); else base.delete(id);
      } catch (e) { errors++; lastError = e.message; if (!token) break; }
    }
    saving = false;
    if (again) { again = false; return flush(); }
    if (errors) {
      failed++;
      setStatus('error', lastError);
      if (token && failed < 6) timer = setTimeout(flush, 5000 * failed);
    } else { failed = 0; setStatus(dirtyCount() ? 'saving' : 'saved'); }
  }

  window.shopSync = { queue, flush };

  // Pick up other staff members' changes when coming back to the page.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !ready || saving || dirtyCount()) return;
    loadOverlay().catch(() => {});
  });
  window.addEventListener('beforeunload', e => {
    if (token && ready && dirtyCount()) { flush(); e.preventDefault(); e.returnValue = ''; }
  });

  /* ---------- photo upload ---------- */
  function shrink(file) {
    return new Promise(resolve => {
      if (!/^image\/(jpeg|png|webp|heic|heif)$/i.test(file.type) && !/\.(heic|heif)$/i.test(file.name)) return resolve(file);
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const max = 1600, scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * scale); c.height = Math.round(img.naturalHeight * scale);
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        c.toBlob(b => resolve(b || file), 'image/jpeg', 0.86);
      };
      img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
      img.src = url;
    });
  }

  window.shopUpload = function (id) {
    if (!token) return alert('Эхлээд нэвтэрнэ үү.');
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*'; input.multiple = true;
    input.onchange = async () => {
      const files = [...input.files];
      if (!files.length) return;
      let done = 0;
      for (const f of files) {
        setStatus('saving', `Зураг илгээж байна ${done + 1}/${files.length}…`);
        try {
          const blob = await shrink(f);
          const { url } = await api('/api/upload', { method: 'POST', headers: { 'content-type': blob.type || 'image/jpeg' }, body: blob });
          const p = products.find(x => Number(x.id) === Number(id));
          if (!p) break;
          editImages(p.id, [...productImages(p), url].join('\n'));
          done++;
        } catch (e) { setStatus('error', 'Зураг: ' + e.message); }
      }
      adminRender();
      if (done) queue();
    };
    input.click();
  };

  /* ---------- sign in / out ---------- */
  async function signIn(name, password) {
    const data = await api('/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ user: name, password }) });
    token = data.token; user = data.user;
    try { localStorage.setItem(TOKEN_KEY, token); localStorage.setItem(USER_KEY, user); } catch (e) {}
    ready = false;
    await loadOverlay();   // fresh data, fresh baseline
    drawBar();
  }
  function signOut(expired) {
    token = ''; user = '';
    if (!expired) statusText = '';
    try { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(USER_KEY); } catch (e) {}
    drawBar();
    if (expired) setStatus('error', 'Нэвтрэх хугацаа дууссан. Дахин нэвтэрнэ үү.');
  }

  /* ---------- admin panel UI ---------- */
  // Website settings, featured and sold-out tools are for signed-in staff only.
  const gate = document.createElement('style');
  gate.textContent = 'body:not(.staff-signed-in) #site-settings,body:not(.staff-signed-in) #featured-admin,body:not(.staff-signed-in) #soldout-admin,body:not(.staff-signed-in) #erp-suggest-admin{display:none!important}';
  document.head.appendChild(gate);
  const panel = document.querySelector('#admin .admin-panel');
  const bar = document.createElement('div');
  bar.className = 'shop-sync-bar';
  bar.style.cssText = 'margin:14px 0;padding:14px;border:1px solid rgba(127,127,127,.35);border-radius:10px;display:flex;flex-wrap:wrap;gap:10px;align-items:center';
  const heading = panel && panel.querySelector('h2');
  if (heading) heading.after(bar);
  const eyebrow = panel && panel.querySelector('.eyebrow');
  if (eyebrow) eyebrow.textContent = 'SHARED PRODUCT MANAGER';
  const intro = panel && panel.querySelector('h2 + .shop-sync-bar + .note');
  if (intro) intro.textContent = 'Нэвтэрсэн ажилтан бүрийн өөрчлөлт серверт автоматаар хадгалагдаж, сайтад шууд харагдана. Зураг нэмэхдээ 📷 товч дарна.';
  const tableNote = panel && panel.querySelector('div[style*="overflow"] > .note');
  if (tableNote) tableNote.textContent = 'Өөрчлөлт бүр автоматаар хадгалагдана. Хадгалсан эсэхийг дээрх төлөвөөс харна уу.';

  let statusText = '';
  function setStatus(kind, text) {
    const el = bar.querySelector('[data-status]');
    statusText = text || ({ saving: '⏳ Хадгалж байна…', saved: '✓ Бүх өөрчлөлт хадгалагдсан', error: '⚠ Хадгалж чадсангүй' })[kind] || '';
    if (el) { el.textContent = statusText; el.style.color = kind === 'error' ? '#d33' : kind === 'saved' ? '#1a7f37' : ''; }
  }

  function drawBar() {
    document.body.classList.toggle('staff-signed-in', !!token);
    const legacy = panel ? [...panel.querySelectorAll('.admin-actions button')].filter(b => /Хадгалах|импорт|Анхны мэдээлэл/.test(b.textContent)) : [];
    legacy.forEach(b => b.hidden = true);
    const work = panel ? [panel.querySelector('.admin-actions'), panel.querySelector('div[style*="overflow"]')] : [];
    if (token) {
      bar.innerHTML = `<strong>👤 ${safe(user)}</strong><span data-status></span><span style="flex:1"></span><button type="button" data-out>Гарах</button>`;
      bar.querySelector('[data-out]').onclick = () => { if (!dirtyCount() || confirm('Хадгалагдаагүй өөрчлөлт байна. Гарах уу?')) signOut(); };
      work.forEach(el => el && (el.style.display = ''));
      setStatus(ready ? (dirtyCount() ? 'saving' : 'saved') : 'saving', ready ? '' : 'Ачаалж байна…');
    } else {
      bar.innerHTML = `<form data-login style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:0"><strong>Ажилтан нэвтрэх</strong><input name="u" placeholder="Нэр" autocomplete="username" required style="width:140px"><input name="p" type="password" placeholder="Нууц үг" autocomplete="current-password" required style="width:160px"><button type="submit">Нэвтрэх</button><span data-status></span></form>`;
      bar.querySelector('[data-login]').onsubmit = async e => {
        e.preventDefault();
        const f = e.target;
        setStatus('saving', 'Нэвтэрч байна…');
        try { await signIn(f.u.value.trim(), f.p.value); } catch (err) { setStatus('error', err.message); }
      };
      work.forEach(el => el && (el.style.display = 'none'));
      if (statusText) setStatus('error', statusText);
    }
  }

  drawBar();
  loadOverlay().then(() => { if (token) setStatus('saved'); })
    .catch(() => { if (token) setStatus('error', 'Сервертэй холбогдож чадсангүй'); });
  if (token) api('/api/me').catch(() => {});
})();
