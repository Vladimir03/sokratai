# Commands And Validation

Run checks in sequence on Windows:

```bash
npm run dev
npm run lint
npm run build
npm run test
npm run smoke-test
npm run smoke-check
```

Notes:

- ⚠️ **`npm run build` ЛОКАЛЬНО перезаписывает `supabase/functions/mcp/index.ts`.** Файл авто-генерируется Vite-плагином `@lovable.dev/mcp-js` и на твоей машине получает импорт `npm:C:\Users\<...>\src\lib\mcp\index.ts` — абсолютный путь разработчика. На проде это гарантированный **503 boot-fail** функции. После любой локальной сборки: `git checkout -- supabase/functions/mcp/index.ts` ДО коммита. Симптом-ловушка: файл выглядит как чужая правка в `git status` (2026-08-02 я дважды списал его на параллельную сессию).
- `test` runs `smoke-check` (Node-based smoke checks).
- `smoke-test` keeps the original bash-based smoke script.
- If lint fails, still run `build` + `smoke-check` and report failures precisely.
- Do not run `build` and `smoke-check` in parallel (can conflict in `dist/`).
- `npx vitest run` (`npm run test:unit`) — unit-тесты (~410, 2026-08-05): грейдинг, анти-утечечные стрипы, валидаторы, статистика ученика, зеркала шкал (parity src↔Deno), отчёт родителям. **С 2026-08-05 гоняется в CI** (шаг «Unit tests» в quality-gates; до этого vitest не запускал НИКТО — `npm test` = smoke-check) и в preflight §4b. Переиспользуемый стаб PostgREST — `supabase/functions/_shared/test-helpers/fake-db.ts`. **Чистое из edge-`index.ts` (top-level `Deno.serve` не импортируется в vitest) выносить в соседний модуль** — прецеденты `homework-api/{student_strip,validators}.ts`, `public-student-report/report_shape.ts`.
- **`npm run typecheck` НИЧЕГО не проверяет** (корневой `tsconfig.json` = `files: []` + references, а CI зовёт именно его). Реальная команда — `npx tsc -p tsconfig.app.json --noEmit`; там живут pre-existing ошибки, их число сверяй с baseline, а не считай нулём.
- **smoke-check §23 гоняет `npm ci --dry-run`** — та же сверка `package-lock.json` ↔ `package.json`, что делает деплой на VPS. До её появления рассинхрон лока обнаруживался только оборванным `deploy-sokratai` (инцидент 2026-07-27 после добавления vitest). Занимает ~5 сек; для быстрых локальных прогонов — `SMOKE_SKIP_NPM_CI=1`. Падение исправляется `npm install --package-lock-only` + коммит лока.
- ⚠️ **§23 проверяет лок ТОЛЬКО для своей платформы.** Разработка идёт на Windows, деплой — на Linux; зелёный `npm ci` на Windows не гарантирует Linux. Пакет с платформенными биндингами (`os`/`cpu` в optionalDependencies) записывается в лок лишь для текущей ОС, и на VPS `npm ci` падает с `Missing:` на чужой платформе. Проверить перед деплоем можно чужой Linux-средой: попросить агента Lovable выполнить `npm ci --dry-run --no-audit --no-fund` (см. skill `production-deploy`).
- 🚫 **`npm ci --prefer-offline` на деплое ЗАПРЕЩЁН** (гард — smoke-check §21). Флаг берёт метаданные пакетов из кэша машины без ревалидации, поэтому деплой падает на версии, которая в реестре ЕСТЬ, а в кэше VPS ещё нет: `ETARGET notarget No matching version found for picomatch@4.0.5` (2026-07-27, третий оборванный деплой подряд; лечилось `npm cache clean --force`). Детерминизм версий держит **лок**, а не кэш. Симптом легко спутать с рассинхроном лока — отличать по коду ошибки: `EUSAGE` = лок разошёлся с `package.json` (чинить `npm install --package-lock-only`), `ETARGET` = проблема кэша/зеркала.
- 🔒 **`vitest` держим на `^3.x` — НЕ поднимать до 4.** `vitest@4` тянет свою копию `vite`, а та требует `rolldown` (16 платформенных биндингов + вложенные `@emnapi`) как обязательную зависимость → лок перестаёт быть кросс-платформенным и `npm ci` на VPS падает (два оборванных деплоя 2026-07-27). На `vitest@3` используется общий `vite`, а `rolldown` остаётся лишь optional-peer'ом `rollup-plugin-visualizer` и в дерево не попадает. Тесты API-совместимы, менять их при понижении не пришлось.
