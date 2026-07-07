# Tasks — AI-загрузка задач в базу

Реализационные задачи для `spec.md` (`docs/delivery/features/kb-ai-task-loader/spec.md`). Контракт промпта — `prompts.md`. Концепция/прототип — `concept.md`, `prototype.html`.

Каждая задача:
- привязана к решению из спеки (**Spec**) и Core Job репетитора (R: «Подготовить материалы к занятиям и ДЗ»);
- закреплена за агентом (Claude Code / Codex);
- содержит **Guardrails** (инварианты из CLAUDE.md / rules) и **Validation**.

Code review для каждой задачи — **Codex** независимо (см. финальный промпт ревьюера).

**Rollout:** фича — только tutor-домен, аддитивна (новая edge function + reuse `insertTask`). Без миграций в P0 → выкат без DB-риска. Rollback фронта = `git revert <hash> && deploy-sokratai`. Edge деплоит Lovable на синк main (rule 95).

**Главный инвариант (повторяется в TASK-1/8):** edge `kb-ai-extract` **только извлекает** черновики; запись в `kb_tasks` — **через существующий `insertTask`**. Не плодить новый write-site (rule 40 dual-write-path).

---

## Phase P0 — MVP: текст + фото → карточки → запись (без миграций)

### TASK-1 — Edge function `kb-ai-extract` (scaffold, extract-only)

- **Spec:** §5 API, §3 решение 4 (единый write-path).
- **Agent:** Claude Code.
- **Files:**
  - `supabase/functions/kb-ai-extract/index.ts` (новый)
  - `supabase/config.toml` (+ `[functions.kb-ai-extract] verify_jwt = true`)
  - `.github/workflows/deploy-supabase-functions.yml` (+ deploy command)
- **Что делаем:**
  1. Роутинг `POST /kb-ai-extract`. CORS + OPTIONS.
  2. Body: `{ folder_id, material: { type, text?, image_refs?: string[] }, exam_hint?, topic_hint? }`.
  3. Auth: userId из JWT (GoTrue). **Ownership:** `SELECT id FROM kb_folders WHERE id=folder_id AND owner_id=userId` → 403 `INVALID_FOLDER` (rule 97 flat-shape) иначе.
  4. Вернуть `{ drafts: ExtractedTask[], stats }`. **Никакой записи в БД.**
