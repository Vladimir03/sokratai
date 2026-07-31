# Homework System — инварианты (всегда в контексте)

Здесь ТОЛЬКО то, что можно нарушить ПЕРВОЙ же правкой, не успев подумать.
**Глубина — skill `homework-system`** (специфика грейдинга по предметам/критериям, CEFR, физика Часть 2, голос, экран задачи ученика, шаблоны и Банк ДЗ, папки, share-ссылки, «требует проверки», история фич). Работаешь с ДЗ глубже одной правки — загрузи его.

## Одна система ДЗ

Система ДЗ **одна** — tutor-connected (`homework_tutor_*`), работает через **guided chat** (пошаговый AI-чат). Удалённые подсистемы **не возрождать**: legacy student-only (`homework_sets`/`homework_tasks`, дроп `20260310110000`), classic mode с OCR-фото (`workflow_mode`, `homework_tutor_submissions`, дроп `20260406120000`). Система попыток (attempts) удалена — ученик пересдаёт без ограничений.

Таблицы: `homework_tutor_assignments` (задания) · `homework_tutor_tasks` (задачи) · `homework_tutor_threads` + `homework_tutor_thread_messages` (guided chat) · `homework_tutor_task_states` (прогресс) · `homework_tutor_templates` · `homework_tutor_materials` · `homework_folders` · `homework_share_links`.

`src/types/homework.ts` содержит legacy-типы `HomeworkSet`/`HomeworkTask` (для конфига SUBJECTS) — **не путать** с активной системой.

## Двойной write-path в `homework_tutor_tasks` — КРИТИЧНО

**ДВА независимых места** инсертят строки. При новой колонке / новом поле в AI-промпте / любом cross-cutting изменении — править **ОБА**, иначе фича молча ломается через один flow.

| Путь | Entry point | Кто пишет |
|---|---|---|
| **A — через edge** | «+ из БЗ» в конструкторе (`TutorHomeworkCreate.tsx` → `KBPickerSheet` → `HWTasksSection`) | `POST /assignments` → `homework-api/index.ts::handleCreateAssignment` / `handleUpdateAssignment` |
| **B — напрямую из клиента** | «В ДЗ» на карточке БЗ (`kb/TaskCard.tsx`) → `hwDraftStore` (Zustand, persisted) → корзина `HWDrawer` | **Прямой** `.insert()` в `HWDrawer.tsx` |

Типы-носители (правь ВСЕ): path A — `DraftTask` (`tutor/homework-create/types.ts`) + `CreateAssignmentTask`/`UpdateAssignmentTask` (`lib/tutorHomeworkApi.ts`) + `kbTaskToDraftTask`; path B — `HWDraftTask` (`types/kb.ts`) + `hwDraftStore.addTask` + прямой INSERT.

**Симптом пропуска:** fix работает в конструкторе, но ДЗ из «В ДЗ» — с NULL в новой колонке.

**Перед мержем:** `grep -rn "from('homework_tutor_tasks')\.insert\|\.update" src/ supabase/` — все 5 write-site (backend create + 3 update-ветки + HWDrawer) пишут новое поле. Плюс: `handleGetStudentAssignment` НЕ селектит поля, которые обязаны остаться tutor-only.

**`task_kind` ↔ `check_format`:** любой write, трогающий `check_format`, ОБЯЗАН писать и `task_kind` (`deriveTaskKind` / `deriveTaskKindFromCheckFormat`). Иначе DB DEFAULT `'extended'` делает все «краткие ответы» развёрнутыми. `task_kind='speaking'` НЕ выводится из `check_format` — только явный выбор через `resolveWriteTaskKind` (грепни: speaking-сайтов 4).

## Структурные тесты (`options_json`) — инварианты

Варианты живут в `options_json` (**student-safe**, GRANT `20260727130000`); верный ответ — ТОЛЬКО в `correct_answer` (tutor-only) в формате чекеров пробников: single `"3"`, multi `"1267"`, matching `"35142"`. **Глубина — skill `homework-system`**, спека — `docs/delivery/features/homework-choice-tasks/spec.md`.

