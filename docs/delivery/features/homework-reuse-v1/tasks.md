# Tasks — Homework Reuse v1

Реализационные задачи для `spec.md` (`docs/delivery/features/homework-reuse-v1/spec.md`).

Каждая задача:
- привязана к одному или нескольким **AC** из спеки (раздел 6a);
- закреплена за конкретным агентом (Claude Code);
- содержит ссылки на канонические правила (`.claude/rules/*`);
- имеет guardrails и validation-команды.

Код-ревью каждой задачи — **Codex** независимо, без контекста автора (промпт ревьюера в конце файла).

**Важно:** TASK-1 и TASK-2 — unblockers, должны идти первыми. TASK-3 / TASK-5 / TASK-8 — параллельные рабочие треки (preview / reuse / groups). TASK-10 — integration. TASK-11 / TASK-12 — в конце.

## Status (2026-04-22)

| TASK | Status | Commit | Notes |
|---|---|---|---|
| TASK-1 | ✅ Done | — | Migrations landed (`homework_share_links`, `source_group_id`) |
| TASK-2 | ✅ Done | `1fb5222` | Assistant nav hidden + redirect + telemetry |
| TASK-3 | ✅ Done | `43e45f2` | Tutor preview + print CSS + copy-to-Telegram |
| TASK-4 | ✅ Done | — | Public `/p/:slug` endpoint + page |
| TASK-5 | ✅ Done | `0c653b4` | `SaveTasksToKBDialog` + `handleSaveTasksToKB` + per-task `BookmarkPlus` in edit-mode |
| TASK-6 | ✅ Done | `0590a3f` | `SaveAsTemplateDialog` + `handleCreateTemplateFromAssignment` + `PATCH /templates/:id` |
| TASK-7 | ✅ Done | — | `ShareLinkDialog` + slug generation + CRUD |
| TASK-8 | ✅ Done | `ead0a05` | `HWAssignSection` tabs + `source_group_id` write |
| TASK-9 | ✅ Done | `f55537c` | Filter `?group_id=` + `source_group_*` on list items + group badge |
| TASK-10 | ✅ Done | `dd1a536` | Actions dropdown (`[⋯]`) on `TutorHomeworkDetail` → preview / share / save-kb / save-template, all lazy + Suspense + conditional mount |
| TASK-11 | ✅ Done | — | All 11 events already wired in TASK-2..10; taxonomy + fire-once invariants consolidated in module header of `homeworkTelemetry.ts`. Audit: PII-free payloads (ids + counts + booleans only), fire-once via `useRef` sentinels (`openedTrackedRef`, `firedRef`) for effect-sites, onClick/onChange for handler-sites. `homework_share_link_visited` server-side in `public-homework-share` edge function (slug-only). Stale «TASK-11 will extend» comment cleaned up. |
| TASK-12 | ⏳ Pending | — | QA pass (cross-browser + print + public share + groups + KB dedup) |

**Известные open gaps (Sprint 2+ или отдельные spawn-задачи):**
- `homework_tutor_templates.subject` CHECK не синхронизирован с canonical subject ids — см. `.claude/rules/40-homework-system.md` §«Save-as-template post-factum» → «Known schema drift». Миграция заспавнена.
- TASK-10 должен будет: (a) смонтировать `SaveTasksToKBDialog` в bulk-mode с `tasks` из assignment detail response; (b) смонтировать `SaveAsTemplateDialog`; (c) смонтировать `ShareLinkDialog`; (d) entry в preview через `navigate`.

---

## Phase 1 — Infrastructure & Cleanup (1 день)

### TASK-1 — Миграции: `homework_share_links` + `source_group_id`

- **Status:** ✅ Done 2026-04-22 (commit `40375b7`). Lint (pre-existing TS errors, не новые) + build + smoke-check clean. **Deviation от спеки:** timestamps `20260422130000` / `...0100` из спеки занят существующей миграцией TASK-9 tutor-dashboard-v2 (`..._add_tutor_select_policies_on_threads_and_task_states.sql`). Использованы `20260422160000_homework_share_links.sql` и `20260422160100_homework_assignments_source_group_id.sql` — хронологический порядок сохранён (последней была `20260422151245`). Имена policy и индексов, структура RLS, FK `auth.users(id) ON DELETE CASCADE` без schema prefix — по соглашениям репо (см. [`20260215100000_homework_tutor_system.sql`](../../../../supabase/migrations/20260215100000_homework_tutor_system.sql) + [`20260223193000_tutor_mini_groups_foundation.sql`](../../../../supabase/migrations/20260223193000_tutor_mini_groups_foundation.sql)).
- **AC:** AC-6, AC-7, AC-8, AC-9, AC-20, AC-21.
- **Job:** P1.3, P2.3.
- **Agent:** Claude Code.
- **Files (новые):**
  - `supabase/migrations/20260422130000_homework_share_links.sql`
  - `supabase/migrations/20260422130100_homework_assignments_source_group_id.sql`
- **Что делаем:**
  - Миграция 1: `CREATE TABLE public.homework_share_links (slug TEXT PRIMARY KEY, assignment_id UUID NOT NULL REFERENCES homework_tutor_assignments(id) ON DELETE CASCADE, show_answers BOOLEAN NOT NULL DEFAULT false, show_solutions BOOLEAN NOT NULL DEFAULT false, expires_at TIMESTAMPTZ NULL, created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`. Два индекса (`assignment_id`, `created_by`). RLS policy «Tutors manage own share links» — `USING/WITH CHECK (created_by = auth.uid())`. `GRANT SELECT, INSERT, UPDATE, DELETE ... TO authenticated`. Публичное чтение НЕ через RLS, а через `service_role` в public edge function.
  - Миграция 2: `ALTER TABLE homework_tutor_assignments ADD COLUMN IF NOT EXISTS source_group_id UUID NULL REFERENCES tutor_groups(id) ON DELETE SET NULL`. Partial index `idx_homework_assignments_source_group (source_group_id) WHERE source_group_id IS NOT NULL`. COMMENT с явным описанием soft-FK семантики.
