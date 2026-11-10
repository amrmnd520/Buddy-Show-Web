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
  const BNPL = { storepay: { name: 'Storepay', icon: '🟣' }, pocket: { name: 'Pocket', icon: '🟢' } };
  // Storepay terms of use 3.1.1: one purchase is 100,000₮–10,000,000₮. Say so on the basket the
  // customer has rather than letting them choose Storepay and be refused after ordering.
  const SP_MIN = 100000, SP_MAX = 10000000;
  const spFits = (sum) => sum >= SP_MIN && sum <= SP_MAX;
  const payNav = () => `<button class="co-back" data-co="paychange" ${paying && paying.cancelling ? 'disabled' : ''}>← Төлбөрийн арга солих</button>`;
  const payCancel = () => `<button type="button" class="co-link" data-co="paycancel" ${paying && paying.cancelling ? 'disabled' : ''}>${paying && paying.cancelling ? 'Цуцалж байна…' : 'Захиалга цуцлах'}</button>
        <p class="co-sum">Цонхыг хаавал захиалга хадгалагдана — сагсаа нээгээд дараа нь төлж болно.</p>`;
  const goLabel = (m, sum) => m === 'qpay' && payOn ? `Захиалаад QPay-ээр төлөх · ${sum}` : BNPL[m] ? `${BNPL[m].name}-ээр захиалах · ${sum}` : `Захиалга илгээх · ${sum}`;
  // spOn: Storepay credentials are set on the server, so the loan request reaches the customer's
  // app by itself. Without them the choice still works — it just becomes an order staff handle by
  // hand — and the wording below says which of the two the customer is getting.
  let payOn = false, spOn = false, paying = null, pollTimer = null; // paying: { order, key, q, checking, msg }
  const checkPay = () => fetch(API + '/api/qpay/status', { cache: 'no-store' }).then(r => r.json()).then(d => {
    const was = payOn, wasSp = spOn;
    payOn = !!d.enabled; spOn = !!d.storepay;
    if ((was !== payOn || wasSp !== spOn) && view !== 'pay') paint();
  }).catch(() => {});
  checkPay();

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
.co-ship{background:#eef7f1;border:1px solid #cfe6d7;color:#1f5f3a;border-radius:6px;padding:9px 12px;font-size:13px;font-weight:600;margin:8px 0 0}
.co-hint button{background:none;border:0;padding:0;color:var(--blue,#203746);font:inherit;font-weight:700;text-decoration:underline;cursor:pointer}
.co-err{background:#fdecea;color:#b42318;border-radius:5px;padding:8px 10px;font-size:13px;margin-top:10px}
.co-ok{text-align:center;padding:10px 0}.co-ok .big{font-size:44px}.co-ok h3{margin:6px 0}.co-ok p{color:#5a6a72;line-height:1.5;font-size:14px}
.co-back{background:none;border:0;padding:0;color:var(--blue,#203746);text-decoration:underline;cursor:pointer;font:inherit;font-size:13px;margin-bottom:6px}
.co-sum{font-size:13px;color:#5a6a72;margin:4px 0 0}
.co-which{display:grid;gap:8px;margin-top:10px}
.co-which label{margin:0;border:1px solid #cfd6da;border-radius:6px;padding:10px;cursor:pointer;display:flex;gap:10px;align-items:flex-start;font-weight:400}
.co-which input{width:auto;margin-top:3px}.co-which span{display:flex;flex-direction:column;gap:2px}.co-which small{color:#5a6a72;font-size:13px;line-height:1.4}
.co-which label:has(input:checked){border-color:var(--orange,#d77a35);background:#fff7f0}
.co-which label:has(input:disabled){opacity:.55;cursor:default;background:#f6f7f8}.co-which label:has(input:disabled) small{color:#8a5a2b}
.co-pay{text-align:center;display:flex;flex-direction:column}
.co-link{background:none;border:0;color:#b42318;font:inherit;font-weight:600;text-decoration:underline;cursor:pointer;padding:8px;margin-top:4px}.co-link:disabled{opacity:.5;cursor:default}
.co-pend{background:#fff4e5;border:1px solid #f3d3a8;border-radius:8px;padding:12px;margin:0 0 12px;font-size:14px;display:grid;gap:8px}.co-pend-b{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.co-pend .co-go{width:auto;flex:1;margin:0}
.co-steps{text-align:left;margin:10px 0;padding-left:22px;line-height:1.6;font-size:14px}.co-sp-app{display:block;margin:4px 0 10px;padding:10px;border-radius:8px;background:#5b2bd6;color:#fff;font-weight:700;text-decoration:none}
@media(max-width:700px),(pointer:coarse){.co-pay .co-banks{order:-1;margin-top:4px}.co-pay h3{order:-3}.co-pay .co-sum:first-of-type{order:-2}.co-pay .co-qr{width:150px}.co-pay .phone-hint{display:block!important}.co-pay .desk-hint{display:none}}.co-pay h3{margin:0 0 4px}.co-pay .amt{font-size:18px}
.co-qr{width:230px;max-width:80%;aspect-ratio:1;image-rendering:pixelated;border:1px solid #e3e7e9;border-radius:8px;padding:8px;background:#fff;margin:10px auto;display:block}
.co-banks{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:10px 0;text-align:center}
.co-banks a{display:flex;flex-direction:column;align-items:center;gap:4px;font-size:11px;color:inherit;text-decoration:none;border:1px solid #e3e7e9;border-radius:8px;padding:8px 4px;background:#fff}
.co-banks img{width:36px;height:36px;border-radius:8px;object-fit:contain}
.co-wait{display:flex;gap:8px;align-items:center;justify-content:center;font-size:13px;color:#5a6a72;margin:10px 0}
.co-wait .dot{width:10px;height:10px;border-radius:50%;background:#d77a35;animation:coPulse 1s infinite alternate}@keyframes coPulse{from{opacity:.3}to{opacity:1}}
@media(min-width:900px){.co-banks{grid-template-columns:repeat(5,1fr)}}
.co-toast{position:sticky;bottom:12px;margin:0 16px;display:flex;gap:12px;align-items:center;justify-content:space-between;background:#10202c;color:#fff;border-radius:10px;padding:12px 14px;font-size:14px;box-shadow:0 8px 24px rgba(0,0,0,.25);opacity:0;transform:translateY(12px);pointer-events:none;transition:.25s;z-index:5}
.co-toast.show{opacity:1;transform:none;pointer-events:auto}.co-toast button{background:var(--orange,#d77a35);color:#fff;border:0;border-radius:6px;padding:8px 12px;font-weight:800;cursor:pointer;white-space:nowrap}
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
    if (view === 'pay' && paying && paying.sp) {
      const o = paying.order;
      area.innerHTML = `${payNav()}<div class="co-pay"><h3>🟣 Storepay-ээр төлөх</h3>
        <p class="co-sum">Захиалга <b>${esc(o.number)}</b> · Дүн <b class="amt">${fmt(o.total)}</b></p>
        <ol class="co-steps"><li><b>${esc(paying.sp.phone)}</b> дугаартай <b>Storepay</b> апп-аа нээнэ үү.</li>
          <li>Buddy Shop-ийн <b>${fmt(o.total)}</b>-ийн худалдан авалтын хүсэлтийг <b>баталгаажуулна</b> уу.</li>
          <li>Баталгаажуулмагц энэ хэсэг автоматаар шинэчлэгдэнэ.</li></ol>
        <a class="co-sp-app" href="https://storepay.mn" target="_blank" rel="noopener">Storepay апп нээх ↗</a>
        <div class="co-wait"><span class="dot"></span> Storepay-ийн баталгаажуулалтыг хүлээж байна…</div>
        ${paying.msg ? `<div class="co-err">${esc(paying.msg)}</div>` : ''}
        <button class="co-go" data-co="paycheck" ${paying.checking ? 'disabled' : ''}>${paying.checking ? 'Шалгаж байна…' : 'Баталгаажуулсан — шалгах'}</button>
        ${payCancel()}</div>`;
      return;
    }
    if (view === 'pay' && paying) {
      const o = paying.order, q = paying.q;
      area.innerHTML = `${payNav()}<div class="co-pay"><h3>QPay-ээр төлөх</h3>
        <p class="co-sum">Захиалга <b>${esc(o.number)}</b> · Төлөх дүн <b class="amt">${fmt(o.total)}</b></p>
        ${q.qr ? `<img class="co-qr" src="${esc(q.qr)}" alt="QPay QR код">` : ''}
        <p class="co-sum desk-hint">Банкны апп-аараа QR кодыг уншуулна уу.${q.banks.length ? ' Утсаараа бол доорх банкаа сонгоно уу:' : ''}</p>
        <p class="co-sum phone-hint" style="display:none;order:-2">👇 Банкаа сонгоход апп нь нээгдэж төлбөр бэлэн бөглөгдсөн байна. Өөр утсаар уншуулах бол доорх QR-ийг ашиглана.</p>
        ${q.banks.length ? `<div class="co-banks">${q.banks.map(b => `<a href="${esc(b.link)}" rel="noopener">${b.logo ? `<img src="${esc(b.logo)}" alt="" loading="lazy">` : ''}<span>${esc(b.name)}</span></a>`).join('')}</div>` : ''}
        ${q.link ? `<p class="co-sum"><a href="${esc(q.link)}" target="_blank" rel="noopener">QPay холбоосоор нээх ↗</a></p>` : ''}
        <div class="co-wait"><span class="dot"></span> Төлбөр хүлээж байна… төлсний дараа энэ хэсэг автоматаар шинэчлэгдэнэ.</div>
        ${paying.msg ? `<div class="co-err">${esc(paying.msg)}</div>` : ''}
        <button class="co-go" data-co="paycheck" ${paying.checking ? 'disabled' : ''}>${paying.checking ? 'Шалгаж байна…' : 'Төлбөрөө төлсөн — шалгах'}</button>
        ${payCancel()}</div>`;
      return;
    }
    if (view === 'done' && done) {
      area.innerHTML = `<div class="co-ok"><div class="big">✅</div><h3>${done.paid ? `Төлбөр амжилттай — ${esc(done.number)}` : `Захиалга ${esc(done.number)} хүлээн авлаа`}</h3>
        ${done.paid
          ? `<p><b>${fmt(done.paidAmount || done.total)}</b> ${done.payMethod === 'storepay' ? 'Storepay-ээр баталгаажлаа' : 'төлөгдлөө'}. Баярлалаа! Манай ажилтан <b>${esc(done.phone)}</b> дугаарт ${done.delivery === 'pickup' ? 'бараагаа авах цагийг' : 'хүргэлтийн цагийг'} мэдэгдэнэ.</p>`
          : BNPL[done.payMethod] ? `<p>Нийт <b>${fmt(done.total)}</b>. Та <b>${BNPL[done.payMethod].name}</b>-ээр хуваан төлөхийг сонгосон. Манай ажилтан удахгүй <b>${esc(done.spPhone || done.phone)}</b> дугаар руу ${BNPL[done.payMethod].name} нэхэмжлэх илгээнэ — ${BNPL[done.payMethod].name} апп дээрээ баталгаажуулна уу.</p>`
          : `<p>Нийт <b>${fmt(done.total)}</b>. Манай ажилтан удахгүй <b>${esc(done.phone)}</b> дугаарт холбогдож, төлбөр болон ${done.delivery === 'pickup' ? 'авах цагийг' : 'хүргэлтийг'} баталгаажуулна.</p>`}
        ${done.qpayError ? `<div class="co-err">${esc(done.qpayError)}</div>` : ''}
        ${done.storepayError ? `<div class="co-err">${esc(done.storepayError)}</div>` : ''}
        ${done.email ? `<p>Баталгаажуулах имэйл ${esc(done.email)} хаяг руу илгээгдлээ.</p>` : ''}
        ${a ? '<p>Захиалга тань «Миний бүртгэл → Захиалгууд» хэсэгт хадгалагдлаа.</p>' : ''}
        <button class="co-go" data-co="close">Дэлгүүр үргэлжлүүлэх</button></div>`;
      return;
    }
    const pend = paying ? `<div class="co-pend"><div><b>${esc(paying.order.number)}</b> · ${fmt(paying.order.total)} — ${paying.sp ? 'Storepay баталгаажуулалт' : 'төлбөр'} хүлээгдэж байна</div>
      <div class="co-pend-b"><button type="button" class="co-go" data-co="payopen">Төлөх →</button><button type="button" class="co-link" data-co="paycancel" ${paying.cancelling ? 'disabled' : ''}>${paying.cancelling ? 'Цуцалж байна…' : 'Захиалга цуцлах'}</button></div>
      ${paying.msg ? `<div class="co-err">${esc(paying.msg)}</div>` : ''}</div>` : '';
    if (!l.length) { area.innerHTML = pend; view = 'cart'; return; }
    if (view === 'cart') {
      area.innerHTML = `${pend}<button class="co-go" data-co="checkout">Захиалга өгөх →</button>
        <p class="co-sum">${payOn ? `QPay-ээр шууд, эсвэл ${spFits(total(l)) ? 'Storepay, Pocket' : 'Pocket'}-оор хуваан төлөх боломжтой.` : `${spFits(total(l)) ? 'Storepay эсвэл Pocket' : 'Pocket'}-оор хуваан төлөх боломжтой.`}</p>`;
      return;
    }
    // checkout form
    const f = form || {
      name: a ? a.name : '', phone: a ? a.phone : '', email: a ? a.email : '', delivery: 'delivery', note: '', save: false, pay: 'qpay', spPhone: '',
    };
    const spOk = spFits(total(l));
    let pm = (f.pay === 'qpay' && payOn) || BNPL[f.pay] ? f.pay : (payOn ? 'qpay' : 'storepay');
    if (pm === 'storepay' && !spOk) pm = payOn ? 'qpay' : 'pocket';
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
        <div class="co-sec">Төлбөр</div>
        <div class="co-which">${payOn ? `<label><input type="radio" name="co-pay" value="qpay" ${pm === 'qpay' ? 'checked' : ''}><span><b>💳 QPay-ээр одоо төлөх</b><small>QR код эсвэл банкны апп-аар шууд</small></span></label>` : ''}
          <label><input type="radio" name="co-pay" value="storepay" ${pm === 'storepay' ? 'checked' : ''} ${spOk ? '' : 'disabled'}><span><b>🟣 Storepay — хуваан төлөх</b><small>${!spOk
            ? (total(l) < SP_MIN ? `Storepay ${fmt(SP_MIN)}-с дээш захиалгад л боломжтой — одоогоор ${fmt(total(l))}` : `Storepay ${fmt(SP_MAX)}-с дээш захиалга авдаггүй`)
            : spOn ? 'Storepay апп руу тань хүсэлт шууд очно — зөвшөөрөхөд л болно' : 'Ажилтан таны утас руу Storepay нэхэмжлэх илгээнэ'}</small></span></label>
          <label><input type="radio" name="co-pay" value="pocket" ${pm === 'pocket' ? 'checked' : ''}><span><b>🟢 Pocket — хуваан төлөх</b><small>Ажилтан таны утас руу Pocket нэхэмжлэх илгээнэ</small></span></label></div>
        <div id="co-sp" style="${pm === 'storepay' && spOn ? '' : 'display:none'}">
          <label for="co-spphone">Storepay-д бүртгэлтэй утас <small style="font-weight:400;color:#5a6a72">(өөр дугаар бол)</small></label>
          <input id="co-spphone" type="tel" maxlength="20" value="${esc(f.spPhone)}" placeholder="Хоосон бол дээрх утас руу очно">
          <p class="co-sum" style="text-align:left;margin:4px 0 0">Зээлийн хүсэлт энэ дугаарын Storepay апп дээр гарна. Хүргэлтийн утас болон Storepay-ийн бүртгэл өөр байвал энд бүртгэлтэй дугаараа бичнэ үү.</p></div>
        ${err ? `<div class="co-err">${esc(err)}</div>` : ''}
        <button class="co-go" ${busy ? 'disabled' : ''}>${busy ? 'Илгээж байна…' : goLabel(pm, fmt(total(l)))}</button>
      </form>`;
  }

  function read() {
    const g = id => (area.querySelector('#' + id) || {}).value || '';
    const way = area.querySelector('input[name="co-way"]:checked');
    const a = acc() && acc().get();
    const w = area.querySelector('input[name="co-which"]:checked');
    const which = savedAddr(a) && w ? w.value : 'new';
    return {
      name: g('co-name').trim(), phone: g('co-phone').trim(), email: g('co-email').trim(), note: g('co-note').trim(), spPhone: g('co-spphone').trim(),
      delivery: way ? way.value : 'delivery', which, save: !!area.querySelector('#co-save')?.checked,
      pay: (area.querySelector('input[name="co-pay"]:checked') || {}).value || (payOn ? 'qpay' : (spFits(total(lines())) ? 'storepay' : 'pocket')),
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
    if (a === 'checkout') { view = 'form'; err = ''; paint(); area.querySelector('#co-name')?.focus(); checkPay(); }
    else if (a === 'back') { form = read(); view = 'cart'; paint(); }
    else if (a === 'login') { form = read(); acc() && acc().open('Нэвтэрсний дараа сагс руугаа буцаж захиалгаа үргэлжлүүлнэ үү.'); }
    else if (a === 'close') { view = 'cart'; done = null; typeof hideCart === 'function' && hideCart(); }
    else if (a === 'paycheck') pollPay(true);
    else if (a === 'payopen') { view = 'pay'; paint(); }
    else if (a === 'paychange') cancelPay(true);
    else if (a === 'paycancel') cancelPay(false);
  });
  area.addEventListener('change', e => {
    if (e.target.name === 'co-pay') {
      const b = area.querySelector('.co-go:not([data-co])'); if (b) b.textContent = goLabel(e.target.value, fmt(total(lines())));
      const sp = area.querySelector('#co-sp'); if (sp) sp.style.display = e.target.value === 'storepay' && spOn ? '' : 'none';
    }
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
        items: l, name: v.name, phone: v.phone, email: v.email, delivery: v.delivery, address, addr: v.delivery === 'pickup' ? null : v.addr, note: v.note, spPhone: v.spPhone, pay: v.pay === 'qpay' && !payOn ? (spFits(total(l)) ? 'storepay' : 'pocket') : v.pay }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || ('Алдаа ' + res.status));
      form = null;
      const keep = { backup: cart.map(x => ({ ...x })), form: v };
      if (d.qpay) { paying = { order: d.order, key: d.payKey, q: d.qpay, ...keep }; view = 'pay'; startPolling(); }
      else if (d.storepay) { paying = { order: d.order, key: d.payKey, sp: d.storepay, ...keep }; view = 'pay'; startPolling(); }
      else { done = d.order; view = 'done'; }
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

  // QPay: our server is told by QPay's callback; the page only asks our server (every 4 s, for 20 min).
  // «Төлбөрөө төлсөн — шалгах» asks QPay once (the server allows that at most every 10 s).
  // cancel the unpaid order and put its items back in the cart (toForm: straight back to the order form)
  async function cancelPay(toForm) {
    if (!paying || paying.cancelling) return;
    paying.cancelling = true; paying.msg = ''; paint();
    try {
      const r = await fetch(`${API}/api/orders/${paying.order.id}/cancel?k=${encodeURIComponent(paying.key)}`, { method: 'POST', cache: 'no-store' });
      const d = await r.json().catch(() => ({}));
      if (d.paid) { paying.cancelling = false; await pollPay(false); return; }
      if (!r.ok) throw new Error(d.error || ('Алдаа ' + r.status));
      clearInterval(pollTimer);
      const p = paying; paying = null;
      if (!cart.length) p.backup.forEach(x => cart.push(x));
      const c = document.getElementById('count'); if (c) c.textContent = String(cart.length);
      try { typeof showCart === 'function' && document.getElementById('overlay')?.classList.contains('show') && showCart(); } catch (e) {}
      form = p.form || null; view = toForm ? 'form' : 'cart'; err = '';
    } catch (e) { if (paying) { paying.cancelling = false; paying.msg = e.message || 'Цуцалж чадсангүй, дахин оролдоно уу.'; } }
    paint();
  }
  function startPolling() {
    clearInterval(pollTimer);
    const until = Date.now() + 20 * 60e3;
    let tick = 0;
    pollTimer = setInterval(() => { if (Date.now() > until) clearInterval(pollTimer); else pollPay(false, !!(paying && paying.sp) && ++tick % 5 === 0); }, 4000);
  }
  async function pollPay(check, quiet) {
    if (!paying) return;
    if (check) { paying.checking = true; paying.msg = ''; paint(); }
    try {
      const r = await fetch(`${API}/api/orders/${paying.order.id}/pay?k=${encodeURIComponent(paying.key)}${check || quiet ? '&check=1' : ''}`, { cache: 'no-store' });
      const d = await r.json().catch(() => ({}));
      if (d.paid) {
        clearInterval(pollTimer);
        done = { ...paying.order, paid: true, paidAmount: d.paidAmount }; paying = null; view = 'done';
        acc() && acc().get() && acc().reload().catch(() => {});
      } else if (d.short) {
        clearInterval(pollTimer);
        paying.msg = `Дутуу төлөгдсөн: ${fmt(d.paidAmount)} / ${fmt(d.total)}. Манай ажилтан тантай холбогдоно.`;
      } else if (check) paying.msg = paying.sp ? 'Storepay-ээс баталгаажуулалт хараахан ирээгүй байна. Апп дээрээ баталгаажуулаад хэдэн секундын дараа дахин шалгана уу.' : 'Төлбөр хараахан орж ирээгүй байна. Төлсөн бол хэдэн секунд хүлээгээд дахин шалгана уу.';
    } catch (e) { if (check) paying.msg = 'Холболт тасарлаа, дахин оролдоно уу.'; }
    if (paying) paying.checking = false;
    if (check || view === 'done' || (paying && paying.msg)) paint();
  }

  // repaint whenever the cart opens or changes
  if (typeof window.showCart === 'function') {
    const prev = window.showCart;
    window.showCart = function (...a) { const out = prev.apply(this, a); if (view === 'done') view = 'cart', done = null; if (view === 'pay') { view = 'cart'; } try { paint(); } catch (e) {} return out; };
  }
  // «Сагсанд нэмэх» on the product page: go straight to the cart (the product window closes).
  // Products with colour options stay open (several colours are often added) and show «Сагс руу очих».
  if (typeof window.addDetailProduct === 'function') {
    const prevAdd = window.addDetailProduct;
    window.addDetailProduct = function (...a) {
      const before = typeof cart !== 'undefined' ? cart.length : 0;
      const out = prevAdd.apply(this, a);
      try {
        if (typeof cart !== 'undefined' && cart.length > before && typeof showCart === 'function') {
          const dlg = document.getElementById('product-detail'); // a modal dialog sits above everything
          const item = cart[cart.length - 1];
          const p = (typeof products !== 'undefined' ? products : []).find(x => Number(x.id) === Number(item.id));
          const colours = !!(item.colorCode || (p && Array.isArray(p.colorOptions) && p.colorOptions.length));
          const goCart = () => { if (dlg && dlg.open) dlg.close(); view = 'cart'; done = null; showCart(); };
          if (!colours) setTimeout(goCart, 250);
          else {
            // colour products: customers often add several colours — stay, and offer the cart
            let toast = dlg && dlg.querySelector('.co-toast');
            if (dlg && !toast) { toast = document.createElement('div'); toast.className = 'co-toast'; dlg.appendChild(toast); }
            if (toast) {
              const n = cart.filter(x => Number(x.id) === Number(item.id)).length;
              toast.innerHTML = `<span>✓ Сагсанд нэмэгдлээ${item.colorCode ? ` · өнгө ${esc(item.colorCode)}` : ''}${n > 1 ? ` (энэ бараанаас ${n})` : ''}</span><button type="button">Сагс руу очих →</button>`;
              toast.querySelector('button').onclick = goCart;
              toast.classList.remove('show'); void toast.offsetWidth; toast.classList.add('show');
              clearTimeout(toast._t); toast._t = setTimeout(() => toast.classList.remove('show'), 6000);
            }
          }
        }
      } catch (e) {}
      return out;
    };
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
.tg-box{border:1px solid #e3e7e9;border-radius:8px;margin:8px 0 4px;background:#fafbfc}.tg-head{width:100%;text-align:left;background:none;border:0;padding:10px 12px;font:inherit;font-weight:700;cursor:pointer;display:flex;justify-content:space-between}
.tg-steps,.tg-p,.tg-list,.tg-acts{margin:0 12px 10px;font-size:14px;line-height:1.6}.tg-row{display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid #eef1f3}.tg-acts{display:flex;gap:8px;flex-wrap:wrap}.tg-steps code{background:#eef3f6;padding:1px 5px;border-radius:3px;font-size:12px}
.ord-pay{background:#fff4e5;border-radius:6px;padding:6px 10px}.ord-pay.ok{background:#eef7f0;color:#1f5f3a}.ord-pay button{margin-left:8px}.ord-warn{background:#fdecea;color:#b42318;border-radius:6px;padding:6px 10px}
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
  // ---------- Telegram alerts setup ----------
  let tg = { open: false, st: null, found: null, msg: '', busy: false };
  const tgCall = async (path, opts = {}) => {
    const res = await fetch(API + path, { ...opts, headers: { authorization: 'Bearer ' + staffToken(), 'content-type': 'application/json' }, cache: 'no-store' });
    const d = await res.json().catch(() => ({}));
    if (!res.ok || d.error) throw new Error(d.error || ('Алдаа ' + res.status));
    return d;
  };
  async function tgLoad() { try { tg.st = await tgCall('/api/telegram'); } catch (e) { tg.st = { error: e.message, chats: [] }; } draw(); }
  function tgHtml() {
    const s = tg.st;
    const head = !s ? '🔔 Telegram мэдэгдэл…' : !s.configured ? '🔕 Telegram мэдэгдэл тохируулаагүй'
      : s.chats.length ? `🔔 Telegram: ${s.chats.length} чат руу мэдэгдэл очно` : '🔕 Telegram: чат холбогдоогүй';
    let h = `<div class="tg-box"><button type="button" class="tg-head" data-tg="toggle">${esc(head)} <span>${tg.open ? '▲' : '▼'}</span></button>`;
    if (tg.open && s) {
      if (!s.configured) {
        h += `<ol class="tg-steps"><li>Telegram дээр <b>@BotFather</b> → <code>/newbot</code> → нэр: <i>Buddy Shop Orders</i> → бот үүсгээд token-ийг хуулна.</li>
          <li>Terminal: <code>cd ~/src/Buddy-Show-Web/buddy-shop-api && npx wrangler secret put TELEGRAM_BOT_TOKEN</code> → token-оо буулгана.</li>
          <li>Энэ хуудсыг шинэчлээд дахин нээнэ.</li></ol>`;
      } else {
        h += `<p class="tg-p">Бот: ${s.bot ? `<a href="https://t.me/${esc(s.bot)}" target="_blank" rel="noopener">@${esc(s.bot)}</a>` : esc(s.error || '')}.
          Мэдэгдэл авах хүн бот руу <b>/start</b> гэж бичнэ (эсвэл ботыг ажилчдын группт нэмээд тэнд нэг мессеж бичнэ), дараа нь «Чат хайх» дарна.</p>
          <div class="tg-list">${s.chats.map(c => `<div class="tg-row"><span>✅ ${esc(c.title)}</span><button type="button" data-tg="off" data-id="${esc(c.id)}">Салгах</button></div>`).join('') || '<div class="tg-p">Холбогдсон чат алга.</div>'}</div>
          ${tg.found ? `<div class="tg-list">${tg.found.filter(c => !s.chats.some(x => x.id === c.id)).map(c => `<div class="tg-row"><span>${c.type === 'private' ? '👤' : '👥'} ${esc(c.title)}</span><button type="button" data-tg="on" data-id="${esc(c.id)}" data-title="${esc(c.title)}">Холбох</button></div>`).join('') || '<div class="tg-p">Шинэ чат олдсонгүй. Бот руу /start гэж бичээд дахин хайна уу.</div>'}</div>` : ''}
          <div class="tg-acts"><button type="button" data-tg="find">🔍 Чат хайх</button>${s.chats.length ? '<button type="button" data-tg="test">Туршилтын мэдэгдэл илгээх</button>' : ''}</div>`;
      }
      if (tg.msg) h += `<div class="tg-p" style="color:#1f5f3a">${esc(tg.msg)}</div>`;
    }
    return h + '</div>';
  }
  panel.addEventListener('click', async e => {
    const b = e.target.closest('[data-tg]'); if (!b || tg.busy) return;
    const a = b.dataset.tg; tg.msg = '';
    if (a === 'toggle') { tg.open = !tg.open; draw(); if (tg.open) tgLoad(); return; }
    tg.busy = true; b.disabled = true;
    try {
      if (a === 'find') { tg.found = (await tgCall('/api/telegram/find')).chats; }
      if (a === 'on' || a === 'off') { const d = await tgCall('/api/telegram/chats', { method: 'POST', body: JSON.stringify({ id: b.dataset.id, title: b.dataset.title, on: a === 'on' }) }); tg.st.chats = d.chats; tg.msg = a === 'on' ? 'Холбогдлоо — тэр чат руу баталгаажуулах мессеж очлоо.' : 'Салгалаа.'; }
      if (a === 'test') { const d = await tgCall('/api/telegram/test', { method: 'POST' }); tg.msg = `${d.sent} чат руу туршилтын мэдэгдэл илгээлээ.`; }
    } catch (err) { tg.msg = '⚠ ' + err.message; }
    tg.busy = false; draw();
  });

  async function qcheck(id) {
    const res = await fetch(API + '/api/orders/' + id + '/qpay-check', { method: 'POST', headers: { authorization: 'Bearer ' + staffToken() } });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { loadErr = d.error || 'Шалгаж чадсангүй'; draw(); return; }
    data.items = data.items.map(o => (o.id === id ? { ...o, ...d } : o)); loadErr = d.paid ? '' : `${d.number}: төлбөр хараахан ороогүй байна.`; draw();
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
    panel.innerHTML = `<div class="eyebrow">ORDERS</div><h2>Захиалгууд ${n('new') ? `<span class="ord-badge">${n('new')} шинэ</span>` : ''}</h2>${tgHtml()}
      <div class="bar">${chips.map(([k, l, c]) => `<button type="button" data-f="${k}" class="${filter === k ? 'on' : ''}">${esc(l)} (${c})</button>`).join('')}<button type="button" data-r>↻ Шинэчлэх</button></div>
      ${loadErr ? `<div class="co-err">${esc(loadErr)}</div>` : ''}
      ${!data ? '' : !list.length ? '<p class="note">Захиалга алга.</p>' : list.slice(page * PER, page * PER + PER).map(o => `<div class="ord-row">
        <div class="ord-head" data-o="${o.id}"><b>${esc(o.number)}</b><span>${dtm(o.createdAt)}</span><span>${esc(o.name)} · ${esc(o.phone)}</span>
          <span>${o.delivery === 'pickup' ? '🏬 Очиж авна' : '🚚 Хүргэлт'}</span><span class="n">${fmt(o.total)}${o.paid ? ' <span title="QPay-ээр төлсөн">💳</span>' : o.payMethod === 'qpay' ? ' <span title="QPay төлбөр хүлээгдэж байна">⏳</span>' : BNPL[o.payMethod] ? ` <span title="${BNPL[o.payMethod].name}">${BNPL[o.payMethod].icon}</span>` : ''}</span><span class="ord-st ${esc(o.status)}">${esc(o.statusText)}</span></div>
        ${openId === o.id ? `<div class="ord-body"><div><table>${o.items.map(i => `<tr><td><img src="${esc(i.image)}" alt="" loading="lazy"></td>
            <td><b>${esc(i.name)}</b>${i.size ? `<br>Хэмжээ: ${esc(i.size)}` : ''}${i.colorCode ? `<br>Өнгө: ${esc(i.colorCode)}` : ''}<br><small>${esc(i.brand)}${i.code ? ' · код ' + esc(i.code) : ''}</small></td>
            <td style="text-align:right;white-space:nowrap">${fmt(i.price)} × ${i.qty}<br><b>${fmt(i.price * i.qty)}</b></td></tr>`).join('')}
            <tr><td></td><td><b>Нийт</b></td><td style="text-align:right"><b>${fmt(o.total)}</b></td></tr></table></div>
          <div><p><b>${esc(o.name)}</b><br>📞 <a href="tel:${esc(o.phone)}">${esc(o.phone)}</a>${o.email ? `<br>✉️ <a href="mailto:${esc(o.email)}">${esc(o.email)}</a>` : ''}${o.customerId ? '<br><small>Бүртгэлтэй хэрэглэгч</small>' : '<br><small>Зочин</small>'}</p>
            <p>${o.delivery === 'pickup' ? '🏬 Дэлгүүрээс очиж авна' : '🚚 ' + esc(o.address)}</p>${o.note ? `<p>📝 ${esc(o.note)}</p>` : ''}
            <p class="ord-pay ${o.paid ? 'ok' : ''}">${o.paid ? `${o.payMethod === 'storepay' ? '🟣 Storepay-ээр' : '💳 QPay-ээр'} төлсөн: <b>${fmt(o.paidAmount)}</b> · ${dtm(o.paidAt)}${o.paidAmount < o.total ? ' — ⚠ дутуу' : ''}`
              : o.payMethod === 'qpay' ? `⏳ QPay төлбөр хүлээгдэж байна <button type="button" data-qc="${o.id}">QPay шалгах</button>`
              : o.payMethod === 'storepay' && o.spLoan ? `⏳ Storepay баталгаажуулалт хүлээгдэж байна (зээл #${esc(o.spLoan)}${o.spPhone ? ` · ${esc(o.spPhone)} дугаарт` : ''}) <button type="button" data-qc="${o.id}">Storepay шалгах</button>` : BNPL[o.payMethod] ? `${BNPL[o.payMethod].icon} <b>${BNPL[o.payMethod].name}</b> — хэрэглэгчийн ${esc(o.spPhone || o.phone)} дугаар руу ${BNPL[o.payMethod].name} нэхэмжлэх илгээнэ үү` : '🤝 Дараа төлөх — ажилтан төлбөрийг тохирно'}</p>
            ${o.priceCheck && o.priceCheck !== 'ok' ? `<p class="ord-warn">⚠ ${esc(o.priceCheck)}</p>` : ''}
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
    else if (t.closest('[data-qc]')) { const b = t.closest('[data-qc]'); b.disabled = true; b.textContent = 'Шалгаж байна…'; qcheck(Number(b.dataset.qc)); }
    else if (t.closest('[data-save]')) { const id = Number(t.closest('[data-save]').dataset.save); update(id, { staffNote: panel.querySelector(`[data-sn="${id}"]`).value }); }
    else if (t.closest('.ord-head')) { const id = Number(t.closest('.ord-head').dataset.o); openId = openId === id ? null : id; draw(); }
  });
  panel.addEventListener('change', e => { if (e.target.dataset.st) update(Number(e.target.dataset.st), { status: e.target.value }); });
  adminSection.prepend(panel);
  draw();
  let was = false;
  setInterval(() => {
    const now = document.body.classList.contains('staff-signed-in');
    if (now && !was) { load(); tgLoad(); }
    was = now;
  }, 1500);
  setInterval(() => { if (document.body.classList.contains('staff-signed-in') && document.visibilityState === 'visible' && !openId) load(); }, 60000);
})();
