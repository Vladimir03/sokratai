# AGENTS.md

Canonical guidance for AI coding agents (Claude Code, Codex, Cursor). **Single source of truth — read this first.** Claude Code imports it via `@AGENTS.md` in `CLAUDE.md` and adds only Claude-Code-specific notes there.

Deep domain detail lives in `.claude/rules/*` (index at the bottom). Feature history, round-by-round fix logs, and commit archaeology live in `docs/delivery/features/<feature>/` and `~/.claude/plans/` — read on demand, **not** duplicated here.

**Cross-references:** link to a rule file by path/name (`.claude/rules/45-mock-exams.md`, `rule 45`) or a section title — **never** by `CLAUDE.md §N`. Section numbers don't survive a CLAUDE.md edit; a path or title does.

---

## Roles

- **Claude Code** — primary implementer.
- **Codex / review agent** — independent reviewer (architecture, regressions, spec drift).
- **Cowork** — research, synthesis, GTM, pilot analysis.
- **Human** — only decision maker for wedge, pricing, segment, major scope.

Agents implement, debug, validate. Humans own architecture, feature design, review. Do not change architecture, add dependencies, or modify security/auth logic without explicit human approval.

---

## Project

**SokratAI** — AI platform for tutoring + homework automation. Domains: Student platform, Tutor platform, AI homework checking, Telegram bot.

**Stack:** React + TypeScript + Vite + React Query (frontend) · Supabase + Edge Functions (backend) · Gemini via Lovable AI Gateway (AI).

**Module isolation (hard boundary):** never import tutor modules into student components or vice-versa. Keep `src/components/ui/*` lightweight (no heavy runtime deps).

### Map
- `src/` frontend · `src/App.tsx` routes · `src/main.tsx` entry
- Student: `src/pages/{Chat,Practice,Diagnostic,StudentHomework,StudentHomeworkDetail}.tsx`, `src/pages/student/*`, `src/components/homework/*`
- Tutor: `src/pages/tutor/*`, `src/components/tutor/*`
- Schedule materials («Занятия»): `src/components/tutor/schedule/*` (tutor drawer) · `src/pages/StudentSchedule.tsx` + `src/pages/student/LessonDetail.tsx` + `src/components/student/schedule/*` (student) · edge `lesson-materials-api` + `student-lessons-api` (rule 98)
- Shared: `src/components/ui`, `src/types`
- Backend: `supabase/functions/` (edge) · `supabase/migrations/` (DB)
- Architecture: `docs/delivery/engineering/architecture/README.md` (human) + `modules.json` (machine) + `high-risk-zones.md`

---

## Workflow — Spec → Plan → Code → Test

1. Read the feature spec (`docs/delivery/features/<feature>/spec.md`) + relevant `.claude/rules/*`.
2. Propose a minimal plan.
3. Implement `tasks.md` only. Prefer additive iterations over refactors.
4. Run validation commands.

DB-backed features: **migration → backend deploy → frontend deploy** (order matters).

Tutor tasks: read the AJTBD canon first (order below) — start from Jobs/wedge, not UI taste.

---

## Commands (Windows — run sequentially, avoid concurrent `dist/` writes)

```sh
npm run dev | lint | build | test | smoke-check
```
- `test` == `smoke-check` (`scripts/smoke-check.mjs`) — the CI quality gate.
- `lint` is informational; if it fails, still run `build` + `smoke-check`.
- `package.json` + CI workflows are the source of truth for commands.

---

## CRITICAL — Network & RU bypass

Prod (`sokratai.ru` + `api.sokratai.ru`) is served from a **Selectel Moscow VPS** (`185.161.65.182`). Lovable Cloud = preview only (`sokratai.lovable.app`). `*.supabase.co` is blocked in RU. Full detail: **rule 95**.

