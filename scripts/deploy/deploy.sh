#!/usr/bin/env bash
#
# Атомарный деплой sokratai.ru + retention старых hashed-assets.
#
# ЗАЧЕМ: прежний шаг `rm -rf /var/www/sokratai/* && cp -r dist/*` стирал ВСЕ
# ранее отданные hashed-чанки. Любой клиент со старым index.html (вкладка
# открыта через деплой, SW-кэш, bfcache) получал жёсткий 404 на каждый
# lazy-import → белый экран. Плюс `cp -r` неатомарен: окно в секунды, когда
# докрут пуст и 404 ловят даже свежие посетители.
#
# ИНВАРИАНТЫ (НЕ нарушать — см. .claude/rules/95-production-deploy.md):
#   1. $ASSETS — append-only. `rm -rf` докрута ЗАПРЕЩЁН.
#   2. GC только по mtime, и КАЖДЫЙ деплой обязан `touch` весь текущий набор
#      ассетов — иначе стабильный, но ЖИВОЙ чанк (react-vendor, pdf.worker)
#      состарится и будет удалён.
#   3. Порядок: сначала ассеты, потом корень. Новый index.html не должен
#      ссылаться на ещё не залитый чанк.
#   4. `--exclude='/.*'` обязателен: `--delete` иначе съест
#      /.well-known/acme-challenge и тихо сломает продление TLS.
#   5. Валидация dist ДО касания прода: упавший/OOM-нутый билд обязан
#      оставить прод байт-в-байт (у VPS 1 GB RAM + 2 GB swap).
#
# RETENTION_DAYS = контракт: сколько живёт устаревшая вкладка пользователя.
#
set -Eeuo pipefail

REPO=/opt/sokratai
DOCROOT=/var/www/sokratai
ASSETS="$DOCROOT/assets"
SNAPSHOTS=/var/www/sokratai-releases
RETENTION_DAYS=30
KEEP_SNAPSHOTS=10
BASE_URL=https://sokratai.ru
MIN_JS_CHUNKS=50

log() { printf '\n=== %s ===\n' "$*"; }
die() { printf '\n❌ %s\n' "$*" >&2; exit 1; }

# Два деплоя не должны переплетать merge ассетов.
exec 9>/var/lock/deploy-sokratai.lock
flock -n 9 || die "деплой уже идёт (lock занят)"

command -v rsync >/dev/null || die "нужен rsync: apt-get install -y rsync"

log "1/10 git pull"
cd "$REPO"
git pull --ff-only
SHA=$(git rev-parse --short HEAD)

log "2/10 npm ci"
npm ci --prefer-offline --no-audit --no-fund

log "3/10 build ($SHA)"
# postbuild-хук генерит dist/invite-og.html (scripts/generate-og-variants.mjs)
NODE_OPTIONS="--max-old-space-size=2048" npm run build

log "4/10 валидация dist (ПРОД ЕЩЁ НЕ ТРОНУТ)"
[ -s dist/index.html ] || die "dist/index.html пуст или отсутствует"
[ -s dist/invite-og.html ] || die "нет dist/invite-og.html — упал postbuild (generate-og-variants)"
js_count=$(find dist/assets -name '*.js' -type f | wc -l)
[ "$js_count" -ge "$MIN_JS_CHUNKS" ] || die "только $js_count JS-чанков (ожидалось ≥$MIN_JS_CHUNKS) — билд неполный"
if grep -q 'data:application/octet-stream;base64' dist/index.html; then
  die "в index.html вернулся modulepreload сырого исходника (data:application/octet-stream) — см. rule 95"
fi
# Каждый /assets/... из обоих HTML обязан существовать в dist/assets.
missing=0
for html in dist/index.html dist/invite-og.html; do
  while IFS= read -r ref; do
    [ -f "dist$ref" ] || { printf '   %s → отсутствует %s\n' "$html" "$ref"; missing=1; }
  done < <(grep -o '/assets/[A-Za-z0-9._-]*' "$html" | sort -u)