- **Guardrails:**
  - `verify_jwt=true` в config **и** deploy без `--no-verify-jwt` (rule 96 #11). Дополнительно: клиент шлёт сессионный JWT (не публичная функция).
  - Все non-2xx — `{ error: <рус>, code }` (rule 97).
  - Не логировать PII (текст задач/имена) — только counts/status (rule 40 telemetry-конвенция).
- **Validation:** `curl` с tutor JWT на свою папку → 200; на чужую папку → 403 `INVALID_FOLDER`. `node scripts/supabase-drift-check.mjs` → функция в config + workflow.

### TASK-2 — Извлечение: системный промпт + мультимодал + JSON-парсинг

- **Spec:** §5 (резолв `storage://`→base64), `prompts.md` (§2 промпт, §3 JSON-схема).
- **Agent:** Claude Code.
- **Files:**
  - `supabase/functions/kb-ai-extract/index.ts` (логика извлечения)
  - reuse `callLovableJson` (сейчас `supabase/functions/homework-api/ai_shared.ts`) — **вынести в `supabase/functions/_shared/ai-lovable.ts`** для cross-function reuse (или импортировать; решить при реализации, не дублировать).
  - reuse `_shared/image-domains.ts` (bucket whitelist), `_shared/attachment-refs.ts` (`parseAttachmentUrls`).
- **Что делаем:**
  1. Системный промпт — verbatim из `prompts.md §2` (+ inject `exam_hint`/`topic_hint`).
  2. Для `image_refs`: `storage://` → signed URL (service_role) → base64 `data:` (паттерн `chat/index.ts::fetchImageAsBase64DataUrl`), валидация хоста (`buildAllowedSignedUrlPrefixes`), bucket `kb-attachments`. Инжект как `LovableImagePart`.
  3. `callLovableJson(messages, "kb_ai_extract")` (Gemini, temp 0.2).
  4. Парсинг JSON по схеме `prompts.md §3`; **retry-once** при невалидном JSON/утечке формата; на повторный сбой — `502 EXTRACT_FAILED` (рус.).
  5. Нормализация: `kim_number` 1..30|null, `exam` ∈ {ege,oge,null}, `answer_confidence` enum; `image_action` форсить `"attach_original"` (P0 не принимает `redraw`).
- **Guardrails:**
  - **Image bucket whitelist (rule 40):** только `kb-attachments` в P0; новый bucket → расширить `HOMEWORK_AI_BUCKETS` + smoke-check.
  - `storage://` НИКОГДА не передаётся в AI как текст — только base64/signed (rule «Передача изображений задач в AI»).
  - `answer=null` при `answer_confidence='low'` — нормализовать на сервере, если модель нарушила (anti-hallucination).
  - Server-side fetch на validated URL — `rewriteToDirect()` (экономия latency, rule 95).
- **Validation:** unit на парсер JSON (валид/битый/частичный). Локальный прогон few-shot из `prompts.md §7` → ожидаемый JSON (task2 «Камень…» → `answer:null`, `needs_review_fields:["answer"]`).

### TASK-3 — Клиент `kbAiExtractApi.ts`

- **Spec:** §5 API.
- **Agent:** Claude Code.
- **Files:** `src/lib/kbAiExtractApi.ts` (новый); reuse `src/lib/edgeFunctionError.ts` (`extractEdgeFunctionError`).
- **Что делаем:** типы `ExtractedTask`/`ExtractResponse` (mirror `prompts.md §3`), функция `extractTasks(input)` через `supabase.functions.invoke('kb-ai-extract', …)`; ошибки — `extractEdgeFunctionError` (rule 97, показываем русскую фразу, не «non-2xx»).
- **Guardrails:** не показывать строку «Edge Function returned a non-2xx status code» (rule 97 #2). Типы черновика синхронны с edge-схемой.
- **Validation:** `npm run build` (типы) + mock-ответ → корректный парс ошибки/успеха.

### TASK-4 — Точка входа «AI-загрузка задач» в «Моей базе»

- **Spec:** §3 решение 8, §6 (точки входа); прототип — экран «Моя база».
- **Agent:** Claude Code.
- **Files:** страница «Моя база» (`src/pages/tutor/knowledge/…`), новый роут/drawer для `AiTaskLoader`.
- **Что делаем:** кнопка «AI-загрузка задач» рядом с «Создать задачу» (+ контекст текущей папки как папка-назначение по умолчанию). Открывает `AiTaskLoader` (страница или крупный drawer). Кнопка «← Моя база».
- **Guardrails:** один primary CTA на экран (rule 90); Lucide-иконка, без эмодзи; `React.lazy` для `AiTaskLoader` (rule performance). Конструктор ДЗ-вход — P1, тут не делаем.
- **Validation:** preview — кнопка видна в «Моей базе», открывает/закрывает загрузчик.

### TASK-5 — UI: ввод материала (текст + фото, Ctrl+V до 10)

- **Spec:** §3 In scope, Ctrl+V до 10; прототип — вкладки Текст/Фото/PDF.
- **Agent:** Claude Code.
- **Files:** `src/components/kb/AiTaskLoader/InputStage.tsx` (новый); reuse `uploadKBTaskImage` (`src/lib/kbApi.ts`), `serializeAttachmentUrls` (`src/lib/attachmentRefs.ts`).
- **Что делаем:** вкладки «Текст»/«Фото» (PDF/Excel — P1, показать disabled или «скоро»); textarea (16px) + dropzone; **Ctrl+V вставка скриншотов** (паттерн `GuidedChatInput.tsx`: `clipboardData.files` + fallback `items.getAsFile()`); кап 10 за сессию; селектор папки; кнопка «Распознать задачи» → `extractTasks`.
- **Guardrails:** iOS — `font-size ≥16px`, `touch-action: manipulation` (rule 80); `URL.revokeObjectURL` cleanup; fileId — `Date.now()+Math.random()` (НЕ `crypto.randomUUID` для Safari <15.4, rule 80); upload в `kb-attachments`.
- **Validation:** preview/Safari — вставка скриншота Ctrl+V добавляет превью; >10 → toast-кап; «Распознать» вызывает edge.

### TASK-6 — UI: карточки-черновики (LaTeX, confidence, правка, рисунок)

- **Spec:** §3 решения 2/3/5/7; прототип — карточки.
- **Agent:** Claude Code.
- **Files:** `src/components/kb/AiTaskLoader/DraftCard.tsx` (новый); reuse `MathText` (`src/components/kb/ui/MathText.tsx`).
- **Что делаем:** карточка по `ExtractedTask`: чипы (exam/№КИМ/тема/формат), confidence-бейдж; **условие и ответ редактируются как сырой `$…$`** с превью через `MathText`; `answer=null` → пустое поле «впишите/поправьте»; рубрика — блок «видно только вам»; **рисунок — бейдж «авторский, AI не меняет» + «Заменить вручную»** (reuse `uploadKBTaskImage`); чек-боксы выбора; дедуп-баннер (из TASK-7).
- **Guardrails:** `MathText` lazy (rule 50, не тянуть KaTeX в shared `ui/*`); `DraftCard` — `React.memo`; рисунок не перерисовываем (политика P0); `solution`/`rubric` остаются в черновике, в Каталог не уходят (anti-leak by construction — пишем в персональную папку).
- **Validation:** preview — правка условия в `$…$` рендерится; пустой `answer` помечен; «Заменить» грузит фото и подменяет `attachment_url` черновика.

### TASK-7 — Дедуп до записи (`kb_normalize_fingerprint`, 3-арг)

- **Spec:** §3 решение 6, §5.
- **Agent:** Claude Code.
- **Files:** edge `kb-ai-extract/index.ts` (расчёт fingerprint-маркеров) **или** клиент перед commit; RPC `kb_normalize_fingerprint` (существует).
- **Что делаем:** для каждого черновика `rpc('kb_normalize_fingerprint', { p_text, p_answer, p_attachment_url })` → SELECT `kb_tasks WHERE owner_id=tutor AND fingerprint=fp` (+ каталожная копия) → если найден, маркер `fingerprint_match: { folder_name }`; в карточке — баннер «похоже, уже есть в …», по умолчанию **не выбрано**.
- **Guardrails:** **3-арг** сигнатура (text, answer, attachment_url) — картинка значима (rule 40 / KB-loader). Не дедуп по тексту без attachment.
- **Validation:** загрузить задачу-дубль существующей → карточка с баннером, снятой галочкой.

### TASK-8 — Commit: запись в «Мою базу» через существующий `insertTask`

- **Spec:** §3 решение 4 (КРИТИЧНО), §5.
- **Agent:** Claude Code.
- **Files:** `src/components/kb/AiTaskLoader/*` (commit-хендлер); reuse `useKnowledgeBase.ts::insertTask` / `useCreateTask`.
- **Что делаем:** «Сохранить N задач» → для каждого выбранного черновика собрать `CreateKBTaskInput` (`text, answer, solution, answer_format, kim_number, exam, primary_score, rubric_text, topic_id, subtopic_id, source_label, attachment_url`) → `insertTask` (P0 цикл; батч-RPC — P1). `owner_id` ставит сервер; `source_label` из распознанного источника ∥ `my`. Тост «Добавлено N · 1 дубликат пропущен». Cache invalidation `['tutor','kb']`.
- **Guardrails:**
  - **НЕ создавать новый write-site в `kb_tasks`** — только существующий insert (rule 40). Грепнуть `from('kb_tasks').insert` перед мержем — новых мест быть не должно.
  - `topic_suggestion`/`subtopic_suggestion` (название) → резолв в `topic_id`/`subtopic_id` на клиенте; не найдено → оставить null (подсказка, не блокер).
  - `attachment_url` — оригинал (dual-format через `serializeAttachmentUrls`).
- **Validation:** сохранить пачку → строки в `kb_tasks` (owner=tutor, fingerprint проставлен), видны в «Моей базе» и в `KBPickerSheet` конструктора ДЗ; дубль пропущен.

### TASK-9 — Телеметрия + manual QA + smoke

- **Spec:** §7.
- **Agent:** Claude Code → Codex (review).
- **Files:** телеметрия-реестр (по аналогии `homeworkTelemetry.ts`), manual QA по чеклисту.
- **Что делаем:** PII-free события `kb_ai_extract_run` (`{folderId, material_type, found, low_conf_answers}`), `kb_ai_tasks_saved` (`{folderId, saved, skipped}`) — без текста/имён. Manual QA: текст→карточки; фото Ctrl+V; пустой ответ; дубль; правка `$…$`; авторский рисунок «не меняем» + замена; сохранение и проверка в БД.
- **Guardrails:** телеметрия типизирована (иначе build падает — паттерн `homeworkTelemetry.ts`); без PII (rule 40).
- **Validation:** `npm run lint && npm run build && npm run smoke-check`; чеклист пройден.

> **P0 deploy-порядок:** edge (Lovable, синк main) → проверить `curl` (401 = живо/JWT, 503 = boot-crash, rule 95) → фронт `deploy-sokratai` (VPS).

---

## Phase P1 — Масштаб: PDF-задачник, авто-темы, Excel, пакет, правка репликой

### TASK-10 — PDF-задачник (multi-page) → задачи + авто-распределение по темам

- **Spec:** §3 P1 (запрос Александра), §8 (стоимость/латентность).
- **Agent:** Claude Code.
- **Что делаем:** приём PDF (постранично → изображения/текст), длинный массив `tasks` + `topic_suggestion` на каждую; клиент группирует по темам в папки-разделы (создать папку на тему при подтверждении). Кап на страницы за вызов + чанки + прогресс.
- **Guardrails:** кап размера пакета (стоимость Gemini); дедуп на всю пачку; «найдено N» при частичном извлечении.
- **Статус: v1 SHIPPED 2026-07-07** (frontend-only; edge/БД/контракты не тронуты). Сделано: PDF → страницы-картинки **на клиенте** (`src/lib/pdfToImages.ts`, pdfjs legacy lazy) → существующий image-пайплайн (`useImageUpload.addFiles` → kb-attachments → `kb-ai-extract` с subject-промптом); кап `MAX_LOADER_IMAGES`=10 стр/вызов; прогресс «Страница N из M» + фаза аплоада; honest-toast при >10 стр (no silent caps); document-превью (A4-contain + «стр. N») + клик-зум (`FullscreenImageCarousel`, единый UX с ДЗ). Build-лог: memory `project_kb_pdf_loader_2026_07_06.md`; инварианты → rule 50 «Мультипредметный каталог + PDF-загрузка». **НЕ сделано (отложено):** авто-группировка по `topic_suggestion` в папки-разделы; диапазон/чанки >10 стр (сборники); текстовый слой цифровых PDF; вход из конструктора ДЗ (TASK-14).

### TASK-11 — Excel/CSV с маппингом колонок

- **Spec:** §3 P1.
- **Что делаем:** вставка таблицы/файл → AI маппит колонки (текст/ответ/№/тема) на поля; ревью-таблица.

### TASK-12 — Пакетный режим ревью + массовые действия + батч-commit

- **Spec:** §3 P1, open question 2.
- **Что делаем:** таблица-ревью на 20+ задач, «Принять все», массовая тема/источник; **`kb_insert_tasks_batch(jsonb)`** (новая SECURITY DEFINER RPC, атомарный commit) — миграция P1.

### TASK-13 — Правка репликой в чат

- **Spec:** §3 решение 1/2 (прототип — чип-правки).
- **Что делаем:** реплики «ответ к №2 — 2 с», «тему №3 — Статика», «убрать дубликат», мерж/сплит → повторный мини-вызов AI на конкретную карточку.

### TASK-14 — Вход в конструкторе ДЗ + rubric/check_format suggest + квота

- **Spec:** §6, open question 1/6.
- **Что делаем:** кнопка «AI-загрузка» в `KBPickerSheet`; извлечение `rubric_text`; advisory `check_format`/№КИМ; решение по квоте (общий лимит vs отдельный «AI-загрузок/день», rule 99).

---

## Phase P2 — Отложено (architectural insurance)

### TASK-15 — AI-перерисовка рисунка (opt-in, vector-first)

- **Spec:** §3 P2, §8 (риск «AI перерисует точный рисунок»).
- **Что делаем:** **отдельный режим** «Перерисовать (бета)» — vector-first (SVG/TikZ-спека → чистая диаграмма) для **простых** схем; результат «AI-черновик»; **оригинал всегда fallback**; тутор подтверждает; auto-replace запрещён. Растровая text→image для экзаменной физики — не используется. Промежуточные надёжные операции (чистка скана/транскрипция подписей/перестроение графика) — кандидаты сюда же. **Требует отдельной spec.**

### TASK-16 — Голосовой ввод задачи · TASK-17 — Генерация новых задач · TASK-18 — Др. предметы (`kb_topics.subject`)

- **Spec:** §3 P2. Каждая — отдельная spec; в P0/P1 не реализуются.

---

## Зависимости (граф)

- TASK-1 → TASK-2 → (TASK-3 ∥ TASK-7).
- TASK-4 → TASK-5 → TASK-6 → TASK-8 (UI-цепочка). TASK-6 потребляет TASK-7 (дедуп-баннер). TASK-8 — после TASK-3 (клиентский тип) и TASK-7.
- TASK-9 — после TASK-8 (полный e2e). P1/P2 — после стабильного P0.

---

## Запуск агентов / Codex review (конвенция репо)

**Промпт исполнителю (на каждую TASK-N):**
> Реализуй TASK-N из `docs/delivery/features/kb-ai-task-loader/kb-ai-task-loader-tasks.md`. Сначала прочитай `AGENTS.md`, `.claude/rules/00-read-first.md`, `spec.md`, `prompts.md` этой папки. Соблюдай Guardrails задачи и инварианты CLAUDE.md (rule 40 dual-write-path, rule 50 KB/LaTeX, rule 80 Safari, rule 90 design, rule 96 auth/edge, rule 97 error-contract, rule 99 квота). Прогони Validation. После фронт-изменений добавь блок «🚀 Deploy needed» (rule 95).

**Промпт ревьюеру (Codex, независимо):**
> Прочитай diff TASK-N без контекста автора. Проверь: (1) edge только извлекает, запись через `insertTask` — нет нового write-site в `kb_tasks` (грепни `from('kb_tasks').insert`); (2) anti-leak — рубрика/решение не утекают в Каталог, edge не возвращает лишнего, нет PII в логах; (3) `kb_normalize_fingerprint` 3-арг; (4) bucket whitelist `kb-attachments`; (5) `storage://` не уходит в AI текстом; (6) rule 97 error-contract; (7) Safari/iOS (rule 80); (8) рисунки не перерисовываются в P0. Верни PASS/CONDITIONAL/FAIL с конкретикой.

---

## Чеклист готовности P0

> **Статус:** реализовано 2026-06-25 (Claude Code, 5 слайсов). `build` + `smoke-check` + targeted ESLint зелёные. Codex-ревью пройдено по каждому слайсу (находки P0/P1 закрыты). Деплой и manual QA — после синка Lovable (edge) + `deploy-sokratai` (фронт).

- [x] Edge `kb-ai-extract` (extract-only) + config.toml + workflow.
- [x] Системный промпт (verbatim `prompts.md §2`, `String.raw`) + JSON-схема + retry-once.
- [x] Клиент `kbAiExtractApi.ts` + error-contract (`extractEdgeFunctionError`).
- [x] Вход в «Моей базе» + `FolderPage` + InputStage (Ctrl+V до 10) + DraftCard (LaTeX/confidence/рисунок).
- [x] Дедуп (3-арг `kb_normalize_fingerprint`) + commit через `insertTask` + invalidation `['tutor','kb']`.
- [x] Телеметрия PII-free (`kb_ai_extract_run`/`kb_ai_tasks_saved`) + smoke-check. Manual QA — после деплоя.
- [x] Codex review по каждому слайсу (P0: handleCommit-commit, PII-логи; P1: body_preview, blind-AI guard — закрыты).
- [x] Anti-leak подтверждён; новый write-site в `kb_tasks` отсутствует (грепнуто).
