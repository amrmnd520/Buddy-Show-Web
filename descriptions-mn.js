/* Short Mongolian product descriptions (descriptions-mn-data.js → window.BUDDY_DESC_MN = { id: [text, baseLength] }).
   A product shows its Mongolian text unless staff have since written their own description:
   baseLength is the length of the description the text was written from (0 = there was none),
   so a description changed later in the admin page is left alone. */
(() => {
  const MN = window.BUDDY_DESC_MN || {};
  if (typeof openProduct !== 'function') return;
  const st = document.createElement('style');
  st.textContent = '.detail-description{white-space:pre-line;line-height:1.6}';
  document.head.appendChild(st);
  const len = (t) => String(t || '').trim().length;
  function apply(p) {
    const m = p && MN[p.id];
    if (!m || p._mn) return;
    const cur = len(p.description) || len(p.shortDescription);
    if (cur === 0 || cur === m[1]) { p.description = m[0]; p._mn = true; }
  }
  const prev = window.openProduct;
  window.openProduct = function (id, ...rest) {
    const p = (typeof products !== 'undefined' ? products : []).find((x) => Number(x.id) === Number(id));
    apply(p);
    return prev.call(this, id, ...rest);
  };
})();