- **Guardrails:**
  - Additive only, `IF NOT EXISTS` везде, zero-downtime safe.
  - RLS нельзя пропустить — без неё репетиторы видят чужие share_links.
  - Не добавлять cascades между share_links и tutors — `created_by` → `auth.users` каскад достаточен.
- **Validation:** `npm run lint && npm run build && npm run smoke-check`. Локально — подать миграции через Supabase CLI, проверить `\d homework_share_links` и `\d homework_tutor_assignments`.

### TASK-2 — Remove «Помощник» from SideNav + redirect `/tutor/assistant`

- **AC:** AC-22.
- **Job:** Cleanup (не основной job, но scope blocker).
- **Agent:** Claude Code.
- **Files:**
  - `src/components/tutor/chrome/SideNav.tsx` — удалить nav item
  - `src/App.tsx` — route `/tutor/assistant` заменить на `<Route path="/tutor/assistant" element={<Navigate to="/tutor/home" replace />} />` (внутри группы AppFrame? вне? — вне, так как редиректим сразу)
  - `src/lib/homeworkTelemetry.ts` (или новый `src/lib/tutorTelemetry.ts`) — добавить событие `tutor_assistant_route_hit`
  - `src/pages/RedirectTutorAssistant.tsx` (опционально) — если нужен side-effect `useEffect` для telemetry перед Navigate
- **Что делаем:**
  - Убираем `{ href: '/tutor/assistant', label: 'Помощник', ... }` из nav items
  - В App.tsx: route `/tutor/assistant` → wrap `<Navigate>` компонентом, который в `useEffect` шлёт telemetry event один раз
  - `TutorAssistant.tsx` **НЕ удаляем** — вернётся в Sprint 2+
  - Проверить, что нет других `Link to="/tutor/assistant"` в репо (grep)
- **Guardrails:**
  - НЕ удалять `TutorAssistant.tsx` — только скрыть навигацию и перенаправить.
  - Route должен быть внутри общего App роутера, чтобы `<Navigate>` работал в контексте React Router.
  - Telemetry fire-once (useRef sentinel), не на каждый render.
- **Validation:** `npm run lint && npm run build && npm run smoke-check`. Manual: клик по старому bookmark → должен попасть на `/tutor/home` без flash.

---

## Phase 2 — Preview surface (3-4 дня, параллельно Phase 3+4)

### TASK-3 — `HomeworkPreviewContent` + `TutorHomeworkPreview` route

- **Status:** ✅ Done 2026-04-22 (commit `43e45f2`). Lint (нет новых ошибок в моих файлах) + build (44s) + smoke-check clean. Route резолвится через TutorGuard, lazy-чанки парсятся, CSS side-effect import ок (верифицировано через preview `import()` в dev server). Интерактивная проверка toolbar / print / copy требует tutor auth — не проверено в preview. **Reuse:** вместо inline Dialog-галереи — shared [`PhotoGallery`](../../../../src/components/homework/shared/PhotoGallery.tsx) (swipe + arrow nav + counter); вместо per-task `getTutorTaskImagesSignedUrls` (N запросов) — один batched вызов [`useKBImagesSignedUrls`](../../../../src/hooks/useKBImagesSignedUrls.ts) с дедуп'ом по ref (тот же pattern, что [`HWTaskCard`](../../../../src/components/tutor/homework-create/HWTaskCard.tsx) edit-mode). **Design deviation от спеки:** поле `Задача №N · ЕГЭ №M · X баллов` в шапке карточки рендерится без ЕГЭ-номера на tutor-пути (`kim_number: null`), т.к. `homework_tutor_tasks` не имеет `kim_number` колонки; public endpoint (TASK-4) может заполнять его из `kb_task_id` provenance, тогда он отобразится. **Share button stub:** `toast.info('Диалог «Поделиться ссылкой» появится в следующей итерации')` — wiring из toolbar на `ShareLinkDialog` (TASK-7) состоится в TASK-10 (Actions-меню integration). **HomeworkPreviewTask тип** экспортируется из `HomeworkPreviewContent.tsx` и по структуре совместим с `PublicShareTask` из [`publicShareApi.ts`](../../../../src/lib/publicShareApi.ts) — TASK-4 `PublicHomeworkShare` сможет использовать тот же компонент без изменений.
- **AC:** AC-1, AC-2, AC-3, AC-5, AC-12.
- **Job:** P0.1 (последняя миля wedge), P1.3.
- **Agent:** Claude Code.
- **Files (новые):**
  - `src/components/tutor/homework-reuse/HomeworkPreviewContent.tsx` — **shared** компонент для `/tutor/homework/:id/preview` И `/p/:slug`
  - `src/pages/tutor/TutorHomeworkPreview.tsx` — route wrapper с tutor toolbar
  - `src/styles/homework-preview-print.css` — print-specific CSS
- **Files (изменения):**
  - `src/App.tsx` — добавить route `/tutor/homework/:id/preview` **внутри AppFrame группы**
  - `src/lib/homeworkTelemetry.ts` — события `homework_preview_opened`, `homework_preview_printed`, `homework_preview_copied_text`
