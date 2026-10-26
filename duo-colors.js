/* DUO color choices, verified 24 October 2026. */
(() => {
  const data = window.BUDDY_DUO_COLORS || {};
  for (const p of products) {
    const patch = data[String(p.id)];
    if (patch && !p.customColorOptions) Object.assign(p, JSON.parse(JSON.stringify(patch)));
  }
  const style = document.createElement('style');
  style.textContent = `.duo-choice-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:14px 0}.duo-choice{background:#fff;border:1px solid #c8d1d5;border-radius:6px;padding:8px;color:#10202c;min-height:62px}.duo-choice img{display:block;width:100%;height:65px;object-fit:contain}.duo-choice strong{display:block;font-size:12px;overflow-wrap:anywhere}.duo-choice small{display:block;font-size:10px;color:#67777e}.duo-choice[aria-pressed=true]{border:2px solid #b7682d;background:#fff8ef}.duo-status{font-size:12px;line-height:1.6;color:#455f51;min-height:20px}.duo-status.error{color:#a52323}.duo-photo-note{font-size:12px;line-height:1.5;color:#617078}.duo-color-select{width:100%;padding:12px;border:1px solid #70838d;border-radius:4px;background:white;min-height:44px}.duo-choice:focus-visible{outline:3px solid #d77a35;outline-offset:2px}@media(max-width:600px){.duo-choice-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}`;
  document.head.appendChild(style);
  function product() { return products.find(p => Number(p.id) === Number(detailProductId)); }
  function choices(p) { return p?.colorOptions || []; }
  function selected(p) {
    const code = document.getElementById('detail-color-code')?.value || '';
    return choices(p).find(o => o.code === code);
  }
  function message(text, error = false) {
    const el = document.getElementById('duo-color-status');
    if (el) { el.textContent = text; el.classList.toggle('error', error); }
  }
  function status(p) {
    const option = selected(p);
    const code = option?.code || '';
    document.querySelectorAll('.duo-choice').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.code === code)));
    if (!option) { message('Сагсанд нэмэхээс өмнө өнгөө сонгоно уу.'); return; }
    const price = document.querySelector('#detail-content .price');
    if (price) price.textContent = money(option.price);
    const info = option.stock == null ? 'Энэ өнгөний үлдэгдлийг лавлана уу.' : `Энэ өнгөний үлдэгдэл: ${option.stock} ширхэг.`;
    message(`${option.kind === 'shop-reference' ? 'Дэлгүүрийн зургийн код: ' : 'Өнгөний код: '}${code}. ${info}`);
  }
  const oldOpen = openProduct;
  openProduct = function(id) {
    oldOpen(id);
    const p = product();
    if (!choices(p).length) return;
    const field = document.getElementById('detail-color-code');
    const oldHint = field.nextElementSibling;
    const panel = document.createElement('div');
    panel.className = 'duo-color-panel';
    panel.innerHTML = `<select class="duo-color-select" id="detail-color-code" aria-label="Өнгөний код" required onchange="chooseDuoColor(this.value)"><option value="">Өнгөө сонгоно уу</option>${choices(p).map(o => `<option value="${safe(o.code)}" ${o.stock === 0 ? 'disabled' : ''}>${safe(o.code)}${o.name ? ' · '+safe(o.name) : ''}${o.kind === 'shop-reference' ? ' · Дэлгүүрийн зургийн код' : ''}${o.stock === 0 ? ' · Дууссан' : ''}</option>`).join('')}</select><div class="duo-choice-grid">${choices(p).map(o => `<button type="button" class="duo-choice" data-code="${safe(o.code)}" aria-pressed="false" aria-label="Өнгө ${safe(o.code)}" onclick="chooseDuoColor(${safe(JSON.stringify(o.code))})" ${o.stock === 0 ? 'disabled' : ''}>${o.image ? `<img src="${safe(o.image)}" alt="Өнгө ${safe(o.code)}" loading="lazy">` : ''}<strong>${safe(o.code)}${o.name ? ' · '+safe(o.name) : ''}</strong><small>${o.kind === 'shop-reference' ? 'Дэлгүүрийн зургийн код' : o.image ? 'Өнгө сонгох' : 'Өнгөний зураг баталгаажаагүй'}</small></button>`).join('')}</div><p id="duo-color-status" class="duo-status" role="status" aria-live="polite"></p>${choices(p).some(o => o.kind === 'shop-reference') ? '<p class="duo-photo-note">BS-ээр эхэлсэн код нь дэлгүүрийн зургийн лавлагаа код. Үйлдвэрлэгчийн өнгөний код болон үлдэгдлийг дэлгүүрээс баталгаажуулна.</p>' : ''}`;
    field.replaceWith(panel);
    if (oldHint?.classList.contains('detail-hint')) oldHint.remove();
    status(p);
  };
  const oldSelect = selectDetailImage;
  selectDetailImage = function(index) {
    const p = product();
    const previous = document.getElementById('detail-color-code')?.value || '';
    oldSelect(index);
    if (!choices(p).length) return;
    const code = currentDetailColor();
    const field = document.getElementById('detail-color-code');
    const option = choices(p).find(o => o.code === code && o.stock !== 0);
    field.value = option ? code : previous;
    status(p);
  };
  window.chooseDuoColor = function(code) {
    const p = product();
    const option = choices(p).find(o => o.code === code);
    if (!option || option.stock === 0) return;
    document.getElementById('detail-color-code').value = code;
    if (option.image) {
      const index = detailGallery.indexOf(option.image);
      if (index >= 0) oldSelect(index);
    }
    status(p);
  };
  const oldAddDetail = addDetailProduct;
  addDetailProduct = function() {
    const p = product();
    if (!choices(p).length) return oldAddDetail();
    const option = selected(p);
    if (!option) { message('Өнгөө сонгоно уу.', true); document.getElementById('detail-color-code').focus(); return; }
    const count = cart.filter(i => Number(i.id) === Number(p.id) && i.colorCode === option.code).length;
    const total = cart.filter(i => Number(i.id) === Number(p.id)).length;
    if ((option.stock != null && count >= option.stock) || (p.stock != null && total >= p.stock)) {
      message('Үлдэгдлээс илүү тоогоор нэмэх боломжгүй.', true); return;
    }
    cart.push({id:p.id,colorCode:option.code,variantId:option.variantId,image:option.image,unitPrice:option.price,availabilityConfirmed:option.stock != null,codeKind:option.kind});
    document.getElementById('count').textContent = cart.length;
    renderDetailCart();
    message(`${option.code} өнгө сагсанд нэмэгдлээ.${option.stock == null ? ' Өнгөний үлдэгдлийг дэлгүүрээс баталгаажуулна.' : ''}`);
  };
  const oldAdd = add;
  add = function(id) {
    const p = products.find(p => Number(p.id) === Number(id));
    if (choices(p).length) return openProduct(id);
    return oldAdd(id);
  };
  const oldRenderDetail = renderDetailCart;
  renderDetailCart = function() {
    oldRenderDetail();
    const box = document.getElementById('detail-added-items');
    if (box) box.querySelectorAll('img').forEach(img => { if (!img.getAttribute('src')) img.remove(); });
  };
  showCart = function() {
    const grouped = new Map();
    cart.forEach((item,index) => { const key=cartItemKey(item);if(!grouped.has(key))grouped.set(key,{...item,firstIndex:index,qty:0});grouped.get(key).qty++; });
    document.getElementById('cartitems').innerHTML = grouped.size ? [...grouped.values()].map(item => {
      const p=products.find(p=>Number(p.id)===Number(item.id));if(!p)return '';
      const amount=item.unitPrice ?? p.price;
      return `<div class="row"><div>${item.image?`<img class="cart-photo" src="${safe(item.image)}" alt="${safe(p.name)} ${safe(item.colorCode)}">`:''}<b>${safe(p.name)}</b>${item.colorCode?`<div>${item.codeKind==='shop-reference'?'Дэлгүүрийн зургийн код':'Өнгөний код'}: ${safe(item.colorCode)}</div>`:''}${item.availabilityConfirmed===false?'<small>Өнгөний үлдэгдлийг лавлана уу.</small>':''}<br>${money(amount)} × ${item.qty}</div><button onclick="removeCart(${item.firstIndex})">Устгах</button></div>`;
    }).join('') : 'Сагс хоосон байна.';
    document.getElementById('total').textContent='Нийт: '+money(cart.reduce((sum,item)=>sum+(item.unitPrice ?? products.find(p=>Number(p.id)===Number(item.id))?.price ?? 0),0));
    document.getElementById('overlay').classList.add('show');
  };
  persist();
  render();
  renderFeaturedLures();
})();
