# Tasks: «Занятия» — материалы в расписании (schedule-materials)

**Дата:** 2026-06-02 · **SPEC:** `spec.md` (v1.0) · **PRD:** `02-prd-ajtbd.md` (v1.2) · **Конкурентный разбор:** `03-competitive-ux.md`
**Pipeline:** шаг 5 (TASKS). Промпты — по doc 19 (`19-agent-workflow-and-review-system-sokrat.md`) и doc 20 (`20-claude-code-prompt-patterns-sokrat.md`).

## Workflow (шаг 6 BUILD)
```
Claude Code (автор, plan mode) → реализует chunk
   → npm run lint && npm run build && npm run smoke-check
   → Codex (ревьюер, ЧИСТАЯ сессия) проверяет по PRD/AJTBD + .claude/rules + AC
   → Fix → Merge → deploy-sokratai (фронт) → пилот → LEARN
```

## Деплой-порядок
P0 первым релизом (TASK-1..6), P1 — fast-follow через 1-2 дня (TASK-7..9). Backend (миграции/edge) деплоится раньше фронта; после фронт-правок — `deploy-sokratai` на VPS (rule 95).

---

## Статус реализации (BUILD, 2026-06-02)

**P0 (TASK-1..6) — реализовано, ветка `feat/schedule-materials`** (commit feature-only). Codex-ревью: CONDITIONAL PASS → блокеры закрыты. Durable-инварианты вынесены в **`.claude/rules/98-schedule-materials.md`**.

