# Tasks: KB → ДЗ flow polish

**Spec:** `docs/delivery/features/kb-hw-flow-polish/spec.md`
**Дата:** 2026-04-15
**Статус:** P0 implemented; P1 TASK-10 done (HWDrawer sourceLabel), TASK-7..9/11/12 remain pending. Post-review fix: provenance join sync in `hw_reorder_tasks` (2026-04-15, migration `20260415120000_hw_reorder_tasks_sync_kb.sql`).

---

## Нарезка

**P0 релиз** — 6 задач, можно ship в один день:
- TASK-1: убрать HW-badge с tab «Домашки» ✅
- TASK-2: shared hook `useKBImagesSignedUrls` (React Query, batch) ✅
- TASK-3: shared `FullscreenImageCarousel` компонент ✅
- TASK-4: `HWTaskCard` — wire hook + carousel + lazy preview ✅
- TASK-5: `HWDrawer` — 75vw + превью фото (паттерн `PickerTaskCard`) ✅
- TASK-6: P0 smoke + manual QA (Chrome desktop, Safari iOS) automated partial ✅ / manual pending Lovable preview

**P1 релиз** — 6 задач, 1–2 дня после P0:
- TASK-7: backend extend `GET /assignments/:id` полями `kb_snapshot_solution`, `kb_snapshot_solution_image_refs`, `kb_source_label`
- TASK-8: `DraftTask` type + `kbTaskToDraftTask` + edit-mode маппинг новых полей
- TASK-9: `HWTaskCard` — read-only блок «Эталонное решение» в `RubricField` + `source_label` в шапке
- TASK-10: `HWDrawer` карточка — `source_label` tutor-only badge ✅
- TASK-11: `TutorHomeworkCreate` — дефолт `disable_ai_bootstrap = true` в edit-mode + template-apply
- TASK-12: P1 QA (student runtime не видит `kb_snapshot_solution`, response `getStudentAssignment` не содержит новых полей)

**Dependency graph:**
- TASK-1 → standalone, ship первым
- TASK-2, TASK-3 → параллельно, blockers для TASK-4 и TASK-5
- TASK-4 зависит от TASK-2 + TASK-3
- TASK-5 зависит от TASK-2
- TASK-6 после всех P0
- TASK-7 → blocker для TASK-8
- TASK-8 → blocker для TASK-9, TASK-10
- TASK-11 → standalone
- TASK-12 после всех P1

---

## P0

### TASK-1: Убрать HW-badge с tab «Домашки» в TutorLayout

**Job:** R4-1
**Agent:** Claude Code
**Files:**
- `src/components/tutor/TutorLayout.tsx`

**AC:** AC-1, AC-2

**Scope:**
- Удалить computation `showHWBadge` и `<span>` счётчика в desktop nav (L125-139) и mobile bottom nav (L183-200).
- Удалить импорт `useHWTaskCount` из `@/stores/hwDraftStore`, если после удаления он больше не нужен. Проверить через Grep.
- `HWBadgeButton` в `src/components/kb/HWDrawer.tsx` и `KnowledgeBaseFrame.tsx` — **не трогаем**, счётчик в шапке КБ остаётся.

**Guardrails:**
- Не менять layout nav (spacing, md/sm breakpoints).
- Не трогать `desktopPrimaryItems` / `mobilePrimaryItems` массивы.

**Validation:**
- `npm run lint && npm run build`.
- Ручная: добавить 1 задачу в КБ-корзину → tab «Домашки» без badge ни на desktop, ни на mobile. Шапка КБ — с «ДЗ · 1».

---

### TASK-2: Shared hook `useKBImagesSignedUrls` (React Query)

**Job:** R4-1
**Agent:** Claude Code
**Files:**
- `src/hooks/useKBImagesSignedUrls.ts` (новый)
- `src/lib/kbApi.ts` (check: `getKBImageSignedUrl` уже экспортирован)

**AC:** AC-3, AC-4 (prerequisite)

**Scope:**
- Создать hook:
  ```ts
  export function useKBImagesSignedUrls(refs: string[] | null | undefined, options?: { enabled?: boolean }): {
    urls: Record<string, string>; // keyed by storage ref
    isLoading: boolean;
  }
  ```
- Внутри: `useQueries` по refs. Каждый query key `['kb', 'signed-url', ref]`. `staleTime: 55 * 60 * 1000`, `gcTime: 60 * 60 * 1000`.
- Игнорировать refs, которые уже direct URLs (`/^(https?:\/\/|data:|blob:)/i`) — вернуть as-is без запроса. `blob:` нужен для optimistic upload preview в `HWTaskCard`.
- Null-safe: пустой массив / null → `{ urls: {}, isLoading: false }`.

**Guardrails:**
- Не вводить новый endpoint. Используем уже существующий `getKBImageSignedUrl` из `kbApi.ts`.
- Hook — pure client, без Supabase client внутри (использует `getKBImageSignedUrl` как thin wrapper).

**Validation:**
- `npm run lint && npm run build`.
- Временный dev-check: в `TutorHomeworkCreate` page добавить `useKBImagesSignedUrls` для первой задачи, залогировать `urls` — убедиться что appears за ~300ms после mount.

---

### TASK-3: Shared `FullscreenImageCarousel` компонент

**Job:** R4-1
**Agent:** Claude Code
**Files:**
- `src/components/homework/shared/FullscreenImageCarousel.tsx` (новый)

**AC:** AC-5, AC-6 (prerequisite)

**Scope:**
- Извлечь паттерн из `src/components/homework/GuidedHomeworkWorkspace.tsx:346-515` (`TaskConditionGallery`) в standalone компонент:
  ```ts
  interface FullscreenImageCarouselProps {
    images: string[];               // already resolved HTTP URLs
    openIndex: number | null;
    onClose: () => void;
    onNavigate: (index: number) => void;
    ariaTitle?: string;
    ariaDescription?: string;
  }
  ```
- Инкапсулировать:
  - `<Dialog>` с `max-w-5xl`, `[&>button]:hidden`.
  - Prev/next кнопки (disabled на границах), counter `N/M`, close (`X`).
  - Keyboard: `ArrowLeft` / `ArrowRight`.
  - Touch swipe: `TAP_THRESHOLD_MS = 250`, `SWIPE_THRESHOLD_PX = 40` — экспортировать константы из того же файла (или scope-local, если они там уже scope-local).
- **Student `TaskConditionGallery` оставляем как есть** — НЕ рефакторим в этом PR. Миграция на shared — parking lot.

**Guardrails:**
- Не добавлять signed URL resolution внутрь — компонент принимает только готовые URL.
- Не импортировать никакую homework-specific логику (`parseAttachmentUrls`, `useStudentTaskImagesSignedUrls`) — компонент чисто presentational.
- Safari/iOS: `touch-pan-x`/`touch-action: manipulation`, `overflow-hidden` на container, `loading="lazy"` на `<img>`.
- Review fix: `DialogContent` имеет явный `z-[60]` выше Sheet, изображение использует `max-h-[75dvh]` вместо `vh`.