- **Что делаем:**
  - `HomeworkPreviewContent` props: `{ tasks: HomeworkTask[] | TemplateTaskLike[], title: string, showAnswers: boolean, showSolutions: boolean }`. Рендерит вертикальный scroll в `max-w-[800px] mx-auto`. Задача: заголовок `Задача №N · ЕГЭ №M · X баллов`, `MathText` для условия, картинки через batch signed-URLs reuse existing tutor-side hook `useTutorTaskImages` (или inline fetch если нет). Картинки `<img style={{maxHeight: '300px'}}/>` + click → Radix Dialog fullscreen.
  - `TutorHomeworkPreview` page — подгружает assignment (React Query), оборачивает content в toolbar с 4 кнопками (Назад / Печать / Копировать текст / Поделиться) и 2 toggle (С ответами / С решениями). `[← Назад]` navigate на `/tutor/homework/:id`.
  - `window.print()` вызывается для PDF path — native, без зависимостей.
  - Copy-to-Telegram формат: `№1. <stripLatex(task_text)>\n[см. рисунок]\nОтвет: <correct_answer>\n\n№2. ...` с `navigator.clipboard.writeText`. Toast `Скопировано`.
  - Print CSS (`homework-preview-print.css`): `@media print { .preview-toolbar { display: none } .preview-task { break-inside: avoid } }`. Импорт только в `TutorHomeworkPreview` и `PublicHomeworkShare`.
  - Telemetry events fire в handlers (opened — в useEffect mount; printed — в click handler Print; copied — в click handler Copy).
- **Guardrails:**
  - Golos Text, дизайн-токены `bg-accent`/`text-slate-*`, никаких emoji.
  - НЕ создавать dependency от `TutorHomeworkDetail` — `HomeworkPreviewContent` должен быть stateless и reusable для public path.
  - `stripLatex` из `src/components/kb/ui/stripLatex.ts` — reuse, не дублировать.
  - Для Safari: `@media print` обязателен через `@import`, не inline — иначе ломается в Safari (см. `.claude/rules/80-cross-browser.md`).
  - `<img>` с `loading="lazy"` обязательно (правило performance.md).
- **Validation:** `npm run lint && npm run build && npm run smoke-check`. Manual: open preview с 10 задачами, проверить print-PDF в Chrome и Safari, проверить copy в Telegram (формулы читаемые).

### TASK-4 — Public share route `/p/:slug` + edge function `public-homework-share`

- **AC:** AC-7, AC-8, AC-9, AC-23 (`homework_share_link_visited`).
- **Job:** P0.1 (экспорт), Принцип 17.
- **Agent:** Claude Code.
- **Files (новые):**
  - `src/pages/PublicHomeworkShare.tsx` — публичная страница **вне AppFrame**
  - `src/lib/publicShareApi.ts` — one function `fetchPublicHomeworkShare(slug)`
  - `supabase/functions/public-homework-share/index.ts` — public edge function
- **Files (изменения):**
  - `src/App.tsx` — route `/p/:slug` **вне AppFrame группы**, без TutorGuard
- **Что делаем:**
  - Edge function: `GET /share/:slug`, без JWT check. Использует `service_role`. Flow: SELECT slug → если `expires_at < now()` → `{ expired: true }`. Иначе JOIN `homework_tutor_assignments` → `homework_tutor_tasks`. Для каждой task: подписать `task_image_url` через `createSignedUrl` TTL=3600s. Если `show_solutions=false` — не селектить `solution_*`. Если `show_answers=false` — обнулить `correct_answer` в response. `rubric_*` НИКОГДА не возвращается.
  - Response shape: `{ title: string, tasks: PublicTask[], show_answers: boolean, show_solutions: boolean, expires_at: string | null, expired: false }`.
  - Telemetry: после успешного SELECT (неEXPIRED) — `INSERT INTO telemetry_events` или логируем через существующий подход (как `guided_check_*` события в `console.warn(JSON.stringify(...))`). Событие `homework_share_link_visited` с payload `{ slug }` (без user_id — публичный доступ).
  - Frontend `PublicHomeworkShare`: использует **тот же** `HomeworkPreviewContent` из TASK-3. Toolbar минимальный: логотип «Сократ» + title + (условно) кнопка «Открыть в Сократе» если `supabase.auth.getSession()` возвращает tutor session. `expired: true` → рендерит `EmptyState` «Срок действия ссылки истёк».
- **Guardrails:**
  - **КРИТИЧНО:** edge function не должна возвращать `rubric_text`, `rubric_image_urls`, имена учеников, `student_assignments`, `notes_for_student`. Это tutor-only fields. Грепать SELECT-колонки перед commit.
  - Route `/p/:slug` должен быть **вне** AppFrame роутера, иначе TutorGuard сработает и отбросит родителя.
  - CORS: edge function должна разрешать все origins (`Access-Control-Allow-Origin: *`) — это public endpoint.
  - Slug generation: reuse в edge function (TASK-7), но validate формат в этом public endpoint как `/^[a-z0-9]{8}$/i`, иначе 400 до БД-запроса.
- **Validation:** lint+build+smoke. Manual (incognito): открыть `/p/valid-slug` → видны задачи; `/p/expired-slug` → «Срок действия истёк»; `/p/invalid-format` → 400; проверить в devtools что response НЕ содержит `rubric`, имён учеников, `solution_*` когда show_solutions=false.

---

## Phase 3 — Reuse actions (3-4 дня, параллельно Phase 2+4)

### TASK-5 — `SaveTasksToKBDialog` (bulk) + edge handler + per-task icon

- **AC:** AC-10, AC-11, AC-12, AC-13, AC-23 (`homework_saved_to_kb`, `homework_saved_to_kb_per_task`).
- **Job:** P1.2.
- **Agent:** Claude Code.
- **Files (новые):**
  - `src/components/tutor/homework-reuse/SaveTasksToKBDialog.tsx`
- **Files (изменения):**
  - `supabase/functions/homework-api/index.ts` — `handleSaveTasksToKB`, route `POST /assignments/:id/save-tasks-to-kb`
  - `src/lib/tutorHomeworkApi.ts` — функция `saveTasksToKB(assignmentId, body)`
  - `src/components/tutor/homework-create/HWTaskCard.tsx` — добавить `BookmarkPlus` icon в edit-mode (только если `readonly=false`)
  - `src/hooks/useKnowledgeBase.ts` (или где живёт hooks для KB folders) — возможно потребуется mutation для создания папки inline
