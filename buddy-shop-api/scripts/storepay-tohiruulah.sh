#!/bin/sh
# Buddy Shop — Storepay-г нэг удаа тохируулна.
#
# Terminal дээр нэг мөр:
#   sh ~/Desktop/"Buddy Shop ERP"/storepay-tohiruulah.sh
#
# Хийх зүйлс: Worker байршуулна → Storepay-ийн таван түлхүүрийг тавина →
# түлхүүр тавигдсаныг шалгана → нэвтрэлт үнэхээр ажиллаж байгааг шалгана.
#
# Нэвтрэлтийн шалгалт нь ЗӨВХӨН токен авдаг — ямар ч зээл үүсгэхгүй тул
# хэдэн ч удаа ажиллуулж болно. Дахин ажиллуулахад аюулгүй: түлхүүр асуухад
# хоосон Enter дарвал тэр түлхүүрийг хэвээр үлдээнэ.

set -u

API="${BUDDY_API:-https://buddy-shop-api.taimenlodge.workers.dev}"
WRK="${BUDDY_WRK:-$HOME/Downloads/Buddy-Show-Web-new/buddy-shop-api}"

step() { printf '\n──  %s\n' "$1"; }
ok()   { printf '    ✓ %s\n' "$1"; }
warn() { printf '    ! %s\n' "$1"; }
fail() { printf '\n❌  %s\n\n' "$1"; exit 1; }

printf '\n════  Storepay-ийн тохиргоо  ════\n'

step "1/4  Шалгаж байна"
[ -d "$WRK" ] || fail "Worker-ийн хавтас олдсонгүй:
    $WRK"
[ -f "$WRK/src/storepay.js" ] || fail "storepay.js олдсонгүй. Шинэ файлуудаа хуулсан эсэхээ шалгана уу."
command -v npx >/dev/null 2>&1 || fail "npx олдсонгүй. Node.js суусан эсэхээ шалгана уу."
cd "$WRK" || fail "Хавтас руу орж чадсангүй."
ok "бүх файл байрандаа"

step "2/4  Worker-ийг байршуулж байна"
npx --yes wrangler deploy >/dev/null 2>&1 \
  || fail "Deploy амжилтгүй.
    Нэвтрээгүй байж магадгүй:  npx wrangler login
    Алдааг харах:              cd \"$WRK\" && npx wrangler deploy"
ok "байршлаа"

step "3/4  Storepay-ийн таван түлхүүр"
printf '    Гарын авлагын дагуу:\n'
printf '      API хэрэглэгч    = app_username / app_password  (Basic authorization)\n'
printf '      Систем хэрэглэгч = username / password          (хаягийн мөрөнд)\n'
printf '    Хэвээр үлдээх бол хоосон Enter дарна.\n\n'

put() {   # put <SECRET_NAME> <асуулт> <нуух уу>
  if [ "$3" = "hide" ]; then
    printf '    %s: ' "$2"; stty -echo 2>/dev/null; read -r v; stty echo 2>/dev/null; printf '\n'
  else
    printf '    %s: ' "$2"; read -r v
  fi
  if [ -z "$v" ]; then warn "$1 — хэвээр үлдээв"; return 0; fi
  printf '%s' "$v" | npx --yes wrangler secret put "$1" >/dev/null 2>&1 \
    && ok "$1 тавигдлаа" || fail "$1 тавьж чадсангүй."
  v=''
}

put STOREPAY_APP_USERNAME "API хэрэглэгчийн нэр   (app_username)" show
put STOREPAY_APP_PASSWORD "API нууц үг            (app_password)" hide
put STOREPAY_USERNAME     "Систем хэрэглэгчийн нэр (username)"    show
put STOREPAY_PASSWORD     "Систем нууц үг          (password)"    hide
put STOREPAY_STORE_ID     "Дэлгүүрийн дугаар       (storeId)"     show

step "4/4  Шалгаж байна"
sleep 3
ST=$(curl -fsS --max-time 30 "$API/api/qpay/status" 2>/dev/null)
case "$ST" in
  *'"storepay":true'*) ok "таван түлхүүр бүгд тавигдсан" ;;
  *) fail "Түлхүүр бүрэн тавигдаагүй байна. Серверийн хариу:
    $ST" ;;
esac

printf '\n    Нэвтрэлтийг шалгах уу? Ажилтны нэвтрэлт хэрэгтэй.\n'
printf '    Алгасах бол хоосон Enter дарна.\n'
printf '    Ажилтны нэр: '; read -r SU
if [ -n "$SU" ]; then
  printf '    Ажилтны нууц үг: '; stty -echo 2>/dev/null; read -r SP; stty echo 2>/dev/null; printf '\n'
  TOK=$(curl -fsS --max-time 30 -X POST "$API/api/login" -H 'content-type: application/json' \
        --data-binary "$(printf '{"user":"%s","password":"%s"}' "$SU" "$SP")" 2>/dev/null \
        | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
  SP=''
  if [ -z "$TOK" ]; then
    warn "Ажилтнаар нэвтэрч чадсангүй — нэвтрэлтийн шалгалт алгаслаа."
  else
    PING=$(curl -fsS --max-time 60 -H "authorization: Bearer $TOK" "$API/api/storepay/ping" 2>/dev/null)
    case "$PING" in
      *'"ok":true'*) ok "Storepay-д амжилттай нэвтэрлээ — түлхүүрүүд зөв" ;;
      *) printf '\n❌  Storepay-д нэвтэрч чадсангүй. Хариу:\n    %s\n\n' "$PING"
         printf '    Ихэвчлэн API хэрэглэгч, систем хэрэглэгч хоёр солигдсоноос болдог.\n'
         printf '    Скриптийг дахин ажиллуулж, хоёрыг нь сольж оруулаад үзээрэй.\n\n'; exit 1 ;;
    esac
  fi
fi

printf '\n════  Бэлэн  ════\n'
printf 'Storepay сайт дээр ажиллахад бэлэн. Үлдсэн нь салбараа merge хийх.\n'
printf 'Эхний жинхэнэ захиалгыг хамгийн бага дүнгээр туршина уу —\n'
printf 'Storepay-д туршилтын орчин байдаггүй.\n\n'
