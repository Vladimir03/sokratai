# High-Risk Zones

This list is for AI agents to avoid accidental high-blast-radius changes.

## Zone Matrix

| Zone | Paths | Why risky | Minimum validation | Default policy |
|---|---|---|---|---|
| Auth guards | `src/components/AuthGuard.tsx`, `src/components/TutorGuard.tsx` | Can lock out users or break role isolation. | `npm run build`, `npm run smoke-check` | Do not edit unless task directly targets auth/role access. |
| Route shell | `src/App.tsx`, `src/main.tsx` | Breaks navigation, lazy loading, or app bootstrap. | `npm run build`, `npm run smoke-check` | Keep route boundaries minimal and explicit. |
| Student chat runtime | `src/pages/Chat.tsx`, `src/components/Chat*.tsx`, `src/components/GraphRenderer.tsx` | Large integration surface with rendering/perf side effects. | `npm run build`, `npm run smoke-check`, `npm run test` | Avoid opportunistic refactors in unrelated PRs. |
| Tutor schedule/payments | `src/pages/tutor/TutorSchedule.tsx`, `src/lib/tutorSchedule.ts`, `src/lib/paymentAmount.ts` | Touches billing logic and calendar workflows. | `npm run build`, `npm run typecheck`, `npm run smoke-check` | Preserve data contracts and cents-based money representation. |
| Tutor query/cache layer | `src/hooks/useTutor.ts`, `src/lib/tutorStudentCacheSync.ts` | Query-key drift breaks optimistic updates across pages. | `npm run build`, `npm run typecheck` | Keep `['tutor', ...]` key convention. |
| Shared UI primitives | `src/components/ui/**` | Used everywhere; heavy deps here bloat all bundles. | `npm run build`, `npm run lint` | No heavy runtime deps in shared primitives. |
| Telegram bot edge function | `supabase/functions/telegram-bot/**` | Webhook-driven runtime; command/callback regressions are user-visible. | `npm run build`, `node scripts/supabase-drift-check.mjs` | Treat command/callback contracts as stable by default. |
| Supabase config/deploy policy | `supabase/config.toml`, `.github/workflows/deploy-supabase-functions.yml` | JWT/deploy drift creates silent auth and release mismatches. | `node scripts/supabase-drift-check.mjs` | Any JWT policy change requires explicit owner decision. |
| Migrations | `supabase/migrations/**` | Direct schema impact and rollback risk. | `npm run build`, `npm run typecheck` | Separate PR track; do not edit in process/doc-only tasks. |
| Cloudflare proxy infra | `docs/delivery/engineering/architecture/cloudflare-proxy*.{md,js}`, any code referencing `VITE_SUPABASE_URL` | Worker reverse-proxy is the only path Supabase API works for RU users. Breaking it locks out the entire RU segment simultaneously (auth, ДЗ, guided chat). | `npm run build`, `npm run smoke-check`; manual `curl https://api.sokratai.ru/__health` post-deploy | Worker code lives in Cloudflare Dashboard — repo file is canonical mirror. Sync both when changing. Test changes on `*.workers.dev` URL before promoting to `api.sokratai.ru`. |

## Safe Navigation Protocol

1. Identify if touched files fall into any zone above.
2. If yes, limit diff scope to task-critical lines only.
3. State in PR summary why zone edits were required.
4. If JWT/deploy policy is involved, run drift-check and include output.
5. If zone edits are not required, explicitly state "intentionally not changed."