- **TASK-1/2/4 (backend, CC-1):** миграции `20260602140000` (таблица + RLS + GRANT-whitelist + partial-unique homework_ref), `20260602140100` (bucket `lesson-materials`, 20 МБ / `application/pdf`), `20260602140200` (per-student `homework_ref` RLS — фикс ревью #2). Edge `lesson-materials-api` (tutor CRUD, `verify_jwt=true`) + `student-lessons-api` (read feed, column-whitelist, signed PDF, `entry_task_id`). Обе в `config.toml` + deploy workflow.
- **TASK-3 (tutor drawer, CC-2):** `LessonMaterialsDrawer` + кнопка «Материалы» в `LessonDetailsDialog` (`TutorSchedule.tsx` минимально).
- **TASK-5/6 (student, CC-3):** вкладка «Занятия» (`StudentSchedule` + `LessonFeedItem`/`LessonGroupHeader`/`MaterialChips`) + `LessonDetail` + Navigation-таб (leftmost) + пост-логин лендинг ученика → `/student/schedule`.

**Фиксы по ревью:** AC-6 one-hop через `entry_task_id` (а не redirect-экран `/homework/:id`); per-student RLS на `homework_ref` (anti-leak defense-in-depth); rule-97 flat-parse на student client (не `extractApiErrorMessage`); `min-h-[100dvh]`; убрана мёртвая `MAX_LESSON_PDF_BYTES` в edge (лимит — на бакете).

**Осознанные отклонения от SPEC §5.2:** `homework_assignment_id` FK = `ON DELETE CASCADE` (не `SET NULL` — иначе `chk_kind_payload` нарушается на cascade); видимость групповых занятий — через `tutor_lesson_participants` + SECURITY DEFINER `student_can_see_lesson`/`student_assigned_to_homework` (unified-группа = ОДНА строка `tutor_lessons` с `student_id IS NULL`, участники в junction-таблице).

**P1 (TASK-7/8/9) — реализовано (2026-06-03):** TASK-7 notify-каскад push→telegram→email (`handleNotify` + шаблон `lesson-materials-notification.ts`, deep-link на занятие); TASK-8 «Создать ДЗ» из drawer (prefill `?subject&students&lesson_id` → auto-link `homework_ref`); TASK-9 нудж после «Отметить проведённым» (drawer). **Codex CONDITIONAL PASS → закрыто:** finding 2 (group-получатели fail-closed в drawer), finding 3-participants (recipient-set lookup → 503 для группы), 1a (URL-получатели валидируются против занятия, server-truth wins + fail-safe), 1b (attach-failure non-fatal + retry-action). Не делали (по разбору): finding 3-каналы (minor), finding 4 (`lesson_id` лог = не PII, конвенция telemetry), переименование `students`→`recipients` (косметика, продьюсер/консьюмер согласованы).

**Open:** push ветки + PR · Lovable preview (применить миграции + задеплоить 2 функции) · `deploy-sokratai` (frontend) · ручная QA (Safari/iOS, anti-leak, one-hop) · анонс репетиторам **после** деплоя.

---

## Задачи

### TASK-1 (P0): Миграция `tutor_lesson_materials` + bucket
- **Job:** R4-3 / R5-1 · **Agent:** Claude Code · **AC:** AC-1
- **Files:** `supabase/migrations/{ts}_tutor_lesson_materials.sql`, `supabase/migrations/{ts}_lesson_materials_bucket.sql`
- Таблица (SPEC §5.2), индексы, RLS (tutor SELECT own; student SELECT по link/`group_session_id`; writes — только service_role), GRANT-whitelist. Bucket `lesson-materials` + policies (tutor own folder; student через signed URL).

### TASK-2 (P0): Edge `lesson-materials-api` (tutor CRUD)
- **Job:** R4-2/R4-3 · **Agent:** Claude Code · **AC:** AC-2, AC-3, AC-4
- **Files:** `supabase/functions/lesson-materials-api/index.ts`, `supabase/config.toml`, `.github/workflows/deploy-supabase-functions.yml`, reuse `_shared/attachment-refs.ts`
- `GET/POST/DELETE` материалов. Ownership через `resolveTutorPkId` (→ `tutors.id`). homework_ref ownership: 3-part join (FK-дрейф) + assignment назначено ученику занятия. Лимиты (rec ≤3 / pdf ≤5 / hw =1; PDF ≤20МБ). DELETE: row → `storage.remove()` (kind='pdf'). Ошибки flat `{error,code}` (rule 97).

### TASK-3 (P0): Tutor drawer «Материалы занятия»
- **Job:** R4-2 · **Agent:** Claude Code · **AC:** AC-2, AC-3, AC-4
- **Files:** `src/components/tutor/schedule/LessonMaterialsDrawer.tsx` (новый), `src/lib/lessonMaterialsApi.ts` (новый), `src/pages/tutor/TutorSchedule.tsx` (минимально: кнопка «Материалы» в `LessonDetailsDialog` ~4054 + state)
- Запись (generic URL) / PDF upload / выбор существующего ДЗ; список + удаление. НЕ трогать create-форму урока (rule 10).

### TASK-4 (P0): Edge `student-lessons-api` (чтение)
- **Job:** S3-1 · **Agent:** Claude Code · **AC:** AC-5, AC-7
- **Files:** `supabase/functions/student-lessons-api/index.ts` (новый), `supabase/config.toml`, deploy workflow, reuse `_shared/score-compute.ts`
- `GET /student/lessons` (лента) + `GET /student/lessons/:id` (деталка). service_role, ownership по `tutor_lessons.student_id = jwt.uid` / group membership. **Column-whitelist (никогда `notes`)**. PDF → signed URL (TTL 3600s). Статус ДЗ для чипа через shared score-compute.

### TASK-5 (P0): Student вкладка «Занятия» (лента)
- **Job:** S3-1/S3-2 · **Agent:** Claude Code · **AC:** AC-5
- **Files:** `src/pages/StudentSchedule.tsx` (новый, lazy), `src/components/student/schedule/{LessonFeedItem,LessonGroupHeader,MaterialChips}.tsx` (новые, `React.memo`), `src/lib/studentScheduleApi.ts` (новый), `src/components/Navigation.tsx` (+таб «Занятия» leftmost), `src/App.tsx` (роут + лендинг)
- Группы Сегодня/На этой неделе/Прошедшие; чипы Запись/Конспект + статус ДЗ; пустое состояние. Грамматика «Домашки» (компактный список из мокапа). reuse `Badge`/`MathText`/статус-хелперы.

### TASK-6 (P0): Деталка занятия + one-click ДЗ
- **Job:** S3-2 · **Agent:** Claude Code · **AC:** AC-6
- **Files:** `src/pages/student/LessonDetail.tsx` (новый, route `/student/schedule/:lessonId`), `src/App.tsx`
- Тема + запись (URL) + конспект (signed PDF) + ДЗ. **Чип ДЗ = один переход** на guided-homework entry route (авто-резолв задачи). Чипы на строке ленты тоже кликабельны.

### TASK-7 (P1): Notify-дайджест
- **Job:** R4-2 · **Agent:** Claude Code · **AC:** AC-9
- **Files:** `lesson-materials-api` (notify route), `_shared/transactional-email-templates/lesson-materials-notification.ts` (новый), reuse `_shared/push-sender.ts` + `_shared/email-sender.ts`
- Одно уведомление на «Готово» (push→telegram→email), deep-link на занятие. Telegram не единственный канал (rule 70).

### TASK-8 (P1): «Создать ДЗ» из drawer
- **Job:** R4-2/R4-3 · **Agent:** Claude Code · **AC:** AC-8
- **Files:** `LessonMaterialsDrawer.tsx`, `TutorHomeworkCreate.tsx` (prefill через URL-param), `lesson-materials-api`
- Открывает конструктор prefilled (предмет+получатели занятия) → на сохранении авто-привязка `homework_ref` к занятию.

### TASK-9 (P1): Нудж после «Отметить проведённым»
- **Job:** R4-2 · **Agent:** Claude Code · **AC:** AC-10
- **Files:** `src/pages/tutor/TutorSchedule.tsx` (`handleCompleteLesson` ~3608: post-success toast→drawer)
- Non-blocking подсказка «Добавить запись?» → открывает drawer. Логику завершения НЕ менять.

### TASK-10: Верификация
- **Agent:** Codex (чистая сессия) + ручная QA
- Codex по PRD/AJTBD + rules + AC + git diff. Ручная QA: Safari/iOS (rule 80), anti-leak (ученик не получает `notes`), one-click ДЗ, расписание не сломано.

---

## Copy-paste промпты для агентов

> Вставлять целиком. Перед запуском заменить `{ts}` на актуальный timestamp миграции и свериться с реальными номерами строк.

### CC-1 — Backend (TASK-1, 2, 4)

```
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI (React+Vite+Supabase, репетиторы физики ЕГЭ/ОГЭ). Принцип: AI = draft + action; reuse > rewrite.

Контекст: фича schedule-materials — репетитор крепит к занятию материалы (запись-URL, PDF-конспект, ссылку на существующее ДЗ), ученик читает их. Сейчас делаем backend P0.

Прочитай перед стартом (обязательно):
- docs/delivery/features/schedule-materials/spec.md (вся; особенно §5 Technical Design, §7 AC, §8 инварианты)
- docs/delivery/features/schedule-materials/02-prd-ajtbd.md (§3a единая модель)
- CLAUDE.md + .claude/rules/40-homework-system.md (anti-leak, service_role read-path, FK-дрейф/resolveTutorPkId, score-compute), 70-notifications.md, 96-auth-ru-bypass.md (#11 config+deploy), 97-edge-function-error-contract.md, 50-kb-module.md (storage delete order)

Задача (plan mode сначала):
1. Миграция supabase/migrations/{ts}_tutor_lesson_materials.sql — таблица tutor_lesson_materials по SPEC §5.2 (kind recording/pdf/homework_ref, chk_kind_payload, FK на tutor_lessons и homework_tutor_assignments, индексы), RLS (tutor SELECT own через tutors.user_id=auth.uid; student SELECT по lesson_id/group_session_id link; БЕЗ client write-policy), GRANT-whitelist после REVOKE.
2. Миграция {ts}_lesson_materials_bucket.sql — bucket lesson-materials, policy: tutor CRUD own folder tutor/{auth.uid()}/{lessonId}/...; студент НЕ прямой read.
3. Edge supabase/functions/lesson-materials-api/index.ts (verify_jwt=true): GET/POST/DELETE материалов + POST notify (заглушка для TASK-7). Ownership через resolveTutorPkId → tutors.id. homework_ref: 3-part join (homework_tutor_assignments.tutor_id = (select user_id from tutors where id = lesson.tutor_id)) + assignment назначено ученику занятия, иначе 403 INVALID_HOMEWORK_REF. Лимиты: recording ≤3, pdf ≤5, homework_ref =1; PDF ≤20МБ (MAX_LESSON_PDF_BYTES). DELETE: ownership → delete row → storage.remove() только для kind='pdf'. Attachment refs только через _shared/attachment-refs.ts. Ошибки — flat {error:<рус>, code} (rule 97).
4. Edge supabase/functions/student-lessons-api/index.ts (service_role): GET /student/lessons + /student/lessons/:id. Ownership по tutor_lessons.student_id=jwt.uid / group_session_id membership. COLUMN-WHITELIST: НИКОГДА не отдавать notes/tutor-only. PDF → signed URL (createSignedUrl, TTL 3600). Статус ДЗ для чипа — через _shared/score-compute.ts (computeFinalScore), без дублирования. 401→понятная ошибка.
5. Зарегистрировать обе функции в supabase/config.toml и .github/workflows/deploy-supabase-functions.yml (rule 96 #11). Прогнать node scripts/supabase-drift-check.mjs.

Acceptance Criteria (встроены):
- AC-1: миграция применяется, таблица с chk_kind_payload + FK + индексами; smoke-check зелёный.
- AC-2/3/4: POST recording/pdf/homework_ref создаёт корректные строки; чужое/не-того-ученика ДЗ → 403.
- AC-7: GET /student/lessons НЕ содержит notes и tutor-only полей.

Guardrails: НЕ SELECT * на student-path; service_role для student-чтения (не PostgREST с RLS); writes только service_role; никаких новых npm-deps; Deno-mirror attachment-refs; не логировать PII (rule 97 #10 — boolean/status only).

Mandatory end block: список изменённых файлов; краткое summary; результат lint/build/smoke-check; какие docs обновить; self-check против spec §7 AC и §8 инвариантов; deploy-напоминание если затронут фронт (здесь — нет, только backend).
```

### CC-2 — Tutor drawer (TASK-3)

```
Твоя роль: senior product-minded full-stack engineer в SokratAI. Reuse > rewrite. Aудитория: репетиторы физики.

Контекст: добавить drawer «Материалы занятия» в расписание репетитора. Backend (lesson-materials-api) уже готов (CC-1).

Прочитай: docs/delivery/features/schedule-materials/spec.md (§5.1, §6, §8), .claude/rules/10-safe-change-policy.md (TutorSchedule.tsx = high-risk!), 80-cross-browser.md, 90-design-system.md, 97-edge-function-error-contract.md, performance.md.

Задача (plan mode):
1. Новый src/lib/lessonMaterialsApi.ts — клиент к lesson-materials-api через extractEdgeFunctionError (rule 97). Функции: listLessonMaterials, addRecording, uploadLessonPdf, attachHomework, deleteMaterial.
2. Новый src/components/tutor/schedule/LessonMaterialsDrawer.tsx (Radix Dialog/Sheet): блоки Запись (input URL + «Добавить», placeholder «Drive · Яндекс.Диск · VK Video · YouTube»), Конспект (PDF upload, drag-drop, прогресс, ≤20МБ ≤5шт), Домашка («Выбрать ДЗ» → пикер существующих ДЗ ученика/группы). Список добавленного + удаление. Один primary CTA «Готово». Лимиты на клиенте.
3. src/pages/tutor/TutorSchedule.tsx — МИНИМАЛЬНО: в LessonDetailsDialog (~line 4054) добавить кнопку «Материалы» + state открытия drawer. НИЧЕГО в create-форме урока и логике не менять (rule 10).

AC: AC-2/3/4 (через UI создаются recording/pdf/homework_ref; чужое ДЗ недоступно). 

Guardrails: rule 10 (TutorSchedule.tsx — только кнопка+state); Safari rule 80 (16px inputs, touch-action:manipulation); rule 90 (Lucide-иконки, без эмодзи, socrat green токены, один primary CTA); no framer-motion; React.memo на списковых элементах; URL.revokeObjectURL для превью PDF; clipboard/drag-drop как в существующих upload-флоу.

Mandatory end block: изменённые файлы; summary; lint/build/smoke-check; self-check против §6/§8 + rule 10/80/90; БЛОК «🚀 Deploy needed» (затронут фронт — нужен deploy-sokratai).
```

### CC-3 — Student «Занятия» + деталка + one-click (TASK-5, 6)

```
Твоя роль: senior product-minded full-stack engineer в SokratAI. Mobile-first. Reuse > rewrite.

Контекст: новая вкладка ученика «Занятия» — лента занятий с материалами + деталка. Backend (student-lessons-api) готов (CC-1).

Прочитай: spec.md (§5.1, §5.3, §6, §8), 03-competitive-ux.md (§4 паттерны), .claude/rules/80-cross-browser.md, 90-design-system.md, performance.md; референс UI — src/pages/StudentHomework.tsx (грамматика), src/components/Navigation.tsx, src/App.tsx (паттерн student-роутов + AuthGuard), src/lib/studentHomeworkApi.ts (requestStudentHomeworkApi 401-refresh).

Задача (plan mode):
1. src/lib/studentScheduleApi.ts — клиент к student-lessons-api, транспорт как requestStudentHomeworkApi (401 → refresh+retry, rule Phase 3.1).
2. src/pages/StudentSchedule.tsx (lazy) — лента: группы Сегодня / На этой неделе / Прошедшие (якорь «сегодня»), компактные строки в стиле «Домашки» (компактный список как Asana/Linear, см. мокап). Пустое состояние «появятся, когда репетитор добавит». С <Navigation/> chrome.
3. src/components/student/schedule/{LessonFeedItem,LessonGroupHeader,MaterialChips}.tsx (React.memo): строка = иконка-предмет + тема + «предмет·репетитор·время» + чипы Запись/Конспект + статус ДЗ (Назначено/Сдано/Проверено) + шеврон. Чипы кликабельны напрямую (Запись→URL новая вкладка; Конспект→signed PDF; ДЗ→guided-homework). reuse Badge/MathText/статус-хелперы.
4. src/components/Navigation.tsx — добавить { path: "/student/schedule", icon: Calendar, label: "Занятия" } ПЕРВЫМ; пост-логин лендинг ученика → /student/schedule.
5. src/App.tsx — роуты /student/schedule и /student/schedule/:lessonId (lazy + Suspense; деталка может быть AuthGuard fullBleed="below-xl").
6. src/pages/student/LessonDetail.tsx — деталка: тема + запись + конспект + ДЗ; чип/кнопка ДЗ = ОДИН переход на guided-homework entry route этого assignment (авто-резолв задачи), без промежуточных экранов.

AC: AC-5 (лента группируется, чипы, пустое состояние), AC-6 (один клик занятие→ДЗ).

Guardrails: Safari rule 80 (16px, touch-action, 100dvh/--vv-h, без Array.at/lookbehind/structuredClone); rule 90 (Lucide, без эмодзи, socrat green, один primary CTA); performance.md (React.memo списки, lazy+Suspense новых страниц, нет framer-motion, loading=lazy на img); НЕ трогать «Домашку» (reuse грамматики, не редактировать StudentHomework.tsx без необходимости).

Mandatory end block: изменённые файлы; summary; lint/build/smoke-check; self-check против §6/§8 + rule 80/90; БЛОК «🚀 Deploy needed» (deploy-sokratai).
```

### CC-4 — P1 fast-follow (TASK-7, 8, 9)

```
Твоя роль: senior product-minded full-stack engineer в SokratAI.

Контекст: fast-follow для schedule-materials (P0 уже задеплоен). Три независимые задачи.

Прочитай: spec.md (§5, §7 AC-8/9/10, §8), .claude/rules/70-notifications.md, 40-homework-system.md (dual write-path конструктора, score), 10-safe-change-policy.md, 97-edge-function-error-contract.md.

Задача (plan mode):
1. TASK-7 notify: в lesson-materials-api реализовать POST /lessons/:id/materials/notify — ОДИН дайджест на вызов, каскад push→telegram→email (reuse _shared/push-sender.ts + email-sender.ts), deep-link на /student/schedule/:lessonId. Новый шаблон _shared/transactional-email-templates/lesson-materials-notification.ts (mirror homework-notification). Telegram не единственный канал (web-push/email fallback). Drawer «Готово» вызывает notify один раз.
2. TASK-8 «Создать ДЗ» из drawer: кнопка «Создать ДЗ» → навигация в конструктор (TutorHomeworkCreate) prefilled (предмет+получатели занятия) через URL-param + return → на сохранении авто-привязка homework_ref к занятию. Учесть dual write-path конструктора (rule 40) — не ломать существующие пути.
3. TASK-9 нудж: TutorSchedule.tsx handleCompleteLesson (~line 3608) — после успешного завершения non-blocking toast/подсказка «Добавить запись?» → открывает LessonMaterialsDrawer. Логику завершения НЕ менять (rule 10).

AC: AC-8 (создание+авто-привязка), AC-9 (одно уведомление, не три, deep-link), AC-10 (нудж открывает drawer, завершение не изменено).

Guardrails: rule 10 (TutorSchedule.tsx минимально); rule 70 (каскад, не дублировать); rule 40 (dual write-path конструктора); rule 97 (flat errors).

Mandatory end block: изменённые файлы; summary; lint/build/smoke-check; self-check против §7 AC + §8; БЛОК «🚀 Deploy needed» (deploy-sokratai).
```

### CODEX-REVIEW — независимый ревью (TASK-10, ChatGPT/Codex, чистая сессия)

```
Ты — независимый ревьюер проекта SokratAI. Контекст агента-автора тебе НЕдоступен. Будь дотошным и скептичным.

ПОРЯДОК (строго):
1. Прочитай docs/discovery/product/tutor-ai-agents/14-ajtbd-product-prd-sokrat.md
2. Прочитай docs/discovery/product/tutor-ai-agents/16-ux-principles-for-tutor-product-sokrat.md и 17-ui-patterns-and-component-rules-sokrat.md
3. Прочитай docs/delivery/features/schedule-materials/spec.md (особенно §7 AC и §8 инварианты) + 02-prd-ajtbd.md (§3a)
4. Прочитай .claude/rules/: 10 (safe-change), 40 (homework/anti-leak/FK-дрейф), 70 (notifications), 80 (Safari), 90 (design-system), 96 (#11 config+deploy), 97 (error-contract), 50 (storage delete)
5. Посмотри git diff (весь PR)

ПРОВЕРЬ ОТВЕТЬ КОНКРЕТНО:
- Job alignment: фича закрывает R4/S3/P3? нет ли scope creep вне SPEC §3?
- ANTI-LEAK (критично): student-lessons-api / RLS / GRANT нигде не отдают tutor_lessons.notes и tutor-only поля? column-whitelist соблюдён (нет SELECT *)?
- FK-дрейф: ownership homework_ref через resolveTutorPkId + 3-part join? нельзя привязать чужое ДЗ / ДЗ не-того-ученика?
- Лимиты: PDF ≤20МБ, recording ≤3, pdf ≤5, homework_ref =1 — на клиенте И в edge?
- Delete order ref→blob (rule 50); только kind='pdf'; ДЗ не трогается.
- Safari/iOS (rule 80): 16px inputs, touch-action, 100dvh, нет Array.at/lookbehind/structuredClone.
- Design (rule 90): Lucide (без эмодзи), socrat green токены, один primary CTA; нет framer-motion (performance.md); React.memo на списках; lazy+Suspense.
- rule 10: TutorSchedule.tsx тронут МИНИМАЛЬНО (только entry point + нудж), create/complete-логика не изменена.
- Edge errors flat {error,code} рус (rule 97); функции в config.toml + deploy workflow (rule 96 #11).
- One-click (AC-6): чип ДЗ → guided-homework за ОДИН переход.
- AC §7: каждый AC проходит PASS/FAIL?

ФОРМАТ ОТВЕТА: PASS / CONDITIONAL PASS / FAIL + пронумерованный список находок (severity: blocker / major / minor), каждая со ссылкой на файл:строку и предложением фикса.
```

---

## Definition of Done (doc 19)
1. Job/scenario linkage ✓ (R4/S3/P3) 2. Wedge linkage ✓ 3. Feature spec ✓ 4. Claude Code impl ✓ 5. Codex review ✓ 6. Feedback incorporated ✓ 7. No UX/UI-canon breakage ✓ 8. Success signal defined ✓ (SPEC §7) 9. Pilot metrics mapped ✓