**Validation:**
- `npm run lint && npm run build`.

---

### TASK-4: `HWTaskCard` — wire hook + carousel + lazy preview

**Job:** R4-1
**Agent:** Claude Code
**Depends on:** TASK-2, TASK-3
**Files:**
- `src/components/tutor/homework-create/HWTaskCard.tsx`

**AC:** AC-4, AC-5, AC-6

**Scope:**
- В `HWTaskCard` вызвать `useKBImagesSignedUrls(taskRefs)` + `useKBImagesSignedUrls(rubricRefs)`. Объединить в `resolvedUrls: Record<ref, url>`.
- `PhotoThumbnail` props: добавить `resolvedUrl?: string | null`. `<img src={previewUrl ?? resolvedUrl}>` если оба null → `ImageIcon` placeholder (текущее поведение).
- В `PhotoGallery` — передать `resolvedUrls[ref] ?? null` в `PhotoThumbnail`.
- `PhotoThumbnail` — обернуть `<img>` в `<button onClick={() => onOpenZoom(index)}>`. Props: `onOpenZoom: (index: number) => void`.
- В `HWTaskCard` добавить state `{ gallery: 'task' | 'rubric', index: number } | null` для zoom viewer. Render `<FullscreenImageCarousel>` с `images` = resolved URLs текущей galleries (task или rubric).
- `touch-action: manipulation` на button-wrapper. `aria-label="Увеличить фото N"`.

**Guardrails:**
- НЕ менять контракт `DraftTask` в этой задаче (оставляем для TASK-8).
- НЕ трогать upload flow (`addTaskPhotos`, `addRubricPhotos`, `removePhoto`).
- `previewUrls` (local blob URLs для текущей session) имеет приоритет над `resolvedUrl` — без этого после upload пользователь увидит ремерцание (blob → signed).
- Review fix: upload flow создаёт optimistic `blob:` refs сразу после валидации файлов и пишет их в draft state до начала сетевого upload; после успеха temp refs заменяются на storage refs, после ошибки удаляются и revoke-ятся.
- iOS Safari: `position: sticky` не используется; Dialog через Radix portal — не должен конфликтовать с parent `<Sheet>` в edit-mode.
- Performance: для 10 задач × 5 фото = 50 RQ queries — OK, они параллельны и кешируются.

**Validation:**
- `npm run lint && npm run build`.
- Ручная (Chrome):
  - Новое ДЗ → «Добавить из базы» → взять задачу с фото → в `HWTaskCard` должны появиться thumbnails (`<img>`, не placeholder).
  - Клик по thumbnail → fullscreen viewer. Arrow keys → навигация. X → закрытие.
  - Upload нового фото через `+ Добавить` — blob preview мгновенно, потом сохраняется в `task_image_path`.
- Ручная (Safari iOS):
  - Touch swipe в fullscreen → prev/next.
  - Тап по thumbnail не двигает body scroll.

---

### TASK-5: `HWDrawer` — 75vw + превью фото

**Job:** R4-1
**Agent:** Claude Code
**Depends on:** TASK-2
**Files:**
- `src/components/kb/HWDrawer.tsx`

**AC:** AC-3

**Scope:**
- `SheetContent className`: заменить `w-[420px] max-w-[90vw] ... sm:max-w-[420px]` на `w-[75vw] !max-w-none sm:max-w-none`.
- Карточка задачи — перестроить по паттерну `KBPickerSheet.PickerTaskCard`:
  - `MathText` условия остаётся (но без `line-clamp-2` — давай `line-clamp-3` как в Picker).
  - Добавить `<img>` thumbnail ниже текста через `useKBImagesSignedUrls([firstRef])`, где `firstRef = parseAttachmentUrls(task.attachmentSnapshot)[0]`.
  - `max-h-48` на `<img>`, `rounded-xl border`, `loading="lazy"`, `object-contain`.
  - Если фото > 1 — показать счётчик `+{N-1} фото` как overlay badge (опционально, P1-ish, можно опустить для минимума).
- Inline edit-mode (pencil) — оставить как есть.
- Edit-режим не показывает photo preview (окей — сложность добавлять gallery-editor в drawer, out of scope).

**Guardrails:**
- Не менять DB-flow в `handleSendHomework`, но сохранить multi-photo correctness: `task_image_url` пишется через `serializeAttachmentUrls(parseAttachmentUrls(task.attachmentSnapshot).slice(0, MAX_TASK_IMAGES))`, а не first-ref-only.
- НЕ менять `hwDraftStore` shape.
- НЕ добавлять fullscreen carousel в drawer в этом релизе (out of scope — если понадобится, отдельная задача).
- Mobile: `w-[75vw]` даёт 75% ширины viewport — Radix Sheet автоматически респектит `max-width: 100vw`. Проверить на реальном iPhone что header/footer видны.

**Validation:**
- `npm run lint && npm run build`.
- Ручная: добавить 3 задачи с фото из каталога КБ → открыть drawer → видно превью всех трёх.
- Ручная: нажать «Создать черновик ДЗ» из drawer с задачей на 2+ фото → открыть `/tutor/homework/:id/edit` → все фото условия видны.
- Edit-режим (клик по Pencil) — textarea условия + input ответа работают как раньше.

---

### TASK-6: P0 smoke + manual QA

**Job:** R4-1
**Agent:** Claude Code (automated) + Vladimir (manual)
**Depends on:** TASK-1..5
**Files:** none

**AC:** AC-1..AC-6

**Scope (automated):**
- `npm run lint`
- `npm run build`
- `npm run smoke-check`

**Scope (manual):**
- Chrome desktop:
  1. Добавить 2 задачи с фото из `/tutor/knowledge` → tab «Домашки» без badge ✅
  2. Открыть HWDrawer (клик «ДЗ · 2») → sheet шириной ~75% экрана ✅
  3. В карточках видны превью фото ✅
  4. Нажать «Создать черновик ДЗ» → переход на `/tutor/homework` с toast ✅
  5. Открыть созданное ДЗ в edit-mode (`/tutor/homework/:id/edit`) → в `HWTaskCard` превью фото видны (НЕ placeholder) ✅
  6. Клик по thumbnail → fullscreen → ArrowLeft/Right работают ✅
  7. Закрыть viewer → upload новое фото через `+ Добавить` → появляется instantly blob preview ✅
- Safari iOS 16+:
  1. Touch swipe в fullscreen viewer ✅
  2. HWDrawer на 375px viewport не съедает header/footer ✅
  3. Photo thumbnail tap не ломает body scroll ✅

**Validation:**
- Нет console errors на каждом шаге.
- Нет 4xx/5xx в Network для signed URL запросов (если ошибка — проверить RLS на `kb-attachments` bucket).

**Automated validation run (2026-04-15):**
- `npm run build` — PASS.
- `npm run smoke-check` — PASS; only existing non-blocking small-input-font warning.
- `npx eslint src/components/kb/HWDrawer.tsx src/components/tutor/homework-create/HWTaskCard.tsx src/components/homework/shared/FullscreenImageCarousel.tsx src/hooks/useKBImagesSignedUrls.ts` — PASS.
- `npm run lint` — FAIL on existing repo-wide lint debt outside this feature; targeted feature lint is green.

