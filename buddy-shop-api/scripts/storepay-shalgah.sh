#!/bin/sh
# Buddy Shop — Storepay-ийн нэвтрэлтийг шалгах оношлогоо.
#
#   sh ~/Desktop/"Buddy Shop ERP"/storepay-shalgah.sh
#
# Юу хийдэг вэ: Storepay руу ШУУД нэвтрэх оролдлого хийнэ. Worker-т хүрэхгүй,
# юу ч хадгалахгүй, ямар ч зээл үүсгэхгүй. Зөвхөн токен авах оролдлого.
#
# Хоёр боломжит дарааллыг хоёуланг нь туршина:
#   А) гарын авлагын дагуу — API хос Basic дээр, систем хос хаягийн мөрөнд
#   Б) эсрэгээр нь
# Аль нэг нь ажиллавал аль болохыг хэлнэ. Хоёулаа унавал нууц үг буруу,
# эсвэл урилгыг хүлээн аваагүй байна.

set -u
AUTH="https://service.storepay.mn/merchant-uaa/oauth/token"

ask()  { printf '  %s: ' "$1"; read -r REPLY_V; }
askp() { printf '  %s: ' "$1"; stty -echo 2>/dev/null; read -r REPLY_V; stty echo 2>/dev/null; printf '\n'; }

printf '\n════  Storepay нэвтрэлтийн шалгалт  ════\n\n'
printf 'Имэйл дэх утгуудаа оруулна уу. Хаана ч хадгалагдахгүй.\n\n'

ask  "Basic username  (жишээ: merchantapp1)"; BU="$REPLY_V"
askp "Basic password"                       ; BP="$REPLY_V"
ask  "App username    (8 оронтой дугаар)"   ; AU="$REPLY_V"
askp "Үүсгэсэн нууц үг"                     ; AP="$REPLY_V"

try() {   # try <тайлбар> <basic-user> <basic-pass> <query-user> <query-pass>
  printf '\n──  %s\n' "$1"
  body=$(curl -s --max-time 30 -u "$2:$3" -X POST \
         --get --data-urlencode "grant_type=password" \
         --data-urlencode "username=$4" --data-urlencode "password=$5" \
         "$AUTH" 2>/dev/null)
  case "$body" in
    *access_token*) printf '    ✓ АЖИЛЛАЛАА\n'; return 0 ;;
    *) printf '    ✗ %s\n' "$(printf '%s' "$body" | head -c 200)"; return 1 ;;
  esac
}

A=1; B=1
try "А) Гарын авлагын дагуу: Basic=$BU, хаягийн мөрөнд=$AU" "$BU" "$BP" "$AU" "$AP" || A=0
if [ "$A" = "0" ]; then
  try "Б) Эсрэгээр: Basic=$AU, хаягийн мөрөнд=$BU" "$AU" "$AP" "$BU" "$BP" || B=0
fi
BP=''; AP=''

printf '\n════  Дүгнэлт  ════\n'
if [ "$A" = "1" ]; then
  printf 'Гарын авлагын дараалал зөв. Одоогийн тохиргоо зөв байх ёстой —\n'
  printf 'нууц үгээ л дахин нягтлаад storepay-tohiruulah.sh-г ажиллуулна уу.\n\n'
elif [ "$B" = "1" ]; then
  printf 'ХОС СОЛИГДСОН байна. storepay-tohiruulah.sh-г дахин ажиллуулж,\n'
  printf 'API талд %s-г, систем талд %s-г оруулна уу.\n\n' "$AU" "$BU"
else
  printf 'Хоёр дараалал хоёулаа бүтсэнгүй. Хамгийн магадлалтай шалтгаанууд:\n'
  printf '  1. Storepay-гаас ирсэн УРИЛГЫГ хараахан хүлээн аваагүй байна.\n'
  printf '     Имэйлээ шалгаад урилгыг хүлээн авсны дараа дахин оролдоно уу.\n'
  printf '  2. "Үүсгэсэн нууц үг" таарахгүй байна — урилга хүлээн авахдаа\n'
  printf '     өөрөө зохиосон нууц үг байх ёстой.\n'
  printf '  3. Basic нууц үг буруу бичигдсэн.\n'
  printf '\nЭдгээрийг шалгаад ч болохгүй бол Nomin-д дээрх алдааны мессежийг\n'
  printf 'харуулж, merchantapp1 нь #5753 дэлгүүрт идэвхтэй эсэхийг асуугаарай.\n\n'
fi