done
[ "$missing" -eq 0 ] || die "HTML ссылается на отсутствующие ассеты"
printf '   ok: %s JS-чанков, все ссылки HTML резолвятся\n' "$js_count"

log "5/10 запоминаем ЖИВОЙ entry (проверка retention на шаге 9)"
OLD_ENTRY=""
if [ -f "$DOCROOT/index.html" ]; then
  OLD_ENTRY=$(grep -o '/assets/index-[A-Za-z0-9_-]*\.js' "$DOCROOT/index.html" | head -1 || true)
fi
printf '   текущий прод-entry: %s\n' "${OLD_ENTRY:-<нет, первый деплой>}"

log "6/10 assets — append-only merge"
mkdir -p "$ASSETS"
# --size-only: имена content-addressed ⇒ одинаковое имя = одинаковые байты =
# пропуск. Но ОБРЕЗАННЫЙ файл (прерванная прошлая копия) имеет другой размер ⇒
# перезальётся. --ignore-existing сохранял бы порчу навсегда.
rsync -a --size-only --chmod=D755,F644 dist/assets/ "$ASSETS/"
# GC-keepalive (инвариант 2): rsync пропустил идентичные файлы, не обновив
# mtime → без этого прохода GC удалит живой react-vendor.
(cd dist/assets && find . -type f -print0) | (cd "$ASSETS" && xargs -0 -r touch -c -m --)

log "7/10 корень — атомарно (rsync = temp-file + rename per file)"
rsync -a --delete --chmod=D755,F644 \
  --exclude='/assets/' --exclude='/.*' \
  dist/ "$DOCROOT/"

log "8/10 снапшот шелла (для быстрого откатa)"
snap="$SNAPSHOTS/$(date -u +%Y%m%dT%H%M%SZ)-$SHA"
mkdir -p "$snap"
cp -a dist/index.html dist/invite-og.html "$snap/"
grep -oh '/assets/[A-Za-z0-9._-]*' dist/index.html dist/invite-og.html | sort -u > "$snap/manifest.txt"
ls -1d "$SNAPSHOTS"/*/ 2>/dev/null | sort | head -n -"$KEEP_SNAPSHOTS" | xargs -r rm -rf

log "9/10 nginx + верификация"
nginx -t && systemctl reload nginx
code() { curl -s -o /dev/null -w '%{http_code}' "$1"; }
[ "$(code "$BASE_URL/")" = 200 ] || die "/ отдаёт не 200"
NEW_ENTRY=$(grep -o '/assets/index-[A-Za-z0-9_-]*\.js' "$DOCROOT/index.html" | head -1)
[ "$(code "$BASE_URL$NEW_ENTRY")" = 200 ] || die "новый entry $NEW_ENTRY отдаёт не 200"
if [ -n "$OLD_ENTRY" ]; then
  old_code=$(code "$BASE_URL$OLD_ENTRY")
  if [ "$old_code" != 200 ]; then
    die "RETENTION СЛОМАН: прошлый entry $OLD_ENTRY отдаёт $old_code — стейл-вкладки словят белый экран"
  fi
  printf '   ✅ retention: прошлый entry %s всё ещё 200\n' "$OLD_ENTRY"
fi
curl -sI "$BASE_URL/" | grep -qi 'cache-control:.*no-store' \
  || printf '   ⚠️  index.html отдаётся без no-store — проверь nginx\n'

log "10/10 GC ассетов старше $RETENTION_DAYS дней"
deleted=$(find "$ASSETS" -type f -mtime +"$RETENTION_DAYS" -print -delete | wc -l)
printf '   удалено: %s файлов\n' "$deleted"
du -sh "$ASSETS" | awk '{printf "   размер пула ассетов: %s\n", $1}'
df -h "$DOCROOT" | awk 'NR==2 {printf "   свободно на диске: %s\n", $4}'

printf '\n✅ Deploy complete (%s)\n' "$SHA"
