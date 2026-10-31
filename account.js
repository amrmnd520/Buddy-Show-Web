/* Customer accounts on the Buddy Shop website.
   - "Нэвтрэх": email + password. New customers register with an email code (from info@buddyshop.mn)
     and then choose a password; "Нууц үгээ мартсан уу?" sends a code to set a new one. Signed in for 90 days.
   - "Миний бүртгэл": name, phone, delivery address; saved products (♡); my orders.
   - The cart is kept in this browser for everyone, and in the account when signed in,
     so it follows the customer to another phone or computer.
   - Staff see the list of registered customers in Admin → «Бүртгэлтэй хэрэглэгчид». */
(() => {
  const API = String(window.BUDDY_API || '').replace(/\/+$/, '');
  if (!API) return;
  const TK = 'bs_customer_token', CART = 'bs_cart';
  const ls = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { return null; } };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = n => (typeof money === 'function' ? money(n) : Number(n || 0).toLocaleString('en-US') + '₮');
  const dt = s => s ? String(s).slice(0, 10).replace(/-/g, '.') : '';
  let account = null, step = 'login', mode = 'new', email = '', busy = false, msg = '', msgOk = false, tab = 'info', lastCart = '';

  async function call(path, opts = {}) {
    const headers = { 'content-type': 'application/json' };
    const t = ls(TK); if (t) headers.authorization = 'Bearer ' + t;
    const res = await fetch(API + path, { ...opts, headers, cache: 'no-store' });
    const d = await res.json().catch(() => ({}));
    if (res.status === 401 && path === '/api/account') { ls(TK, null); account = null; paintButton(); }
    if (!res.ok) throw new Error(d.error || ('Алдаа ' + res.status));
    return d;
  }

  // ---------- styles ----------
  const st = document.createElement('style');
  st.textContent = `
.acc-btn{white-space:nowrap}@media(max-width:600px){.acc-btn .acc-lbl{display:none}}
.acc-modal{position:fixed;inset:0;background:rgba(9,23,34,.55);z-index:1000;display:none;align-items:flex-start;justify-content:center;padding:6vh 16px;overflow:auto}
.acc-modal.open{display:flex}
.acc-box{background:#fff;color:var(--ink,#10202c);width:100%;max-width:520px;border-radius:10px;padding:26px 26px 22px;position:relative;box-shadow:0 20px 60px rgba(0,0,0,.25)}
.acc-box h2{margin:0 0 6px;font-size:22px}.acc-box p.sub{margin:0 0 18px;color:#5a6a72;font-size:14px;line-height:1.5}
.acc-x{position:absolute;right:12px;top:10px;background:none;border:0;font-size:26px;line-height:1;cursor:pointer;color:#5a6a72}
.acc-box label{display:block;font-size:13px;font-weight:700;margin:12px 0 5px}
.acc-box input,.acc-box textarea{width:100%;box-sizing:border-box;border:1px solid #cfd6da;border-radius:6px;padding:11px 12px;font:inherit;font-size:15px}
.acc-box textarea{min-height:76px;resize:vertical}
.acc-box input.code{font-size:26px;letter-spacing:10px;text-align:center;font-weight:800}
.acc-go{width:100%;margin-top:16px;background:var(--orange,#d77a35);color:#fff;border:0;border-radius:6px;padding:13px;font-weight:800;font-size:15px;cursor:pointer}
.acc-go:disabled{opacity:.6;cursor:wait}
.acc-link{background:none;border:0;color:var(--blue,#203746);text-decoration:underline;cursor:pointer;font:inherit;font-size:13px;padding:0}
.acc-msg{margin-top:12px;font-size:13px;border-radius:5px;padding:8px 10px;background:#fdecea;color:#b42318}.acc-msg.ok{background:#eef7f0;color:#1f5f3a}
.acc-tabs{display:flex;gap:6px;border-bottom:1px solid #e3e7e9;margin:4px 0 14px}
.acc-tabs button{background:none;border:0;border-bottom:3px solid transparent;padding:9px 8px;font:inherit;font-size:14px;font-weight:700;color:#5a6a72;cursor:pointer}
.acc-tabs button.on{color:var(--ink,#10202c);border-color:var(--orange,#d77a35)}
.acc-item{display:flex;gap:12px;align-items:center;border-bottom:1px solid #eef1f3;padding:9px 0}
.acc-item img{width:54px;height:54px;object-fit:contain;border:1px solid #e3e7e9;border-radius:6px;background:#fff;flex:none}
.acc-item .t{flex:1;min-width:0;font-size:14px}.acc-item .t b{display:block;cursor:pointer}.acc-item .t small{color:#5a6a72}
.acc-empty{color:#5a6a72;font-size:14px;padding:14px 0;line-height:1.5}
.acc-foot{display:flex;justify-content:space-between;gap:10px;margin-top:18px;font-size:13px}
.acc-order{border:1px solid #e3e7e9;border-radius:8px;padding:10px 12px;margin-bottom:10px;font-size:14px}
.acc-heart{margin-top:8px;width:100%;background:#fff;border:1px solid #cfd6da;color:var(--ink,#10202c);border-radius:6px;padding:11px;font-weight:700;cursor:pointer}
.acc-heart.on{border-color:var(--orange,#d77a35);color:var(--orange,#d77a35)}
.cust-panel table{width:100%;border-collapse:collapse;font-size:13px}.cust-panel th,.cust-panel td{text-align:left;padding:7px 6px;border-bottom:1px solid #e3e7e9;vertical-align:top}
.cust-panel th{font-size:12px;color:#5a6a72}.cust-panel .bar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:10px 0}
.cust-panel .bar input{flex:1;min-width:200px}`;
  document.head.appendChild(st);

  // ---------- header button + dialog ----------
  const btn = document.createElement('button');
  btn.className = 'acc-btn'; btn.type = 'button';
  btn.onclick = () => open();
  const cartBtn = document.querySelector('.header button[onclick^="showCart"]');
  if (cartBtn) cartBtn.before(btn); else document.querySelector('.header')?.appendChild(btn);
  function paintButton() {
    const label = account ? (account.name ? account.name.split(' ')[0] : 'Миний бүртгэл') : 'Нэвтрэх';
    btn.innerHTML = '👤<span class="acc-lbl"> ' + esc(label) + '</span>'; btn.title = label;
  }

  const modal = document.createElement('div');
  modal.className = 'acc-modal';
  modal.innerHTML = '<div class="acc-box" role="dialog" aria-modal="true" aria-label="Миний бүртгэл"></div>';
  document.body.appendChild(modal);
  const box = modal.firstChild;
  modal.addEventListener('click', e => { if (e.target === modal) close(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && modal.classList.contains('open')) close(); });

  function open(note) {
    msg = note || ''; msgOk = !!note;
    if (account) { if (step !== 'setpass') step = 'account'; } else if (step === 'account' || step === 'setpass') step = 'login';
    draw(); modal.classList.add('open');
    setTimeout(() => box.querySelector('input')?.focus(), 30);
  }
  function close() { modal.classList.remove('open'); }
  const message = () => msg ? `<div class="acc-msg ${msgOk ? 'ok' : ''}">${esc(msg)}</div>` : '';

  function draw() {
    let h = '<button class="acc-x" aria-label="Хаах" data-a="close">×</button>';
    if (step === 'login') {
      h += `<h2>Нэвтрэх</h2><p class="sub">Имэйл хаяг, нууц үгээрээ нэвтэрнэ үү.</p>
        <form data-f="login"><label for="acc-email">Имэйл</label><input id="acc-email" type="email" autocomplete="username" required value="${esc(email)}" placeholder="name@gmail.com">
        <label for="acc-pass">Нууц үг</label><input id="acc-pass" type="password" autocomplete="current-password" required>
        <button class="acc-go" ${busy ? 'disabled' : ''}>${busy ? 'Шалгаж байна…' : 'Нэвтрэх'}</button></form>${message()}
        <div class="acc-foot"><button class="acc-link" data-a="forgot">Нууц үгээ мартсан уу?</button><button class="acc-link" data-a="register"><b>Шинээр бүртгүүлэх</b></button></div>`;
    } else if (step === 'email') {
      h += mode === 'forgot'
        ? `<h2>Нууц үг сэргээх</h2><p class="sub">Бүртгэлтэй имэйлээ оруулбал 6 оронтой код илгээнэ. Кодоор нэвтрээд шинэ нууц үгээ зохионо.</p>`
        : `<h2>Шинээр бүртгүүлэх</h2><p class="sub">Имэйлээ оруулбал баталгаажуулах 6 оронтой код илгээнэ. Дараа нь нууц үгээ зохионо.</p>`;
      h += `<form data-f="email"><label for="acc-email">Имэйл</label><input id="acc-email" type="email" autocomplete="email" required value="${esc(email)}" placeholder="name@gmail.com">
        <button class="acc-go" ${busy ? 'disabled' : ''}>${busy ? 'Илгээж байна…' : 'Код авах'}</button></form>${message()}
        <div class="acc-foot"><button class="acc-link" data-a="tologin">← Нэвтрэх</button></div>
        <p class="sub" style="margin:16px 0 0;font-size:12px">Таны имэйл, оруулсан хаяг утас зөвхөн захиалга, хүргэлтэд ашиглагдана. Бүртгэлээ хүссэн үедээ устгаж болно.</p>`;
    } else if (step === 'setpass') {
      h += `<h2>${account && account.hasPassword ? 'Шинэ нууц үг' : 'Нууц үгээ зохионо уу'}</h2><p class="sub">${esc(account ? account.email : '')} — дараа нь энэ имэйл, нууц үгээрээ нэвтэрнэ. Дор хаяж 8 тэмдэгт.</p>
        <form data-f="setpass"><input type="email" autocomplete="username" value="${esc(account ? account.email : '')}" hidden>
        <label for="acc-new">Нууц үг</label><input id="acc-new" type="password" autocomplete="new-password" minlength="8" required>
        <label for="acc-new2">Нууц үг давтах</label><input id="acc-new2" type="password" autocomplete="new-password" minlength="8" required>
        <button class="acc-go" ${busy ? 'disabled' : ''}>${busy ? 'Хадгалж байна…' : 'Нууц үг хадгалах'}</button></form>${message()}
        ${account && account.hasPassword ? '<div class="acc-foot"><button class="acc-link" data-a="toaccount">← Буцах</button></div>' : ''}`;
    } else if (step === 'code') {
      h += `<h2>Кодоо оруулна уу</h2><p class="sub"><b>${esc(email)}</b> хаяг руу код илгээлээ. Ирэхгүй бол Spam/Promotions хавтсаа шалгаарай.</p>
        <form data-f="code"><input id="acc-code" class="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required placeholder="••••••">
        <button class="acc-go" ${busy ? 'disabled' : ''}>${busy ? 'Шалгаж байна…' : 'Нэвтрэх'}</button></form>${message()}
        <div class="acc-foot"><button class="acc-link" data-a="back">← Өөр имэйл</button><button class="acc-link" data-a="resend">Код дахин авах</button></div>`;
    } else {
      const a = account;
      h += `<h2>Миний бүртгэл</h2><p class="sub">${esc(a.email)}</p>
        <div class="acc-tabs">${[['info', 'Миний мэдээлэл'], ['saved', `Хадгалсан (${a.wishlist.length})`], ['orders', `Захиалгууд (${a.orders.length})`]]
          .map(([k, l]) => `<button data-tab="${k}" class="${tab === k ? 'on' : ''}">${l}</button>`).join('')}</div>`;
      if (tab === 'info') {
        h += `<form data-f="profile"><label for="acc-name">Нэр</label><input id="acc-name" autocomplete="name" maxlength="80" value="${esc(a.name)}">
          <label for="acc-phone">Утас</label><input id="acc-phone" type="tel" autocomplete="tel" maxlength="20" value="${esc(a.phone)}" placeholder="9911xxxx">
          <label for="acc-addr">Хүргэлтийн хаяг</label><textarea id="acc-addr" autocomplete="street-address" maxlength="400" placeholder="Дүүрэг, хороо, байр, орц, тоот">${esc(a.address)}</textarea>
          <button class="acc-go" ${busy ? 'disabled' : ''}>${busy ? 'Хадгалж байна…' : 'Хадгалах'}</button></form>${message()}
          <div class="acc-foot"><button class="acc-link" data-a="setpass">${a.hasPassword ? 'Нууц үг солих' : 'Нууц үг тохируулах'}</button></div>`;
      } else if (tab === 'saved') {
        const list = a.wishlist.map(id => (typeof products !== 'undefined' ? products : []).find(p => Number(p.id) === Number(id))).filter(Boolean);
        h += list.length ? list.map(p => `<div class="acc-item"><img src="${esc(p.image)}" alt="" loading="lazy"><div class="t"><b data-open="${p.id}">${esc(p.name)}</b><small>${esc(p.brand || '')} · ${fmt(p.price)}</small></div>
            <button class="acc-link" data-unsave="${p.id}">Хасах</button></div>`).join('')
          : '<div class="acc-empty">Хадгалсан бараа алга. Барааны хуудсан дээрх «♡ Хадгалах» товчийг дарж хадгална.</div>';
      } else {
        h += a.orders.length ? a.orders.map(o => `<div class="acc-order"><b>#${o.id}</b> · ${dt(o.createdAt)} · ${esc(o.status)} · <b>${fmt(o.total)}</b>
            <div style="color:#5a6a72;font-size:13px;margin-top:4px">${o.items.map(i => esc(i.name || ('#' + i.id)) + (i.qty > 1 ? ' ×' + i.qty : '')).join(', ')}</div></div>`).join('')
          : '<div class="acc-empty">Одоогоор захиалга алга. Онлайн захиалга, төлбөр нээгдмэгц таны захиалгууд энд харагдана.</div>';
      }
      h += `<div class="acc-foot"><button class="acc-link" data-a="logout">Гарах</button><button class="acc-link" data-a="delete" style="color:#b42318">Бүртгэл устгах</button></div>`;
    }
    box.innerHTML = h;
  }

  box.addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target.dataset.f;
    if (busy) return;
    const val = sel => (e.target.querySelector(sel) || {}).value || '';
    const v = { pass: val('#acc-pass'), new1: val('#acc-new'), new2: val('#acc-new2'), email: val('#acc-email'), code: val('#acc-code'), name: val('#acc-name'), phone: val('#acc-phone'), address: val('#acc-addr') };
    if (f === 'email' || f === 'login') email = v.email.trim().toLowerCase();
    if (f === 'setpass' && v.new1 !== v.new2) { msg = 'Нууц үг хоорондоо таарахгүй байна'; msgOk = false; draw(); return; }
    if (f === 'profile' && account) Object.assign(account, { name: v.name, phone: v.phone, address: v.address });
    busy = true; msg = ''; draw();
    try {
      if (f === 'login') {
        const d = await call('/api/account/login', { method: 'POST', body: JSON.stringify({ email, password: v.pass }) });
        ls(TK, d.token); account = d.account; step = 'account'; tab = account.phone ? 'saved' : 'info';
        mergeCart(); paintButton(); paintHeart();
      } else if (f === 'setpass') {
        const first = !account.hasPassword;
        account = await call('/api/account', { method: 'PUT', body: JSON.stringify({ password: v.new1 }) });
        step = 'account'; tab = 'info'; msgOk = true;
        msg = first && !account.phone ? 'Нууц үг хадгалагдлаа. Одоо хүргэлтэд хэрэгтэй нэр, утас, хаягаа оруулаарай.' : 'Нууц үг хадгалагдлаа';
      } else if (f === 'email') {
        await call('/api/account/code', { method: 'POST', body: JSON.stringify({ email }) });
        step = 'code';
      } else if (f === 'code') {
        const code = v.code;
        const d = await call('/api/account/verify', { method: 'POST', body: JSON.stringify({ email, code }) });
        ls(TK, d.token); account = d.account; tab = d.isNew || !account.phone ? 'info' : 'saved';
        step = (mode === 'forgot' || !account.hasPassword) ? 'setpass' : 'account';
        if (d.isNew) { msg = 'Имэйл баталгаажлаа!'; msgOk = true; }
        mergeCart(); paintButton(); paintHeart();
      } else if (f === 'profile') {
        account = await call('/api/account', { method: 'PUT', body: JSON.stringify({
          name: v.name, phone: v.phone, address: v.address }) });
        msg = 'Хадгалагдлаа'; msgOk = true; paintButton();
      }
    } catch (err) { msg = err.message; msgOk = false; }
    busy = false; draw();
    if (step === 'code') setTimeout(() => box.querySelector('#acc-code')?.focus(), 30);
    if (step === 'email') setTimeout(() => box.querySelector('#acc-email')?.focus(), 30);
    if (step === 'setpass') setTimeout(() => box.querySelector('#acc-new')?.focus(), 30);
    if (step === 'login' && msg) setTimeout(() => box.querySelector('#acc-pass')?.focus(), 30);
  });

  box.addEventListener('click', async e => {
    const t = e.target.closest('[data-a],[data-tab],[data-open],[data-unsave]');
    if (!t) return;
    if (t.dataset.tab) { tab = t.dataset.tab; msg = ''; draw(); return; }
    if (t.dataset.open) { close(); typeof openProduct === 'function' && openProduct(Number(t.dataset.open)); return; }
    if (t.dataset.unsave) { await toggleSave(Number(t.dataset.unsave)); draw(); return; }
    const a = t.dataset.a;
    if (a === 'close') close();
    else if (a === 'back') { step = 'email'; msg = ''; draw(); }
    else if (a === 'forgot' || a === 'register') {
      const typed = box.querySelector('#acc-email'); if (typed && typed.value) email = typed.value.trim().toLowerCase();
      mode = a === 'forgot' ? 'forgot' : 'new'; step = 'email'; msg = ''; draw(); box.querySelector('#acc-email')?.focus();
    }
    else if (a === 'tologin') { step = 'login'; msg = ''; draw(); }
    else if (a === 'setpass') { step = 'setpass'; msg = ''; draw(); box.querySelector('#acc-new')?.focus(); }
    else if (a === 'toaccount') { step = 'account'; msg = ''; draw(); }
    else if (a === 'resend') {
      try { await call('/api/account/code', { method: 'POST', body: JSON.stringify({ email }) }); msg = 'Шинэ код илгээлээ'; msgOk = true; }
      catch (err) { msg = err.message; msgOk = false; }
      draw();
    } else if (a === 'logout') {
      ls(TK, null); account = null; step = 'login'; paintButton(); paintHeart(); close();
    } else if (a === 'delete') {
      if (!t.dataset.armed) { t.dataset.armed = '1'; t.textContent = 'Дахин дарж бүрмөсөн устгана'; setTimeout(() => { t.dataset.armed = ''; t.textContent = 'Бүртгэл устгах'; }, 5000); return; }
      try { await call('/api/account', { method: 'DELETE' }); } catch (err) { msg = err.message; draw(); return; }
      ls(TK, null); account = null; step = 'login'; paintButton(); paintHeart(); close();
    }
  });

  // ---------- saved products (♡) on the product page ----------
  const saved = id => !!account && account.wishlist.map(Number).includes(Number(id));
  async function toggleSave(id) {
    if (!account) { open('Бараа хадгалахын тулд эхлээд нэвтэрнэ үү.'); return; }
    const list = saved(id) ? account.wishlist.filter(x => Number(x) !== id) : [id, ...account.wishlist];
    account.wishlist = list; paintHeart();
    try { account = await call('/api/account', { method: 'PUT', body: JSON.stringify({ wishlist: list }) }); } catch (e) {}
    paintHeart();
  }
  function paintHeart() {
    const add = document.querySelector('#detail-content .add');
    if (!add || typeof detailProductId === 'undefined') return;
    let h = document.getElementById('acc-heart');
    if (!h) { h = document.createElement('button'); h.id = 'acc-heart'; h.type = 'button'; h.className = 'acc-heart'; h.onclick = () => toggleSave(Number(detailProductId)); add.after(h); }
    const on = saved(detailProductId);
    h.classList.toggle('on', on); h.textContent = on ? '♥ Хадгалсан' : '♡ Хадгалах';
  }
  const dc = document.getElementById('detail-content');
  if (dc) new MutationObserver(() => { if (!document.getElementById('acc-heart')) paintHeart(); }).observe(dc, { childList: true, subtree: true });
  if (typeof window.openProduct === 'function') {
    const prev = window.openProduct;
    window.openProduct = function (...a) { const out = prev.apply(this, a); try { paintHeart(); } catch (e) {} return out; };
  }

  // ---------- cart kept in this browser and in the account ----------
  const cartNow = () => (typeof cart !== 'undefined' && Array.isArray(cart) ? cart : null);
  const slim = c => c.map(x => { const o = { id: x.id, colorCode: x.colorCode || '' }; if (x.size) o.size = x.size; if (Number(x.price) > 0) o.price = Number(x.price); if (x.image) o.image = x.image; return o; });
  function setCart(list) {
    if (!cartNow()) return;
    const known = list.filter(x => (typeof products === 'undefined') || products.some(p => Number(p.id) === Number(x.id)));
    cart.length = 0; known.forEach(x => cart.push(x));
    const c = document.getElementById('count'); if (c) c.textContent = cart.length;
    lastCart = JSON.stringify(slim(cart));
  }
  function mergeCart() {
    const local = cartNow(); if (!local || !account) return;
    if (!local.length && account.cart.length) setCart(account.cart);
    else saveCart(true);
  }
  let saveTimer = null;
  function saveCart(now) {
    const c = cartNow(); if (!c) return;
    const s = JSON.stringify(slim(c));
    if (s === lastCart && !now) return;
    lastCart = s; ls(CART, s);
    if (!account) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => call('/api/account', { method: 'PUT', body: JSON.stringify({ cart: JSON.parse(s) }) })
      .then(a => { account = a; }).catch(() => {}), now ? 0 : 1500);
  }
  try { const s = JSON.parse(ls(CART) || '[]'); if (Array.isArray(s) && s.length && cartNow() && !cart.length) setCart(s); } catch (e) {}
  lastCart = JSON.stringify(slim(cartNow() || []));
  setInterval(() => saveCart(false), 1200);
  addEventListener('pagehide', () => saveCart(false));

  // ---------- start ----------
  paintButton();
  if (ls(TK)) call('/api/account').then(a => { account = a; paintButton(); mergeCart(); paintHeart(); }).catch(() => {});

  // ---------- admin: registered customers ----------
  const adminSection = document.getElementById('admin');
  const staffToken = () => ls('buddyshop_api_token') || '';
  if (adminSection) {
    const panel = document.createElement('div');
    panel.className = 'admin-panel cust-panel'; panel.id = 'customers-admin';
    let items = null, q = '', page = 0, err = '', loading = false;
    const PER = 10;
    async function load() {
      if (!staffToken() || loading) return;
      loading = true; err = ''; paint();
      try {
        const res = await fetch(API + '/api/customers', { headers: { authorization: 'Bearer ' + staffToken() }, cache: 'no-store' });
        const d = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(d.error || ('Алдаа ' + res.status));
        items = d.items;
      } catch (e) { err = e.message; }
      loading = false; paint();
    }
    function filtered() {
      const s = q.trim().toLowerCase();
      return (items || []).filter(c => !s || [c.email, c.name, c.phone, c.address].join(' ').toLowerCase().includes(s));
    }
    function csv() {
      const rows = [['Имэйл', 'Нэр', 'Утас', 'Хаяг', 'Бүртгүүлсэн', 'Сүүлд нэвтэрсэн', 'Хадгалсан', 'Сагсанд', 'Захиалга']]
        .concat(filtered().map(c => [c.email, c.name, c.phone, c.address, dt(c.createdAt), dt(c.lastLogin), c.wishlist.length, c.cart, c.orders]));
      const text = '﻿' + rows.map(r => r.map(v => '"' + String(v ?? '').replace(/"/g, '""') + '"').join(',')).join('\n');
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
      a.download = 'buddyshop-customers.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }
    function paint() {
      const list = filtered(), pages = Math.max(1, Math.ceil(list.length / PER));
      page = Math.min(page, pages - 1);
      const name = id => { const p = (typeof products !== 'undefined' ? products : []).find(p => Number(p.id) === Number(id)); return p ? p.name : '#' + id; };
      panel.innerHTML = `<div class="eyebrow">CUSTOMERS</div><h2>Бүртгэлтэй хэрэглэгчид ${items ? `<small style="font-size:15px;color:#5a6a72">(${items.length})</small>` : ''}</h2>
        <div class="bar"><input placeholder="Имэйл, нэр, утсаар хайх" value="${esc(q)}" data-q><button type="button" data-r>${loading ? 'Ачаалж байна…' : 'Шинэчлэх'}</button><button type="button" data-csv ${items && items.length ? '' : 'disabled'}>CSV татах</button></div>
        ${err ? `<div class="acc-msg">${esc(err)}</div>` : ''}
        ${!items ? '' : !list.length ? '<div class="acc-empty">Бүртгэлтэй хэрэглэгч алга.</div>' : `<table><thead><tr><th>Имэйл</th><th>Нэр</th><th>Утас</th><th>Хаяг</th><th>Бүртгүүлсэн</th><th>Сүүлд</th><th>Хадгалсан бараа</th><th>Сагс</th></tr></thead><tbody>
          ${list.slice(page * PER, page * PER + PER).map(c => `<tr><td>${esc(c.email)}</td><td>${esc(c.name)}</td><td>${esc(c.phone)}</td><td style="max-width:220px">${esc(c.address)}</td>
            <td>${dt(c.createdAt)}</td><td>${dt(c.lastLogin)}</td><td title="${esc(c.wishlist.map(name).join(', '))}">${c.wishlist.length}</td><td>${c.cart}</td></tr>`).join('')}</tbody></table>
          ${pages > 1 ? `<div class="bar"><button type="button" data-p="-1" ${page ? '' : 'disabled'}>‹ Өмнөх</button><span>${page + 1} / ${pages}</span><button type="button" data-p="1" ${page < pages - 1 ? '' : 'disabled'}>Дараах ›</button></div>` : ''}`}`;
    }
    panel.addEventListener('input', e => { if (e.target.dataset.q !== undefined) { q = e.target.value; page = 0; const pos = e.target.selectionStart; paint(); const i = panel.querySelector('[data-q]'); i.focus(); i.setSelectionRange(pos, pos); } });
    panel.addEventListener('click', e => {
      if (e.target.closest('[data-r]')) load();
      else if (e.target.closest('[data-csv]')) csv();
      else if (e.target.closest('[data-p]')) { page += Number(e.target.closest('[data-p]').dataset.p); paint(); }
    });
    const stats = document.getElementById('stats-admin');
    if (stats) stats.after(panel); else adminSection.prepend(panel);
    paint();
    // load when staff are signed in (and again after they sign in)
    let was = false;
    setInterval(() => { const now = document.body.classList.contains('staff-signed-in'); if (now && !was) load(); was = now; }, 1500);
  }
})();
