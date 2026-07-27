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
# Маркер «пул ассетов ведёт ЭТОТ скрипт». Живёт вне докрута (не отдаётся
# nginx) и вне $ASSETS (иначе GC по mtime удалил бы его как обычный файл).
# Смысл — в шаге 9: проверять retention можно только если ПРОШЛЫЙ деплой тоже
# был нашим. На переходном запуске прошлый entry снёс легаси-`rm -rf`, и его
# 404 — ожидаемое прошлое, а не наша регрессия.
POOL_STATE="$SNAPSHOTS/.pool-managed"
# Канарейка append-only: пустой файл в пуле ассетов, который НИКОГДА не входит
# ни в один билд. Если он исчез — пул кто-то вычистил, и разрушительное
# поведение вернулось.
#
# Зачем отдельно от проверки прошлого entry (шаг 9): та ловит проблему только
# когда хэш СМЕНИЛСЯ. Если билд дал те же хэши (правка не тронула фронт), пул
# мог быть стёрт и заново залит тем же набором — проверка entry пройдёт, а
# ранее отданные ЧУЖИЕ хэши уже потеряны. Канарейка ловит это независимо от
# хэшей: её ничто не восстанавливает.
CANARY="$ASSETS/.retention-canary"
RETENTION_DAYS=30
KEEP_SNAPSHOTS=10
BASE_URL=https://sokratai.ru
MIN_JS_CHUNKS=50

log() { printf '\n=== %s ===\n' "$*"; }
die() { printf '\n❌ %s\n' "$*" >&2; exit 1; }

# Два деплоя не должны переплетать merge ассетов.
#
# Стаб уже держит lock на FD 9 (взят ДО его `git pull` — ревью 5.6 P1) и
# наследует его через exec. Переоткрывать здесь НЕЛЬЗЯ: `exec 9>file` создаёт
# новый дескриптор и теряет блокировку стаба. Берём lock сами только при прямом
# запуске тела (напр. `bash scripts/deploy/deploy.sh` при ручном откате).
if [ -z "${DEPLOY_LOCK_HELD:-}" ]; then
  exec 9>/var/lock/deploy-sokratai.lock
  flock -n 9 || die "деплой уже идёт (lock занят)"
  export DEPLOY_LOCK_HELD=1
fi

command -v rsync >/dev/null || die "нужен rsync: apt-get install -y rsync"

cd "$REPO"
# Pull уже сделан стабом (он же проверил чистый main). При прямом запуске тела
# подтягиваем сами — но с теми же гардами, иначе ручной откат уедет с
# feature-ветки.
if [ -z "${DEPLOY_PULLED:-}" ]; then
  log "1/10 git pull (тело запущено напрямую)"
  cur=$(git rev-parse --abbrev-ref HEAD)
  [ "$cur" = "main" ] || die "HEAD на «$cur», а не «main» — деплой остановлен"
  [ -z "$(git status --porcelain --untracked-files=no)" ] || die "рабочее дерево не чистое — деплой остановлен"
  git pull --ff-only origin main
else
  log "1/10 git pull — уже выполнен стабом"