- **Что делаем:**
  - **Backend handler:** body `{ task_ids: string[], folder_id: string, new_folder_name?: string }`. Flow:
    1. Если `new_folder_name` присутствует — создать `kb_folders` запись с `owner_id=auth.uid()`, использовать её id как `folder_id`.
    2. Для каждого `task_id` — SELECT `homework_tutor_tasks` с WHERE `assignment.tutor_id = auth.uid()` (через join). Собрать payload задачи.
    3. Если у задачи `kb_task_id IS NOT NULL`:
       - Если `kb_tasks.owner_id = me` → skip, вернуть `{ task_id, kb_task_id, already_in_base: true, folder_id: existing.folder_id, folder_name: existing.folder_name }`.
       - Если `kb_tasks.owner_id IS NULL` (каталог) → **создать копию** в выбранную папку (reuse existing «В мою папку» logic — проверить `.claude/rules/50-kb-module.md`).
    4. Если `kb_task_id IS NULL` — compute fingerprint через `kb_normalize_fingerprint`, попытаться INSERT с `pg_advisory_xact_lock`. Collision → вернуть existing kb_task_id + папку.
    5. Копируем поля: `task_text`, `task_image_url`, `correct_answer`, `solution_text`, `solution_image_urls`. НЕ копируем `rubric_*` (AC-12).
    6. Response: `{ saved: [{task_id, kb_task_id, already_in_base, folder_id, folder_name}], created_folder?: {id, name} }`.
  - **Frontend `SaveTasksToKBDialog`:**
    - Sheet (`side="right"` на desktop, `side="bottom"` на mobile — см. `.claude/rules/90-design-system.md` patterns).
    - Props: `{ assignmentId, tasks, open, onClose, mode: 'bulk' | 'single' }`. В `single` mode — один task, чекбокс спрятан.
    - Селект папок из `Моя база`. Последняя строка — «+ Создать новую папку» → при клике разворачивает inline `<Input>` + кнопка `Создать`. После create → папка появляется в селекте и выбрана.
    - Все задачи чекбоксами, дефолт **all selected** (AC-10). Счётчик «Выбрано N, новых M, уже в базе K».
    - Primary CTA `[Сохранить N задач]`. Disabled пока `selected === 0` или `folder_id === null`.
    - После успеха — toast + telemetry. Если `mode='single'` — `homework_saved_to_kb_per_task`. Если `bulk` — `homework_saved_to_kb`.
  - **Per-task integration:** `HWTaskCard` в edit-mode показывает `BookmarkPlus` icon в ряду actions. Клик → открыть `SaveTasksToKBDialog` с `mode='single'` для этой задачи. В view-mode (в read-only `/preview` и Detail — не показываем).
- **Guardrails:**
  - Backend **обязан** проверить ownership: `homework_tutor_tasks → homework_tutor_assignments.tutor_id = auth.uid()`. Без этого — leak.
  - Fingerprint dedup — НЕ дублировать логику, reuse `kb_normalize_fingerprint` и `pg_advisory_xact_lock` из KB moderation V2 (rule 50).
  - **НЕ передавать** `rubric_text` / `rubric_image_urls` в INSERT — grep SELECT columns перед commit.
  - Для per-task icon: не добавлять его в dense-row карточек учеников / read-only views — только в HW Create / Edit конструктор.
  - «+ Создать папку» не должен позволять пустое имя / дубликат имени в той же parent folder (проверка на backend).
  - Telemetry payload: `{ assignment_id, tasks_count, folder_id, skipped_count }` для bulk; `{ assignment_id, task_id, folder_id }` для single. Никаких task_text / имён.
- **Validation:** lint+build+smoke. Manual: (1) bulk save 5 задач в новую папку; (2) bulk save где 1 задача из каталога, 1 из моей базы, 1 новая; (3) per-task icon save из HW Create edit-mode; (4) попытка save в чужое ДЗ через URL манипуляцию → 403.

### TASK-6 — `SaveAsTemplateDialog` + handler + `PATCH /templates/:id`

- **AC:** AC-14, AC-15, AC-16, AC-17.
- **Job:** P2.3 (масштабирование через reuse).
- **Agent:** Claude Code.
- **Files (новые):**
  - `src/components/tutor/homework-reuse/SaveAsTemplateDialog.tsx`
- **Files (изменения):**
  - `supabase/functions/homework-api/index.ts` — `handleCreateTemplateFromAssignment` (`POST /assignments/:id/save-as-template`), `handleUpdateTemplate` (`PATCH /templates/:id`)
  - `src/lib/tutorHomeworkApi.ts` — функции `createTemplateFromAssignment`, `updateTutorHomeworkTemplate`
