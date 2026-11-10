#!/bin/sh
# Buddy Shop — Storepay-ийн нэвтрэлтийг шалгах оношлогоо.
#
#   sh ~/Desktop/"Buddy Shop ERP"/storepay-shalgah.sh
#
# Storepay руу ШУУД нэвтрэх оролдлого хийнэ. Worker-т хүрэхгүй, юу ч хадгалахгүй,
# ямар ч зээл үүсгэхгүй. Зөвхөн токен авах оролдлого.
#
# Яагаад энэ хувилбар өөр вэ: OAuth сервер хоёр тусдаа алдаа буцаадаг —
#   invalid_client  → Basic дахь API хэрэглэгчийг ТАНИХГҮЙ байна
#   invalid_grant   → API хэрэглэгч зөв, харин системийн нууц үг буруу
# Тиймээс эхлээд САНААТАЙГААР буруу системийн нууц үгээр нэг удаа оролдоно.
# Хариу нь аль талд асуудалтайг шууд хэлж өгнө.

set -u
AUTH="https://service.storepay.mn/merchant-uaa/oauth/token"
BAD='zzz-zoriud-buruu-99'          # мэдээж буруу нууц үг — ялгаж тогтооход л хэрэгтэй

ask()  { printf '  %s: ' "$1"; read -r REPLY_V; }
askp() { printf '  %s: ' "$1"; stty -echo 2>/dev/null; read -r REPLY_V; stty echo 2>/dev/null; printf '\n'; }

# Нууц үгийг харуулахгүйгээр хуулалтын алдаа (урт, зай, тасарсан) илрүүлнэ.
fingerprint() {
  n=$(printf '%s' "$1" | wc -c | tr -d ' ')
  f=$(printf '%s' "$1" | cut -c1)
  l=$(printf '%s' "$1" | rev | cut -c1)
  case "$1" in
    *' '*) sp=' ⚠ ЗАЙ агуулж байна' ;;
    *)     sp='' ;;
  esac
  printf '%s тэмдэгт, "%s"-оор эхэлж "%s"-оор төгсөнө%s' "$n" "$f" "$l" "$sp"
}

probe() {  # probe <basic-user> <basic-pass> <sys-user> <sys-pass>
  curl -s --max-time 30 -u "$1:$2" -X POST \
       --get --data-urlencode "grant_type=password" \
       --data-urlencode "username=$3" --data-urlencode "password=$4" \
       "$AUTH" 2>/dev/null
}

printf '\n════  Storepay нэвтрэлтийн шалгалт  ════\n\n'
printf 'Имэйл дэх утгуудаа оруулна уу. Хаана ч хадгалагдахгүй.\n\n'

ask  "Систем хэрэглэгч  (8 оронтой дугаар, порталд нэвтэрдэг)"; SU="$REPLY_V"
askp "Системийн нууц үг (урилга хүлээн авахдаа үүсгэсэн)"     ; SP="$REPLY_V"
printf '\n'
ask  "API хэрэглэгчийн нэр (жишээ: merchantapp1)"; AU="$REPLY_V"
askp "API нууц үг"                               ; AP="$REPLY_V"

printf '\n──  Оруулсан утгууд\n'
printf '    систем:  %s  /  нууц үг: %s\n' "$SU" "$(fingerprint "$SP")"
printf '    API:     %s  /  нууц үг: %s\n' "$AU" "$(fingerprint "$AP")"

printf '\n──  1-р шалгалт: API хэрэглэгчийг Storepay таних уу?\n'
printf '    (санаатай буруу системийн нууц үгээр оролдоно)\n'
R1=$(probe "$AU" "$AP" "$SU" "$BAD")
case "$R1" in
  *invalid_client*) C='unknown'; printf '    ✗ invalid_client — API хэрэглэгчийг ТАНИХГҮЙ байна\n' ;;
  *invalid_grant*|*Bad*credentials*|*UserDetailsService*)
                    C='ok';      printf '    ✓ API хэрэглэгч танигдлаа (invalid_grant буцлаа)\n' ;;
  *access_token*)   C='ok';      printf '    ! Буруу нууц үгээр ч токен өглөө — Storepay-д мэдэгдэх хэрэгтэй\n' ;;
  *)                C='?';       printf '    ? %s\n' "$(printf '%s' "$R1" | head -c 200)" ;;
