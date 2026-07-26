# Production Deploy — инварианты (всегда в контексте)

Прод (`sokratai.ru` + `api.sokratai.ru`) — **Selectel Moscow VPS** (`185.161.65.182`). Lovable Cloud = только preview. **Глубина — skill `production-deploy`** (полный алгоритм деплоя и откатa, OG-варианты в nginx, инцидент SW с octet-stream и его диагностика, механика авто-reload чанков, tiered-статус ошибок кабинета, топология деплоя edge-функций, probe-скрипт, pg_cron).

## «🚀 Deploy needed» — когда напоминать

Фронт-изменение **НЕ доходит до прода само**. После правок в `src/**`, `index.html`, `package.json`, `vite.config.ts`, `tailwind.config.ts`, `public/**`, `tsconfig*`, `postcss.config.*` — заканчивать финальное сообщение блоком:

```
ssh -i "$HOME\.ssh\sokratai_proxy" root@185.161.65.182
deploy-sokratai
```

**НЕ напоминать**, если менялись только: `supabase/migrations/**`, `supabase/functions/**`, `supabase/config.toml`, `docs/**`, `.claude/**`, `*.md`, `.github/**`, `scripts/**` (**исключение: `scripts/deploy/**` — прод-влияющий**, тело деплоя, подхватывается `git pull`'ом на VPS).

Миграции и edge-функции авто-деплоит Lovable на push в main. Фронт — только `deploy-sokratai`.

## Инварианты деплоя (`scripts/deploy/deploy.sh`)

Тело деплоя живёт **в репо**; `/usr/local/bin/deploy-sokratai` — тонкий стаб (`flock` → гарды чистого main → `git pull` → `bash -n` → `exec`), поэтому правка логики деплоя **не требует ops-шага**.

1. **`/var/www/sokratai/assets` — append-only. `rm -rf` докрута ЗАПРЕЩЁН** (в т.ч. через `"$DOCROOT"`/`"$ASSETS"`). Прежний шаг стирал все ранее отданные hashed-чанки → клиент со старым `index.html` (вкладка через деплой, SW-кэш, bfcache) получал 404 на каждый lazy-import = **белый экран**. Именно это давало отчёты «Failed to fetch dynamically imported module» в `/admin`.
2. **GC только по mtime, и КАЖДЫЙ деплой обязан `touch` весь текущий набор ассетов.** `rsync --size-only` пропускает идентичные файлы, не обновляя mtime; без явного `touch`-прохода GC удалит стабильный, но **живой** чанк (`react-vendor`, `pdf.worker`). Самое опасное место дизайна.
3. **Порядок: ассеты → корень.** Новый `index.html` не должен ссылаться на ещё не залитый чанк.
4. **`--exclude='/.*'` обязателен.** Старый `rm -rf .../*` не матчил дотфайлы, и `/.well-known/acme-challenge` выживал случайно; `rsync --delete` съел бы его и тихо сломал продление TLS через ~60 дней.
5. **Валидация `dist` ДО касания прода.** У VPS 1 ГБ RAM + 2 ГБ swap: OOM-нутый билд обязан оставить прод байт-в-байт.
6. **`RETENTION_DAYS = 30` — контракт: сколько живёт устаревшая вкладка пользователя.**
7. **Lock берётся ДО `git pull`** (в стабе, наследуется через `exec`; тело НЕ переоткрывает FD — `exec 9>` потерял бы блокировку). Иначе второй запуск меняет рабочее дерево под сборкой первого → смешанный bundle со старым SHA.
8. **Деплой только с чистого `main`.** `git pull --ff-only` не проверяет ни имя ветки, ни чистоту дерева — забытая на VPS feature-ветка уехала бы в прод.

Гарды: smoke-check **§20** (SW-инварианты) и **§21** (нет `modulepreload` на `/src/*`; `deploy.sh` не вернул destructive `rm -rf`, сохранил `--size-only`/`touch -c`/`--exclude='/.*'`/`--delete` **в КОДЕ, не в комментариях**, порядок «ассеты → корень», lock/branch-гарды стаба).

Откат = копирование двух HTML из `/var/www/sokratai-releases/<ts>-<sha>/` (ассеты релиза ещё в пуле).

## Клиентские инварианты, связанные с деплоем

- **Service Worker: НИКОГДА `respondWith(undefined)`** — и это включает неявный вид, `return cached` при cache miss (именно так выглядел инцидент 2026-06-29). Каждая fallback-ветвь обязана иметь `|| Response.error()`. Пустой ответ читается как `application/octet-stream` → strict-MIME ES-модулей падает → чанк не исполняется, фича молча исчезает.
- **`isHashedAsset` обязан матчить реальные vite-хэши** (`name-<hash>.js|css`, base62 **смешанного** регистра). Старый `/[a-f0-9]{8,}/` не матчил НИ ОДИН чанк.
- **`cache.put` только за тип-гардом И внутри `event.waitUntil`.** Тип-гард: cache-first + иммутабельный `CACHE_NAME` ⇒ одна неверная запись живёт вечно. `waitUntil`: `respondWith` продлевает жизнь воркера только для ВОЗВРАЩАЕМОГО promise, «выстрелил и забыл» может не дожить.
- **Менял логику кэширования SW → бампай `CACHE_NAME`** и `MIN_SW_CACHE_VERSION` в smoke-check.
- **Байпас `api.sokratai.ru` / `*.supabase.co` / `mc.yandex.ru` — ВЫШЕ любой кэширующей ветки** (security: данные одного юзера не должны попасть в общий Cache Storage).
- SW регистрируется на **всех** `PROD_HOSTS`, вне них — принудительный unregister. **Поэтому SW нельзя проверить локально** — только prod/preview. Эмердженси: `?sw=off`.
- **Chunk-load ошибка → авто-reload ОДИН раз на эпизод, НЕ краш-экран.** Marker + окно тишины (монотонное, пере-взводится) + circuit breaker ≤3/10 мин. Marker снимается только своим значением (localStorage общий на вкладки). Каждая точка входа зовёт `noteChunkError()`. Репорт **ВСЕГДА и ДО** reload. `vite:preloadError` для reload **не перехватываем** — он фаерится на hover-prefetch и стирал бы формы.
- **`controllerchange` НЕ перезагружает страницу** — был безусловный `reload()` = гарантированная потеря данных при каждом обновлении SW.
- **Ошибки данных кабинета: никогда OR-агрегация в баннер.** RU DPI роняет ~1 из N параллельных запросов → ложная тревога. `TutorDataStatus` tiered: `criticalError` только когда у поверхности нет полезного контента, `degraded` — когда блок упал при отрисованной странице; тихо → эскалация → самолечение; сетевые ошибки нейтральны (**не винить сеть пользователя** — узкое место наш кросс-граничный хоп).

## Anti-patterns

- Не предполагать, что Lovable обновит прод после push — он обновит только preview.
- Не менять DNS `sokratai.ru` / `api.sokratai.ru` (указывают на VPS).
- Не «исправлять» хардкод `https://api.sokratai.ru` в `src/lib/supabaseClient.ts` — он намеренный (rule 96).
- **Всё из `public/**` попадает в докрут дословно, а репозиторий ПУБЛИЧНЫЙ** — сырые данные пользователей запрещены и там, и в `docs/`.