- **Любой write проходит `normalizeOptionsJson`** (`_shared/task-options.ts` + браузерное зеркало `src/lib/taskOptions.ts`, parity — smoke §24). Он же вшит в `kb_snapshot.ts`: авто-зеркало ДЗ→База и push-to-kb получают СЫРОЙ payload клиента, и без него `correct: true` из импорт-скрипта уезжает в `kb_tasks`.
- **`options_json` — часть dual write-path И push-to-kb.** `homeworkTaskFieldsToKbUpdate` пишет колонку **безусловно** ⇒ поле, отсутствующее в SELECT или в `PUSH_TO_KB_DRAFT_FIELDS`, **ЗАТИРАЕТ** варианты у задачи-источника Базы, а форк каталожной задачи теряет их в копии (ревью 5.6).
- **Балл считает КОД** (`gradeStructuredChoice` → чекеры Части 1 пробников), `deterministic_score=true`; AI только объясняет через `precomputedVerdict`. **Любой новый выход из `evaluateStudentAnswer` обязан либо пройти `mergeStructuredResult`, либо вернуть `buildStructuredResult`** — иначе балл теряется (так теряли его ветка «картинка условия не загрузилась» и путь физ-блок-схемы). Сбой AI / исчерпанная квота → canned-фидбэк, НЕ 429 и не CHECK_FAILED.
- **Anti-leak объяснения — детерминированный, а не промптом:** `feedbackLeaksCorrectChoice` на не-CORRECT вердиктах (ключ отдельным токеном + дословная цитата варианта) → canned + событие `guided_check_structured_answer_leak_scrubbed`. `sanitizeFeedback` тут НЕ работает: он игнорирует эталоны короче 2 символов, т.е. любой single_choice.
- **Оцениваемый ключ — РОВНО один буквенно-цифровой символ** (чекеры посимвольные: «10» не совпадёт никогда → молчаливый ноль при верном выборе). Нормализация **fail-closed**: битый вариант / дубль / перебор капа отвергают весь `options_json` (→ текстовый ввод), а не режут список.

## Anti-leak — три слоя, не один

1. **Edge column-whitelist.** Никакого `select("*")` на `homework_tutor_tasks`/`_assignments`. `solution_text`, `solution_image_urls`, `rubric_*`, `ai_reference_solution`, `grading_criteria_json`, `ai_score_comment`, `correct_answer`, `ocr_text`, `student_opened_at`, `tutor_*_by` — tutor-only.
2. **Column-GRANT** (миграции `20260630170000` для tasks, `20260516120100` для task_states) — **единственная защита от ПРЯМОГО PostgREST**. RLS фильтрует строки, не колонки: без GRANT-whitelist ученик читал бы `solution_text` из консоли. **Новая tutor-only колонка → НЕ гранить `authenticated`; новая student-safe → добавить в GRANT явной миграцией.** `*`-select для authenticated заблокирован навсегда.
3. **Compile-time.** `StudentHomeworkTask` (`types/homework.ts`, `studentHomeworkApi.ts`) не содержит этих полей.

**Image-only гейт:** если `solution_text.trim().length < 20` — `solution_image_urls` ДРОПАЮТСЯ на всех 3 AI-путях (leak-детектор работает по тексту; image-only эталон извлекается через «transcribe image» jailbreak).

Контраст с пробниками: там reveal **state-aware** (rule 45). Здесь — tutor-only **навсегда**.

## Шаги баллов — два разных поля, НЕ путать

| Поле | Шаг | Валидатор | DB |
|---|---|---|---|
| `homework_tutor_tasks.max_score` | **0.5** | `isPositiveHalfStepNumber` | `numeric(6,1)` |
| `task_states.tutor_score_override` + `ai_score` | **0.1** | `isPositiveTenthStep`-паттерн | `numeric(5,2)` |

6 callsite `max_score` в `homework-api/index.ts` — ВСЕ `isPositiveHalfStepNumber`. **НЕ возвращать к `isPositiveInt`**: дробные 12.5 молча коллапсятся в 1 через `? t.max_score : 1`, а валидатор пропустит запрос (валидируется ДРУГОЕ поле). Грепни `isPositive(Int|HalfStepNumber)\((t|task)\.max_score`.

