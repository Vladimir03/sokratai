# Spec: AI-загрузка задач — Phase P1 (extract-at-scale)

> **Назначение этого документа:** техническая спека для реализации Phase P1 фичи «AI-загрузка задач» (KB-модуль, tutor-домен). Передаётся отдельному агенту (Claude Code) для разработки; ревью — ChatGPT-5.5 (промпт в §7). Стиль и инварианты — как в P0 (`spec.md`, `prompts.md`, `kb-ai-task-loader-tasks.md` в этой папке; канон — `.claude/rules/50-kb-module.md` «AI-загрузка задач»).
>
> **P0 уже в проде** (extract-only edge `kb-ai-extract` + UI-загрузчик «Моей базы» + commit через `insertTask`). P1 расширяет это: вырезание рисунков, PDF-сборники, пакетный режим, критерии/№КИМ, вход в конструктор ДЗ, своя квота.
>
> **Перед реализацией прочитай:** `AGENTS.md`, `.claude/rules/00-read-first.md`, `.claude/rules/50-kb-module.md` (секция «AI-загрузка задач — kb-ai-extract» — канон P0), `spec.md` + `prompts.md` этой папки.

---

## 0. Job Context (обязательно, rule 30)

| Участник | Core Job | Sub-job |
|---|---|---|
| Репетитор (B2B) | R: «Подготовить материалы к занятиям и ДЗ» | Наполнить структурированную базу задач за один вечер (сотни задач из сборников/PDF), без ручной перепечатки |

Wedge: «боль пустой базы» — главный барьер онбординга. P0 убрал ручную перепечатку одной задачи (~2–4 мин → <30 сек). **P1 убирает барьер ОБЪЁМА** (PDF-сборник целиком, пакет 20+ задач) — это **самый частый запрос репетиторов**. Богатая база → быстрая сборка ДЗ/пробников → retention.

---

## 1. Locked decisions (владелец, через AskUserQuestion)

1. **Вырезание рисунка — полу-авто:** Gemini предлагает рамку (`box_2d`) → тутор подтверждает в один тап / правит. Полностью авто-кроп без подтверждения — НЕ в P1.
2. **PDF → папки:** тутор подтверждает предложенную AI группировку по темам перед записью (папки по имени переиспользуются, новые создаются). Не авто-без-подтверждения.
3. **Квота:** free-репетитор **10 AI-загрузок/день**, premium/trial — **безлимит** (reuse `is_premium`). Явно показывать в UI.
4. **ОГЭ критерии:** P1 только **пробрасывает** `kim_number`+`check_format`+извлечённую рубрику в `kb_tasks`; грейдинг использует существующий слой (ЕГЭ — полная ФИПИ-методология; ОГЭ — баллы по КИМ + generic). Полную `physics-oge.ts` методологию НЕ строим.
5. **Картинка-источник (из P0, действует):** прикрепляем рисунок только если изображение = одна задача + есть существенный рисунок; мультискрин/текст/сомнение → только текст; таблицы → LaTeX-`array`; тутор может добавить/убрать вручную.
6. **HW-constructor:** AI-задачи попадают в черновик ДЗ инлайн (как KB-импорт), в «Мою базу» автоматически НЕ дублируются (опц. «сохранить в базу» — позже).

**Не в этой спеке (остаток P1-бэклога):** Excel/CSV-импорт (TASK-11), правка репликой в чат (TASK-13), AI-перерисовка рисунка vector-first (P2 TASK-15). Упомянуть как «будущее», не реализовывать.

---

## 2. Reuse map (КРИТИЧНО — не изобретать заново)

