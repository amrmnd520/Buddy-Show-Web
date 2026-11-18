/* Cart links: buddyshop.mn/?cart=<id>[~<size>][*<qty>],<id>...  (used by the Messenger bot)
   e.g. ?cart=17945566079862~M         one Norfin Element 2+, size M
        ?cart=105506*2,129647          two of one product, one of another
   - The products are put in the cart (sizes keep their own price; an item already in the cart
     is not added twice when the same link is opened again).
   - Signed in on this browser → the cart opens straight away.
   - Not signed in → the account window opens on «Шинээр бүртгүүлэх» (with the usual
     «Нэвтрэх» link for people who already have an account). As soon as they are signed in
     with a password set, the window closes and the cart opens. */
(() => {
  const raw = new URLSearchParams(location.search).get('cart');
  if (!raw) return;
  const wanted = raw.split(',').map(s => {
    const m = s.trim().match(/^(\d+)(?:~([^*]+))?(?:\*(\d+))?$/);
    if (!m) return null;
    let size = ''; try { size = m[2] ? decodeURIComponent(m[2]).trim() : ''; } catch (e) { size = m[2] || ''; }
    return { id: Number(m[1]), size, qty: Math.min(Math.max(Number(m[3]) || 1, 1), 20) };
  }).filter(Boolean);
  // drop ?cart= from the address bar so a refresh does not add the items again
  const clean = () => { try { const u = new URL(location.href); u.searchParams.delete('cart'); history.replaceState(history.state, '', u.pathname + (u.search || '') + u.hash); } catch (e) {} };
  const find = id => (typeof products !== 'undefined' ? products : []).find(p => Number(p.id) === Number(id));
  const count = () => { const c = document.getElementById('count'); if (c) c.textContent = cart.length; };

  function addAll() {
    const added = [];
    for (const w of wanted) {
      const p = find(w.id); if (!p) continue;
      let size = '', price = p.price;
      if (Array.isArray(p.sizes) && p.sizes.length) {
        const s = p.sizes.find(x => String(x.label).toLowerCase() === w.size.toLowerCase()) ||
          (p.sizes.length === 1 ? p.sizes[0] : null);
        if (!s) continue; // a size is needed and none matched: leave it for the product page
        size = s.label; price = s.price || p.price;
      }
      const have = cart.filter(x => Number(x.id) === p.id && String(x.size || '') === size).length;
      for (let i = have; i < w.qty; i++) cart.push(size ? { id: p.id, colorCode: '', size, price, image: p.image } : { id: p.id, colorCode: '', image: p.image });
      added.push(p);
    }
    count();
    return added;
  }

  function goCart() {
    if (typeof showCart === 'function') showCart();
  }

  function needAccount() {
    const A = window.BuddyAccount; if (!A) return goCart();
    A.open('Захиалгаа дуусгахын тулд бүртгүүлнэ үү. Бүртгэлтэй бол «Нэвтрэх» дарна уу — дараа нь сагс тань шууд нээгдэнэ.');
    // open on the register step
    setTimeout(() => document.querySelector('.acc-modal.open [data-a="register"]')?.click(), 50);
    const t = setInterval(() => {
      const a = A.get();
      if (a && a.hasPassword) {
        clearInterval(t);
        document.querySelector('.acc-modal')?.classList.remove('open');
        goCart();
      }
      if (!document.querySelector('.acc-modal.open')) clearInterval(t); // they closed it themselves
    }, 500);
  }

  let tries = 0;
  (function start() {
    // wait for staff edits (sizes, prices) and for the saved sign-in to be checked — at most ~6 s
    const signedInCheckPending = (() => { try { return !!localStorage.getItem('bs_customer_token') && !(window.BuddyAccount && window.BuddyAccount.get()); } catch (e) { return false; } })();
    if ((!window.BUDDY_SYNCED || signedInCheckPending || typeof cart === 'undefined') && tries++ < 24) return setTimeout(start, 250);
    clean();
    const added = addAll();
    if (!added.length) {
      // nothing could be added (e.g. size missing): just open the product
      if (wanted[0] && find(wanted[0].id) && typeof openProduct === 'function') openProduct(wanted[0].id);
      return;
    }
    if (window.BuddyAccount && window.BuddyAccount.get() && window.BuddyAccount.get().hasPassword) goCart();
    else needAccount();
  })();
})();