## Все 3 AI-пути правятся вместе

Check / hint / chat (`guided_ai.ts::buildCheckPrompt`, `buildHintPrompt`, `chat/index.ts::processAIRequest`). Новый prompt-builder ОБЯЗАН принимать `subject`; иначе ученик на French ДЗ получает «физическую величину». Chat-путь **server-side подтверждает** subject/exam_type/cefr/rubric из БД — client-supplied значение проигрывает (anti-tamper).

**`learning_goal` НЕ едет в грейдинг-промпты** (`includeGoal:false`): поле student-writable = канал prompt-injection прямо в оценку. Инвариант: новый промпт, который СТАВИТ балл/вердикт → `includeGoal:false`.

**Квота:** любой новый homework AI-путь → `checkAiQuota(userId, db, {context:'homework', incrementUsage:true})` ДО вызова (rule 99). Токены → `onUsage` + `source` в `TokenUsageSource`.

**Детерминированный грейдинг** (физика Часть 2): балл считает КОД (`walkPhysicsFlowchart`), не модель; результат помечается `deterministic_score=true`, иначе confidence-гард понижает верный балл.

## Картинки в AI — резолвить, иначе галлюцинация

`task_image_url` в БД = `storage://...` — внутренняя ссылка, AI её не откроет. Перед передачей: `storage://` → signed URL → при необходимости inline `data:image/...;base64`. **НИКОГДА** не вставлять `storage://` как текст.

Новый bucket в KB/homework write-path → в `_shared/image-domains.ts::HOMEWORK_AI_BUCKETS` + `npm run smoke-check` + редеплой `chat` и `homework-api`. Иначе AI получает «[Задача на фото]» и **галлюцинирует**.

**Компрессия обязательна на КАЖДОМ клиентском upload фото для AI** (`compressForUpload`, клиентский кап ≤ серверного `MAX_IMAGE_BYTES`). Если картинка обязательна, а не резолвится — **fail-closed**, не молчаливый плейсхолдер.

**HEIC (2026-07-30, баг Ирины):** Gemini его не декодирует — `inlinePromptImageUrl` скипает HEIC (mime + magic bytes, лог `unsupported_heic`); фото решения ученика не заинлайнились → `student_images_missing` CHECK_FAILED, НЕ слепая оценка (структурные тесты не задеты — балл кодом). Клиент конвертирует HEIC→JPEG в `compressForUpload`, legacy `.heic` вьюеры конвертируют через `useHeicImage` (rule 80).

Dual-format: `task_image_url` / `rubric_image_urls` / `solution_image_urls` = single `storage://` ИЛИ JSON-array → только через `parseAttachmentUrls` / `serializeAttachmentUrls`.

## Task identity

`task_id` (UUID FK) — единственный immutable identity для сообщений, AI-контекста и state. `task_order` — display/sort, меняется при reorder. Все новые message-insert'ы ОБЯЗАНЫ включать `task_id`; фильтры — по `task_id` (fallback на `task_order` только для pre-migration строк). Номер задачи в UI — resolve через `task_id → tasks[].order_num`, НЕ stored `message.task_order`.

⚠️ **В `homework_tutor_task_states` НЕТ колонки `task_order`.** Добавление её в `THREAD_SELECT` → PostgREST 500 на любой запрос треда → залипшая загрузка и пустой чат.

## Единый write-path транзакционных действий

Force-complete / bulk-close / review — через SECURITY DEFINER RPC (`hw_tutor_force_complete_task`, `hw_tutor_force_complete_all_tasks`, `hw_tutor_review_task`, `hw_tutor_review_all_ai`, `hw_tutor_reopen_review`), не multi-query. Race-guard обязателен (двойной клик → 409, не двойная запись). Bulk-счётчик на фронте = `WHERE` в RPC. Новое транзакционное действие → своя RPC, multi-query НЕ воспроизводить.

Финальный балл — `computeFinalScore` (`_shared/score-compute.ts`), приоритет `tutor_score_override → earned_score → ai_score → status`. Не дублировать формулу.

## Конструктор ДЗ — QA-гейт (rule-10 high-risk зона)