---

## P1

### TASK-7: Backend — extend `GET /assignments/:id` response

**Job:** R4-3
**Agent:** Claude Code
**Files:**
- `supabase/functions/homework-api/index.ts` (функция `handleGetAssignment` или аналогичная)

**AC:** AC-7 (prerequisite), AC-8 (prerequisite)

**Scope:**
- В handler, который возвращает `GET /assignments/:id` для tutor, добавить в response для каждой task:
  - `kb_snapshot_solution: string | null` — из `homework_kb_tasks.task_solution_snapshot` по `homework_id = assignment.id AND task_id = kb_tasks.id` (LEFT JOIN).
  - `kb_snapshot_solution_image_refs: string | null` (dual-format attachment ref) — из `kb_tasks.solution_attachment_url` через LEFT JOIN. Если KB-задача удалена → `null`.
  - `kb_source_label: string | null` — из `kb_tasks.source_label` через LEFT JOIN. Если KB-задача удалена → `null`.
- Один JOIN-запрос на весь assignment (не N запросов). Использовать уже существующий паттерн с `homework_kb_tasks` (если есть) или добавить один новый select.
- **НЕ** добавлять эти поля в `getStudentAssignment` или любой student-facing endpoint.

**Guardrails:**
- Additive — не менять существующие поля response.
- Null-safe для каждого нового поля.
- RLS: `kb_tasks` JOIN должен работать для moderators И non-moderators. `homework_kb_tasks` — tutor_id check остаётся.

**Validation:**
- `npm run lint && npm run build`.
- Manual: curl `GET /assignments/:id` с tutor JWT → verify new fields в response.
- Manual: curl `GET /student-assignment/:id` (или аналог) со student JWT → verify new fields **отсутствуют**.

---

### TASK-8: `DraftTask` + конвертеры — прокинуть новые поля

**Job:** R4-3
**Agent:** Claude Code
**Depends on:** TASK-7
**Files:**
- `src/components/tutor/homework-create/types.ts`
- `src/components/tutor/homework-create/HWTasksSection.tsx` (функция `kbTaskToDraftTask`)
- `src/pages/tutor/TutorHomeworkCreate.tsx` (функция `convertAssignmentToDraftTasks` — find by grep)

**AC:** AC-7, AC-8 (prerequisite)

**Scope:**
- `DraftTask` (types.ts) — добавить optional fields:
  - `kb_snapshot_solution_image_refs?: string | null` (dual-format ref)
  - `kb_source_label?: string | null`
- `kbTaskToDraftTask` в `HWTasksSection.tsx`:
  - `kb_snapshot_solution_image_refs: task.solution_attachment_url ?? null`
  - `kb_source_label: task.source_label ?? null`
- `convertAssignmentToDraftTasks` в `TutorHomeworkCreate.tsx` (edit-mode load):
  - Прочитать новые поля из response (TASK-7), положить в DraftTask.

**Guardrails:**
- Не менять save-path (submit homework) — новые поля не пишутся в `homework_tutor_tasks`, они только UI-проекция.
- Backward compat: старые ДЗ в edit-mode без этих полей в БД → `null` → пустой slot.

**Validation:**
- `npm run lint && npm run build`.
- Ручная: открыть существующее ДЗ → DevTools React → проверить что task prop имеет `kb_snapshot_solution`, `kb_source_label`.

---

### TASK-9: `HWTaskCard` — «Эталонное решение» + `source_label` badge

**Job:** R4-3
**Agent:** Claude Code
**Depends on:** TASK-8
**Files:**
- `src/components/tutor/homework-create/HWTaskCard.tsx`

**AC:** AC-7, AC-8

**Scope:**
- В шапке `HWTaskCard` (после `<SourceBadge>`): `{task.kb_source_label && <span className="text-xs text-muted-foreground">{task.kb_source_label}</span>}`.
- В `RubricField`:
  - Parse `kb_snapshot_solution_image_refs` через `parseAttachmentUrls`.
  - Если `task.kb_snapshot_solution || solutionImageRefs.length > 0` — render read-only блок:
    ```tsx
    <div className="rounded-xl bg-socrat-surface px-3 py-2.5">
      <div className="mb-1 text-[11px] font-medium uppercase tracking-[0.12em] text-slate-500">
        Эталонное решение (из БЗ)
      </div>
      {task.kb_snapshot_solution && <MathText text={task.kb_snapshot_solution} className="text-sm text-slate-700" />}
      {solutionImageRefs.length > 0 && <ReferenceSolutionPhotos refs={solutionImageRefs} />}
    </div>
    ```
  - `ReferenceSolutionPhotos` — использует `useKBImagesSignedUrls(refs)` + `FullscreenImageCarousel` (переиспользуем TASK-2, TASK-3). Read-only — без кнопки удаления, без upload.
- Блок рендерится **внутри** collapsible `RubricField` (после rubric textarea и rubric фото).

**Guardrails:**
- НЕ передавать это поле в AI: AI grading промпт (`evaluateStudentAnswer`) НЕ должен видеть `kb_snapshot_solution`. Проверить что ни одна edge function не читает это поле.
- НЕ добавлять кнопку «Скопировать в критерии» — parking lot.
- Безопасность: `MathText` используется через `preprocessLatex` → XSS-safe.

**Validation:**
- `npm run lint && npm run build`.
- Ручная: создать ДЗ из KB-задачи с заполненным `solution` и `source_label` → в конструкторе видны оба поля в нужных местах.
- Ручная: задача без `solution` → блок «Эталонное решение» НЕ рендерится (нет пустого заголовка).

---

### TASK-10: `HWDrawer` карточка — `source_label` badge

**Job:** R4-3
**Agent:** Claude Code
**Depends on:** TASK-8 (частично — HWDrawer читает из `hwDraftStore`, не из DraftTask)
**Files:**
- `src/stores/hwDraftStore.ts` (расширение `HWDraftTask`)
- `src/types/kb.ts` (extend `HWDraftTask`)
- `src/components/kb/HWDrawer.tsx`

**AC:** AC-8

**Scope:**
- Расширить `HWDraftTask` (в `src/types/kb.ts`): добавить `sourceLabel: string | null`.
- `hwDraftStore.addTask`: прокинуть `task.source_label ?? null`.
- `HWDrawer` — в шапке карточки рядом с `SourceBadge` добавить `{task.sourceLabel && <span className="text-[10px] text-slate-400">{task.sourceLabel}</span>}`.
- **Миграция existing drafts в localStorage**: при загрузке persist-state, если `sourceLabel` отсутствует → `null`. Zustand persist автоматически backward-compat через optional field.

**Guardrails:**
- НЕ ломать существующий persist state (ученики с активной корзиной не должны терять задачи).
- НЕ добавлять `sourceLabel` в `homework_kb_tasks` или `homework_tutor_tasks` — это ТОЛЬКО UI-проекция, не persisted в БД ДЗ.