Hard rules for any Supabase HTTP call:
- **Client:** use `supabase` from `@/lib/supabaseClient` (hardcodes `https://api.sokratai.ru`). **Never** import `@/integrations/supabase/client`.
- **Never** hardcode `vrsseotrfmsxpbciyqzc.supabase.co`, build `${PROJECT_ID}.supabase.co`, use `VITE_SUPABASE_PROJECT_ID`, or rely on `import.meta.env.VITE_SUPABASE_URL` (Lovable forces it to the blocked direct domain).
- **Edge functions:** signed URLs returned to a browser → wrap in `rewriteToProxy()`; server-side `fetch()` of a signed URL → `rewriteToDirect()`; validators reading signed URLs from DB → accept **both** hosts (dual-host, rule 40). Import `SUPABASE_PROXY_URL`/`SUPABASE_PROXY_HOST` from `_shared/proxy-url.ts` — never hardcode the proxy host.
- **Pre-merge:** `git diff --staged | grep -E "supabase\.co"` — any non-comment hit that isn't `api.sokratai.ru` is a merge blocker.

**Deploy:** a frontend change does **not** reach prod automatically. After touching `src/**`, `index.html`, `package.json`, `vite.config.ts`, `tailwind.config.ts`, or `public/**`, end your final message with a **"🚀 Deploy needed"** block (rule 95): `ssh … 185.161.65.182 && deploy-sokratai`. Migrations + edge functions auto-deploy via Lovable on push.

---

## CRITICAL — cross-cutting invariants

- **Dual write-path discipline:** before claiming "done" on a new column / payload field, grep **all** write-sites. `homework_tutor_tasks` has 4 backend paths (`homework-api` handleCreate/handleUpdate) + 1 client path (`HWDrawer.tsx`); `check_format` and `task_kind` are written together. (rule 40)
- **FK `tutor_id` mismatch:** `homework_tutor_assignments.tutor_id` & `mock_exam_assignments.tutor_id` → `auth.users.id`. `tutor_students.tutor_id`, `tutor_lessons.tutor_id`, `tutor_payments.tutor_id` → `public.tutors.id` (PK). Any lookup joining these MUST convert via a `tutors.user_id ↔ tutors.id` map. Symptom: "0/N" analytics, missing student name/gender in AI prompt. (rule 40, rule 45)
- **`profiles` has no `email` column** — email lives only in `auth.users` (`auth.admin.getUserById`). (rule 70)
- **Anti-leak:** homework `solution_text` / `rubric_*` are **tutor-only forever**; mock-exam reveal is **state-aware** (Часть 2 only post-approval). Student endpoints must never SELECT tutor-only fields. (rule 40, rule 45)
- **Edge-function errors:** every non-2xx is JSON `{ error, code? }` with a Russian phrase; clients parse via `extractEdgeFunctionError`; email lookup via `find_auth_user_id_by_email` RPC, never `listUsers`. (rule 97)
- **Tutor data-fetch UX:** never OR-aggregate query errors into a banner (RU DPI drops ~1 of N parallel requests → false alarm). `TutorDataStatus` is tiered: `criticalError` only when the surface has no usable content, `degraded` when a block failed while the page rendered; quiet→escalate + self-heal; network errors stay neutral (no «VPN» blame). (rule 95)

---

## High-risk files (change only when the task requires)

`src/components/AuthGuard.tsx` · `src/components/TutorGuard.tsx` (module-level role cache — **do not delete**) · `src/pages/Chat.tsx` · `src/pages/tutor/TutorSchedule.tsx` · `supabase/functions/telegram-bot/index.ts`

---

## Database rules

Additive only: new tables / columns / indexes OK. **Forbidden:** modifying existing migrations, dropping or renaming columns. Adding a subject to `SUBJECTS` (`src/types/homework.ts`) → add a CHECK-constraint migration for **both** `homework_tutor_assignments` and `homework_tutor_templates` (rule 40). Run the `config.toml` drift-check before changing `verify_jwt` / `--no-verify-jwt`.

---

## Hard rules for new code