Конструктор — **хроническая зона регрессий**. Коммит, трогающий `TutorHomeworkCreate.tsx` или `tutor/homework-create/{HWTasksSection,HWTaskCard,HWMaterialsSection}.tsx`, **ОБЯЗАН** содержать явное подтверждение: `Manual QA: checklist в skill homework-system пройден`. Полный чеклист (9 пунктов) — в skill.

Два P0 из чеклиста, которые ломались чаще всего:
- **Tab-switch preservation.** Уйти на другую вкладку на 31+ сек → вернуться → задачи на месте. Два независимых механизма потери: focus-refetch в конструкторе (гард — smoke-check §8: любой `useQuery` в write-form странице ОБЯЗАН иметь `refetchOnWindowFocus: false`) и размонтирование кабинета `TutorGuard`'ом (rule 96 §5a).
- **Готовность кнопки сохранения** в edit-режиме: `editInitialSnapshot` ставится reset-эффектом, объявленным **РАНЬШЕ** prefill-эффекта; обратный порядок → «Подготавливаем…» навсегда.

Дефолты create-режима читаются **СИНХРОННО** из кэша react-query в lazy-init — никаких новых `useQuery` и никаких эффектов-клобберов.

## Фото: просмотр, поворот, разметка (2026-07-31)

**Глубина — skill `homework-system`.** Здесь только первично-нарушаемое.

- **Просмотрщик фото ОДИН — `@/components/common/photo-viewer`.** Своих лайтбоксов и `<a target="_blank">` на картинке больше не заводить: до унификации их было 4 копии + 6 мест «увеличить = сырая вкладка», и HEIC-восстановление жило на 2 поверхностях из ~15. Новая поверхность с фото → `PhotoViewer` / `PhotoThumbButton` / `OrientedPhoto`, сырой `<img>` — только через `SafeImage` (rule 40 image-fallback).
- **Угол поворота — в `photo_orientations` по storage-ref, файл ученика НИКОГДА не перезаписывается.** Пишет только репетитор (RPC `photo_orientations_set`, гейт `is_tutor`), читают все. Гард бакетов — **DENYLIST** (запрещён общий `kb-attachments`), а не allowlist: у allowlist плохая асимметрия отказа — забыл бакет, и фича МОЛЧА мертва на новой поверхности (так и вышло 31.07: выдуманные имена бакетов заблокировали поворот и на условии, и на решении ученика). **Имена бакетов НЕ писать по памяти — грепать `HOMEWORK_AI_BUCKETS` и `*_BUCKET =` в `src/lib`.**
- ⚠️ **Позиционно сопоставлять `refs[i]` с `urls[i]` НЕЛЬЗЯ.** `createSignedStorageUrls` ВЫКИДЫВАЕТ неподписавшиеся файлы, массив URL становится короче — и поворот второго фото уезжает в ref первого. Только `resolveRefsForUrls` (принимает позиционные ref лишь при совпадении длин, иначе восстанавливает ref из самой ссылки).
- **Координаты разметки — пиксели НЕповёрнутого фото.** Тогда поворот после разметки не сдвигает пометки. Поворот запекается в пиксели РОВНО в одном месте — `renderAnnotatedPhoto`.
- **Размеченное фото уходит СУЩЕСТВУЮЩИМ путём** (`uploadTutorHomeworkTaskImage` → `postTutorThreadMessage`). Своего write-path у разметки нет.
- ⚠️ **`message_kind` из запроса проходит через серверный allowlist** (`resolveTutorMessageKind`), и любое новое значение ОБЯЗАНО ехать вместе с CHECK-миграцией на `homework_tutor_thread_messages` — иначе вставка падает 23514. Скрытая заметка остаётся `tutor_note` при любом запрошенном типе.

## Ключевые файлы

`src/lib/studentHomeworkApi.ts` · `src/lib/tutorHomeworkApi.ts` · `src/hooks/useStudentHomework.ts` · `src/components/homework/*` · `src/components/tutor/GuidedThreadViewer.tsx` · `src/pages/student/HomeworkProblem.tsx` · `supabase/functions/homework-api/` (+ `guided_ai.ts`, `kb_snapshot.ts`) · `supabase/functions/_shared/subject-rubrics/`.