fi
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
# HTML-комментарии снимаются ДО проверки содержимого — иначе гард читает
# СОБСТВЕННУЮ документацию. Ровно это и случилось на первом боевом запуске:
# в index.html живёт комментарий, дословно цитирующий
# `data:application/octet-stream;base64` (объяснение, почему нельзя ставить
# modulepreload на /src/*.tsx), и валидация упала на нём, а не на коде.
# Vite оставляет HTML-комментарии в выводе, так что цитата доезжает до dist.
# Тот же класс ложных срабатываний уже ловился в smoke-check — там комментарии
# тоже снимаются первыми. Заодно это закрывает симметричный случай: упоминание
# `/assets/...` в комментарии больше не читается как ссылка на ассет.
#
# Обе проверки живут внутри одного node-прохода: он гарантированно есть (билд
# только что отработал), и сбой самого node отличим от найденной проблемы.
validation=$(node -e '
  const fs = require("fs");
  const strip = (f) => fs.readFileSync(f, "utf8").replace(/<!--[\s\S]*?-->/g, "");
  const problems = [];
  if (/data:application\/octet-stream;base64/.test(strip("dist/index.html"))) {
    problems.push("в index.html вернулся modulepreload сырого исходника (data:application/octet-stream) — см. rule 95");
  }
  for (const f of ["index.html", "invite-og.html"]) {
    for (const ref of new Set(strip("dist/" + f).match(/\/assets\/[A-Za-z0-9._-]+/g) || [])) {
      if (!fs.existsSync("dist" + ref)) problems.push(f + " ссылается на отсутствующий " + ref);
    }
  }
  process.stdout.write(problems.join("\n"));
') || die "не смог проверить dist (node упал) — прод не тронут"
[ -z "$validation" ] || die "валидация dist не прошла:
$validation"
printf '   ok: %s JS-чанков, все ссылки HTML резолвятся\n' "$js_count"

log "5/10 запоминаем ЖИВОЙ entry (проверка retention на шаге 9)"
OLD_ENTRY=""
if [ -f "$DOCROOT/index.html" ]; then
  OLD_ENTRY=$(grep -o '/assets/index-[A-Za-z0-9_-]*\.js' "$DOCROOT/index.html" | head -1 || true)
fi
printf '   текущий прод-entry: %s\n' "${OLD_ENTRY:-<нет, первый деплой>}"
POOL_MANAGED=0
[ -f "$POOL_STATE" ] && POOL_MANAGED=1
[ "$POOL_MANAGED" = 1 ] || printf '   ⚠️  переходный деплой: пул ассетов ещё не наш, retention проверим со следующего раза\n'

log "6/10 assets — append-only merge"
mkdir -p "$ASSETS"

# Канарейку проверяем ДО заливки — иначе мы же её и восстановим, скрыв улику.
# Спрашивать имеет смысл только если пул был НАШ: до перехода на этот скрипт
# канарейки просто не существовало.
if [ "$POOL_MANAGED" = 1 ] && [ ! -f "$CANARY" ]; then
  printf '\n🚨 КАНАРЕЙКА ПРОПАЛА: %s отсутствует.\n' "$CANARY" >&2
  printf '   Пул ассетов был вычищен между деплоями. Это ровно то поведение,\n' >&2
  printf '   которое давало белые экраны: ранее отданные чанки потеряны, и\n' >&2
  printf '   вкладки, открытые до прошлого деплоя, ловят 404 на lazy-import.\n' >&2
  printf '   Ищи `rm -rf` докрута — в deploy.sh, в ops-скриптах, в чьей-то шпаргалке.\n\n' >&2
  # НЕ падаем: этот запуск как раз восстанавливает пул, и блокировать его
  # значило бы удерживать прод сломанным. Жёсткий гейт остаётся на шаге 9,
  # где проверяется реальный пользовательский симптом.
fi
# --size-only: имена content-addressed ⇒ одинаковое имя = одинаковые байты =
# пропуск. Но ОБРЕЗАННЫЙ файл (прерванная прошлая копия) имеет другой размер ⇒
# перезальётся. --ignore-existing сохранял бы порчу навсегда.
rsync -a --size-only --chmod=D755,F644 dist/assets/ "$ASSETS/"
# GC-keepalive (инвариант 2): rsync пропустил идентичные файлы, не обновив
# mtime → без этого прохода GC удалит живой react-vendor.
(cd dist/assets && find . -type f -print0) | (cd "$ASSETS" && xargs -0 -r touch -c -m --)
# С этого момента пул наш: следующий деплой обязан доказать retention.
mkdir -p "$SNAPSHOTS" && touch "$POOL_STATE"
# Канарейку взводим/освежаем КАЖДЫЙ раз: GC удаляет по mtime старше
# RETENTION_DAYS, и без touch она бы «истекла» сама, тихо превратив проверку
# в вечное предупреждение.
touch "$CANARY"

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
  if [ "$old_code" = 200 ]; then
    printf '   ✅ retention: прошлый entry %s всё ещё 200\n' "$OLD_ENTRY"
  elif [ "$POOL_MANAGED" = 1 ]; then
    die "RETENTION СЛОМАН: прошлый entry $OLD_ENTRY отдаёт $old_code — стейл-вкладки словят белый экран"
  else
    # Переходный деплой: тот entry снёс ЛЕГАСИ-`rm -rf` ещё до нас. Падать
    # здесь значило бы обвинять новый скрипт в наследстве старого — и, хуже,
    # блокировать ровно тот запуск, который чинит проблему.
    printf '   ⚠️  прошлый entry %s отдаёт %s — ожидаемо, его снёс легаси-деплой.\n' "$OLD_ENTRY" "$old_code"
    printf '      Retention копится С ЭТОГО запуска; следующий деплой проверит его жёстко.\n'
  fi
fi
curl -sI "$BASE_URL/" | grep -qi 'cache-control:.*no-store' \
  || printf '   ⚠️  index.html отдаётся без no-store — проверь nginx\n'

log "10/10 GC ассетов старше $RETENTION_DAYS дней"
deleted=$(find "$ASSETS" -type f -mtime +"$RETENTION_DAYS" -print -delete | wc -l)
printf '   удалено: %s файлов\n' "$deleted"
du -sh "$ASSETS" | awk '{printf "   размер пула ассетов: %s\n", $1}'
df -h "$DOCROOT" | awk 'NR==2 {printf "   свободно на диске: %s\n", $4}'

printf '\n✅ Deploy complete (%s)\n' "$SHA"