- **Dates / money:** `date-fns` `parseISO` (never `new Date("…")` — breaks Safari); money in kopecks (int), `/100` only on display — `src/lib/formatters.ts`. (rule 80)
- **AI + images:** resolve `storage://` → signed URL, send multimodal `{ type:"image_url", image_url:{ url } }`, and audit **all** AI paths (check / hint / question / bootstrap) — pattern in `homework-api/guided_ai.ts` (`buildCheckPrompt`, `buildHintPrompt`). (rule 40)
- **AI quota:** any new homework AI path must call `checkAiQuota(userId, db, { context:'homework', incrementUsage:true })` before the AI call (`_shared/subscription-limits.ts`). (rule 40)
- **Subject-aware prompts:** all 3 guided AI paths (check / hint / chat) take `subject`; never hardcode "физик-наставник". (rule 40)
- **Tutor payments:** participant-level idempotency `(lesson_id, tutor_student_id)`; statuses `pending`/`paid` only (no `overdue`); lesson date = `tutor_lessons.start_at`. Presumptive past-lesson confirm (`tutor_confirm_lessons`/`tutor_revert_lesson`) creates `tutor_payments` **only on explicit «Подтвердить»**, never silently; group no-show → 0. (rule 60)
- **Image upload UX:** reuse `usePasteImages` + `useDragDropFiles` + `compressForUpload`; route broken image URLs through a fallback, never a raw `<img>`. (rule 40, rule 90)

---

## Tutor product — canonical read order + guardrails

Before any tutor feature, read in order:
1. `docs/discovery/research/08-wedge-decision-memo-sokrat.md`
2–6. `docs/discovery/product/tutor-ai-agents/14…18-*.md`
7. the relevant `docs/delivery/features/` file

Guardrails: start from Jobs/wedge, not UI taste · don't turn the Assistant into a generic chat · every AI output ends in an action (`В ДЗ`, `В мою базу`, `Отправить`) · flag anything that doesn't strengthen the paid pilot · no new wedge/pricing/segment decisions in code.

Review checklist: which Job? · strengthens the wedge? · clear primary CTA? · AI output → action? · statuses visible? · avoids generic chat? · matches docs 16 + 17? · no scope creep?

---

## Docs structure

Discovery (WHAT/WHY) vs Delivery (HOW). New specs → `docs/delivery/features/<feature>/`; every spec includes "Section 0: Job Context". Never use legacy paths (`docs/product/`, `docs/features/`). (rule 30)

---

## Rules index — `.claude/rules/` (domain depth, read on demand)

| File | Domain |
|---|---|
| `00-read-first.md` | Read order before changes |
| `10-safe-change-policy.md` | Minimal-change policy, high-risk files |
| `20-commands-and-validation.md` | Validation command sequence |
| `30-docs-structure.md` | Discovery/Delivery doc layout |
| `40-homework-system.md` | Homework: guided chat, write-paths, anti-leak, scoring, subject prompts, constructor QA |
| `45-mock-exams.md` | Mock exams: state-aware anti-leak, AI grader, Part 1 OCR/checker, pause mode, seed |
| `50-kb-module.md` | Knowledge base, moderation, Source→Copy, fingerprint dedup, storage protection |
| `60-telegram-bot.md` | Telegram bot, /pay, invite flow, reliability |
| `70-notifications.md` | Push/email/cascade delivery, VAPID, profiles.email |
| `80-cross-browser.md` | Safari/iOS rules, forbidden patterns, build targets |
| `90-design-system.md` | Palette, typography, spacing, components, anti-patterns |
| `95-production-deploy.md` | When `deploy-sokratai` is required (Selectel VPS) |
| `96-auth-ru-bypass.md` | 11 hard rules for auth flows in RU |
| `97-edge-function-error-contract.md` | Non-2xx JSON error contract |
| `98-schedule-materials.md` | «Занятия»: lesson materials, anti-leak/FK-drift, group model, one-hop ДЗ, post-login landing |
| `99-ai-quota-subscriptions.md` | AI daily-message quota (10/50), `get_subscription_status`, paid-tutor boost gate, admin grant-tutor-plan mechanism |
| `performance.md` | React.memo lists, lazy load, React Query keys, getSession vs getUser |

---

## Output expectations

When completing a task, include: (1) changed files, (2) validation commands run, (3) files intentionally **not** modified.
