// Staff password recovery for the admin page (buddyshop.mn/#admin).
// Staff accounts are the names in the USERS secret. A staff member who forgot the password asks
// for a code: it goes to the shop owner (email STAFF_RESET_TO, default info@buddyshop.mn, and the
// linked Telegram chats), who passes it on. With the code the staff member sets a new password,
// stored hashed in D1; it then takes precedence over the password in USERS.

const CODE_MINUTES = 30, MAX_TRIES = 5;
const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
async function hmac(env, data) {
  const key = await crypto.subtle.importKey('raw', enc.encode(env.TOKEN_SECRET || ''), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}
function same(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0;
}
async function ensure(env) {
  await env.DB.batch([
    env.DB.prepare('CREATE TABLE IF NOT EXISTS staff_pass (user TEXT PRIMARY KEY, hash TEXT NOT NULL, updated_at TEXT)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS staff_codes (user TEXT PRIMARY KEY, hash TEXT NOT NULL, expires INTEGER, tries INTEGER DEFAULT 0, sent_at INTEGER)'),
  ]);
}

// password check used by /api/login: a password set through recovery wins over USERS
export async function checkPassword(env, user, password, fromSecret) {
  await ensure(env);
  const row = await env.DB.prepare('SELECT hash FROM staff_pass WHERE user = ?1').bind(user).first();
  if (row) return same(row.hash, await hmac(env, `staffpw:${user}:${password}`));
  return same(String(password || ''), String(fromSecret ?? ''));
}

export async function requestStaffCode(env, user, list, notify, mail) {
  await ensure(env);
  const name = String(user || '').trim().toLowerCase();
  const generic = [200, { ok: true }]; // same answer whether or not the name exists
  if (!name || !(name in list)) { await new Promise((r) => setTimeout(r, 500)); return generic; }
  const last = await env.DB.prepare('SELECT sent_at FROM staff_codes WHERE user = ?1').bind(name).first();
  if (last && Date.now() - last.sent_at < 60e3) return [429, { error: 'Код саяхан илгээгдсэн. 1 минутын дараа дахин оролдоно уу.' }];
  const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1e6).padStart(6, '0');
  await env.DB.prepare(`INSERT INTO staff_codes (user, hash, expires, tries, sent_at) VALUES (?1, ?2, ?3, 0, ?4)
    ON CONFLICT(user) DO UPDATE SET hash = ?2, expires = ?3, tries = 0, sent_at = ?4`)
    .bind(name, await hmac(env, `staffcode:${name}:${code}`), Date.now() + CODE_MINUTES * 60e3, Date.now()).run();
  const text = `🔑 Ажилтан «${name}» admin-ы нууц үгээ сэргээх код хүслээ: ${code}\nКод ${CODE_MINUTES} минут хүчинтэй. Та хүсээгүй бол энэ мессежийг үл тоомсорлоно уу.`;
  await Promise.allSettled([
    notify(env, text),
    mail(env, env.STAFF_RESET_TO || 'info@buddyshop.mn', `🔑 ${name} — admin нууц үг сэргээх код ${code}`,
      `<div style="font-family:Arial,sans-serif;max-width:460px;margin:auto;padding:24px;color:#10202c"><div style="font-weight:800;font-size:18px">▲ BUDDY SHOP</div>
      <p>Ажилтан <b>${name}</b> buddyshop.mn/#admin-ы нууц үгээ сэргээх код хүслээ:</p>
      <div style="font-size:34px;font-weight:800;letter-spacing:8px;background:#f2f5f7;border-radius:8px;padding:14px 0;text-align:center">${code}</div>
      <p style="font-size:13px;color:#5a6a72">Код ${CODE_MINUTES} минут хүчинтэй. Кодыг тухайн ажилтанд өөрөө дамжуулна уу. Та хүсээгүй бол үл тоомсорлоно уу.</p></div>`, text),
  ]);
  return generic;
}

export async function resetStaffPassword(env, user, code, password, list) {
  await ensure(env);
  const name = String(user || '').trim().toLowerCase();
  const pw = String(password || '');
  if (pw.length < 8) return [400, { error: 'Нууц үг дор хаяж 8 тэмдэгт байна' }];
  if (!name || !(name in list)) return [400, { error: 'Код буруу эсвэл хугацаа дууссан' }];
  const row = await env.DB.prepare('SELECT hash, expires, tries FROM staff_codes WHERE user = ?1').bind(name).first();
  if (!row || Date.now() > row.expires) return [400, { error: 'Кодын хугацаа дууссан. Шинэ код авна уу.' }];
  if (row.tries >= MAX_TRIES) return [429, { error: 'Хэт олон буруу оролдлого. Шинэ код авна уу.' }];
  if (!same(row.hash, await hmac(env, `staffcode:${name}:${String(code || '').replace(/\D/g, '')}`))) {
    await env.DB.prepare('UPDATE staff_codes SET tries = tries + 1 WHERE user = ?1').bind(name).run();
    await new Promise((r) => setTimeout(r, 400));
    return [400, { error: 'Код буруу байна' }];
  }
  await env.DB.batch([
    env.DB.prepare('DELETE FROM staff_codes WHERE user = ?1').bind(name),
    env.DB.prepare(`INSERT INTO staff_pass (user, hash, updated_at) VALUES (?1, ?2, ?3)
      ON CONFLICT(user) DO UPDATE SET hash = ?2, updated_at = ?3`).bind(name, await hmac(env, `staffpw:${name}:${pw}`), new Date().toISOString()),
  ]);
  return [200, { ok: true, user: name }];
}
