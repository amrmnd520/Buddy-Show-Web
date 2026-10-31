/* Size options ("Хэмжээ"): one website product, several ERP products.
   p.sizes = [{ label: '1000', code: '4969363046420' }, …]
   - Product page: size buttons with their own price and Emart stock (from erp-sync.js);
     a size without stock is shown but cannot be added to the cart.
   - Cart: remembers the chosen size and its price.
   - Admin: "Хэмжээ тохируулах" dialog finds the model's sizes in the ERP and saves them. */
(() => {
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = n => Number(n || 0).toLocaleString('en-US') + '₮';
  const norm = c => String(c || '').trim().toUpperCase().replace(/\s+/g, ' ');
  const list = () => (typeof products !== 'undefined' ? products : []);
  const findP = id => list().find(x => Number(x.id) === Number(id));
  const hasSizes = p => p && Array.isArray(p.sizes) && p.sizes.length > 0;
  // Order sizes the way people expect: XS < S < M < L < XL…, numbers by value (1000 < 2500 < C3000 < 4000).
  const RANK = ['XXS', 'XS', 'S', 'SM', 'M', 'MK', 'L', 'LK', 'LXL', 'XL', 'XLK', 'XXL', '2XL', '3XL', '4XL', '5XL'];
  const sizeKey = l => { const u = String(l).trim().toUpperCase(); const r = RANK.indexOf(u); if (r >= 0) return [0, r, u];
    const n = parseFloat((u.match(/\d+(\.\d+)?/) || [])[0]); return isNaN(n) ? [2, 0, u] : [1, n, u]; };
  const natural = (a, b) => { const x = sizeKey(a), y = sizeKey(b); return x[0] - y[0] || x[1] - y[1] || x[2].localeCompare(y[2], 'en', { numeric: true }); };
  let picked = null; // { id, label }

  const st = document.createElement('style');
  st.textContent = `.size-pick{margin:4px 0 14px}.size-pick-label{font-weight:700;font-size:14px;margin-bottom:8px}
.size-chips{display:flex;flex-wrap:wrap;gap:8px}.size-chip{min-width:64px;border:1.5px solid #c8d1d5;background:#fff;border-radius:6px;padding:8px 12px;font:inherit;font-weight:700;cursor:pointer;line-height:1.2;text-align:center}
.size-chip small{display:block;font-weight:500;font-size:11px;color:#5a6a72;margin-top:2px}.size-chip[aria-pressed=true]{border-color:#203746;background:#203746;color:#fff}.size-chip[aria-pressed=true] small{color:#d6dde1}
.size-chip.out{color:#9aa6ac;text-decoration:line-through;border-style:dashed}.size-chip.out small{text-decoration:none}.size-chip:focus-visible{outline:2px solid #d77a35;outline-offset:2px}
.cart-size{font-size:12px;color:#5a6a72}
dialog.size-dlg{width:min(860px,96vw);max-height:90vh;border:0;border-radius:10px;padding:0;box-shadow:0 20px 60px #0005}dialog.size-dlg::backdrop{background:#0008}
.size-dlg .sd-in{padding:20px;display:grid;gap:12px}.size-dlg h3{margin:0;font-size:20px}.size-dlg .sd-help{font-size:13px;color:#5a6a72;margin:0;line-height:1.5}
.size-dlg input[type=search],.size-dlg input[type=text]{padding:8px;border:1px solid #ccd1d3;border-radius:4px;font:inherit;width:100%}
.sd-pick{display:grid;gap:4px;max-height:180px;overflow:auto}.sd-pick button{text-align:left;border:1px solid #e3e7e9;background:#fff;border-radius:4px;padding:6px 8px;font:inherit;cursor:pointer}
.sd-chosen{background:#eef3f6;border-radius:6px;padding:8px 10px;font-weight:700}.sd-table{overflow:auto;max-height:46vh;border:1px solid #e3e7e9;border-radius:6px}
.sd-table table{border-collapse:collapse;width:100%;font-size:13px}.sd-table th,.sd-table td{padding:6px 8px;border-bottom:1px solid #eef0f1;text-align:left;vertical-align:middle}
.sd-table td.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}.sd-table input[type=text]{width:90px}.sd-table code{font-size:11px}
.sd-foot{display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end}.sd-foot button{border:1px solid #c8d1d5;background:#fff;border-radius:4px;padding:9px 14px;font:inherit;font-weight:700;cursor:pointer}
.sd-foot .primary{background:#203746;color:#fff;border-color:#203746}.sd-foot .danger{color:#b42318;margin-right:auto}.sd-err{color:#b42318;font-size:13px}`;
  document.head.appendChild(st);

  /* ---------- product page ---------- */
  function sizeRow(p, s) {
    const out = typeof s.qty === 'number' && s.qty <= 0;
    const on = picked && picked.id === p.id && picked.label === s.label;
    return `<button type="button" class="size-chip ${out ? 'out' : ''}" aria-pressed="${on}" data-size="${esc(s.label)}" title="${out ? 'Үлдэгдэлгүй' : ''}">${esc(s.label)}${s.price ? `<small>${fmt(s.price)}</small>` : ''}</button>`;
  }
  function paintDetail(p) {
    const box = document.getElementById('detail-content'); if (!box || !hasSizes(p)) return;
    const sizes = [...p.sizes].sort((a, b) => natural(a.label, b.label));
    if (!picked || picked.id !== p.id) {
      const first = sizes.find(s => !(typeof s.qty === 'number' && s.qty <= 0)) || sizes[0];
      picked = { id: p.id, label: first.label };
    }
    const cur = sizes.find(s => s.label === picked.label) || sizes[0];
    let pick = box.querySelector('.size-pick');
    if (!pick) {
      pick = document.createElement('div'); pick.className = 'size-pick';
      const anchor = box.querySelector('.color-code-label') || box.querySelector('.add[onclick*="addDetailProduct"]') || box.querySelector('.price');
      anchor ? anchor.before(pick) : box.append(pick);
    }
    const title = p.sizeTitle || 'Хэмжээ';
    pick.innerHTML = `<div class="size-pick-label">${esc(title)}: ${esc(cur.label)}</div><div class="size-chips" role="group" aria-label="${esc(title)}">${sizes.map(s => sizeRow(p, s)).join('')}</div>`;
    const priceEl = box.querySelector('.price'); if (priceEl && cur.price) priceEl.textContent = fmt(cur.price);
    // A sized product needs no colour-code box unless its photos carry colour codes.
    if (!p.imageColorCodes) box.querySelectorAll('.color-code-label,#detail-color-code,.detail-hint').forEach(el => { if (!el.closest('.size-pick')) el.style.display = 'none'; });
    // Show the chosen size's own code instead of the whole list.
    box.querySelectorAll('.detail-meta').forEach(el => { if (/^Код:/.test(el.textContent)) el.textContent = 'Код: ' + cur.code; });
    box.querySelector('.erp-nostock-note')?.remove();
    const out = typeof cur.qty === 'number' && cur.qty <= 0;
    if (out) box.querySelector('.price')?.insertAdjacentHTML('beforebegin', `<div class="erp-nostock-note">Энэ ${p.sizeTitle === 'Сонголт' ? 'сонголт' : 'хэмжээ'} үлдэгдэлгүй</div>`);
    box.querySelectorAll('.add').forEach(b => {
      if (!/Сагсанд|Үлдэгдэлгүй/.test(b.textContent) || b.getAttribute('onclick') === 'setDetailCover()') return;
      b.textContent = out ? 'Үлдэгдэлгүй' : 'Сагсанд нэмэх +'; b.disabled = out; b.classList.toggle('erp-nostock', out);
    });
  }
  document.addEventListener('click', e => {
    const chip = e.target.closest('.size-chip'); if (!chip) return;
    const p = findP(typeof detailProductId !== 'undefined' ? detailProductId : null); if (!p) return;
    picked = { id: p.id, label: chip.dataset.size }; paintDetail(p);
  });

  if (typeof openProduct === 'function') {
    const prev = openProduct;
    openProduct = function (id) { const p = findP(id); if (!picked || !p || picked.id !== p.id) picked = null; prev(id); if (hasSizes(p)) paintDetail(p); };
  }
  if (typeof add === 'function') {
    const prev = add;
    add = function (id) { return hasSizes(findP(id)) ? openProduct(id) : prev(id); };
  }
  if (typeof addDetailProduct === 'function') {
    const prev = addDetailProduct;
    addDetailProduct = function () {
      const p = findP(detailProductId);
      if (!hasSizes(p)) return prev();
      const s = p.sizes.find(x => picked && picked.id === p.id && x.label === picked.label);
      if (!s || (typeof s.qty === 'number' && s.qty <= 0)) return;
      cart.push({ id: p.id, colorCode: '', size: s.label, price: s.price || p.price, image: p.image });
      document.getElementById('count').textContent = cart.length;
      if (typeof renderDetailCart === 'function') renderDetailCart();
    };
  }
  // Cart lines differ by size, and use the size's own price.
  cartItemKey = function (item) { return JSON.stringify([Number(item.id), String(item.colorCode || '').trim(), String(item.size || '')]); };
  const itemPrice = item => Number(item.price) || (findP(item.id)?.price || 0);
  showCart = function () {
    const grouped = new Map();
    cart.forEach((item, index) => { const key = cartItemKey(item); if (!grouped.has(key)) grouped.set(key, { ...item, firstIndex: index, qty: 0 }); grouped.get(key).qty++; });
    document.getElementById('cartitems').innerHTML = grouped.size ? [...grouped.values()].map(item => {
      const p = findP(item.id); if (!p) return '';
      return `<div class="row"><div>${item.image ? `<img class="cart-photo" src="${esc(item.image)}" alt="${esc(p.name)}">` : ''}<b>${esc(p.name)}</b>${item.size ? `<div class="cart-size">${esc(p.sizeTitle || 'Хэмжээ')}: ${esc(item.size)}</div>` : ''}${item.colorCode ? `<div>Өнгөний код: ${esc(item.colorCode)}</div>` : ''}<br>${fmt(itemPrice(item))} × ${item.qty}</div><button onclick="removeCart(${item.firstIndex})">Устгах</button></div>`;
    }).join('') : 'Сагс хоосон байна.';
    document.getElementById('total').textContent = 'Нийт: ' + fmt(cart.reduce((sum, item) => sum + itemPrice(item), 0));
    document.getElementById('overlay').classList.add('show');
  };

  /* ---------- admin: size editor ---------- */
  const API = String(window.BUDDY_API || '').replace(/\/+$/, '');
  const token = () => { try { return localStorage.getItem('buddyshop_api_token') || ''; } catch (e) { return ''; } };
  let catalog = null;
  async function loadCatalog() {
    if (catalog) return catalog;
    const res = await fetch(API + '/api/erp/catalog', { headers: { authorization: 'Bearer ' + token() } });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || ('Алдаа ' + res.status));
    if (!d.items || !d.items.length) throw new Error('ERP-ийн барааны жагсаалт хоосон байна. Серверийг шинэчилсний дараа 15 минут хүлээнэ үү.');
    catalog = d.items.map(([code, name, price, qty]) => ({ code, name, price, qty, low: name.toLowerCase().replace(/\s+/g, ' ') }));
    return catalog;
  }
  // "Shimano Sedona 4000" → base "shimano sedona"; "Norfin winter suit FJORD M" → "norfin winter suit fjord"
  const VAR = /^(c?\d{3,5}[a-z]*|\d{1,2}(\.\d)?|xxs|xs|s|m|l|xl|xxl|2xl|3xl|4xl|mk|lk|fg|hg|xg|pg|%|\(\d+\)|#\d+)$/i;
  function family(name) {
    const t = String(name || '').replace(/\s+/g, ' ').trim().split(' ');
    while (t.length > 1 && VAR.test(t[t.length - 1].replace(/,$/, ''))) t.pop();
    return t.join(' ').toLowerCase();
  }
  function labelOf(name, base) {
    const rest = String(name).replace(/\s+/g, ' ').trim().slice(base.length).replace(/[%,]/g, ' ').replace(/\(\d+\)/g, ' ').replace(/\s+/g, ' ').trim();
    return rest || '';
  }

  const dlg = document.createElement('dialog'); dlg.className = 'size-dlg';
  document.body.append(dlg);
  let state = null; // { pid, q, rows:[{code,name,price,qty,label,on}], siteQ, err }

  function drawDlg() {
    const p = state.pid ? findP(state.pid) : null;
    const siteHits = !p && state.siteQ.trim().length > 1
      ? list().filter(x => (x.name + ' ' + (x.brand || '') + ' ' + (x.code || '')).toLowerCase().includes(state.siteQ.trim().toLowerCase())).slice(0, 12) : [];
    dlg.innerHTML = `<form method="dialog" class="sd-in" onsubmit="return false">
      <h3>Хэмжээ тохируулах</h3>
      <p class="sd-help">Сайтын нэг барааг ERP-ийн хэд хэдэн бараатай (хэмжээ бүрээр) холбоно. Хэрэглэгч барааны хуудсанд хэмжээгээ сонгож, хэмжээ бүрийн үнэ, Emart үлдэгдэл ERP-ээс шинэчлэгдэнэ.</p>
      ${p ? `<div class="sd-chosen">Сайтын бараа: ${esc(p.name)} <button type="button" data-d="change" style="margin-left:8px;font-weight:500">Солих</button></div>` :
        `<label>Сайтын бараа хайх<input type="search" id="sd-site" value="${esc(state.siteQ)}" placeholder="Жишээ: Sedona" autocomplete="off"></label>
         <div class="sd-pick">${siteHits.map(x => `<button type="button" data-d="pick" data-pid="${Number(x.id)}">${esc(x.name)} <small style="color:#5a6a72">${esc(x.brand || '')}${x.code ? ' · ' + esc(x.code) : ''}</small></button>`).join('')}</div>`}
      ${p ? `<label>ERP-ээс хайх<input type="search" id="sd-q" value="${esc(state.q)}" placeholder="Загварын нэр" autocomplete="off"></label>
      ${state.err ? `<div class="sd-err">⚠ ${esc(state.err)}</div>` : ''}
      <div class="sd-table"><table><thead><tr><th></th><th>Хэмжээ (сайт дээр харагдах)</th><th>ERP нэр</th><th>Код</th><th class="num">Үнэ</th><th class="num">Emart</th></tr></thead><tbody>
      ${state.rows.map((r, i) => `<tr><td><input type="checkbox" data-i="${i}" ${r.on ? 'checked' : ''} aria-label="Сонгох"></td><td><input type="text" data-l="${i}" value="${esc(r.label)}"></td><td>${esc(r.name)}</td><td><code>${esc(r.code)}</code></td><td class="num">${fmt(r.price)}</td><td class="num">${r.qty}</td></tr>`).join('') || `<tr><td colspan="6" style="color:#5a6a72">${catalog ? 'Илэрц алга. Нэрээ богиносгож хайна уу.' : 'Ачаалж байна…'}</td></tr>`}
      </tbody></table></div>` : ''}
      <div class="sd-foot">${p && hasSizes(p) ? '<button type="button" class="danger" data-d="clear">Хэмжээг арилгах</button>' : ''}<button type="button" data-d="close">Болих</button>${p ? '<button type="button" class="primary" data-d="save">Хадгалах</button>' : ''}</div>
    </form>`;
  }
  async function search(q, preselect) {
    state.q = q;
    try { await loadCatalog(); state.err = ''; } catch (e) { state.err = e.message; drawDlg(); return; }
    const qq = q.trim().toLowerCase();
    const base = family(q);
    const hits = qq ? catalog.filter(c => c.low.includes(qq) || (base && (c.low === base || c.low.startsWith(base + ' ')))).slice(0, 60) : [];
    const p = findP(state.pid);
    const mine = new Set((p && hasSizes(p) ? p.sizes.map(s => norm(s.code)) : []));
    const fam = base || qq;
    state.rows = hits.map(c => ({ ...c, label: (p && hasSizes(p) && p.sizes.find(s => norm(s.code) === norm(c.code))?.label) || labelOf(c.name, c.low.startsWith(fam) ? fam : '') || c.code,
      on: mine.has(norm(c.code)) || (preselect && (c.low === fam || c.low.startsWith(fam + ' '))) }))
      .sort((a, b) => natural(a.label, b.label));
    drawDlg();
  }
  window.openSizeEditor = function (pid, erpName) {
    state = { pid: pid || null, q: '', rows: [], siteQ: '', err: '' };
    drawDlg(); dlg.showModal();
    const p = pid && findP(pid);
    if (p) search(erpName ? family(erpName) : (hasSizes(p) ? family(catalog?.find(c => norm(c.code) === norm(p.sizes[0].code))?.name || p.name) : family(p.name.replace(/^.*?-\s*/, ''))), !!erpName || hasSizes(p));
  };
  dlg.addEventListener('click', e => {
    const b = e.target.closest('[data-d]'); if (!b) return;
    const d = b.dataset.d, p = findP(state.pid);
    if (d === 'close') return dlg.close();
    if (d === 'change') { state.pid = null; state.rows = []; return drawDlg(); }
    if (d === 'pick') { state.pid = Number(b.dataset.pid); const x = findP(state.pid); return search(family(x.name.replace(/^.*?-\s*/, '')), false); }
    if (d === 'clear' && p) {
      if (p.sizesPrev) { p.code = p.sizesPrev.code; p.name = p.sizesPrev.name; delete p.sizesPrev; }
      delete p.sizes; delete p.sizeTitle;
      if (typeof refresh === 'function') refresh(); return dlg.close();
    }
    if (d === 'save' && p) {
      const chosen = state.rows.filter(r => r.on);
      if (!chosen.length) { state.err = 'Дор хаяж нэг хэмжээ сонгоно уу.'; return drawDlg(); }
      const labels = chosen.map(r => r.label.trim());
      if (labels.some(l => !l) || new Set(labels).size !== labels.length) { state.err = 'Хэмжээ бүр давтагдашгүй нэртэй байх ёстой.'; return drawDlg(); }
      p.sizes = chosen.map(r => ({ label: r.label.trim(), code: r.code, price: r.price, qty: r.qty })).sort((a, b) => natural(a.label, b.label));
      p.code = p.sizes.map(s => s.code).join(' | ');
      const low = Math.min(...p.sizes.map(s => s.price).filter(Boolean));
      if (isFinite(low)) { p.price = low; p.regularPrice = low; }
      p.stock = p.erpQty = p.sizes.reduce((s, x) => s + (x.qty || 0), 0);
      if (typeof refresh === 'function') refresh();
      dlg.close();
      window.dispatchEvent(new CustomEvent('sizes-saved', { detail: { id: p.id, count: p.sizes.length } }));
    }
  });
  dlg.addEventListener('change', e => {
    if (e.target.dataset.i != null) state.rows[Number(e.target.dataset.i)].on = e.target.checked;
  });
  dlg.addEventListener('input', e => {
    if (e.target.dataset.l != null) { state.rows[Number(e.target.dataset.l)].label = e.target.value; return; }
    const keep = (id) => { const el = dlg.querySelector('#' + id); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } };
    if (e.target.id === 'sd-site') { state.siteQ = e.target.value; drawDlg(); keep('sd-site'); }
    if (e.target.id === 'sd-q') { const v = e.target.value; clearTimeout(dlg._t); dlg._t = setTimeout(() => search(v, false).then(() => keep('sd-q')), 250); }
  });
})();