**Validation:**
- `npm run lint && npm run build`.
- Ручная: localStorage с existing корзиной → открыть drawer → не падает, задачи видны без source_label.
- Ручная: добавить новую задачу с `source_label` → в drawer виден под текстом задачи.

---

### TASK-11: `disable_ai_bootstrap` — дефолт OFF везде

**Job:** R4-1
**Agent:** Claude Code
**Files:**
- `src/pages/tutor/TutorHomeworkCreate.tsx`

**AC:** AC-9, AC-10

**Scope:**
- Grep `disable_ai_bootstrap ?? false` в `TutorHomeworkCreate.tsx` — ожидаются 2 места:
  - L171 (`convertAssignmentToDraftTasks` или edit-mode load)
  - L227 (template-apply)
- Заменить оба на `disable_ai_bootstrap ?? true`.
- Проверить что L91 (new HW default) и L810 (reset state) уже `true` — не трогать.
- Submit-path (L486, L712) — оставить как есть (репетитор явно toggle'нул через UI, значение берётся из state meta).

**Guardrails:**
- Это меняет поведение для legacy ДЗ с `null` в БД — они получат OFF-toggle при открытии в edit. Принято.
- Ученики уже начавшие ДЗ с `disable_ai_bootstrap = null` могли видеть AI-intro на стартовых задачах — OK, это runtime-only (bootstrap выполняется при первом открытии каждой задачи). Новых bootstrap-ов не появится, уже полученные intro-сообщения в `homework_tutor_thread_messages` остаются.

**Validation:**
- `npm run lint && npm run build`.
- Ручная: открыть ДЗ, созданное до этой фичи → раскрыть «Расширенные параметры» → toggle = OFF.
- Ручная: создать новое ДЗ → toggle = OFF.
- Ручная: применить шаблон → toggle = OFF.

---

### TASK-12: P1 QA + student runtime isolation check

**Job:** R4-3
**Agent:** Claude Code (automated) + Vladimir (manual)
**Depends on:** TASK-7..11
**Files:** none

**AC:** AC-7..AC-10

**Scope (automated):**
- `npm run lint && npm run build && npm run smoke-check`
- Grep check: `kb_snapshot_solution` / `kb_source_label` / `kb_snapshot_solution_image_refs` не встречаются в:
  - `src/lib/studentHomeworkApi.ts`
  - `src/components/homework/**`
  - `src/pages/student/**`
  - `supabase/functions/homework-api/index.ts` — в student-facing handlers (handleCheckAnswer, handleRequestHint, handleGetStudentAssignment).

**Scope (manual):**
- Tutor:
  1. Создать ДЗ с KB-задачей (кот. имеет `solution` + `source_label`) → всё отображается ✅
  2. Открыть старое ДЗ (без `disable_ai_bootstrap` в БД) → toggle OFF ✅
  3. KB-задача без `source_label` → slot не рендерится ✅
  4. KB-задача с `solution` но без фото решения → текст есть, carousel не рендерится ✅
- Student:
  1. Открыть ДЗ на `/student/homework/:id` → в DevTools React/Network проверить что `kb_snapshot_solution` отсутствует в response + компоненте ✅
  2. Запросить hint → промпт AI не содержит эталонного решения (проверить через Supabase logs) ✅

**Validation:**
- Все manual checks PASS.
- Нет регрессий в student flow (проверить check_answer + hint сценарии).

---

## Copy-paste промпты для агентов

Plain-text блоки — скопировать один в Claude Code / Codex.

### TASK-1 — prompt

```
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Контекст: SokratAI — платформа для репетиторов физики ЕГЭ/ОГЭ. Wedge — сборка качественного ДЗ за 5–10 минут. AI = draft + action. Сейчас на tab «Домашки» в top-nav отображается dot-badge со счётчиком драфт-корзины из hwDraftStore (КБ → корзина → конструктор ДЗ). Это вводит в заблуждение: клик по tab ведёт на список assignments, а не на корзину. Репетиторы идут туда, ничего не находят — лишние клики, поломанный mental model.

Канонические доки (читать в порядке):
1. docs/delivery/features/kb-hw-flow-polish/spec.md (§3, AC-1, AC-2)
2. CLAUDE.md
3. .claude/rules/10-safe-change-policy.md
4. .claude/rules/90-design-system.md

Задача:
1. В src/components/tutor/TutorLayout.tsx:
   - Удалить вычисление `showHWBadge` в desktop nav (строки ~125) и mobile bottom nav (~183)
   - Удалить `<span>` счётчика в обеих местах
   - Если после этого `useHWTaskCount` больше не импортируется — удалить импорт (строка ~28)
2. НЕ трогать `HWBadgeButton` в src/components/kb/HWDrawer.tsx и его использование в src/components/kb/KnowledgeBaseFrame.tsx — счётчик в шапке КБ остаётся.
3. НЕ менять массивы `desktopPrimaryItems` / `mobilePrimaryItems` / `desktopMoreItems` / `mobileMoreItems`.

Acceptance Criteria:
- AC-1: добавив 1+ задачу в корзину КБ, на desktop и mobile top-nav tab «Домашки» НЕ содержит dot-badge.
- AC-2: счётчик в шапке КБ («ДЗ · N» кнопка) отображается и обновляется как раньше.

Guardrails:
- Не менять layout/spacing/breakpoints навигации.
- Не трогать mobile «Ещё» sheet.
- Не переименовывать routes.

Validation:
- npm run lint && npm run build
- Ручная проверка: добавить задачу в корзину через /tutor/knowledge → tab «Домашки» без badge; шапка КБ с «ДЗ · 1».

Mandatory end block:
- Changed files
- Summary (≤3 bullets)
- Validation output
- Docs to update: нет (spec already covers this)
- Self-check: соответствует ли docs/discovery/product/tutor-ai-agents/17-ui-patterns-and-component-rules-sokrat.md (навигационные паттерны)?
```

### TASK-2 — prompt

```
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Контекст: SokratAI. Wedge — сборка ДЗ за 5–10 минут. В KB-attachments storage картинки хранятся как storage:// refs, в UI резолвятся в signed URLs (TTL 60 мин). Сейчас HWTaskCard НЕ показывает превью KB-фото (только blob preview для новых uploads), а HWDrawer показывает крохотный ImageIcon placeholder. Нужен быстрый shared hook для resolve signed URLs с кешированием, чтобы (1) repeat-resolve не дёргался при reorder задач, (2) HWDrawer + HWTaskCard шарили кеш.

Канонические доки:
1. docs/delivery/features/kb-hw-flow-polish/spec.md (§3, §5 Open Questions closure, AC-3, AC-4)
2. src/lib/kbApi.ts — `getKBImageSignedUrl`, `parseAttachmentUrls`, `serializeAttachmentUrls`, `MAX_TASK_IMAGES`
3. src/components/homework/GuidedHomeworkWorkspace.tsx:346 — канонический паттерн TaskConditionGallery (использует аналогичный студенческий hook)
4. .claude/rules/performance.md — React Query key convention

Задача: создать файл src/hooks/useKBImagesSignedUrls.ts с таким контрактом:

export function useKBImagesSignedUrls(
  refs: string[] | null | undefined,
  options?: { enabled?: boolean }
): {
  urls: Record<string, string>; // keyed by storage ref
  isLoading: boolean;
}

Требования:
- Использовать `useQueries` из @tanstack/react-query.
- Query key per ref: ['kb', 'signed-url', ref]
- staleTime: 55 * 60 * 1000 (55 min; signed URL TTL = 60 min)
- gcTime: 60 * 60 * 1000
- enabled: options?.enabled !== false && !!ref
- queryFn: (ref) => getKBImageSignedUrl(ref) с null-fallback при ошибке
- Refs, являющиеся HTTP/data URLs (regex /^(https?:\/\/|data:)/i), возвращать as-is без запроса — помещать прямо в возвращаемый `urls` объект.
- Null/пустой ввод → { urls: {}, isLoading: false }
- isLoading = true если хотя бы один query в статусе 'pending' И нет resolved URL для него.

Guardrails:
- Не добавлять новый Supabase endpoint. Используем существующий getKBImageSignedUrl.
- Не кешировать в localStorage (signed URL кратковременны и security-sensitive).
- Hook чистый — без Supabase client внутри.

Validation:
- npm run lint && npm run build
- Временно (и потом откатить): в TutorHomeworkCreate page добавить вызов useKBImagesSignedUrls с 1-2 refs, залогировать urls через console.log. Убедиться что signed URL появляется в Network за ~300ms и второй раз после reorder НЕ дёргается (кеш hit).

Mandatory end block: changed files, summary, validation output, docs to update (нет), self-check against .claude/rules/performance.md (React Query key convention соблюдена).
```

### TASK-3 — prompt

```
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Контекст: SokratAI. Уже существует fullscreen carousel для student runtime (GuidedHomeworkWorkspace.tsx:346-515, `TaskConditionGallery`). Теперь нужен такой же в tutor-flow (HWTaskCard). Чтобы не делать третий копипаст — выносим общий presentational компонент. Student side в этом PR НЕ рефакторим.

Канонические доки:
1. docs/delivery/features/kb-hw-flow-polish/spec.md (§3 Open Questions closure, AC-5, AC-6)
2. src/components/homework/GuidedHomeworkWorkspace.tsx:346-515 — референс-реализация
3. .claude/rules/80-cross-browser.md — iOS Safari правила
4. .claude/rules/performance.md

Задача: создать src/components/homework/shared/FullscreenImageCarousel.tsx с контрактом:

interface FullscreenImageCarouselProps {
  images: string[];                    // already resolved HTTP URLs
  openIndex: number | null;            // null = closed
  onClose: () => void;
  onNavigate: (index: number) => void;
  ariaTitle?: string;                  // default: 'Фото'
  ariaDescription?: string;             // default: 'Просмотр изображений во весь экран'
}

Внутри:
- Radix <Dialog> с open={openIndex !== null}.
- DialogContent: max-w-5xl, rounded-xl, p-0, [&>button]:hidden.
- Container с `onTouchStart`/`onTouchEnd` для swipe.
- Close button в углу (X icon), aria-label.
- При >1 image — counter (N/M) и prev/next кнопки (disabled на границах).
- Keyboard: ArrowLeft → prev, ArrowRight → next (addEventListener с cleanup).
- Touch swipe: экспортируемые константы TAP_THRESHOLD_MS=250, SWIPE_THRESHOLD_PX=40. Swipe влево → next, вправо → prev.
- <img src={images[openIndex]}> с loading="lazy", object-contain, max-h 75vh.
- При изменении images.length → если openIndex >= length, закрыть viewer (вызвать onClose).

Guardrails:
- НЕ импортировать homework-specific логику (parseAttachmentUrls, useStudentTaskImagesSignedUrls, etc.). Только presentational.
- НЕ добавлять signed URL resolution внутрь.
- НЕ трогать student TaskConditionGallery (parking lot — отдельный рефакторинг).
- iOS Safari: touch-action: manipulation на кнопках, overflow-hidden на container.

Validation:
- npm run lint && npm run build.

Mandatory end block: changed files, summary (≤3 bullets), validation output, self-check against .claude/rules/80-cross-browser.md.
```

### TASK-4 — prompt

```
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Контекст: SokratAI. HWTaskCard в конструкторе ДЗ сейчас показывает blob preview только для upload'ов текущей сессии. Для KB-фото и edit-mode фото — ImageIcon placeholder. Нужно: (1) ленивый resolve signed URL через shared hook (TASK-2), (2) click-to-zoom fullscreen carousel через shared компонент (TASK-3).

Zavisimosti: TASK-2 (hook), TASK-3 (carousel) завершены.

Канонические доки:
1. docs/delivery/features/kb-hw-flow-polish/spec.md (§5 Technical Design «P0», AC-4, AC-5, AC-6)
2. src/hooks/useKBImagesSignedUrls.ts (новый, из TASK-2)
3. src/components/homework/shared/FullscreenImageCarousel.tsx (новый, из TASK-3)
4. CLAUDE.md — Dual-format invariant для homework images
5. .claude/rules/80-cross-browser.md

Задача (src/components/tutor/homework-create/HWTaskCard.tsx):

1. В HWTaskCard:
   a. Вызвать useKBImagesSignedUrls(taskRefs) + useKBImagesSignedUrls(rubricRefs). Получить resolvedTaskUrls и resolvedRubricUrls (оба Record<ref, url>).
   b. Добавить state: const [zoom, setZoom] = useState<{ gallery: 'task' | 'rubric'; index: number } | null>(null);

2. PhotoThumbnail props — расширить:
   interface PhotoThumbnailProps {
     storageRef: string;
     previewUrl: string | null;      // blob (this-session)
     resolvedUrl?: string | null;     // signed URL (KB/edit-mode)
     index: number;
     onRemove: (index: number) => void;
     onOpenZoom: (index: number) => void;
   }

3. PhotoThumbnail render:
   - Если previewUrl || resolvedUrl → <button onClick={() => onOpenZoom(index)}><img src={previewUrl ?? resolvedUrl}></button>
   - Если нет → ImageIcon placeholder (не clickable).
   - style={{ touchAction: 'manipulation' }} на button. aria-label="Увеличить фото N".
   - Кнопка X (remove) остаётся. e.stopPropagation() в её onClick чтобы не триггерить zoom.

4. PhotoGallery props — расширить: принять resolvedUrls: Record<string, string>, onOpenZoom: (idx: number) => void. Передать в PhotoThumbnail.

5. В HWTaskCard — передать в <PhotoGallery>:
   - resolvedUrls={resolvedTaskUrls} для task gallery
   - resolvedUrls={resolvedRubricUrls} для rubric gallery
   - onOpenZoom={(idx) => setZoom({ gallery: 'task', index: idx })} соответственно
   - Аналогично для rubric внутри RubricField.

6. RubricField props — прокинуть resolvedRubricUrls, onOpenZoom.

7. В конце HWTaskCard — рендер <FullscreenImageCarousel> с images = zoom?.gallery === 'task' ? taskRefs.map(r => resolvedTaskUrls[r] ?? previewUrls[r]).filter(Boolean) : ... Возможно через useMemo.
   - openIndex={zoom?.index ?? null}
   - onClose={() => setZoom(null)}
   - onNavigate={(i) => setZoom({ ...zoom, index: i })}

Guardrails:
- НЕ менять DraftTask shape (это TASK-8).
- НЕ трогать upload flow (addTaskPhotos, addRubricPhotos, removePhoto, handleTaskTextPaste).
- previewUrls (blob) имеет приоритет над resolvedUrl — иначе после upload будет ремерцание (blob → signed).
- iOS: position: sticky не используется. Radix portal для Dialog — не должен конфликтовать с parent <Sheet>.

Acceptance Criteria:
- AC-4: после импорта KB-задачи с фото — превью видно (не placeholder). В edit-mode — тоже.
- AC-5: клик по thumbnail → fullscreen. ArrowLeft/Right, touch swipe, counter, X, backdrop — все работают.
- AC-6: rubric фото — тот же fullscreen.

Validation:
- npm run lint && npm run build
- Ручная (Chrome): новое ДЗ → «Добавить из базы» → KB-задача с фото → в HWTaskCard видно превью. Клик → fullscreen. Arrow keys навигация. X закрывает.
- Ручная (Safari iOS): touch swipe в fullscreen, tap по thumbnail не скроллит body.

Mandatory end block.
```

### TASK-5 — prompt

```
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Контекст: HWDrawer (правый Sheet «Домашнее задание» в КБ) сейчас w-[420px] с крохотным ImageIcon placeholder вместо фото. Конкурирующий UX — KBPickerSheet на /tutor/homework/create, w-[75vw], с полноразмерными превью. Нужно унифицировать: тот же w-[75vw] и паттерн превью PickerTaskCard.

Зависимости: TASK-2 (hook useKBImagesSignedUrls) готов.

Канонические доки:
1. docs/delivery/features/kb-hw-flow-polish/spec.md (§5 Technical Design P0-2, AC-3)
2. src/components/tutor/KBPickerSheet.tsx:43-160 — референс PickerTaskCard
3. src/hooks/useKBImagesSignedUrls.ts (из TASK-2)
4. src/lib/kbApi.ts — parseAttachmentUrls

Задача (src/components/kb/HWDrawer.tsx):

1. SheetContent className — заменить:
   `w-[420px] max-w-[90vw] ... sm:max-w-[420px]`
   на:
   `w-[75vw] !max-w-none ... sm:max-w-none`
   (оставить bg-socrat-surface, p-0, flex, flex-col, gap-0)

2. Карточка задачи — перестроить (в map tasks):
   a. Сохранить number badge (index+1) слева, action icons справа.
   b. Контент: SourceBadge + subtopic + изменено-badge как раньше.
   c. MathText условия: заменить line-clamp-2 на line-clamp-3.
   d. Добавить ниже MathText блок с фото:
      - firstRef = parseAttachmentUrls(task.attachmentSnapshot)[0]
      - useKBImagesSignedUrls([firstRef].filter(Boolean)) (локальный вызов в map или helper-child compon)
      - Если firstRef && signed URL есть → <img className="w-full rounded-xl border border-gray-200 bg-gray-50 object-contain max-h-48" loading="lazy" src={url} alt="Вложение к задаче">
      - Если firstRef && isLoading → skeleton h-24
      - Если > 1 фото (parseAttachmentUrls.length > 1) → overlay badge «+{N-1} фото» в углу.
   e. Inline edit-режим (editingId === task.taskId) — оставить как есть, без фото.

3. Footer и кнопки «Добавить из Базы знаний» / «Создать черновик ДЗ» — без изменений.

Guardrails:
- НЕ менять handleSendHomework (логика создания ДЗ в БД).
- НЕ менять hwDraftStore shape или логику reorderTasks/updateSnapshot.
- НЕ добавлять fullscreen carousel в drawer (out of scope).
- Mobile: w-[75vw] даёт 75% viewport; Radix автоматически respect max-width: 100vw. Проверить на 375px.
- Каждый вызов useKBImagesSignedUrls — в отдельном child component или через батч (все refs из всех карточек сразу). Рекомендую отдельный child `<DraftTaskRow task={task} ... />` чтобы каждая карточка — свой hook-scope.

Acceptance Criteria:
- AC-3: drawer ~75% ширины viewport; превью фото видны в каждой карточке (не placeholder).

Validation:
- npm run lint && npm run build.
- Ручная: добавить 3 KB-задачи с фото → открыть drawer → 3 превью видны.
- Ручная: edit-mode (клик Pencil) → textarea + input работают.
- Ручная (Safari iOS 375px): header+footer видны, content скроллится.

Mandatory end block + self-check против .claude/rules/90-design-system.md (Sheet ширина, avoid emoji, Lucide icons).
```

### TASK-7 — prompt

```
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Контекст: backend GET /assignments/:id в supabase/functions/homework-api/index.ts (tutor-facing) возвращает tasks с полями task_text, task_image_url, correct_answer, rubric_text, rubric_image_urls, etc. Не хватает provenance-полей из KB: solution, solution_attachment_url, source_label. Эти поля доступны через homework_kb_tasks + kb_tasks, но сейчас не джойнятся.

Канонические доки:
1. docs/delivery/features/kb-hw-flow-polish/spec.md (§5 API, TASK-7, AC-7, AC-8)
2. CLAUDE.md — Profiles table нет колонки email (аналогичная дисциплина: не добавлять поля, которых нет)
3. supabase/functions/_shared/attachment-refs.ts — parseAttachmentUrls
4. .claude/rules/40-homework-system.md — task_id как canonical identity

Задача (supabase/functions/homework-api/index.ts):

1. Найти handler для GET /assignments/:id (handleGetAssignment или аналог). Для каждой task в response добавить optional поля:
   - kb_snapshot_solution: string | null — из homework_kb_tasks.task_solution_snapshot (matched by homework_id + task_id на KB)
   - kb_snapshot_solution_image_refs: string | null (dual-format ref) — из kb_tasks.solution_attachment_url (LEFT JOIN)
   - kb_source_label: string | null — из kb_tasks.source_label (LEFT JOIN)

2. Требования к реализации:
   - ОДИН запрос на все KB-поля (не N запросов per task). Собрать kb_task_ids из tasks, сделать один SELECT из homework_kb_tasks JOIN kb_tasks.
   - LEFT JOIN: если kb_task_id удалён из kb_tasks → kb_snapshot_solution_image_refs и kb_source_label = null. kb_snapshot_solution — из homework_kb_tasks (snapshot, всегда сохранён).
   - Mapping: task_id в homework_tutor_tasks не равен kb_task_id. Linkage: homework_kb_tasks.task_id = kb_tasks.id. homework_kb_tasks сопоставляется с homework_tutor_tasks через homework_id + sort_order (см. существующий паттерн в codebase — grep homework_kb_tasks).

3. НЕ добавлять эти поля ни в один student-facing handler:
   - handleGetStudentAssignment (если есть)
   - handleCheckAnswer (ответ)
   - handleRequestHint (ответ)
   - handlePostThreadMessage (ответ)

Guardrails:
- Additive: не менять существующие поля response.
- Null-safe для каждого нового поля.
- RLS: kb_tasks JOIN должен работать для всех tutor-ов (moderators и не). homework_kb_tasks RLS — проверить, но обычно tutor_id check.
- НЕ читать kb_snapshot_solution в evaluateStudentAnswer / generateHint — AI grading context остаётся как есть.

Acceptance Criteria (backend):
- AC-7 (prep): GET /assignments/:id с tutor JWT возвращает новые поля.
- AC-8 (prep): то же самое, с null-fallback для задач без KB provenance.

Validation:
- npm run lint && npm run build
- Deploy edge function (или local): curl GET /assignments/:id с tutor JWT → JSON содержит новые поля.
- curl GET для student endpoint → новых полей НЕТ.

Mandatory end block + self-check против CLAUDE.md «Критическая архитектура» (student/tutor isolation).
```

### TASK-8 — prompt

```
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Контекст: после TASK-7 backend возвращает kb_snapshot_solution / kb_snapshot_solution_image_refs / kb_source_label в ответе GET /assignments/:id. Нужно прокинуть эти поля через DraftTask type + два конвертера (KB-picker и edit-mode).

Зависимости: TASK-7.

Канонические доки:
1. docs/delivery/features/kb-hw-flow-polish/spec.md (§5 Technical Design)
2. src/components/tutor/homework-create/types.ts — DraftTask
3. src/components/tutor/homework-create/HWTasksSection.tsx — kbTaskToDraftTask
4. src/pages/tutor/TutorHomeworkCreate.tsx — convertAssignmentToDraftTasks (найти grep'ом)

Задача:

1. src/components/tutor/homework-create/types.ts — расширить DraftTask (optional fields):
   ```
   kb_snapshot_solution_image_refs?: string | null; // dual-format attachment ref
   kb_source_label?: string | null;
   ```
   В createEmptyTask() не задавать (undefined по умолчанию).

2. src/components/tutor/homework-create/HWTasksSection.tsx — в kbTaskToDraftTask() добавить в returned draft:
   ```
   kb_snapshot_solution_image_refs: task.solution_attachment_url ?? null,
   kb_source_label: task.source_label ?? null,
   ```
   (task: KBTask уже содержит оба поля — см. src/types/kb.ts)

3. src/pages/tutor/TutorHomeworkCreate.tsx — в convertAssignmentToDraftTasks (или как оно называется — grep по «kb_snapshot_solution» в файле чтобы найти existing provenance mapping):
   - Считать из backend response поля kb_snapshot_solution, kb_snapshot_solution_image_refs, kb_source_label.
   - Положить в DraftTask (kb_snapshot_solution уже может обрабатываться — только добавить два новых).

Guardrails:
- Не менять save-path (submit homework). Новые поля — UI-only projection, не пишутся в homework_tutor_tasks.
- Backward compat: старые ДЗ без этих полей в БД → null → пустые slot'ы в UI (TASK-9).
- Не менять существующие kb_snapshot_text / kb_snapshot_answer / kb_snapshot_solution логику.

Validation:
- npm run lint && npm run build
- Ручная: React DevTools → открыть ДЗ в edit-mode → первая task имеет props kb_snapshot_solution (если задача из KB) и новые поля.

Mandatory end block.
```

### TASK-9 — prompt

```
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Контекст: после TASK-8 DraftTask содержит kb_snapshot_solution (text), kb_snapshot_solution_image_refs (refs), kb_source_label (string | null). Нужно отобразить их в HWTaskCard: (а) source_label — мелким серым текстом в шапке рядом с SourceBadge; (б) эталонное решение (text + фото) — read-only блок внутри collapsible «Критерии проверки». Оба — tutor-only.

Зависимости: TASK-2 (useKBImagesSignedUrls), TASK-3 (FullscreenImageCarousel), TASK-8 (DraftTask fields).

Канонические доки:
1. docs/delivery/features/kb-hw-flow-polish/spec.md (§5 «P1», AC-7, AC-8)
2. src/components/kb/TaskCard.tsx:353-398 — референс-визуал секции «Решение»
3. CLAUDE.md «Dual-format invariant»

Задача (src/components/tutor/homework-create/HWTaskCard.tsx):

1. В шапке (в том же ряду, где <SourceBadge>):
   {task.kb_source_label && (
     <span className="text-xs text-muted-foreground truncate max-w-[240px]" title={task.kb_source_label}>
       {task.kb_source_label}
     </span>
   )}

2. В RubricField:
   а. Parse: const solutionImageRefs = parseAttachmentUrls(task.kb_snapshot_solution_image_refs);
   b. Если task.kb_snapshot_solution || solutionImageRefs.length > 0 — рендерить в конце collapsible (после существующих rubric textarea и фото):

   <div className="rounded-xl bg-socrat-surface px-3.5 py-3">
     <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.12em] text-slate-500">
       Эталонное решение (из БЗ)
     </div>
     {task.kb_snapshot_solution && (
       <MathText text={task.kb_snapshot_solution} className="text-sm leading-relaxed text-slate-700 whitespace-pre-wrap" />
     )}
     {solutionImageRefs.length > 0 && (
       <ReferenceSolutionPhotos refs={solutionImageRefs} className="mt-2" />
     )}
   </div>

3. ReferenceSolutionPhotos (новый child-компонент в том же файле, memo):
   - Props: { refs: string[]; className?: string }
   - const { urls } = useKBImagesSignedUrls(refs)
   - state [zoomIndex, setZoomIndex] = useState<number | null>(null)
   - Render ряд thumbnails (flex gap-2 flex-wrap touch-pan-x) — каждый <button onClick={() => setZoomIndex(i)}><img src={urls[ref]}></button>
   - Ниже: <FullscreenImageCarousel images={refs.map(r => urls[r] ?? '').filter(Boolean)} openIndex={zoomIndex} onClose={() => setZoomIndex(null)} onNavigate={setZoomIndex} ariaTitle="Эталонное решение (из БЗ)" />
   - Нет кнопки X удаления, нет кнопки + добавления.

Guardrails:
- НЕ передавать kb_snapshot_solution в AI. Проверить (grep): ни evaluateStudentAnswer, ни generateHint, ни streamChat build prompts не читают это поле.
- НЕ добавлять кнопку «Скопировать в критерии» — parking lot.
- MathText использует preprocessLatex → XSS-safe.
- Collapsible RubricField по умолчанию свернут — user click раскрывает.

Acceptance Criteria:
- AC-7: блок «Эталонное решение» отображается read-only если есть данные; НЕ в ответе getStudentAssignment.
- AC-8: kb_source_label отображается в шапке tutor-only; если null — slot не рендерится.

Validation:
- npm run lint && npm run build
- Ручная: создать ДЗ из KB-задачи с solution + source_label → оба видны.
- Ручная: задача без solution → блок не рендерится (нет пустого заголовка).
- Grep: `kb_snapshot_solution` в src/lib/studentHomeworkApi.ts, src/pages/student/, src/components/homework/ → 0 matches.

Mandatory end block + self-check: student isolation не нарушена.
```

### TASK-10 — prompt

```
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Контекст: HWDrawer (drag-корзина КБ) сейчас не знает про source_label. Нужно прокинуть через hwDraftStore и отобразить tutor-only badge в шапке карточки drawer.

Канонические доки:
1. docs/delivery/features/kb-hw-flow-polish/spec.md (§5 TASK-10, AC-8)
2. src/stores/hwDraftStore.ts — HWDraftTask shape + addTask
3. src/types/kb.ts — HWDraftTask interface
4. src/components/kb/HWDrawer.tsx — карточка

Задача:

1. src/types/kb.ts — HWDraftTask, добавить optional поле:
   sourceLabel?: string | null;

2. src/stores/hwDraftStore.ts — addTask() функция, расширить создание draftTask:
   sourceLabel: task.source_label ?? null,

3. src/components/kb/HWDrawer.tsx — в шапке карточки (где SourceBadge + subtopic):
   {task.sourceLabel && (
     <span className="text-[10px] text-slate-400 truncate max-w-[180px]" title={task.sourceLabel}>
       {task.sourceLabel}
     </span>
   )}

4. Persist migration: Zustand persist автоматически backward-compat через optional field. Existing drafts в localStorage без sourceLabel → undefined → not rendered.

Guardrails:
- НЕ менять handleSendHomework (логика DB-save).
- НЕ пытаться «восстановить» sourceLabel для existing drafts — это ТОЛЬКО UI-проекция, отсутствие не ошибка.
- НЕ добавлять sourceLabel в homework_kb_tasks или homework_tutor_tasks.

Validation:
- npm run lint && npm run build
- Ручная: localStorage с existing корзиной (без sourceLabel) → drawer открывается без ошибок, задачи видны.
- Ручная: добавить новую KB-задачу с source_label → в drawer виден под условием.

Mandatory end block.
```

### TASK-11 — prompt

```
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Контекст: meta.disable_ai_bootstrap дефолт для нового ДЗ — true (AI bootstrap OFF). Но в edit-mode и при применении шаблона — fallback `?? false` → legacy ДЗ получают AI-intro ON, что противоречит решению владельца продукта. Нужно привести дефолт к единому true везде.

Канонические доки:
1. docs/delivery/features/kb-hw-flow-polish/spec.md (§5 TASK-11, AC-9, AC-10)
2. src/pages/tutor/TutorHomeworkCreate.tsx — grep `disable_ai_bootstrap`

Задача (src/pages/tutor/TutorHomeworkCreate.tsx):

1. Найти строки с `disable_ai_bootstrap ?? false` — ожидаются 2:
   - edit-mode load (convertAssignmentToDraftTasks или аналог)
   - template-apply handler
2. Заменить оба на `disable_ai_bootstrap ?? true`.
3. НЕ трогать:
   - L91 (new HW default) — уже true.
   - L810 (reset state) — уже true.
   - Submit path (L486, L712) — там meta.disable_ai_bootstrap берётся из state напрямую (`??` не используется для defaulting, это явный user toggle).

Guardrails:
- Это меняет поведение для legacy ДЗ с null в БД — они получат OFF-toggle в edit. Принято (см. spec §8 Risks).
- Ученики, уже начавшие ДЗ с null — bootstrap уже сохранён в homework_tutor_thread_messages, эти сообщения остаются. Новых bootstrap-ов на новые задачи не будет.

Acceptance Criteria:
- AC-9: открыть legacy ДЗ → toggle OFF.
- AC-10: новое ДЗ / applied template → toggle OFF.

Validation:
- npm run lint && npm run build
- Ручная: открыть ДЗ, созданное до фичи (`SELECT disable_ai_bootstrap FROM homework_tutor_assignments WHERE ...` — ищем null) → раскрыть «Расширенные параметры» → toggle = OFF.
- Ручная: новое ДЗ → toggle = OFF.
- Ручная: применить template → toggle = OFF.

Mandatory end block.
```

### TASK-12 — prompt (QA-only, mostly manual)

```
Твоя роль: senior QA engineer в проекте SokratAI.

Контекст: финальная проверка P1 релиза перед merge. Critical invariant — student runtime НЕ должен видеть kb_snapshot_solution / kb_source_label / kb_snapshot_solution_image_refs.

Канонические доки:
1. docs/delivery/features/kb-hw-flow-polish/spec.md (§7 Validation, AC-7..AC-10)
2. CLAUDE.md — Critical Architecture Rules (student/tutor isolation)

Автоматизированные проверки:
1. npm run lint && npm run build && npm run smoke-check
2. Grep (должно быть 0 matches для каждой строки в каждом файле ниже):
   - `kb_snapshot_solution` / `kb_source_label` / `kb_snapshot_solution_image_refs` В:
     - src/lib/studentHomeworkApi.ts
     - src/components/homework/**
     - src/pages/student/** (если существует)
   - В supabase/functions/homework-api/index.ts — эти поля не должны попадать в:
     - handleGetStudentAssignment (если есть)
     - handleCheckAnswer response
     - handleRequestHint response
     - handlePostThreadMessage response
     - evaluateStudentAnswer / generateHint (AI grading prompts)

Manual checklist:
[ ] Tutor создаёт ДЗ из KB с solution + source_label → оба отображаются в нужных местах
[ ] Tutor открывает legacy ДЗ → AI-bootstrap toggle OFF
[ ] KB-задача без source_label → slot не рендерится (нет пустого текста)
[ ] KB-задача с solution но без фото решения → текст есть, carousel не рендерится
[ ] Student открывает ДЗ на /student/homework/:id → Network response не содержит kb_snapshot_*
[ ] Student запрашивает hint → AI-промпт в Supabase logs (select * from function_logs where ...) НЕ содержит эталонного решения
[ ] Student runtime UI не показывает никакой новый источник / решение

Report format:
- PASS / CONDITIONAL PASS / FAIL
- Для каждого checklist item: ✅ / ❌ + note
- Grep results summary

Mandatory end block с P1 release go/no-go рекомендацией.
```

---

## Out-of-scope reminders

Не делать в этом релизе даже если соблазнительно:
- Рефакторинг student `TaskConditionGallery` на shared `FullscreenImageCarousel` (parking lot)
- Передача `kb_snapshot_solution` в AI grading context (parking lot, отдельная SPEC)
- Показ эталонного решения ученику после сдачи (parking lot, отдельная SPEC)
- Кнопка «Скопировать решение в критерии» в RubricField (parking lot)
- Drag-and-drop reorder в HWDrawer
- Batch signed-URL endpoint для KB-attachments
- Server-side drafts cart (замена localStorage persist)