| Нужно | Уже есть | Файл |
|---|---|---|
| Extract-edge (текст+фото→черновики) | ✅ P0 | `supabase/functions/kb-ai-extract/index.ts` (+ `_shared/ai-lovable.ts`: `callLovableJson`, `inlineImageUrlToBase64`) |
| Клиент extract | ✅ P0 | `src/lib/kbAiExtractApi.ts` (`extractTasks`, `ExtractedTask`, `KbAiExtractApiError`) |
| UI загрузчика | ✅ P0 | `src/pages/tutor/knowledge/AiTaskLoaderPage.tsx`, `src/components/kb/AiTaskLoader/{InputStage,DraftCard}.tsx` |
| Commit в kb_tasks | ✅ P0 | `useKnowledgeBase.ts::insertTask`/`useCreateTask` (single); `AiTaskLoaderPage::draftToCreateInput` |
| Загрузка/валидация фото | ✅ | `src/hooks/useImageUpload.ts`, `src/lib/kbApi.ts` (`uploadKBTaskImage`, `getKBImageSignedUrl`, `validateImageFile`, `parseAttachmentUrls`/`serializeAttachmentUrls`) |
| Multi-select + «выбрать всё» + bulk CTA | ✅ | `src/components/tutor/homework-reuse/SaveTasksToKBDialog.tsx` (`Set<string>` state, select-all, `useKBImagesSignedUrls` batch) |
| Папки (дерево/создание/рекурсивные счётчики) | ✅ | `src/hooks/useFolders.ts` (`useFolderTree`, `insertFolder`/`useCreateFolder`, `fetchAllFolders`) |
| Критерии ФИПИ (методология) | ✅ ЕГЭ | `supabase/functions/_shared/subject-rubrics/` (`physics-ege.ts::buildPhysicsEgeRubric` КИМ 1-26, `index.ts::resolveSubjectRubric`) |
| Баллы по № КИМ | ✅ ЕГЭ+ОГЭ | `src/lib/kbKimScores.ts` (`getKimPrimaryScore`, `PHYSICS_EGE_KIM_SCORES` Σ45, `PHYSICS_OGE_KIM_SCORES` Σ39) |
| check_format/kim/task_kind helpers | ✅ | `src/lib/checkFormatHelpers.ts`, backend `homework-api::deriveTaskKind`/`VALID_CHECK_FORMATS` |
| Квота AI | ✅ | `_shared/subscription-limits.ts::checkAiQuota`, RPC `get_subscription_status`, таблица `daily_message_limits`, `src/hooks/useSubscription.ts`, `apiErrorMessage.ts` |
| Вход в конструктор ДЗ | ✅ | `src/components/tutor/KBPickerSheet.tsx` (`onAddTasks`), `HWTasksSection.tsx` (`handleAddFromKB`, `kbTaskToDraftTask`), `DraftTask` (`homework-create/types.ts`) |
| Телеметрия PII-free | ✅ P0 | `src/lib/kbAiLoaderTelemetry.ts` (типизированный реестр) |
| SECURITY DEFINER RPC шаблон | ✅ | `supabase/migrations/20260318150000_kb_moderation_v2.sql::kb_publish_task` (fingerprint + advisory lock + insert) |

**Новое (придётся создать):** `pdfjs-dist` (lazy), canvas-кроппер, `kb_insert_tasks_batch` RPC, `ai_uploads_today` квота-инфра, `figure_box` в extract-схеме, AI-вход в `KBPickerSheet`.

---

## 3. Cross-cutting инварианты (соблюдать во ВСЕХ задачах)

- **Единый write-path (rule 40):** запись в `kb_tasks` — только через `insertTask` ИЛИ новый `kb_insert_tasks_batch` RPC (это ЕДИНСТВЕННЫЙ новый разрешённый write-site, с теми же гарантиями: owner_id сервер, fingerprint-триггер). Перед мержем грепнуть `from('kb_tasks').insert` / `INSERT INTO kb_tasks` — новых ad-hoc мест быть не должно.
- **Anti-leak (rule 50):** рубрика/критерии → личная папка (owner=tutor), в Каталог не уходят (publish-триггеры рубрику не копируют). `solution` → Каталог by design. Edge не возвращает лишнего; логи PII-free (counts/ids, никогда текст задач/имена).
- **RU-bypass (rule 95/96):** клиент — `supabase` из `@/lib/supabaseClient`; НИКАКИХ `*.supabase.co` хардкодов; browser-facing signed URL → `rewriteToProxy`, server-side fetch → `rewriteToDirect`; pre-merge `git diff | grep supabase\.co`.
- **AI+картинки (rule 40):** `storage://` → base64/signed, bucket `kb-attachments` (в `HOMEWORK_AI_BUCKETS`); `storage://` НИКОГДА не в AI текстом; own-namespace `{userId}/…` bind.
- **Safari/iOS (rule 80):** input/textarea/select ≥16px; `touch-action:manipulation`; `URL.revokeObjectURL` cleanup; без lookbehind/`structuredClone`/`Array.at`; fileId генерится внутри канонического `uploadKBTaskImage` (там `crypto.randomUUID`, ок на HTTPS — не реимплементировать).
- **Design (rule 90):** один primary CTA на экран; Lucide-иконки, без эмодзи в chrome; Golos Text; `MathText` lazy; list-item компоненты `React.memo`; новые тяжёлые либы (pdfjs) — `React.lazy`/dynamic import (rule performance).
- **Ошибки edge (rule 97):** non-2xx → `{error:<рус>, code}`; клиент — `extractEdgeFunctionError`, никогда «non-2xx».
- **Квота (rule 99):** новый AI-путь = отдельная квота AI-загрузок (см. TASK-P1-6), НЕ общий чат/ДЗ-лимит.
- **Телеметрия:** типизированная, PII-free, расширять `kbAiLoaderTelemetry.ts`.
- **Деплой-порядок:** миграция (Lovable) → edge (Lovable синк) → фронт (`deploy-sokratai`). После фронт-изменений — блок «🚀 Deploy needed».