- **Что делаем:**
  - **Backend handleCreate:** body `{ title: string, tags: string[], include_rubric: boolean, include_materials: boolean, include_ai_settings: boolean }`. SELECT задачи ДЗ с WHERE ownership-check. Формируем `tasks_json[]` — каждая задача inline-snapshot + optional `source_kb_task_id` если `kb_task_id IS NOT NULL` (AC-15). Условный `include_*`:
    - `include_rubric=false` → `rubric_text: null, rubric_image_urls: null` в snapshot
    - `include_ai_settings=false` → `check_format: undefined` (не записываем) — при использовании шаблона возьмётся default
    - `include_materials=true` → TODO: сейчас шаблоны не хранят материалы (они живут в `homework_tutor_materials` отдельно). **Для Sprint 1:** флаг игнорируется (noop) — это honest, так как шаблон-materials требует отдельной схемы. Добавить TODO-комментарий в код и в changelog.
    - INSERT в `homework_tutor_templates`. Возвращаем `HomeworkTemplate`.
  - **Backend handleUpdate:** `PATCH /templates/:id` body `{ title?, tags?, topic? }`. Whitelist только 3 поля. Если body содержит `tasks_json` / `subject` / другое — 400 `"Only title, tags, topic can be updated"`. UPDATE + RETURNING. Ownership check: `tutor_id = auth.uid()`.
  - **Frontend `SaveAsTemplateDialog`:**
    - Radix Dialog.
    - Поля: `Название` (prefill = `${assignment.title} — шаблон`), `Теги` (multi-chip input, prefill `[subject-label, topic]`).
    - 3 switch-toggle дефолтом **ON**: `Включить рубрику`, `Включить материалы`, `Включить настройки AI`. Под каждым — подпись описания («Проверочные критерии для AI», «Прикреплённые PDF/ссылки (временно недоступно)», «disable_ai_bootstrap, check_format»).
    - Для `Включить материалы` — всегда disabled + tooltip «Появится в следующей версии» (AC-16 compliance + honest UX).
    - Primary `[Сохранить шаблон]`. После успеха — toast + telemetry `homework_saved_as_template_post_factum`.
- **Guardrails:**
  - Ownership check в обоих handlers — без этого можно обновить чужой шаблон.
  - `tasks_json` в PATCH запрещён **жёстко** (400, не silent ignore) — иначе UI может случайно прислать и stale tasks_json затрёт валидный.
  - Checkbox «Сохранить как шаблон» в HWActionBar **НЕ ТРОГАТЬ** (AC-16) — он независимый путь.
  - Materials toggle — добавить disable + tooltip, не скрывать (чтобы пользователь видел, что функция существует и будет).
  - Telemetry payload: `{ assignment_id, template_id, include_rubric, include_ai_settings }` (без `include_materials` так как он noop).
- **Validation:** lint+build+smoke. Manual: (1) save template с rubric=true → проверить что в `tasks_json[0].rubric_text` присутствует; (2) с rubric=false → `rubric_text: null`; (3) PATCH `/templates/:id` с `{title: "New"}` → 200; (4) PATCH с `{tasks_json: []}` → 400.

### TASK-7 — `ShareLinkDialog` + handler + slug generation

- **Status:** ✅ Done 2026-04-22 (commit `bab6ae2`). Lint + build + smoke-check clean. Frontend функции названы `createHomeworkShareLink` / `listHomeworkShareLinks` / `deleteHomeworkShareLink` (префикс `Homework` вместо голого `Share` — меньше name clash). Dialog открывается пока только программно; wiring в Actions-меню на Detail — в TASK-10.
- **AC:** AC-6, AC-23 (`homework_share_link_created`).
- **Job:** P1.3 + Принцип 17.
- **Agent:** Claude Code.
- **Files (новые):**
  - `src/components/tutor/homework-reuse/ShareLinkDialog.tsx`
- **Files (изменения):**
  - `supabase/functions/homework-api/index.ts` — `handleCreateShareLink` (`POST /assignments/:id/share-links`), `handleListShareLinks` (`GET /assignments/:id/share-links`), `handleDeleteShareLink` (`DELETE /share-links/:slug`)
  - `src/lib/tutorHomeworkApi.ts` — функции `createShareLink`, `listShareLinks`, `deleteShareLink`
- **Что делаем:**
  - **Slug generation:** backend-side, base36 8 символов, retry на UNIQUE collision (retry max 3, иначе 500). Formula: `Math.random().toString(36).substring(2, 10)` → заменить на crypto-safe `crypto.getRandomValues` для edge function Deno (Deno has `crypto` built-in). Поскольку edge function — Deno, использовать `crypto.randomUUID().replace(/-/g, '').slice(0, 8)`.
  - **handleCreateShareLink:** body `{ show_answers: boolean, show_solutions: boolean, expires_in_days?: number }`. Ownership check через assignment.tutor_id. Если `expires_in_days` указан → `expires_at = now() + interval 'N days'`. INSERT в `homework_share_links`. Response `{ slug, url, expires_at }` где `url = ${PUBLIC_APP_URL}/p/${slug}`.
  - **handleListShareLinks:** `GET /assignments/:id/share-links` → список с `{slug, show_answers, show_solutions, expires_at, created_at}` сортировка `created_at DESC`. Только свои.
  - **handleDeleteShareLink:** `DELETE /share-links/:slug` → DELETE с WHERE `created_by = auth.uid()`. 404 если не найдена.
  - **Frontend `ShareLinkDialog`:**
    - Секция «Новая ссылка»: toggle `С ответами` (OFF), toggle `С решениями` (OFF), toggle `Истекает через 30 дней` (OFF). `[Создать ссылку]`.
    - После create — URL появляется в read-only input + `[📋 Скопировать]` (navigator.clipboard.writeText) + `[↗ Открыть в новой вкладке]`.
    - Секция «Существующие ссылки» (ниже) — список. Для каждой: chips флагов, дата создания (`formatters.ts`), `[🗑️]`. Click trash → подтверждение → DELETE.
    - Dialog открывается из Actions-меню на Detail ИЛИ из toolbar на `/preview` (из AC-3).
- **Guardrails:**
  - Slug collision retry (3 попытки), а не одна — защита от pathological случая.
  - `PUBLIC_APP_URL` берётся из env (обязателен для production, fallback `https://sokratai.lovable.app`).
  - Telemetry payload: `{ assignment_id, show_answers, show_solutions, has_expiry }`. Без slug (минимизировать PII в telemetry).
  - `navigator.clipboard` — guard на `!window.isSecureContext` / fallback на `document.execCommand('copy')` для preview-окружений (iOS Safari < 15.4 без HTTPS).
  - Проверить: ownership check на DELETE **обязателен** — иначе любой tutor может удалить чужую ссылку знанием slug.
