# AGENTS.md

Repository guidance for AI coding agents (Codex, Claude Code, Cursor).

## Scope

- Prefer minimal, surgical edits.
- Do not change business logic, auth behavior, or public API contracts unless the task explicitly asks for it.
- Do not update dependencies unless explicitly requested.
- Avoid broad refactors in unrelated files.

## Project Map

- Frontend app: `src/`
- Routes and app composition: `src/App.tsx`
- React entrypoint: `src/main.tsx`
- Supabase edge functions: `supabase/functions/`
- Database migrations: `supabase/migrations/`
- Engineering docs: `docs/engineering/`
- Architecture map (human): `docs/engineering/architecture/README.md`
- Architecture map (machine): `docs/engineering/architecture/modules.json`
- High-risk zones: `docs/engineering/architecture/high-risk-zones.md`

## Working Commands

Run commands sequentially on Windows (avoid concurrent writes to `dist/`):

```sh
npm run dev
npm run lint
npm run build
npm run test
npm run smoke-test
npm run smoke-check
```

Notes:

- `test` runs `smoke-check`.
- `smoke-test` keeps the original bash-based smoke script.
- `smoke-check` runs the Node-based smoke checks (`scripts/smoke-check.mjs`).
- In CI, use `smoke-check` as the main smoke quality gate; treat `smoke-test` as legacy bash fallback.
- In CI, lint is currently informational (non-blocking) until a dedicated lint-debt reduction PR.
- If lint is red, still run `build` and `smoke-check` and report exact failures.
- If docs mention both `bun` and `npm`, treat `package.json` + CI workflows as source of truth (currently `npm run ...`).
- For DB-backed features, rollout order is mandatory: apply new Supabase migration(s) first, then deploy frontend; do not assume GitHub merge alone updates production behavior.
- If frontend references additive DB columns that are not yet migrated, fail safely in UI and report rollout mismatch instead of changing business logic.
- For mini-group payment flows, use participant-level idempotency key `(lesson_id, tutor_student_id)`; do not assume one payment row per lesson for group lessons.

## Supabase Drift Guardrails

- Before changing `verify_jwt` in `supabase/config.toml` or using `--no-verify-jwt` in workflow deploy commands, run a drift-check between config and workflow and request explicit owner decision for policy changes.
- Before changing `supabase/config.toml`, verify bidirectional consistency: every `[functions.*]` entry should map to `supabase/functions/*`, and every `supabase/functions/*` directory should have an explicit policy decision in config.

## Critical Boundaries

- Keep **Student** and **Tutor** modules isolated.
- Keep `src/components/ui/*` lightweight (no heavy runtime dependencies).
- Treat these files as high-risk and change only when required:
  - `src/components/AuthGuard.tsx`
  - `src/components/TutorGuard.tsx`
  - `src/pages/Chat.tsx`
  - `src/pages/tutor/TutorSchedule.tsx`
  - `supabase/functions/telegram-bot/index.ts`

## Output Expectations

- Include a short summary of changed files.
- Include exact commands used for validation.
- Explicitly list what was intentionally not changed.