esac

printf '\n──  2-р шалгалт: жинхэнэ нууц үгээр бүрэн нэвтрэлт\n'
R2=$(probe "$AU" "$AP" "$SU" "$SP")
case "$R2" in
  *access_token*) G='ok'; printf '    ✓ АЖИЛЛАЛАА — токен авлаа\n' ;;
  *)              G='no'; printf '    ✗ %s\n' "$(printf '%s' "$R2" | head -c 200)" ;;
esac

printf '\n──  3-р шалгалт: эсрэг дараалал (хос солигдсон эсэх)\n'
R3=$(probe "$SU" "$SP" "$AU" "$AP")
case "$R3" in
  *access_token*) S='ok'; printf '    ✓ ЭСРЭГЭЭР нь ажиллаж байна\n' ;;
  *)              S='no'; printf '    ✗ энэ дараалал ч бүтсэнгүй\n' ;;
esac
SP=''; AP=''

printf '\n════  Дүгнэлт  ════\n'
if [ "$G" = "ok" ]; then
  printf 'Бүх зүйл зөв. storepay-tohiruulah.sh-г ажиллуулаад дуусна.\n\n'
elif [ "$S" = "ok" ]; then
  printf 'ХОС СОЛИГДСОН байна. storepay-tohiruulah.sh-г дахин ажиллуулж,\n'
  printf 'API талд %s-г, систем талд %s-г оруулна уу.\n\n' "$SU" "$AU"
elif [ "$C" = "ok" ]; then
  printf 'API хэрэглэгч (%s) ЗӨВ — Storepay түүнийг таниж байна.\n' "$AU"
  printf 'Асуудал системийн нууц үгэнд байна. %s-аар порталд нэвтэрдэг\n' "$SU"
  printf 'яг тэр нууц үгээ оруулна уу. Дээрх "тэмдэгт" тоог имэйл дэх\n'
  printf 'утгатайгаа тулгаж үзээрэй — хуулахдаа зай/тэмдэгт алдагдсан байж болно.\n\n'
else
  printf 'API хэрэглэгчийг (%s) Storepay ТАНИХГҮЙ байна.\n' "$AU"
  printf 'Системийн нууц үг энд огт хамаагүй — порталд нэвтэрч чадаж байгаа нь\n'
  printf 'тэр талыг аль хэдийн баталсан.\n\n'
  printf 'Хоёр боломж:\n'
  printf '  1. Танд ХОЁР API ирсэн (касс болон онлайн). Нөгөөг нь энэ скриптээр\n'
  printf '     турших — API нэр/нууц үгийг нөгөө имэйлээс авч дахин ажиллуулна уу.\n'
  printf '  2. Тэр API хэрэглэгч хараахан идэвхжээгүй. Nomin-д ийм зурвас илгээнэ үү:\n\n'
  printf '     ─────────────────────────────────────────────\n'
  printf '     Сайн байна уу. Storepay merchant API-д холбогдох гэтэл\n'
  printf '     oauth/token дээр дараах алдаа гарч байна:\n'
  printf '       invalid_client — "Client authentication failed due to\n'
  printf '       unknown client..."\n'
  printf '     Системийн хэрэглэгч %s-аар порталд асуудалгүй нэвтэрч байгаа\n' "$SU"
  printf '     тул асуудал API client талд байна. Бидэнд ирүүлсэн API\n'
  printf '     хэрэглэгч "%s" идэвхтэй эсэх, аль дэлгүүрт (касс/онлайн)\n' "$AU"
  printf '     хамаарахыг шалгаж өгнө үү.\n'
  printf '     ─────────────────────────────────────────────\n\n'
fi