- **Validation:** lint+build+smoke. Manual: (1) создать 2 ссылки с разными флагами; (2) открыть обе в incognito, проверить различие; (3) удалить одну, проверить что incognito показывает 404/expired; (4) попытка DELETE чужой ссылки через direct fetch → 403/404.

---

## Phase 4 — Groups (2-3 дня, параллельно Phase 2+3)

### TASK-8 — `HWAssignSection` tabs Группы/Ученики + `source_group_id` write

- **AC:** AC-18, AC-19, AC-20, AC-23 (`homework_assign_group`).
- **Job:** P2.3.
- **Agent:** Claude Code.
- **Files (изменения):**
  - `src/components/tutor/homework-create/HWAssignSection.tsx` — tabs, group picker
  - `src/hooks/useTutorGroups.ts` — если отсутствует, создать; если есть, расширить `listActiveGroupsWithMembers`
  - `src/pages/tutor/TutorHomeworkCreate.tsx` — пробросить `source_group_id` в create/update payload
  - `src/lib/tutorHomeworkApi.ts` — расширить `CreateAssignmentBody` и `UpdateAssignmentBody` (`source_group_id?: string | null`)
  - `supabase/functions/homework-api/index.ts` — `handleCreateAssignment` + `handleUpdateAssignment` принимают `source_group_id`, записывают в INSERT/UPDATE
- **Что делаем:**
  - **Hook:** `useTutorGroups()` возвращает `{ groups: Array<{id, name, short_name, color, is_active, members: Array<{tutor_student_id, is_active}>}>, isLoading }`. Query key `['tutor','groups']`. При `mini_groups_enabled=false` — возвращает `{ groups: [] }` без запроса.
  - **`HWAssignSection` refactor:**
    - Проверить `tutors.mini_groups_enabled` (через существующий hook). Если `false` → рендерить **только** существующий ученический список (backward compat — AC-18).
    - Если `true` → Tabs от shadcn/ui: `[Группы]` / `[Ученики]`. Default определяется по числу активных групп.
    - Tab `Группы`: список карточек групп (reuse `.claude/rules/90-design-system.md` design tokens — color circle, name, counter members). Клик = autoSelect/deselect. Multi-select allowed.
    - Под списком групп — resolved student list preview (badges) с возможностью убрать отдельного ученика. Если убран — input становится `manual` (источник = manual list, не group), `source_group_id` будет `NULL`.
    - State tracking: `selectedGroups: Set<string>`, `manuallyRemoved: Set<string>`, `manuallyAdded: Set<string>`. `resolvedStudentIds = union(groupMembers) - manuallyRemoved + manuallyAdded`.
    - Derived `source_group_id`: если `selectedGroups.size === 1 && manuallyRemoved.size === 0 && manuallyAdded.size === 0` → `[...selectedGroups][0]`. Иначе `null` (AC-20).
  - **Backend:** `CreateAssignmentBody.source_group_id: string | null`. В `handleCreateAssignment` / `handleUpdateAssignment` — whitelist поля, проверить что `tutor_groups.tutor_id = auth.uid()` (cross-tutor leak protection). INSERT/UPDATE с полем.
  - **Telemetry:** в `TutorHomeworkCreate.tsx` на `onSubmit` — `homework_assign_group` с `{ group_ids: [...selectedGroups], student_count, is_multi_group }`. Fires только если `selectedGroups.size > 0`.
- **Guardrails:**
  - Не ломать edit-mode ДЗ: если `existingAssignment.source_group_id IS NOT NULL` — prefill `selectedGroups = new Set([source_group_id])`. Если lagging (группа удалена) — `source_group_id` → NULL после `SET NULL` FK каскад, обрабатывать gracefully.
  - Ownership check `tutor_groups.tutor_id = auth.uid()` на backend — без него любой tutor сможет записать чужой group_id.
  - Не использовать `source_group_id` как ACL — это **только** метаданные. Assignment-student linkage остаётся через `homework_tutor_student_assignments`.
  - Query invalidation: при изменении members группы (вне scope этой фичи, но на будущее) — `['tutor','groups']` key должен инвалидироваться.
  - Design: AMBER / AVOID — **НЕ добавлять** emoji в nav, в кнопки групп — используй Lucide Users icon (правило 90-design-system.md).
- **Validation:** lint+build+smoke. Manual: (1) mini_groups_enabled=false → старый UI; (2) enabled=true с 2 группами → tabs видны, выбор группы prefills 5 учеников; (3) убрать одного ученика → source_group_id=null; (4) edit-mode ДЗ с source_group_id → prefill корректен; (5) запись в БД проверить через direct SELECT.

### TASK-9 — Filter `?group_id=` + badge на HWSummaryCard

- **AC:** AC-21, AC-23 (`homework_filter_by_group`).
- **Job:** P2.3.
- **Agent:** Claude Code.
- **Files (изменения):**
  - `supabase/functions/homework-api/index.ts` — `handleListAssignments` принимает `?group_id=`, добавляет WHERE `source_group_id = $1`
  - `src/lib/tutorHomeworkApi.ts` — `listTutorHomeworkAssignments` принимает `{ group_id?: string }`
  - `src/pages/tutor/TutorHomework.tsx` — добавить `<select>` фильтр по группе рядом с sort select
  - `src/pages/tutor/TutorHomework.tsx::AssignmentCard` — если `source_group_id IS NOT NULL` и группа найдена — badge `Группа {name}` с color
  - `src/lib/tutorHomeworkApi.ts::HomeworkAssignmentListItem` — добавить поля `source_group_id: string | null`, `source_group_name: string | null`, `source_group_color: string | null`
  - Backend `handleListAssignments` — join на `tutor_groups` чтобы вернуть name/color вместе
