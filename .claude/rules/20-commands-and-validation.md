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

- `test` runs `smoke-check` (Node-based smoke checks).
- `smoke-test` keeps the original bash-based smoke script.
- If lint fails, still run `build` + `smoke-check` and report failures precisely.
- Do not run `build` and `smoke-check` in parallel (can conflict in `dist/`).
- `npx vitest run` (`npm run test:unit`) — unit-тесты; сейчас покрывают цепочку балла и «% самостоятельности» (`_shared/score-compute.test.ts`).
- **`npm run typecheck` НИЧЕГО не проверяет** (корневой `tsconfig.json` = `files: []` + references, а CI зовёт именно его). Реальная команда — `npx tsc -p tsconfig.app.json --noEmit`; там живут pre-existing ошибки, их число сверяй с baseline, а не считай нулём.
- **smoke-check §23 гоняет `npm ci --dry-run`** — та же сверка `package-lock.json` ↔ `package.json`, что делает деплой на VPS. До её появления рассинхрон лока обнаруживался только оборванным `deploy-sokratai` (инцидент 2026-07-27 после добавления vitest). Занимает ~5 сек; для быстрых локальных прогонов — `SMOKE_SKIP_NPM_CI=1`. Падение исправляется `npm install --package-lock-only` + коммит лока.
