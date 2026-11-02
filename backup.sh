#!/bin/bash
# Buddy Shop — full backup into ~/Documents/BuddyShop-Backup/<date>/
#
# Run from the project folder:
#   cd ~/src/Buddy-Show-Web && git pull && bash backup.sh
#
# What is saved:
#   1. website-and-server-code.zip  — the whole site (pages, scripts, 2,000+ product photos) and the Cloudflare server code
#   2. database.sql                  — the full database: orders, customers, staff product edits, visitor stats
#   3. orders.json / customers.json / product-edits.json — the same data, easy to open and read
#   4. r2/                          — files kept on Cloudflare storage (ERP stock, best sellers, Telegram chats, uploaded photos)
#   5. secrets-names.txt            — the NAMES of the passwords/keys in use (never the values)
# Passwords and keys are NOT in the backup. Keep them in a password manager.

set -e
cd "$(dirname "$0")"
ROOT="$(pwd)"
STAMP="$(date +%Y-%m-%d_%H%M)"
OUT="$HOME/Documents/BuddyShop-Backup/$STAMP"
mkdir -p "$OUT/r2"
API="https://buddy-shop-api.taimenlodge.workers.dev"
echo "▶ Backup → $OUT"

echo "1/5 Site and server code…"
git archive --format=zip -o "$OUT/website-and-server-code.zip" HEAD
git log -1 --format='%H %ci %s' > "$OUT/code-version.txt"

cd "$ROOT/buddy-shop-api"
echo "2/5 Full database (D1)…"
npx wrangler d1 export buddy-shop --remote --output "$OUT/database.sql"

echo "3/5 Readable copies of orders, customers, product edits…"
npx wrangler d1 execute buddy-shop --remote --json --command "SELECT * FROM orders ORDER BY id" > "$OUT/orders.json" || true
npx wrangler d1 execute buddy-shop --remote --json --command "SELECT id,email,name,phone,address,addr,wishlist,cart,created_at,last_login,logins FROM customers ORDER BY id" > "$OUT/customers.json" || true
curl -s "$API/api/products" > "$OUT/product-edits.json" || true

echo "4/5 Cloudflare storage (R2)…"
for KEY in erp/stock.json erp/catalog.json erp/top.json erp/dismissed.json settings/telegram.json; do
  npx wrangler r2 object get "buddy-shop-images/$KEY" --remote --file "$OUT/r2/$(echo "$KEY" | tr '/' '_')" >/dev/null 2>&1 || true
done
# photos staff uploaded from the admin page (if any)
python3 - "$OUT/product-edits.json" > "$OUT/r2/uploaded-photo-urls.txt" <<'PY' || true
import json, re, sys
s = open(sys.argv[1]).read()
print("\n".join(sorted(set(re.findall(r'https://buddy-shop-api\.taimenlodge\.workers\.dev/img/[^"\\]+', s)))))
PY
if grep -q "http" "$OUT/r2/uploaded-photo-urls.txt" 2>/dev/null; then
  mkdir -p "$OUT/r2/uploaded-photos"
  while read -r U; do [ -n "$U" ] && curl -s -o "$OUT/r2/uploaded-photos/$(basename "$U")" "$U" || true; done < "$OUT/r2/uploaded-photo-urls.txt"
fi

echo "5/5 Names of secrets in use…"
npx wrangler secret list > "$OUT/secrets-names.txt" 2>/dev/null || true

cat > "$OUT/README.txt" <<'TXT'
Buddy Shop backup
=================
website-and-server-code.zip  The website (index.html, scripts, assets/ product photos) and buddy-shop-api/ (Cloudflare server).
                             The same code is on GitHub: github.com/amrmnd520/Buddy-Show-Web
database.sql                 Full copy of the Cloudflare D1 database "buddy-shop".
orders.json, customers.json  Readable copies of the orders and customer accounts.
product-edits.json           Products added/edited by staff in the admin page (on top of catalog.js).
r2/                          ERP stock/prices, best sellers, Telegram chat list, uploaded photos.
secrets-names.txt            Which secrets the server uses. The values are NOT here.

Restore (if ever needed)
- Code: unzip, or clone from GitHub, then in buddy-shop-api/: npx wrangler deploy
- Database: npx wrangler d1 execute buddy-shop --remote --file database.sql   (into an empty database)
- Secrets: npx wrangler secret put NAME   for each name in secrets-names.txt
           (USERS, TOKEN_SECRET, ODOO_LOGIN, ODOO_PASSWORD, RESEND_API_KEY, TELEGRAM_BOT_TOKEN,
            QPAY_USERNAME, QPAY_PASSWORD, QPAY_INVOICE_CODE)
- Telegram chats: r2/settings_telegram.json → npx wrangler r2 object put buddy-shop-images/settings/telegram.json --remote --file r2/settings_telegram.json
TXT

echo "✅ Done: $OUT"
du -sh "$OUT"
open "$OUT" 2>/dev/null || true