- **Что делаем:**
  - **Backend filter:** if `group_id` param present → `WHERE source_group_id = $1`. Если пустое/null — не фильтровать. Query invalidation на фронте на смену фильтра.
  - **Backend join:** LEFT JOIN `tutor_groups tg ON tg.id = homework_tutor_assignments.source_group_id AND tg.tutor_id = auth.uid()`. Возвращать `tg.name as source_group_name, tg.color as source_group_color` в response.
  - **Frontend `TutorHomework.tsx`:**
    - `<select>` «Все группы» + по одному option на каждую активную группу. Только если `mini_groups_enabled=true` и `groups.length > 0`. Иначе селект скрыт.
    - Query key расширяется: `['tutor','homework','assignments', { sort, filter, group_id }]`.
    - При изменении → telemetry `homework_filter_by_group` (`{ group_id }`).
  - **Frontend `AssignmentCard`:**
    - Badge рядом с subject/student-count. Pill `bg-[source_group_color]/10 text-[source_group_color] border-[source_group_color]` если цвет присутствует, иначе нейтральный.
    - Lucide `Users` icon 12px внутри badge.
  - **Backward compat:** старые ДЗ без `source_group_id` — badge не рендерится. Филтр «Все группы» показывает их.
- **Guardrails:**
  - LEFT JOIN — если группа удалена (FK SET NULL), `source_group_id` остаётся но `tg.name = NULL` → не рендерить badge (graceful degrade).
  - Select `text-base` (16px) per iOS Safari rule (правило 80-cross-browser.md).
  - Badge не emoji, Lucide Users (правило 90-design-system.md).
  - Фильтр не должен перекрывать существующий sort/status UI на mobile — проверить layout при narrow viewport.
- **Validation:** lint+build+smoke. Manual: (1) создать ДЗ через группу → появляется badge; (2) фильтр по группе → только ДЗ этой группы; (3) удалить группу → badge исчезает, ДЗ остаются в общем списке.

---

## Phase 5 — Integration + QA (2 дня)

### TASK-10 — Actions меню на `TutorHomeworkDetail` + связка диалогов

- **AC:** AC-1 (entry into preview), AC-10 (entry into save-to-KB), AC-14 (entry into save-as-template), AC-6 (entry into share-link).
- **Job:** integration.
- **Agent:** Claude Code.
- **Files (изменения):**
  - `src/pages/tutor/TutorHomeworkDetail.tsx` — расширить `DetailActions` (компонент в `rightSlot` ResultsHeader)
- **Что делаем:**
  - Текущий `DetailActions` имеет status badge + «Редактировать» + «Удалить». Добавить между «Редактировать» и «Удалить» кнопку `[⋯]` (DropdownMenu from shadcn) с items:
    - `👁️ Открыть preview` → `navigate('/tutor/homework/:id/preview')`
    - `🔗 Поделиться ссылкой` → `setShareDialogOpen(true)`
    - `📚 Сохранить задачи в базу` → `setSaveKBDialogOpen(true)`
    - `📋 Сохранить как шаблон` → `setSaveTemplateDialogOpen(true)`
  - Ленивые imports для диалогов через `React.lazy` + Suspense — не грузить их до первого открытия.
  - На mobile — кнопка `⋯` становится главным entry point (остальное в dropdown), чтобы экономить место.
  - Navigate на preview использует `navigate` из `react-router-dom`, не Link — обеспечивает scroll reset.
- **Guardrails:**
  - Один primary CTA per screen — `[Редактировать]` остаётся primary, dropdown items все secondary/ghost visually.
  - Dropdown items НЕ показывать emoji — заменить на Lucide icons (Eye, Share2, BookmarkPlus, FileText).
  - Диалоги mount только когда `open=true` (через conditional render) — иначе fetch'и запускаются на mount всех 3 диалогов.
  - Performance: диалоги через React.lazy — иначе bundle size Detail вырастет заметно.
- **Validation:** lint+build+smoke. Manual: 4 dropdown items работают, правильные диалоги открываются, preview navigate не ломает history.

### TASK-11 — Telemetry wiring (11 событий) + наполнение `homeworkTelemetry`

- **AC:** AC-23.
- **Job:** validation infrastructure.
- **Agent:** Claude Code.
- **Files (изменения):**
  - `src/lib/homeworkTelemetry.ts` — добавить константы для 11 новых событий
  - grep-verify что каждое событие fire'ится **ровно один раз** в expected моменте
- **Что делаем:**
  - Добавить const definitions для:
    - `homework_preview_opened` (useEffect mount in `TutorHomeworkPreview`)
    - `homework_preview_printed` (click Print button)
    - `homework_preview_copied_text` (click Copy button)
    - `homework_saved_to_kb` (bulk success callback)
    - `homework_saved_to_kb_per_task` (single-mode success callback)
    - `homework_saved_as_template_post_factum` (template dialog success)
    - `homework_share_link_created` (share dialog success)
    - `homework_share_link_visited` (server-side, в `public-homework-share` edge function)
    - `homework_assign_group` (HW Create submit with selected groups)
    - `homework_filter_by_group` (select change in TutorHomework)
    - `tutor_assistant_route_hit` (redirect component useEffect)
  - Payload для каждого: задокументировать типизированный payload (TypeScript type), без PII (имён, email, task_text).
  - useRef sentinels для fire-once events (preview_opened per-mount) — не fire на каждый refetch.
- **Guardrails:**
  - PII-free payload — grep новые events на `task_text`, `student_name`, `email` перед commit.
  - Fire-once pattern обязателен для `preview_opened` — refetch не должен multiply-fire.
  - Public `homework_share_link_visited` — server-side, без user_id (публичный доступ).
- **Validation:** lint+build+smoke. Manual trace через console: каждое действие produces exactly one event.

### TASK-12 — QA pass

- **AC:** все.
- **Job:** validation.
- **Agent:** Claude Code.
- **Files:**
  - `docs/delivery/features/homework-reuse-v1/qa-checklist.md` — новый файл
