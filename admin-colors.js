/* Color variants shared by the product manager and storefront. */
(() => {
  let editingId = null;
  let draft = [];
  const dialog = document.createElement('dialog');
  dialog.id = 'admin-color-editor';
  dialog.style.cssText = 'width:min(1000px,95vw);max-height:90vh;overflow:auto;padding:24px;border:0;border-radius:10px';
  dialog.innerHTML = '<h2>Өнгөний сонголт</h2><p id="admin-color-title"></p><p>ERP код, өнгөний нэр болон тухайн өнгөний зургийг оруулна уу. Үнэ, үлдэгдлийг хоосон үлдээвэл барааны үнэ болон тодорхойгүй үлдэгдэл ашиглана.</p><div style="overflow:auto"><table><thead><tr><th>ERP / өнгөний код *</th><th>Өнгөний нэр</th><th>Зургийн зам</th><th>Үнэ ₮</th><th>Үлдэгдэл</th><th></th></tr></thead><tbody id="admin-color-rows"></tbody></table></div><p id="admin-color-error" role="alert" style="color:#a52323"></p><button type="button" id="admin-color-add">+ Өнгө нэмэх</button> <button type="button" id="admin-color-save">Хадгалах</button> <button type="button" id="admin-color-cancel">Болих</button>';
  document.body.appendChild(dialog);
  function rows() {
    document.getElementById('admin-color-rows').innerHTML = draft.map((o,i) => `<tr>${['code','name','image','price','stock'].map(k=>`<td><input aria-label="${safe(k)} ${i+1}" data-row="${i}" data-field="${k}" ${['price','stock'].includes(k)?'type="number" min="0" step="any"':''} value="${safe(o[k]??'')}" style="min-width:${k==='image'?180:100}px"></td>`).join('')}<td><button type="button" data-remove="${i}">Устгах</button></td></tr>`).join('');
  }
  dialog.addEventListener('input', e => {
    if(e.target.dataset.field) draft[Number(e.target.dataset.row)][e.target.dataset.field]=e.target.value;
  });
  dialog.addEventListener('click', e => {
    if(e.target.dataset.remove != null) {draft.splice(Number(e.target.dataset.remove),1);rows();}
  });
  window.editProductColors = id => {
    const p=products.find(p=>Number(p.id)===Number(id));if(!p)return;
    editingId=id;draft=JSON.parse(JSON.stringify(p.colorOptions||[]));
    document.getElementById('admin-color-title').textContent=p.name;
    document.getElementById('admin-color-error').textContent='';rows();dialog.showModal();
  };
  document.getElementById('admin-color-add').onclick=()=>{draft.push({code:'',name:'',image:'',price:'',stock:'',kind:'erp'});rows();};
  document.getElementById('admin-color-cancel').onclick=()=>dialog.close();
  document.getElementById('admin-color-save').onclick=()=>{
    const p=products.find(p=>Number(p.id)===Number(editingId));if(!p)return;
    try {
      const seen=new Set();
      const options=draft.map(o=>{
        const code=String(o.code||'').trim(),name=String(o.name||'').trim(),image=String(o.image||'').trim();
        if(!code)throw Error('Өнгө бүрд код оруулна уу.');
        if(seen.has(code.toUpperCase()))throw Error('Өнгөний код давхардаж байна: '+code);
        seen.add(code.toUpperCase());
        if(image && (/^[a-z]+:/i.test(image)&&!/^https?:\/\//i.test(image)))throw Error('Зургийн зам буруу байна.');
        const price=o.price==null||o.price===''?Number(p.price):Number(o.price);
        const stock=o.stock==null||o.stock===''?null:Number(o.stock);
        if(!Number.isFinite(price)||price<0||(stock!==null&&(!Number.isInteger(stock)||stock<0)))throw Error('Үнэ болон үлдэгдлээ шалгана уу.');
        return {...o,code,name,image,price,stock,kind:o.kind||'erp'};
      });
      p.colorOptions=options;p.customColorOptions=true;
      p.imageColorCodes=Object.fromEntries(options.filter(o=>o.image).map(o=>[o.image,o.code]));
      persist();adminRender();render();renderFeaturedLures();dialog.close();
    } catch(e){document.getElementById('admin-color-error').textContent=e.message;}
  };
  function availableColors(p) {
    const options=(p.colorOptions||[]).map(o=>({...o}));
    for(const [image,code] of Object.entries(p.imageColorCodes||{})) {
      if(code && !options.some(o=>o.code===code)) options.push({code,name:'',image,price:p.price,stock:null});
    }
    return options;
  }
  window.viewAdminColor = (id,index) => {
    const p=products.find(p=>Number(p.id)===Number(id));
    const box=document.getElementById('admin-color-preview-'+id);
    if(!p||!box)return;
    const o=availableColors(p)[Number(index)];
    if(index===''||!o){box.innerHTML='';return;}
    box.innerHTML=`${o.image?`<img src="${safe(o.image)}" alt="${safe(o.name||o.code)}" style="display:block;width:110px;height:80px;object-fit:contain;background:white;margin:8px 0">`:'<div>Өнгөний зураг оруулаагүй</div>'}<strong>${safe(o.code)}</strong>${o.name?`<div>${safe(o.name)}</div>`:''}<div>${money(o.price??p.price)}</div><div>Үлдэгдэл: ${o.stock==null?'Тодорхойгүй':safe(o.stock)}</div>${o.kind==='shop-reference'?'<small>Дэлгүүрийн зургийн лавлагаа код</small>':''}`;
  };
  const oldAdmin=adminRender;
  adminRender=function(){
    oldAdmin();
    const body=document.getElementById('adminrows');
    const heading=body.closest('table').querySelector('thead tr');
    if(!heading.querySelector('[data-color-heading]'))heading.insertAdjacentHTML('beforeend','<th data-color-heading>Өнгөний сонголт</th>');
    const query=(document.getElementById('admin-search').value||'').toLowerCase();
    const shown=products.filter(p=>!query||(p.name+' '+p.brand+' '+(p.code||'')).toLowerCase().includes(query));
    Array.from(body.rows).forEach((row,i)=>{
      const p=shown[i],options=availableColors(p),id=Number(p.id);
      row.insertAdjacentHTML('beforeend',`<td style="min-width:210px">${options.length?`<select aria-label="${safe(p.name)} — байгаа өнгөнүүд" onchange="viewAdminColor(${id},this.value)"><option value="">Өнгө харах (${options.length})</option>${options.map((o,j)=>`<option value="${j}">${safe(o.code)}${o.name?' · '+safe(o.name):''}</option>`).join('')}</select>`:'<div style="font-size:12px;margin-bottom:8px">Өнгөний сонголт бүртгээгүй</div>'}<div id="admin-color-preview-${id}" style="font-size:12px;line-height:1.6"></div><button type="button" onclick="editProductColors(${id})">Өнгө засах (${(p.colorOptions||[]).length})</button></td>`);
    });
  };
})();
