#!/bin/sh
# Buddy Shop — ERP-ийн өгөгдлийн нөөцийг энэ компьютер руу татна.
#
# Supabase-ийн үнэгүй багц ямар ч нөөц хадгалдаггүй. Worker шөнө бүр Cloudflare R2 руу
# хуулбар үүсгэдэг ч тэр нь мөн л нэг Cloudflare данс дотор. Энэ скрипт гуравдахь,
# бүрэн тусдаа хуулбарыг эзний компьютер дээр үүсгэнэ. launchd сард нэг удаа ажиллуулна.
#
# Түлхүүрийг файлд биш, Keychain-д хадгална. Нэг удаа тохируулахдаа:
#   security add-generic-password -s buddy-backup -a buddy -w 'ТҮЛХҮҮР'
#
# Гараар ажиллуулж шалгах:  sh "$HOME/Desktop/Buddy Shop ERP/buddy-backup.sh"

set -eu

# Ердийн үед эдгээрийг хөндөх шаардлагагүй; туршихад л дарж өөрчилнө.
API="${BUDDY_API:-https://buddy-shop-api.taimenlodge.workers.dev}"
DEST="${BUDDY_DEST:-$HOME/Desktop/Buddy Shop ERP/Backup}"
KEEP="${BUDDY_KEEP:-12}"      # сүүлийн 12 сарын хуулбарыг үлдээнэ

mkdir -p "$DEST"
LOG="$DEST/backup.log"
say()  { printf '%s  %s\n' "$(date '+%Y-%m-%d %H:%M')" "$*" >> "$LOG"; }
die()  { say "АЛДАА: $*"; printf '%s\n' "$*" >&2; exit 1; }

TOKEN=$(security find-generic-password -s buddy-backup -w 2>/dev/null) \
  || die "Keychain дотор buddy-backup түлхүүр алга. README-г үзнэ үү."

LIST=$(curl -fsS --max-time 60 -H "x-backup-token: $TOKEN" "$API/api/backup/latest.txt") \
  || die "Серверээс жагсаалт авч чадсангүй (сүлжээ, эсвэл түлхүүр буруу)."

DATE=$(printf '%s\n' "$LIST" | sed -n '1p')
WANT=$(printf '%s\n' "$LIST" | sed -n '3p')
case "$DATE" in
  20[0-9][0-9]-[0-1][0-9]-[0-3][0-9]) ;;
  *) die "Сервер дээр нөөц алга (хариу: $DATE)" ;;
esac

TMP="$DEST/.tmp-$DATE"
rm -rf "$TMP"; mkdir -p "$TMP"
F="$TMP/buddy-$DATE.ndjson.gz"

curl -fsS --max-time 600 -H "x-backup-token: $TOKEN" -o "$F" "$API/api/backup/$DATE" \
  || die "Нөөц татагдсангүй."
gzip -t "$F" 2>/dev/null || die "Татсан файл эвдэрсэн байна."

# Мөрийн тоог сервер дээрхтэй тулгана: тасалдсан татлага чимээгүй өнгөрч болохгүй.
# '#table …' мөрүүд нь хүснэгт хоорондын заагч тул тоонд оруулахгүй.
total=$(gunzip -c "$F" | grep -vc '^#table ' || true)
[ "$total" = "$WANT" ] || die "Дутуу татагдлаа: $total мөр, $WANT байх ёстой."

rm -rf "$DEST/$DATE"
mv "$TMP" "$DEST/$DATE"
say "$DATE — $total мөр татлаа."

# Хуучин сарынхыг цэвэрлэнэ.
count=$(ls -1d "$DEST"/20??-??-?? 2>/dev/null | wc -l | tr -d ' ')
if [ "$count" -gt "$KEEP" ]; then
  ls -1d "$DEST"/20??-??-?? | sort | sed -n "1,$((count - KEEP))p" | while IFS= read -r d; do
    rm -rf "$d"; say "хуучин нөөц устгав: $(basename "$d")"
  done
fi

printf '%s — %s мөр, байршил: %s\n' "$DATE" "$total" "$DEST/$DATE"