- **Что делаем:** создать structured QA checklist с:
  - **Cross-browser:** Chrome Desktop / Safari macOS / iPhone Safari / Android Chrome — по 4 экрана (Detail, Preview, public `/p/:slug`, HW Create с группами)
  - **Print preview:** Chrome + Safari — PDF формулы читаемые, toolbar скрыт, каждая задача break-inside
  - **Public share:** incognito + logged-out + logged-in другим tutor'ом — response не содержит rubric/students; `/p/invalid-slug` → 404/400; `/p/expired-slug` → «истёк»
  - **KB dedup:** fingerprint collision test (сохранить одну и ту же задачу из разных ДЗ — вторая должна skip)
  - **Groups edit-mode:** ДЗ с `source_group_id` → открыть edit → проверить prefill; удалить одного ученика → `source_group_id=null` после save; edit ДЗ группа которой удалена → graceful fallback
  - **`/tutor/assistant` bookmark:** открыть → redirect на `/tutor/home` без flash; telemetry event fires
  - **Accessibility quick pass:** tab-навигация по share dialog, preview toolbar — focus-visible states видны; `<select>` фильтра группы имеет aria-label
- **Guardrails:** чеклист — это документ, не код. Если какой-то AC не проходит — НЕ marking как done, reopen TASK.
- **Validation:** manual pass. Каждый TASK обязан сверяться с QA checklist перед marking complete.

---

## Итого

**12 тасков, ~12-16 человеко-дней, 1 sprint (1-2 недели) для одного fullstack разработчика.**

**Порядок исполнения (критический путь):**

```
TASK-1 (migrations) ──┬── TASK-3 (preview) ─┬── TASK-10 (menu integration) ── TASK-11 (telemetry) ── TASK-12 (QA)
TASK-2 (cleanup)      ├── TASK-5 (save-kb) ─┤
                      ├── TASK-6 (template)─┤
                      ├── TASK-7 (share)    ┤
                      ├── TASK-4 (public)   ┤
                      └── TASK-8 (groups) ──┘── TASK-9 (filter)
```

TASK-1 разблокирует всё, TASK-2 независимый. Потом 6 параллельных рабочих треков (3/4/5/6/7/8). TASK-9 после TASK-8. TASK-10 собирает всё в Actions-меню. TASK-11 и TASK-12 — замыкающие.

**Estimated effort:**
- TASK-1: M (1-2 дня)
- TASK-2: S (0.5 дня)
- TASK-3: M (2-3 дня)
- TASK-4: S-M (1-2 дня)
- TASK-5: M (2 дня)
- TASK-6: S (1 день)
- TASK-7: S (1 день)
- TASK-8: M (1-2 дня)
- TASK-9: S (1 день)
- TASK-10: S (0.5 дня)
- TASK-11: S (0.5 дня)
- TASK-12: S (1 день)

**Итого:** 12-16 человеко-дней.

---

## Copy-paste промпты для агентов

> Каждый промпт self-contained — агент не имеет контекста этого брейншторма. Укажи конкретную TASK-N при запуске.

### Промпт для Claude Code (TASK-N)

```
Реализуй TASK-{N} из docs/delivery/features/homework-reuse-v1/tasks.md.

Контекст:
- Spec: docs/delivery/features/homework-reuse-v1/spec.md
- AC: ссылка внутри TASK-{N} (раздел 6a спеки)
- Глобальные правила: .claude/rules/*.md (особенно 40-homework-system.md, 50-kb-module.md, 90-design-system.md, 80-cross-browser.md)
- Canonical read order для tutor-фич: CLAUDE.md § Tutor AI Agents

Выполни строго:
1. Прочитай AC задачи в spec.md §6a.
2. Прочитай канонические доки для tutor (15, 16, 17), если ещё не делал в этой сессии.
3. Имплементируй согласно «Что делаем» секции в TASK-{N}.
4. Соблюдай guardrails секции TASK-{N}.
5. Прогоняй validation команды по завершении (lint + build + smoke-check).
6. Commit одним PR, commit message в конвенции проекта: `feat(homework-reuse-v1): TASK-{N} — {короткое описание}`.

Не выходи за scope TASK-{N}. Если обнаружил смежный баг — заведи отдельную задачу через spawn, не смешивай.
```

### Промпт для Codex (независимое ревью любой TASK-N)

```
Сделай независимое code review PR для TASK-{N} из docs/delivery/features/homework-reuse-v1/tasks.md.

Контекст:
- Spec: docs/delivery/features/homework-reuse-v1/spec.md (секция 6a — Acceptance Criteria)
- Tasks: docs/delivery/features/homework-reuse-v1/tasks.md (найди TASK-{N})
- Правила: .claude/rules/*.md

Проверь:
1. Все AC для TASK-{N} реализованы — пройди по каждому AC из списка в задаче.
2. Guardrails не нарушены (перечислены в TASK-{N}).
3. Нет PII в telemetry (имён, email, task_text).
4. Ownership-checks на всех backend-handlers, которые трогают user data.
5. Cross-browser risks (правило 80-cross-browser.md) — особенно Safari/iOS.
6. Design-system compliance (правило 90-design-system.md) — Golos Text, токены, не emoji в UI chrome.
7. Performance rules (правило performance.md) — React.memo на list-items, lazy imports для тяжёлых диалогов.
8. Не тронуты high-risk файлы (AuthGuard, TutorGuard, Chat.tsx, TutorSchedule.tsx, telegram-bot/index.ts) без явной необходимости.
9. Student/Tutor isolation соблюдена — особенно для public share-link endpoint.

Report:
- Пройденные AC (галочками)
- Нарушения guardrails (с file:line)
- Потенциальные security risks (с severity)
- Запах кода (code smells)
- Рекомендация: APPROVE / REQUEST_CHANGES

Не пиши код — только review.
```
