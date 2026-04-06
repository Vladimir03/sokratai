# Architecture Map for AI Agents

Last updated: 2026-02-23

## Purpose

This folder is the navigation layer for AI agents (Codex/Claude/Cursor):

- `modules.json` is the machine-readable module registry.
- `high-risk-zones.md` lists fragile areas and safe edit protocol.

Use this map before editing code to reduce blind spots and avoid cross-module regressions.

## Repository Map (High-Level)

| Area | Main paths | Role |
|---|---|---|
| Frontend app shell | `src/main.tsx`, `src/App.tsx`, `src/pages/**` | Entry, routing, lazy loading boundaries |
| Student domain | `src/pages/Chat.tsx`, `src/pages/Practice.tsx`, `src/pages/Diagnostic.tsx`, `src/components/practice/**`, `src/components/diagnostic/**` | Student learning flows |
| Tutor domain | `src/pages/tutor/**`, `src/components/tutor/**`, `src/hooks/useTutor*.ts*`, `src/lib/tutor*.ts` | Tutor cabinet and student management |
| Shared platform layer | `src/components/ui/**`, `src/hooks/**`, `src/lib/**`, `src/types/**` | Shared UI, types, data-access helpers |
| Supabase runtime | `supabase/functions/**`, `supabase/config.toml` | Edge functions and runtime policies |
| DB evolution | `supabase/migrations/**` | Schema and data migrations |
| CI and scripts | `.github/workflows/**`, `scripts/**` | Quality gates, deploy automation, drift checks |

## How Agents Should Use `modules.json`

1. Map each changed file to one or more `path_globs`.
2. For matched modules, read:
   - `risk_level`
   - `forbidden_changes`
   - `notes`
3. Run the union of all `validation_commands` for touched modules.
4. In PR summary, explicitly say:
   - which modules were touched
   - which high-risk zones were intentionally not changed
5. If module data conflicts with task instructions, task instructions win and conflict must be reported.

## Default Validation Baseline

Run sequentially on Windows:

```sh
npm run build
npm run smoke-check
npm run test
```

If the task touches typing-heavy boundaries (`src/lib/**`, `src/hooks/**`, contracts), also run:

```sh
npm run typecheck
```

For Supabase config/deploy drift checks:

```sh
node scripts/supabase-drift-check.mjs
```
