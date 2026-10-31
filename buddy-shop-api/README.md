# Buddy Shop — олон хүн бараа нэмэх систем

Ажилтнууд нэр, нууц үгээрээ нэвтэрч, хаанаас ч (утас, iPad, компьютер) бараа нэмэх, засах, устгах, зураг оруулах боломжтой.
Өөрчлөлт бүр автоматаар хадгалагдаж, сайтад шууд харагдана. GitHub Desktop шаардлагагүй.

- Бараа: Cloudflare D1 өгөгдлийн сан
- Зураг: Cloudflare R2 (утасны зургийг 1600px болгож багасгаад хадгална)
- Хуучин catalog.js хэвээрээ үндсэн жагсаалт болж үлдэнэ. Ажилтны өөрчлөлт түүн дээр нэмэгдэнэ.

## Нэг удаа суулгах (Mac Terminal дээр)

**0. R2-г идэвхжүүлэх.** dash.cloudflare.com → **R2 Object Storage** → идэвхжүүлнэ (картаа бүртгүүлэхийг шаардаж магадгүй, 10GB хүртэл үнэгүй).

**1. Хавтас руу орох:**
```
cd ~/Documents/GitHub/Buddy-Show-Web/buddy-shop-api
```
(Хавтас өөр газар байвал Finder-ээс `buddy-shop-api` хавтсыг Terminal цонх руу чирж, урд нь `cd ` бичнэ.)

**2. Cloudflare-т нэвтрэх:**
```
npx wrangler login
```

**3. Өгөгдлийн сан үүсгэх:**
```
npx wrangler d1 create buddy-shop
```
Гарч ирэх `database_id = "..."` утгыг хуулж, `wrangler.toml` файл дахь `PASTE_DATABASE_ID_HERE`-ийн оронд тавина. Дараа нь:
```
npx wrangler d1 execute buddy-shop --remote --file schema.sql
```

**4. Зургийн сан үүсгэх:**
```
npx wrangler r2 bucket create buddy-shop-images
```

**5. Ажилтнуудын нэр, нууц үг.** Нэрийг жижиг латин үсгээр бичнэ:
```
npx wrangler secret put USERS
```
Асуухад нэг мөрөөр оруулна, жишээ нь:
`{"amarmend":"урт-нууц-үг-1","bat":"урт-нууц-үг-2","saraa":"урт-нууц-үг-3"}`

**6. Нэвтрэлтийн түлхүүр:**
```
openssl rand -hex 32 | npx wrangler secret put TOKEN_SECRET
```

**7. Байршуулах:**
```
npx wrangler deploy
```
Гарч ирэх хаягийг хуулна, жишээ нь `https://buddy-shop-api.amrmnd.workers.dev`

**8. Сайтыг холбох.** `Buddy-Show-Web/shop-api-config.js` файлыг нээж:
```
window.BUDDY_API = 'https://buddy-shop-api.amrmnd.workers.dev';
```
болгоод хадгална. GitHub Desktop → Commit → Push.

## Өдөр тутам

1. Сайтын **Бүтээгдэхүүн удирдах** хэсэгт нэр, нууц үгээрээ нэвтэрнэ (30 хоног санана).
2. **+ Шинэ бараа** → мэдээллээ бөглөнө → **📷 Зураг нэмэх** дарж утаснаас зураг сонгоно.
3. Дээд талд **✓ Бүх өөрчлөлт хадгалагдсан** гарвал болсон.

## Ажилтан нэмэх, хасах

`npx wrangler secret put USERS`-ийг дахин ажиллуулж шинэ жагсаалт оруулна. Хасагдсан хүн шууд гарна.

## Анхаарах

- Нэг барааг хоёр хүн яг зэрэг засвал сүүлд хадгалсных нь үлдэнэ.
- `site-settings.js` (лого, онцлох бараа, цэс) хуучин шигээ эзэн нь удирдана.

## ERP (Odoo) холболт — үнэ, Emart-ийн үлдэгдэл

15 минут тутам Odoo-оос (`erpdb`, WH/Stock = Buddy/Emart) барааны **үнэ** болон **үлдэгдлийг** татаж, сайт дээр кодоор нь тааруулж шинэчилнэ.
- Үнэ, үлдэгдэл ERP-ээс ирдэг тул admin дээр гараар засахад дараагийн ачаалалтаар ERP-ийнхээр солигдоно.
- Үлдэгдэл 0 бараа жагсаалтад хэвийн харагдана, дэлгэрэнгүй хуудсанд «Үлдэгдэлгүй» гэж гарч сагсанд нэмэгдэхгүй.
- Кодгүй, эсвэл ERP-д олдоогүй кодтой бараа өөрчлөгдөхгүй.

Нэг удаа тохируулах (Terminal):
```
npx wrangler secret put ODOO_LOGIN      # Odoo нэвтрэх имэйл
npx wrangler secret put ODOO_PASSWORD   # Odoo нууц үг
npx wrangler deploy
```
Шалгах: `https://buddy-shop-api.taimenlodge.workers.dev/api/erp/status`

## Customer accounts (email code sign-in)

- `POST /api/account/code {email}` emails a 6-digit code (Resend, from info@buddyshop.mn; valid 10 min, 5 tries; 1/min and 6/hour per email, 12/hour per IP).
- `POST /api/account/verify {email, code}` → `{token, account}`; token keeps the customer signed in for 90 days. Used to register and to reset a forgotten password.
- `POST /api/account/login {email, password}` → `{token, account}` (10 tries / 15 min per email). Passwords are stored as PBKDF2-SHA256 (100k iterations, random salt); set with `PUT /api/account {password}`.
- `GET / PUT / DELETE /api/account` (customer token): name, phone, address, wishlist, cart, orders.
- `GET /api/customers` (staff token): list for Admin → «Бүртгэлтэй хэрэглэгчид».
- Tables `customers`, `login_codes`, `rate_limits`, `orders` are created automatically in D1.
- Secret: `npx wrangler secret put RESEND_API_KEY`.

## Orders (from the website cart)

- `POST /api/orders` (customer token optional): items, name, phone, email, delivery|pickup, address, note → order number `BS1001…`.
  New-order email to info@buddyshop.mn (or `ORDER_NOTIFY`), Telegram if `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` are set, confirmation email to the customer.
- `GET /api/orders`, `PUT /api/orders/:id {status, staffNote}` (staff): Admin → «Захиалгууд».
  Statuses: new, confirmed, paid, shipping, done, cancelled. Prices are the ones shown on the site; staff confirm before payment.

## Telegram alerts

`TELEGRAM_BOT_TOKEN` secret (bot made with @BotFather). Staff choose the chats in Admin → «Захиалгууд» → 🔔 Telegram:
write /start to the bot (or add it to a group), «Чат хайх», «Холбох». Chats are kept in R2 `settings/telegram.json`.
Staff API: `GET /api/telegram`, `GET /api/telegram/find`, `POST /api/telegram/chats {id,title,on}`, `POST /api/telegram/test`.
