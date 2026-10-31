/* Checkout: "Захиалга өгөх" in the cart → name, phone, delivery or pick-up, address → order.
   Signed-in customers get their details filled in and the order saved under «Миний захиалгууд».
   Guests can order too (phone required). Staff get an email (and Telegram when set up),
   and follow orders in Admin → «Захиалгууд». Payment is arranged by staff until QPay is added. */
(() => {
  const API = String(window.BUDDY_API || '').replace(/\/+$/, '');
  if (!API) return;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = n => (typeof money === 'function' ? money(n) : Number(n || 0).toLocaleString('en-US') + '₮');
  const findP = id => (typeof products !== 'undefined' ? products : []).find(p => Number(p.id) === Number(id));
  const priceOf = item => Number(item.price) || (findP(item.id)?.price || 0);
  const acc = () => window.BuddyAccount;
  let view = 'cart', busy = false, err = '', done = null, form = null; // form: last typed values

  const st = document.createElement('style');
  st.textContent = `
.co-go{width:100%;margin-top:12px;background:var(--orange,#d77a35);color:#fff;border:0;border-radius:6px;padding:14px;font-weight:800;font-size:16px;cursor:pointer}
.co-go:disabled{opacity:.6;cursor:wait}
.co-box label{display:block;font-size:13px;font-weight:700;margin:12px 0 5px}
.co-box input,.co-box textarea,.co-box select{width:100%;box-sizing:border-box;border:1px solid #cfd6da;border-radius:6px;padding:10px 12px;font:inherit;font-size:15px;background:#fff}
.co-box textarea{min-height:64px;resize:vertical}
.co-box .acc-grid{display:grid;grid-template-columns:1fr 1fr;gap:0 12px}
.co-sec{font-weight:800;font-size:15px;margin:18px 0 0;padding-top:12px;border-top:1px solid #e3e7e9}
.co-ways{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px}
.co-ways label{margin:0;border:1px solid #cfd6da;border-radius:6px;padding:10px;cursor:pointer;font-weight:700;display:flex;gap:8px;align-items:center}
.co-ways input{width:auto}.co-ways label:has(input:checked){border-color:var(--orange,#d77a35);background:#fff7f0}
.co-hint{background:#f2f5f7;border-radius:6px;padding:10px 12px;font-size:13px;line-height:1.5;margin:10px 0}
.co-hint button{background:none;border:0;padding:0;color:var(--blue,#203746);font:inherit;font-weight:700;text-decoration:underline;cursor:pointer}
.co-err{background:#fdecea;color:#b42318;border-radius:5px;padding:8px 10px;font-size:13px;margin-top:10px}
.co-ok{text-align:center;padding:10px 0}.co-ok .big{font-size:44px}.co-ok h3{margin:6px 0}.co-ok p{color:#5a6a72;line-height:1.5;font-size:14px}
.co-back{background:none;border:0;padding:0;color:var(--blue,#203746);text-decoration:underline;cursor:pointer;font:inherit;font-size:13px;margin-bottom:6px}
.co-sum{font-size:13px;color:#5a6a72;margin:4px 0 0}
.co-which{display:grid;gap:8px;margin-top:10px}
.co-which label{margin:0;border:1px solid #cfd6da;border-radius:6px;padding:10px;cursor:pointer;display:flex;gap:10px;align-items:flex-start;font-weight:400}
.co-which input{width:auto;margin-top:3px}.co-which span{display:flex;flex-direction:column;gap:2px}.co-which small{color:#5a6a72;font-size:13px;line-height:1.4}
.co-which label:has(input:checked){border-color:var(--orange,#d77a35);background:#fff7f0}
.co-check{display:flex!important;gap:8px;align-items:center;font-weight:400!important}.co-check input{width:auto}`;
  document.head.appendChild(st);

  const drawer = document.querySelector('#overlay .drawer');
  if (!drawer) return;
  const note = drawer.querySelector('.note');
  const area = document.createElement('div'); area.className = 'co-box';
  if (note) note.replaceWith(area); else drawer.appendChild(area);

  // the cart grouped into order lines
  function lines() {
    const map = new Map();
    (typeof cart !== 'undefined' ? cart : []).forEach(item => {
      const key = typeof cartItemKey === 'function' ? cartItemKey(item) : JSON.stringify([item.id, item.colorCode, item.size]);
      if (!map.has(key)) map.set(key, { item, qty: 0 }); map.get(key).qty++;
    });
    return [...map.values()].map(({ item, qty }) => {
      const p = findP(item.id); if (!p) return null;
      const s = item.size && Array.isArray(p.sizes) ? p.sizes.find(x => x.label === item.size) : null;
      const code = (s && s.code) || String(p.code || '').split('|')[0].trim();
      return { id: p.id, name: p.name, brand: p.brand || '', code, size: item.size || '', colorCode: item.colorCode || '', image: item.image || p.image || '', price: priceOf(item), qty };
    }).filter(Boolean);
  }
  const total = l => l.reduce((s, i) => s + i.price * i.qty, 0);

  function paint() {
    const l = lines(), a = acc() && acc().get();
    const cartRows = drawer.querySelector('#cartitems'), tot = drawer.querySelector('#total');
    const showCartRows = view === 'cart';
    if (cartRows) cartRows.style.display = showCartRows ? '' : 'none';
    if (tot) tot.style.display = showCartRows ? '' : 'none';
    if (view === 'done' && done) {
      area.innerHTML = `<div class="co-ok"><div class="big">✅</div><h3>Захиалга ${esc(done.number)} хүлээн авлаа</h3>
        <p>Нийт <b>${fmt(done.total)}</b>. Манай ажилтан удахгүй <b>${esc(done.phone)}</b> дугаарт холбогдож, төлбөр болон ${done.delivery === 'pickup' ? 'авах цагийг' : 'хүргэлтийг'} баталгаажуулна.</p>
        ${done.email ? `<p>Баталгаажуулах имэйл ${esc(done.email)} хаяг руу илгээгдлээ.</p>` : ''}
        ${a ? '<p>Захиалга тань «Миний бүртгэл → Захиалгууд» хэсэгт хадгалагдлаа.</p>' : ''}
        <button class="co-go" data-co="close">Дэлгүүр үргэлжлүүлэх</button></div>`;
      return;
    }
    if (!l.length) { area.innerHTML = ''; view = 'cart'; return; }
    if (view === 'cart') {
      area.innerHTML = `<button class="co-go" data-co="checkout">Захиалга өгөх →</button>
        <p class="co-sum">Төлбөрийг захиалга баталгаажсаны дараа ажилтан мэдэгдэнэ.</p>`;
      return;
    }
    // checkout form
    const f = form || {
      name: a ? a.name : '', phone: a ? a.phone : '', email: a ? a.email : '', delivery: 'delivery', note: '', save: false,
    };
    const saved = savedAddr(a);
    const which = saved ? ((form && form.which) || 'saved') : 'new';
    const newSrc = { addr: form && form.which === 'new' && form.addr ? form.addr : (saved ? {} : ((a && a.addr) || {})) };
    area.innerHTML = `<button class="co-back" data-co="back">← Сагс руу буцах</button>
      <h3 style="margin:4px 0 0">Захиалга өгөх</h3>
      <p class="co-sum">${l.reduce((s, i) => s + i.qty, 0)} бараа · Нийт <b>${fmt(total(l))}</b></p>
      ${a ? '' : `<div class="co-hint">Бүртгэлтэй бол <button type="button" data-co="login">нэвтэрч</button> захиалбал мэдээлэл тань автоматаар бөглөгдөж, захиалгын түүх хадгалагдана. Бүртгэлгүйгээр ч захиалж болно.</div>`}
      <form data-co-form>
        <label for="co-name">Нэр *</label><input id="co-name" autocomplete="name" maxlength="80" required value="${esc(f.name)}">
        <label for="co-phone">Утас *</label><input id="co-phone" type="tel" autocomplete="tel" maxlength="20" required value="${esc(f.phone)}" placeholder="9911xxxx">
        <label for="co-email">Имэйл ${a ? '' : '<small style="font-weight:400;color:#5a6a72">(баталгаажуулах имэйл авах бол)</small>'}</label>
        <input id="co-email" type="email" autocomplete="email" maxlength="120" value="${esc(f.email)}" ${a ? 'readonly' : ''}>
        <div class="co-sec">Хүлээн авах</div>
        <div class="co-ways"><label><input type="radio" name="co-way" value="delivery" ${f.delivery !== 'pickup' ? 'checked' : ''}> 🚚 Хүргэлтээр</label>
          <label><input type="radio" name="co-way" value="pickup" ${f.delivery === 'pickup' ? 'checked' : ''}> 🏬 Дэлгүүрээс авах</label></div>
        <div id="co-addr" style="${f.delivery === 'pickup' ? 'display:none' : ''}">
          ${saved ? `<div class="co-which">
            <label><input type="radio" name="co-which" value="saved" ${which === 'saved' ? 'checked' : ''}><span><b>📍 Бүртгэлтэй хаяг</b><small>${esc(a.address)}</small></span></label>
            <label><input type="radio" name="co-which" value="new" ${which === 'new' ? 'checked' : ''}><span><b>➕ Шинэ хаяг</b><small>Ажил, найзынх гэх мэт өөр хаяг руу хүргүүлэх</small></span></label></div>` : ''}
          <div id="co-new" style="${which === 'saved' ? 'display:none' : ''}">${acc() ? acc().addrFields(newSrc) : ''}
            ${a ? `<label class="co-check"><input type="checkbox" id="co-save" ${(saved ? f.save : true) ? 'checked' : ''}> ${saved ? 'Энэ хаягийг үндсэн хаягаа болгож хадгалах' : 'Энэ хаягийг бүртгэлдээ хадгалах'}</label>` : ''}</div></div>
        <label for="co-note">Захиалгын тайлбар</label><textarea id="co-note" maxlength="500" placeholder="Хүргэлтийн цаг, бусад хүсэлт">${esc(f.note)}</textarea>
        ${err ? `<div class="co-err">${esc(err)}</div>` : ''}
        <button class="co-go" ${busy ? 'disabled' : ''}>${busy ? 'Илгээж байна…' : `Захиалга илгээх · ${fmt(total(l))}`}</button>
        <p class="co-sum">Төлбөр: манай ажилтан захиалгыг баталгаажуулаад дансны мэдээлэл өгнө. QPay удахгүй нэмэгдэнэ.</p>
      </form>`;
  }

  function read() {
    const g = id => (area.querySelector('#' + id) || {}).value || '';
    const way = area.querySelector('input[name="co-way"]:checked');
    const a = acc() && acc().get();
    const w = area.querySelector('input[name="co-which"]:checked');
    const which = savedAddr(a) && w ? w.value : 'new';
    return {
      name: g('co-name').trim(), phone: g('co-phone').trim(), email: g('co-email').trim(), note: g('co-note').trim(),
      delivery: way ? way.value : 'delivery', which, save: !!area.querySelector('#co-save')?.checked,
      addr: which === 'saved' ? { ...a.addr } : (acc() && area.querySelector('#co-new') ? acc().readAddr(area.querySelector('#co-new')) : {}),
    };
  }
  function savedAddr(a) { const x = a && a.addr; return !!(x && (x.district || x.building || x.complex) && a.address); }
  function addrLine(x) {
    const num = (v, w) => (v ? (/^\d+$/.test(v) ? `${v}-р ${w}` : `${v} ${w}`) : '');
    const parts = [x.city, x.district, num(x.khoroo, x.city && x.city !== 'Улаанбаатар' ? 'баг' : 'хороо'), x.complex,
      num(x.building, 'байр'), num(x.entrance, 'орц'), num(x.floor, 'давхар'), x.door ? `${x.door} тоот` : ''].filter(Boolean);
    return parts.join(', ') + (x.note ? `. ${x.note}` : '');
  }

  area.addEventListener('click', e => {
    const b = e.target.closest('[data-co]'); if (!b) return;
    const a = b.dataset.co;
    if (a === 'checkout') { view = 'form'; err = ''; paint(); area.querySelector('#co-name')?.focus(); }
    else if (a === 'back') { form = read(); view = 'cart'; paint(); }
    else if (a === 'login') { form = read(); acc() && acc().open('Нэвтэрсний дараа сагс руугаа буцаж захиалгаа үргэлжлүүлнэ үү.'); }
    else if (a === 'close') { view = 'cart'; done = null; typeof hideCart === 'function' && hideCart(); }
  });
  area.addEventListener('change', e => {
    if (e.target.name === 'co-which') area.querySelector('#co-new').style.display = e.target.value === 'saved' ? 'none' : '';
    if (e.target.name === 'co-way') area.querySelector('#co-addr').style.display = e.target.value === 'pickup' ? 'none' : '';
    if (e.target.id === 'acc-a-city' && acc()) {
      const w = area.querySelector('#acc-a-dwrap'); if (w) w.innerHTML = acc().districtField(e.target.value, '');
      const kl = area.querySelector('label[for="acc-a-khoroo"]'); if (kl) kl.textContent = e.target.value === 'Улаанбаатар' ? 'Хороо' : 'Баг';
    }
  });
  area.addEventListener('submit', async e => {
    e.preventDefault(); if (busy) return;
    const v = read(); form = v;
    const l = lines();
    const address = v.delivery === 'pickup' ? '' : addrLine(v.addr);
    if (v.delivery === 'delivery' && (!v.addr.district || !(v.addr.building || v.addr.complex))) { err = 'Хүргэлтийн хаягаа (дүүрэг, хотхон/байр, тоот) бөглөнө үү'; paint(); return; }
    busy = true; err = ''; paint();
    try {
      const headers = { 'content-type': 'application/json' };
      const t = acc() && acc().token(); if (t) headers.authorization = 'Bearer ' + t;
      const res = await fetch(API + '/api/orders', { method: 'POST', headers, body: JSON.stringify({
        items: l, name: v.name, phone: v.phone, email: v.email, delivery: v.delivery, address, addr: v.delivery === 'pickup' ? null : v.addr, note: v.note }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || ('Алдаа ' + res.status));
      done = d.order; view = 'done'; form = null;
      cart.length = 0; const c = document.getElementById('count'); if (c) c.textContent = '0';
      const a = acc() && acc().get();
      if (a) {
        const upd = {};
        if (!a.name && v.name) upd.name = v.name;
        if (v.phone && v.phone !== a.phone) upd.phone = v.phone;
        if (v.save && v.delivery === 'delivery' && v.which === 'new') upd.addr = v.addr;
        (Object.keys(upd).length ? acc().save(upd) : acc().reload()).catch(() => {});
      }
    } catch (ex) { err = ex.message; }
    busy = false; paint();
  });

  // repaint whenever the cart opens or changes
  if (typeof window.showCart === 'function') {
    const prev = window.showCart;
    window.showCart = function (...a) { const out = prev.apply(this, a); if (view === 'done') view = 'cart', done = null; try { paint(); } catch (e) {} return out; };
  }
  if (typeof window.removeCart === 'function') {
    const prevR = window.removeCart;
    window.removeCart = function (...a) { const out = prevR.apply(this, a); try { paint(); } catch (e) {} return out; };
  }
  // after signing in from the checkout, fill in the customer's details
  acc() && acc().onChange(a => { if (a && view === 'form') { form = null; paint(); } });

  // ---------- admin: orders ----------
  const adminSection = document.getElementById('admin');
  const staffToken = () => { try { return localStorage.getItem('buddyshop_api_token') || ''; } catch (e) { return ''; } };
  if (!adminSection) return;
  const sst = document.createElement('style');
  sst.textContent = `
.ord-panel .bar{display:flex;gap:6px;flex-wrap:wrap;margin:10px 0}
.ord-panel .bar button{border:1px solid #cfd6da;background:#fff;border-radius:16px;padding:6px 12px;font:inherit;font-size:13px;cursor:pointer}
.ord-panel .bar button.on{background:#10202c;color:#fff;border-color:#10202c}
.ord-row{border:1px solid #e3e7e9;border-radius:8px;margin-bottom:8px;background:#fff}
.ord-head{display:grid;grid-template-columns:90px 110px 1fr 120px 110px 170px;gap:10px;align-items:center;padding:10px 12px;cursor:pointer;font-size:14px}
.ord-head .n{text-align:right;font-weight:800;font-variant-numeric:tabular-nums}
.ord-body{border-top:1px solid #e3e7e9;padding:12px;display:grid;grid-template-columns:1.4fr 1fr;gap:18px;font-size:14px}
.ord-body table{width:100%;border-collapse:collapse}.ord-body td{padding:6px 4px;border-bottom:1px solid #eef1f3;vertical-align:top}
.ord-body img{width:40px;height:40px;object-fit:contain;border:1px solid #e3e7e9;border-radius:4px;background:#fff}
.ord-body textarea{width:100%;box-sizing:border-box;min-height:60px;border:1px solid #cfd6da;border-radius:6px;padding:8px;font:inherit}
.ord-st{font-size:12px;font-weight:700;border-radius:10px;padding:3px 9px;background:#eef3f6;color:#203746;white-space:nowrap;justify-self:start}
.ord-st.new{background:#fff4e5;color:#8a5300}.ord-st.done{background:#eef7f0;color:#1f5f3a}.ord-st.cancelled{background:#fdecea;color:#b42318}
.ord-badge{display:inline-block;background:#d77a35;color:#fff;border-radius:10px;font-size:12px;font-weight:800;padding:1px 7px;margin-left:6px;vertical-align:middle}
@media(max-width:900px){.ord-head{grid-template-columns:1fr 1fr;}.ord-body{grid-template-columns:1fr}}`;
  document.head.appendChild(sst);
  const panel = document.createElement('div');
  panel.className = 'admin-panel ord-panel'; panel.id = 'orders-admin';
  let data = null, filter = 'open', openId = null, loadErr = '', page = 0;
  const PER = 10;
  const OPEN = ['new', 'confirmed', 'paid', 'shipping'];
  const dtm = s => s ? new Date(s).toLocaleString('sv-SE', { timeZone: 'Asia/Ulaanbaatar' }).slice(0, 16).replace(/-/g, '.') : '';
  async function load() {
    if (!staffToken()) return;
    try {
      const res = await fetch(API + '/api/orders', { headers: { authorization: 'Bearer ' + staffToken() }, cache: 'no-store' });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || ('Алдаа ' + res.status));
      data = d; loadErr = '';
    } catch (e) { loadErr = e.message; }
    draw();
  }
  async function update(id, body) {
    const res = await fetch(API + '/api/orders/' + id, { method: 'PUT', headers: { authorization: 'Bearer ' + staffToken(), 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { loadErr = d.error || 'Хадгалж чадсангүй'; draw(); return; }
    data.items = data.items.map(o => (o.id === id ? { ...o, ...d } : o)); draw();
  }
  function draw() {
    const S = (data && data.statuses) || {};
    const all = data ? data.items : [];
    const n = k => all.filter(o => o.status === k).length;
    const list = all.filter(o => filter === 'all' ? true : filter === 'open' ? OPEN.includes(o.status) : o.status === filter);
    const pages = Math.max(1, Math.ceil(list.length / PER)); page = Math.min(page, pages - 1);
    const chips = [['open', 'Идэвхтэй', all.filter(o => OPEN.includes(o.status)).length], ...Object.keys(S).map(k => [k, S[k], n(k)]), ['all', 'Бүгд', all.length]];
    panel.innerHTML = `<div class="eyebrow">ORDERS</div><h2>Захиалгууд ${n('new') ? `<span class="ord-badge">${n('new')} шинэ</span>` : ''}</h2>
      <div class="bar">${chips.map(([k, l, c]) => `<button type="button" data-f="${k}" class="${filter === k ? 'on' : ''}">${esc(l)} (${c})</button>`).join('')}<button type="button" data-r>↻ Шинэчлэх</button></div>
      ${loadErr ? `<div class="co-err">${esc(loadErr)}</div>` : ''}
      ${!data ? '' : !list.length ? '<p class="note">Захиалга алга.</p>' : list.slice(page * PER, page * PER + PER).map(o => `<div class="ord-row">
        <div class="ord-head" data-o="${o.id}"><b>${esc(o.number)}</b><span>${dtm(o.createdAt)}</span><span>${esc(o.name)} · ${esc(o.phone)}</span>
          <span>${o.delivery === 'pickup' ? '🏬 Очиж авна' : '🚚 Хүргэлт'}</span><span class="n">${fmt(o.total)}</span><span class="ord-st ${esc(o.status)}">${esc(o.statusText)}</span></div>
        ${openId === o.id ? `<div class="ord-body"><div><table>${o.items.map(i => `<tr><td><img src="${esc(i.image)}" alt="" loading="lazy"></td>
            <td><b>${esc(i.name)}</b>${i.size ? `<br>Хэмжээ: ${esc(i.size)}` : ''}${i.colorCode ? `<br>Өнгө: ${esc(i.colorCode)}` : ''}<br><small>${esc(i.brand)}${i.code ? ' · код ' + esc(i.code) : ''}</small></td>
            <td style="text-align:right;white-space:nowrap">${fmt(i.price)} × ${i.qty}<br><b>${fmt(i.price * i.qty)}</b></td></tr>`).join('')}
            <tr><td></td><td><b>Нийт</b></td><td style="text-align:right"><b>${fmt(o.total)}</b></td></tr></table></div>
          <div><p><b>${esc(o.name)}</b><br>📞 <a href="tel:${esc(o.phone)}">${esc(o.phone)}</a>${o.email ? `<br>✉️ <a href="mailto:${esc(o.email)}">${esc(o.email)}</a>` : ''}${o.customerId ? '<br><small>Бүртгэлтэй хэрэглэгч</small>' : '<br><small>Зочин</small>'}</p>
            <p>${o.delivery === 'pickup' ? '🏬 Дэлгүүрээс очиж авна' : '🚚 ' + esc(o.address)}</p>${o.note ? `<p>📝 ${esc(o.note)}</p>` : ''}
            <label style="font-weight:700;font-size:13px">Төлөв</label><select data-st="${o.id}" style="width:100%;padding:8px;margin:4px 0 10px">${Object.keys(S).map(k => `<option value="${k}" ${k === o.status ? 'selected' : ''}>${esc(S[k])}</option>`).join('')}</select>
            <label style="font-weight:700;font-size:13px">Ажилтны тэмдэглэл</label><textarea data-sn="${o.id}" placeholder="Зөвхөн ажилтнуудад харагдана">${esc(o.staffNote)}</textarea>
            <button type="button" data-save="${o.id}" style="margin-top:6px">Тэмдэглэл хадгалах</button>
            ${o.updatedBy ? `<p class="note" style="margin-top:8px">Сүүлд: ${esc(o.updatedBy)} · ${dtm(o.updatedAt)}</p>` : ''}</div></div>` : ''}</div>`).join('')}
      ${pages > 1 ? `<div class="bar"><button type="button" data-p="-1" ${page ? '' : 'disabled'}>‹ Өмнөх</button><span style="align-self:center">${page + 1} / ${pages}</span><button type="button" data-p="1" ${page < pages - 1 ? '' : 'disabled'}>Дараах ›</button></div>` : ''}`;
  }
  panel.addEventListener('click', e => {
    const t = e.target;
    if (t.closest('[data-f]')) { filter = t.closest('[data-f]').dataset.f; page = 0; draw(); }
    else if (t.closest('[data-r]')) load();
    else if (t.closest('[data-p]')) { page += Number(t.closest('[data-p]').dataset.p); draw(); }
    else if (t.closest('[data-save]')) { const id = Number(t.closest('[data-save]').dataset.save); update(id, { staffNote: panel.querySelector(`[data-sn="${id}"]`).value }); }
    else if (t.closest('.ord-head')) { const id = Number(t.closest('.ord-head').dataset.o); openId = openId === id ? null : id; draw(); }
  });
  panel.addEventListener('change', e => { if (e.target.dataset.st) update(Number(e.target.dataset.st), { status: e.target.value }); });
  adminSection.prepend(panel);
  draw();
  let was = false;
  setInterval(() => {
    const now = document.body.classList.contains('staff-signed-in');
    if (now && !was) load();
    was = now;
  }, 1500);
  setInterval(() => { if (document.body.classList.contains('staff-signed-in') && document.visibilityState === 'visible' && !openId) load(); }, 60000);
})();