---

## 4. Задачи

### TASK-P1-1 — Вырезание рисунка из скриншота (полу-авто)

**Goal:** скрин с текстом+графиком → AI предлагает рамку графика → тутор подтверждает/правит → в задачу сохраняется только вырезанный рисунок (а не весь скрин с дублирующимся текстом). Заодно закрывает кейс «мультискрин с рисунком» (вырезаем график конкретной задаче).

**Design / reuse:**
- **Edge:** в `kb-ai-extract` промпт + схему добавить per-задача `figure_box: [y0,x0,y1,x1] | null` (нормировка **0–1000**, формат Gemini `box_2d`; см. https://ai.google.dev/gemini-api/docs/image-understanding). Просить рамку ТОЛЬКО когда `image_index != null` (есть существенный рисунок). Нормализовать: значения 0..1000, иначе null. Прокинуть в `ExtractedTask.figure_box`.
- **Клиент:** новый `src/components/kb/AiTaskLoader/FigureCropper.tsx` — overlay рамки поверх оригинала (canvas или `react-easy-crop`, lazy). Тутор тянет/растягивает рамку (предзаполнена из `figure_box`). «Применить» → canvas-кроп **из локального File** (он в сессии — прокинуть File-map из `InputStage` в `DraftCard`, либо грузить оригинал по signed URL с `crossOrigin`) → `uploadKBTaskImage(cropBlob)` → `onChange(index, { attachment_ref: cropRef })`. Fallback: «весь скрин» / «без рисунка».
- Оригинал-скрин после кропа можно не хранить (attach = кроп). Padding к рамке (≈3%) чтоб не срезать подписи осей.
- **Модель:** старт — тот же `gemini-3-flash-preview` (bbox тем же вызовом, ноль доп-инфры). **Перед UI — спайк** на 20–30 реальных скриншотах: если точность мала — fallback на **Qwen3-VL через OpenRouter** (сильный grounding; новый секрет `OPENROUTER_API_KEY` + ветка в `_shared/ai-lovable.ts`). Решение по модели — по результату спайка.

**Guardrails:** AI-рамка не блокирует (тутор правит); кроп детерминированный (canvas), не AI; `URL.revokeObjectURL`; кроп — в `kb-attachments` own-namespace; `figure_box` нормализуется на сервере (0..1000 или null).

**Validation:** спайк точности → отчёт; скрин с графиком → предложенная рамка → правка → сохранён только кроп; «без рисунка»/«весь скрин» работают.

---

### TASK-P1-2 — PDF-задачник целиком (multi-page) → задачи + папки по темам ⭐ ВЫСШИЙ ПРИОРИТЕТ

**Goal:** репетитор кидает PDF-сборник → AI режет на задачи, раскладывает по темам в папки «Моей базы». Наполнение базы за вечер.

**Design / reuse:**
- **PDF→изображения (клиент):** добавить `pdfjs-dist` (lazy-load, rule performance — НЕ в shared). Рендер каждой страницы в canvas → `toBlob` (jpeg/png, разумный DPI ~150) → `uploadKBTaskImage` → `storage://` ref. Новый `src/components/kb/AiTaskLoader/PdfInputStage.tsx` (вкладка «PDF» в загрузчике, рядом с Текст/Фото — в P0 они disabled «скоро», теперь включить PDF).
- **Извлечение:** по странице вызывать существующий `extractTasks({ material:{type:'image', image_refs:[pageRef]} })` — **каждая страница = один image_ref** (мультискрин-правило корректно: на странице несколько задач → картинки не цепляются, только текст; рисунки — TASK-P1-1 опционально). Кап страниц за вызов + чанки (cost/latency): дефолт **30 страниц**, чанк по ~5 (прогресс-бар «Распознано N задач из M страниц»). Агрегировать `drafts[]` со всех страниц, каждая с `topic_suggestion`.
- **Группировка по папкам (тутор подтверждает, decision 2):** клиент группирует `drafts` по `topic_suggestion` → экран-ревью «Создадутся папки: Кинематика (8), Динамика (5), Без темы (3)…». Тутор правит названия/мерджит/подтверждает. Резолв: папку по имени искать в `useFolderTree()` (case-insensitive) → reuse; нет → `insertFolder`/`useCreateFolder`. Затем commit задач в их папки.
- **Commit:** через `kb_insert_tasks_batch` (TASK-P1-3) — много задач, нужен пакетный insert. По папке — батч.

**Guardrails:** pdfjs lazy; кап страниц/чанки + прогресс (частичное извлечение — показать «найдено N», не падать целиком); создание папок — `insertFolder` (личные папки, НЕ catalog-темы); дедуп на всю пачку (см. TASK-P1-3); квота: 1 AI-загрузка = 1 PDF-сессия (не per-страница) ИЛИ per-N-страниц — решить в TASK-P1-6 (рекоменд: per-сессия, т.к. дорогой PDF = 1 «загрузка», иначе квота 10 бессмысленна; **уточнить при реализации**).

**Validation:** PDF на 10–20 страниц → задачи распознаны, сгруппированы по темам, тутор подтвердил → папки созданы/переиспользованы, задачи в них (owner=tutor, fingerprint); частичный сбой страницы → «найдено N», не краш.

---

### TASK-P1-3 — Пакетный режим: таблица-ревью 20+ + «Принять все» + массовые действия + батч-commit

**Goal:** при 20+ задачах (особенно из PDF) — компактная таблица вместо карточек, «Выбрать всё», массово проставить тему/источник, сохранить пачкой.

**Design / reuse:**
- **UI:** `AiTaskLoaderPage` — переключатель «Карточки / Таблица» (карточки ≤~8, таблица для больших пачек; авто-таблица при PDF). Новый `src/components/kb/AiTaskLoader/DraftTable.tsx` — multi-select по паттерну `SaveTasksToKBDialog` (`Set<index>` state, select-all, bulk-CTA, batch signed URLs через `useKBImagesSignedUrls`). Колонки: чек, текст (truncate+`stripLatex`), ответ, №КИМ, тема, формат, дедуп-флаг. Массовые: «Тема для выбранных», «Источник для выбранных», «Принять все».
- **Батч-commit:** новая миграция `kb_insert_tasks_batch(p_tasks jsonb)` SECURITY DEFINER (шаблон `kb_publish_task`): owner=`auth.uid()`, на каждую — fingerprint (триггер сам ставит) + опц. дедуп-skip, атомарный insert, RETURN `{inserted_ids, skipped}`. REVOKE FROM PUBLIC + GRANT authenticated. Клиент: `kb_insert_tasks_batch` вместо loop `insertTask` для пачки (loop оставить для single). Инвалидация `['tutor','kb']`.
- Дедуп: edge-маркеры `fingerprint_match` (P0) переиспользовать в таблице (колонка/иконка, по умолчанию дубли сняты).

**Guardrails:** батч-RPC — единственный новый write-site (rule 40), owner серверный; massive `<table>` — `React.memo` строк + `<colgroup>`/`table-layout:fixed` + iOS sticky-правила (rule 80, см. HeatmapGrid); один primary CTA «Сохранить N».

**Validation:** 20+ задач → таблица; select-all + массовая тема → проставилось; «Сохранить N» → батч-insert, дубли пропущены; быстрый рендер (memo).

---

### TASK-P1-4 — Критерии + формат проверки + № КИМ (проброс в kb_tasks)

**Goal:** AI вытаскивает критерии (рубрику), подсказывает формат проверки и № КИМ; всё это сохраняется в задачу, чтобы при выдаче в ДЗ грейдинг шёл по ФИПИ-критериям (ЕГЭ — полная методология, ОГЭ — баллы+generic).

**Что УЖЕ есть (НЕ переделывать):** edge `kb-ai-extract` уже извлекает `rubric_text` + `check_format` + `kim_number` (схема P0). `kb_tasks.check_format` (миграция `20260401140000`) и `kb_tasks.kim_number` — **колонки существуют**. Грейдинг ДЗ уже использует `resolveSubjectRubric(kim_number, subject, exam_type)` → ФИПИ-методология (ЕГЭ). `kbKimScores` покрывает ЕГЭ+ОГЭ баллы.

**ГЭП (это и есть задача):** `CreateKBTaskInput` **НЕ содержит** `check_format`/`kim_number` → P0 commit их теряет (пишется только `rubric_text`). Исправить:
- `src/types/kb.ts::CreateKBTaskInput` += `check_format?`, `kim_number?` (колонки уже есть).
- `useKnowledgeBase.ts::insertTask` + `kb_insert_tasks_batch` (TASK-P1-3) — писать оба поля.
- `AiTaskLoaderPage::draftToCreateInput` — прокинуть `draft.check_format` (валидно ∈ {short_answer,detailed_solution}) + `draft.kim_number`. (Сейчас `check_format` помечен «advisory, не персистится» — снять это ограничение.)
- DraftCard: read-only бейджи «Формат: развёрнутый», «№ КИМ N» (уже частично есть чипы) + рубрика (есть). Авто-подсказка: если `kim_number` есть, а `check_format` пуст → `inferCheckFormatFromKim`; балл → `getKimPrimaryScore` (если `primary_score` пуст).
- **ОГЭ (decision 4):** ничего нового — `exam_type` пробрасывается, грейдинг сам резолвит (ЕГЭ-методология / ОГЭ баллы+generic). `physics-oge.ts` НЕ создаём.

**Guardrails:** рубрика — личная база, не Каталог (anti-leak); `check_format` валидировать enum'ом перед записью; `kim_number` 1..30|null; не ломать KB→ДЗ мост (`kbTaskToDraftTask` уже несёт kim_number/check_format — проверить парность).

**Validation:** распознать №21 ЕГЭ → сохранить → в kb_tasks `check_format='detailed_solution'`, `kim_number=21`, `rubric_text` непуст; выдать в ДЗ → грейдинг по ФИПИ-методологии №21 (проверить `resolveSubjectRubric` получает kim).

---

### TASK-P1-5 — AI-загрузка прямо в конструкторе ДЗ

**Goal:** собирать ДЗ из распознанных задач, не заходя в «Мою базу».

**Design / reuse:**
- **Вход:** в `KBPickerSheet` добавить вкладку/кнопку «AI-загрузка» (рядом с Каталог/Моя база) ИЛИ кнопку в `HWTasksSection`. Открывает реюз потока загрузчика (`InputStage`/`DraftCard`/`extractTasks`).
- **Edge:** сделать `folder_id` **опциональным** в `kb-ai-extract` — для конструктора назначения-папки нет (задачи идут в черновик ДЗ). Если `folder_id` задан → проверять ownership (как сейчас); если null → ownership = аутентифицированный тутор (`verify_jwt` + опц. `is_tutor`). Дедуп всё равно по `userId`-базе.
- **Commit (не в KB, а в ДЗ):** вместо `insertTask` — конвертер `extractedTaskToDraftTask(draft): DraftTask` (зеркало `kbTaskToDraftTask` из `HWTasksSection`, маппинг полей: `task_text`, `correct_answer`, `task_image_path`=serialize(attachment_ref), `rubric_text`, `solution_text`, `max_score`=`primary_score??1`, `check_format`, `kim_number`, `kb_source:'ai'`/без `kb_task_id`) → `onAddTasks(drafts)` → `HWTasksSection` добавляет в `tasks[]`. **В «Мою базу» НЕ дублируем** (decision 6); опц. чекбокс «также сохранить в базу» — отложить.
- Квота: тот же `checkAiUploadQuota` (TASK-P1-6).

**Guardrails:** dual-write-path (rule 40) — здесь задачи идут в ДЗ-черновик (path A через визард), НЕ новый write-site в `homework_tutor_tasks` (сохранение — существующим save-флоу конструктора); `DraftTask`-маппинг — все поля (kim/check_format/рубрика/фото) чтобы не терять при сохранении ДЗ; `folder_id`-optional не должен ослабить ownership при заданном folder.

**Validation:** в конструкторе ДЗ «AI-загрузка» → вставить задачу → распозналась → «Добавить в ДЗ» → появилась в списке задач конструктора со всеми полями → сохранить ДЗ → задача в `homework_tutor_tasks`.

---

### TASK-P1-6 — Своя квота AI-загрузок (10/день free, premium безлимит) + UI

**Goal:** AI-загрузки не съедают чат/ДЗ-лимит; репетитор явно видит «осталось N из 10».

**Design / reuse (rule 99):**
- **Миграция:** `daily_message_limits` += `ai_uploads_today integer NOT NULL DEFAULT 0` (отдельный счётчик, тот же `last_reset_date`). Расширить RPC `get_subscription_status` → доп. поля `ai_uploads_today`, `ai_uploads_daily_limit`, `ai_uploads_limit_reached` (premium/trial → -1 безлимит; free → 10).
- **Edge:** новый `_shared/subscription-limits.ts::checkAiUploadQuota(userId, db, {incrementUsage})` (зеркало `checkAiQuota`, считает `ai_uploads_today`). `kb-ai-extract` зовёт ПЕРЕД AI-вызовом; инкремент на УСПЕШНЫЙ extract (не на валидационный фейл). **Единица квоты:** 1 успешный `extractTasks`-вызов = 1 загрузка (PDF-сессия = 1, не per-страница — иначе квота 10 бессмысленна для PDF; задокументировать в коде). Лимит достигнут → 429 `{error:рус, code:'AI_UPLOADS_LIMIT'}` (rule 97).
- **Клиент:** `useSubscription` (или новый лёгкий хук) отдаёт `aiUploadsUsed`/`aiUploadsLimit`. UI-бар «AI-загрузок: N/10» в загрузчике (`AiTaskLoaderPage` шапка) + в `KBPickerSheet` AI-вкладке. При лимите — дизейбл «Распознать» + рус. сообщение (premium → бар скрыт). `apiErrorMessage.ts` — ветка для `AI_UPLOADS_LIMIT`.

**Guardrails:** отдельный счётчик (НЕ трогать `messages_today`); fail-open при сбое RPC (как `checkAiQuota`); premium=безлимит через `is_premium` (decision 3); PII-free.

**Validation:** free-тутор делает 10 загрузок → 11-я блокируется (429+UI); чат/ДЗ-лимит не затронут; premium → безлимит, бар скрыт; счётчик сбрасывается назавтра.

---

## 5. Порядок реализации (зависимости)

1. **TASK-P1-4** (criteria persist) + **TASK-P1-6** (квота) — лёгкие, фундаментальные, разблокируют остальное.
2. **TASK-P1-3** (batch-режим + `kb_insert_tasks_batch`) — нужен для PDF (много задач).
3. **TASK-P1-2** (PDF) ⭐ — высший приоритет, опирается на batch.
4. **TASK-P1-1** (crop) — независим, можно параллельно (начать со спайка точности модели).
5. **TASK-P1-5** (HW-constructor) — последним, реюз всего.

Каждую задачу — отдельным слайсом со STOP-точкой: `npm run lint && tsc --noEmit && npm run smoke-check` (полный `vite build` может OOM-ить локально — `tsc` достаточный type-гейт) + Codex-ревью + апрув владельца.

---

## 6. Verification (end-to-end, после всех слайсов)

- **Backend:** `node scripts/supabase-drift-check.mjs` (новые миграции/edge в config+workflow); curl `kb-ai-extract` с/без `folder_id` (200/опц.); квота — 11-й вызов 429.
- **Frontend:** preview (`preview_*`, + `preview_resize` iOS): PDF→задачи→папки; таблица 20+; crop рамка→правка→кроп; AI-вход в конструкторе ДЗ; квота-бар.
- **E2e:** PDF-сборник → задачи в папках по темам (owner/fingerprint); из конструктора ДЗ → задача в `homework_tutor_tasks` с kim/check_format/рубрикой; грейдинг по ФИПИ-методологии.
- **Грепы pre-merge:** нет нового `from('kb_tasks').insert` кроме `insertTask`+`kb_insert_tasks_batch`; нет `supabase.co`-хардкода; квота-счётчик отдельный; `verify_jwt` для edge; PII-free логи.
- **Manual QA:** прогнать P0-чеклист (rule 50) + новые кейсы.

---

## 7. Промпт для code-review (ChatGPT-5.5, независимо, на каждый слайс)

> Прочитай diff слайса TASK-P1-N без контекста автора. Это Phase P1 фичи «AI-загрузка задач» (KB tutor-модуль, SokratAI). Проверь по инвариантам проекта:
> 1. **Единый write-path (rule 40):** запись в `kb_tasks` — ТОЛЬКО через `insertTask` или `kb_insert_tasks_batch` RPC; нет нового ad-hoc `from('kb_tasks').insert`/`INSERT INTO kb_tasks` (грепни). Батч-RPC: `SECURITY DEFINER`, owner=`auth.uid()`, `REVOKE FROM PUBLIC` + `GRANT authenticated`, fingerprint-дедуп.
> 2. **Anti-leak (rule 50):** рубрика/критерии не утекают в Каталог (пишутся в личную папку owner=tutor; publish-триггеры рубрику не копируют); edge не возвращает лишнего; в логах НЕТ PII (текст задач/имена/email) — только counts/ids/status.
> 3. **RU-bypass (rule 95/96):** клиент — `supabase` из `@/lib/supabaseClient`; нет `*.supabase.co` хардкода; browser signed URL → `rewriteToProxy`, server fetch → `rewriteToDirect`.
> 4. **AI+картинки (rule 40):** `storage://` → base64/signed, bucket `kb-attachments` whitelist, own-namespace `{userId}/…` bind; `storage://` не уходит в AI текстом; `figure_box` нормализован (0..1000|null).
> 5. **Квота (rule 99):** AI-загрузки — ОТДЕЛЬНЫЙ счётчик `ai_uploads_today` (не `messages_today`); fail-open; premium=безлимит; рус. 429.
> 6. **Дедуп:** `kb_normalize_fingerprint` 3-арг (text, answer, attachment_url).
> 7. **Edge errors (rule 97):** non-2xx → `{error:<рус>, code}`; клиент — `extractEdgeFunctionError`, нет «non-2xx».
> 8. **Safari/iOS (rule 80):** input/textarea/select ≥16px; `touch-action:manipulation`; `URL.revokeObjectURL`; без lookbehind/`structuredClone`/`Array.at`; pdfjs/crop-либа — lazy.
> 9. **Design (rule 90):** один primary CTA; Lucide, без эмодзи в chrome; `MathText` lazy; list-rows `React.memo`.
> 10. **PDF:** pdfjs lazy + кап страниц/чанки + прогресс; папки через `insertFolder` (личные, не catalog-темы), тутор подтверждает группировку.
> 11. **Reuse:** переиспользованы существующие хелперы (`useImageUpload`, `uploadKBTaskImage`, `useFolderTree`, `SaveTasksToKBDialog`-паттерн, `resolveSubjectRubric`, `kbTaskToDraftTask`), а не дублированы.
> Верни **PASS / CONDITIONAL / FAIL** с конкретикой (файл:строка) по каждому пункту.

---

## 8. Deploy + миграции

- **Миграции P1:** `kb_insert_tasks_batch` (TASK-P1-3); `ai_uploads_today` + `get_subscription_status` extension (TASK-P1-6). `check_format`/`kim_number` колонки — УЖЕ есть (TS-only правка). Порядок: миграции (Lovable) → edge (`kb-ai-extract` промпт+folder-optional+квота; `_shared/*`) → фронт (`deploy-sokratai`).
- **Новый секрет (только если спайк выберет OpenRouter, TASK-P1-1):** `OPENROUTER_API_KEY` в Supabase secrets.
- **CI edge-деплой сломан** (rule 95) — edge через Lovable-синк; после фронта — блок «🚀 Deploy needed».
- **После реализации:** обновить `spec.md`/`kb-ai-task-loader-tasks.md` этой папки + `.claude/rules/50-kb-module.md` (P1-инварианты) + memory `project_kb_ai_task_loader.md`.
