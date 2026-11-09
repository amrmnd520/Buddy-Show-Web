#!/bin/sh
# Buddy Shop — нөөцлөлтийг нэг удаа бүрэн тохируулна.
#
# Terminal дээр нэг мөр:
#   sh ~/Desktop/"Buddy Shop ERP"/nooclolt-tohiruulah.sh
#
# Хийх зүйлс: түлхүүр үүсгэж Keychain-д хадгална → Worker-т өгнө → deploy хийнэ →
# эхний нөөцлөлтийг ажиллуулна → сарын хуваарийг суулгана → татаж шалгана.
# Дахин ажиллуулахад аюулгүй: өмнө үүсгэсэн түлхүүрийг дахин ашиглана.

set -u

API="https://buddy-shop-api.taimenlodge.workers.dev"
ERP="$HOME/Desktop/Buddy Shop ERP"
WRK="$HOME/Downloads/Buddy-Show-Web-new/buddy-shop-api"
AGENT="$HOME/Library/LaunchAgents/com.buddyshop.backup.plist"

step() { printf '\n──  %s\n' "$1"; }
ok()   { printf '    ✓ %s\n' "$1"; }
fail() { printf '\n❌  %s\n\n' "$1"; exit 1; }

printf '\n════  Buddy Shop нөөцлөлтийн тохиргоо  ════\n'

step "1/6  Шаардлагатай зүйлсийг шалгаж байна"
[ -d "$WRK" ]   || fail "Worker-ийн хавтас олдсонгүй:
    $WRK"
[ -f "$ERP/buddy-backup.sh" ] || fail "buddy-backup.sh олдсонгүй:
    $ERP"
[ -f "$ERP/com.buddyshop.backup.plist" ] || fail "com.buddyshop.backup.plist олдсонгүй:
    $ERP"
command -v npx >/dev/null 2>&1 || fail "npx олдсонгүй. Node.js суусан эсэхээ шалгана уу."
ok "бүх файл байрандаа"

step "2/6  Түлхүүр бэлдэж байна"
TOKEN=$(security find-generic-password -s buddy-backup -w 2>/dev/null) || TOKEN=""
if [ -z "$TOKEN" ]; then
  TOKEN=$(openssl rand -base64 32 | tr -d '\n')
  security add-generic-password -s buddy-backup -a buddy -w "$TOKEN" -U 2>/dev/null \
    || fail "Keychain-д хадгалж чадсангүй."
  ok "шинэ түлхүүр үүсгэж Keychain-д хадгаллаа"
else
  ok "Keychain дотор байсан түлхүүрийг ашиглана"
fi

step "3/6  Worker-т түлхүүрийг өгч, байршуулж байна"
cd "$WRK" || fail "Хавтас руу орж чадсангүй: $WRK"
printf '%s' "$TOKEN" | npx --yes wrangler secret put BACKUP_TOKEN >/dev/null 2>&1 \
  || fail "Түлхүүрийг Worker-т өгч чадсангүй.
    Ихэвчлэн нэвтрээгүйгээс болдог. Эхлээд:  npx wrangler login
    Дараа нь энэ скриптийг дахин ажиллуулна уу."
ok "түлхүүр Worker дээр тавигдлаа"
npx --yes wrangler deploy >/dev/null 2>&1 || fail "Deploy амжилтгүй.
    Алдааг харахын тулд:  cd \"$WRK\" && npx wrangler deploy"
ok "Worker байршлаа"

step "4/6  Эхний нөөцлөлтийг ажиллуулж байна (хэдэн секунд)"
# -f биш: алдаа гарвал серверийн тайлбарыг харах ёстой, зөвхөн кодыг биш.
BODY="$ERP/.backup-run.out"
CODE=$(curl -sS -o "$BODY" -w '%{http_code}' --max-time 180 \
       -X POST -H "x-backup-token: $TOKEN" "$API/api/backup/run" 2>/dev/null)
OUT=$(cat "$BODY" 2>/dev/null); rm -f "$BODY"
[ "$CODE" = "200" ] || fail "Нөөцлөлт ажиллахгүй байна (HTTP $CODE). Серверийн хариу:
    $OUT"
ROWS=$(printf '%s' "$OUT" | sed -n 's/.*"rows": *\([0-9]*\).*/\1/p')
[ -n "$ROWS" ] || ROWS="?"
ok "сервер дээр нөөц үүслээ — $ROWS мөр"

step "5/6  Сарын хуваарийг суулгаж байна"
mkdir -p "$HOME/Library/LaunchAgents"
cp "$ERP/com.buddyshop.backup.plist" "$AGENT" || fail "LaunchAgents руу хуулж чадсангүй."
launchctl unload "$AGENT" 2>/dev/null
launchctl load "$AGENT" 2>/dev/null || fail "Хуваарийг ачаалж чадсангүй."
ok "сар бүрийн 1-ний 10:00-д ажиллана"

step "6/6  Компьютер руу татаж шалгаж байна"
sh "$ERP/buddy-backup.sh" || fail "Татах явцад алдаа гарлаа (дээрх мөрийг үзнэ үү)."

printf '\n════  Бэлэн боллоо  ════\n'
printf 'Нөөц хадгалагдах газар:  %s/Backup\n' "$ERP"
printf 'Сервер дээр шөнө бүр, энэ компьютер дээр сард нэг удаа хуулбар үүснэ.\n'
printf 'Алдаа гарвал имэйлээр мэдэгдэнэ.\n\n'
