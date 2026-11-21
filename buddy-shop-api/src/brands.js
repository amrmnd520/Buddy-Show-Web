// Brand logos shown on the website (brand strip, sidebar). Staff upload a logo in admin → the image
// goes through /api/upload like product photos, and its URL is kept here per brand name.
// Stored as one small JSON object in R2 (settings/brand-logos.json): { "Rapala": "https://…/img/products/…png" }.
const KEY = 'settings/brand-logos.json';
const MAX_BRANDS = 300;

async function read(env) {
  const obj = await env.IMAGES.get(KEY);
  if (!obj) return {};
  try { const d = JSON.parse(await obj.text()); return d && typeof d === 'object' && !Array.isArray(d) ? d : {}; } catch { return {}; }
}

export async function getBrandLogos(env) { return { logos: await read(env) }; }

// body: { brand, image }  — image empty/null removes the logo
export async function setBrandLogo(env, body) {
  const brand = String((body && body.brand) || '').trim().replace(/\s+/g, ' ').slice(0, 60);
  if (!brand) return [400, { error: 'Брэндийн нэр хоосон байна' }];
  const image = String((body && body.image) || '').trim();
  // only our own uploaded photos or the site's bundled files — never an outside address
  if (image && !/^(https:\/\/[a-z0-9.-]+\/img\/products\/[\w./-]+|assets\/[\w./-]+)$/i.test(image)) {
    return [400, { error: 'Зураг зөвхөн «Зураг оруулах»-аар орж ирнэ' }];
  }
  const logos = await read(env);
  if (image) logos[brand] = image; else delete logos[brand];
  if (Object.keys(logos).length > MAX_BRANDS) return [400, { error: 'Хэт олон брэнд' }];
  await env.IMAGES.put(KEY, JSON.stringify(logos), { httpMetadata: { contentType: 'application/json; charset=utf-8' } });
  return [200, { ok: true, logos }];
}
