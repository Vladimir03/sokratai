# Agent runbook — AI-загрузка задач (P0)

Два готовых к копированию промпта: **(A)** kickoff для Claude Code (вся P0 как goal через plan mode) и **(B)** независимое ревью для ChatGPT-5.5 / Codex. Сопутствующие доки в этой папке: `spec.md`, `prompts.md`, `kb-ai-task-loader-tasks.md`.

**Цикл:**

```
[CC] plan mode (P0) → approve → слайс N → lint/build/smoke → дифф
        → [ChatGPT-5.5/Codex] review (B) → PASS?
           нет → фиксы в CC → re-review
           да  → следующий слайс
после P0: Lovable redeploy edge → curl-проверка (401=живо) → deploy-sokratai (фронт) → manual QA
```

Деплой не автоматизируется: edge — Lovable вручную (синк main), фронт — `deploy-sokratai` на VPS. Миграций в P0 нет.

---

## A. Kickoff для Claude Code (вставить целиком)

```text
ЦЕЛЬ (goal): реализовать Phase P0 фичи «AI-загрузка задач» — edge-функция kb-ai-extract
(только извлечение черновиков) + UI-загрузчик в «Моей базе» + запись в kb_tasks ЧЕРЕЗ
существующий insertTask. Источник истины:
docs/delivery/features/kb-ai-task-loader/{spec.md, prompts.md, kb-ai-task-loader-tasks.md}.

РЕЖИМ РАБОТЫ:
1) Сначала прочитай (read-only, делегируй субагентам Explore, держи main-тред чистым):
   AGENTS.md, .claude/rules/00-read-first.md, docs/delivery/engineering/overview/codebase.md,
   затем spec.md + prompts.md + kb-ai-task-loader-tasks.md этой папки.
2) РАБОТАЙ В PLAN MODE. Составь план реализации ВСЕЙ P0 (TASK-1…9) в порядке зависимостей,
   разбитый на 5 слайсов (ниже), с явными СТОП-точками между слайсами. НЕ пиши код, пока я
   не одобрю план (ExitPlanMode).
3) После approve — реализуй слайс за слайсом. После КАЖДОГО слайса:
   `npm run lint && npm run build && npm run smoke-check`, отметь TASK-и done в трекере,
   дай краткий дифф-саммари и ОСТАНОВИСЬ для моего ревью + независимого Codex-ревью.
   Следующий слайс — ТОЛЬКО после моего «ок».

СЛАЙСЫ (строгий порядок):
- Слайс 1 — Бэкенд: TASK-1 + TASK-2 (edge kb-ai-extract: extract-only, ownership по kb_folders,
  мультимодальный вызов через callLovableJson, системный промпт ВЕРБАТИМ из prompts.md §2,
  JSON-схема §3, retry-once на битый JSON) + config.toml + deploy workflow.
- Слайс 2 — Клиент-API: TASK-3 (src/lib/kbAiExtractApi.ts, типы ExtractedTask, extractEdgeFunctionError).
- Слайс 3 — UI: TASK-4 (вход «AI-загрузка задач» в «Моей базе») + TASK-5 (ввод текст+фото,
  Ctrl+V до 10 скриншотов) + TASK-6 (карточки: LaTeX через MathText, confidence-флаги,
  правка условия/ответа в сыром $…$, рисунок «авторский — AI не меняет» + «Заменить вручную»).
- Слайс 4 — Дедуп+commit: TASK-7 (kb_normalize_fingerprint 3-арг) + TASK-8 (запись выбранных
  через insertTask, invalidation ['tutor','kb']).
- Слайс 5 — TASK-9 (телеметрия PII-free + manual QA по чеклисту + smoke).

ЖЁСТКИЕ ОГРАНИЧЕНИЯ (НЕ нарушать; подробности — Guardrails в tasks.md):
- ЕДИНЫЙ WRITE-PATH: edge ТОЛЬКО извлекает; запись — через существующий insertTask. НЕ создавай
  нового `from('kb_tasks').insert`. Перед слайсом 4 грепни — новых write-site быть не должно (rule 40).
- ANTI-LEAK: рубрика и решение в Каталог не уходят (пишем в персональную папку owner=tutor);
  edge не возвращает лишних полей; в console-логах НЕТ PII (текст задач/email/имена) — только counts.
- kb_normalize_fingerprint — 3 аргумента (text, answer, attachment_url).
- Картинки в AI — только base64/signed (bucket kb-attachments в whitelist); `storage://` НИКОГДА
  не как текст. В P0 рисунки НЕ перерисовываются (image_action='attach_original').
- Anti-hallucination: при answer_confidence='low' answer=null (нормализуй на сервере).
- Ошибки edge — {error: <рус>, code} (rule 97); клиент — через extractEdgeFunctionError, никогда
  не показывай «Edge Function returned a non-2xx status code».
- Safari/iOS (rule 80): input/textarea/select ≥16px; touch-action: manipulation; без lookbehind/
  structuredClone/Array.at/crypto.randomUUID в hot-path; URL.revokeObjectURL cleanup.
- Design (rule 90): один primary CTA на экран; без эмодзи в chrome; Lucide-иконки; Golos Text;
  MathText lazy.
- НИКАКИХ миграций в P0. НЕ деплой: edge — Lovable вручную, фронт — deploy-sokratai вручную;
  после фронт-изменений добавь блок «🚀 Deploy needed» (rule 95). Изоляция tutor/student;
  high-risk файлы (rule 10) не трогай без необходимости.

ОТКРЫТЫЕ ВОПРОСЫ — НЕ угадывай, СПРОСИ меня перед реализацией затронутого слайса:
(1) квота AI-загрузок: считать в общий дневной лимит или отдельный «AI-загрузок/день» (rule 99)?
(2) как резолвить topic_suggestion→topic_id: только точное совпадение имени, или создавать тему?

СТАРТ: составь план в plan mode и покажи мне. Код не трогай до approve.
```

---

## B. Ревью для ChatGPT-5.5 / Codex (вставить целиком, на каждый слайс)

```text
РОЛЬ: независимый ревьюер. Тебе дают дифф ОДНОГО слайса P0 фичи «AI-загрузка задач» БЕЗ контекста
автора. Контекст-доки: docs/delivery/features/kb-ai-task-loader/{spec.md, prompts.md,
kb-ai-task-loader-tasks.md} + .claude/rules/*. Проверь по чеклисту и верни вердикт
PASS / CONDITIONAL / FAIL со списком находок (severity · файл:строка · проблема · предлагаемый фикс).

ЧЕКЛИСТ:
1. Write-path: запись в kb_tasks ТОЛЬКО через существующий insertTask. Нет нового
   `from('kb_tasks').insert/.upsert`. Грепни — новых write-site быть не должно (rule 40).
2. Anti-leak: edge не возвращает лишних полей; рубрика (rubric_text/rubric_image_urls) и решение
   остаются в персональной папке, в Каталог не утекают; в логах нет PII (текст задач/email/имена).
3. Fingerprint: kb_normalize_fingerprint вызывается с 3 арг (text, answer, attachment_url).
4. Изображения: bucket-whitelist (только kb-attachments); `storage://` резолвится в signed/base64
   ДО AI и НИКОГДА не уходит в промпт как текст; server-side fetch обёрнут в rewriteToDirect.
5. Рисунки: в P0 нет генерации/перерисовки; image_action форсится 'attach_original'.
6. Anti-hallucination: при answer_confidence='low' answer=null — нормализация на сервере, даже если
   модель нарушила.
7. Error-contract (rule 97): non-2xx = {error: рус, code}; клиент использует extractEdgeFunctionError
   (не показывает «non-2xx status code»).
8. Edge config: verify_jwt=true в config.toml + deploy без --no-verify-jwt + запись в workflow
   (rule 96 #11).
9. Safari/iOS (rule 80): нет lookbehind/structuredClone/Array.at/crypto.randomUUID в hot-path;
   input/textarea/select ≥16px; touch-action: manipulation; URL.revokeObjectURL cleanup.
10. Design (rule 90): один primary CTA; без эмодзи в chrome; Lucide; Golos Text; MathText lazy
    (не импортируется в src/components/ui/*).
11. Изоляция/safe-change (rule 10): затронут только tutor-домен; high-risk файлы
    (AuthGuard/TutorGuard/Chat/telegram-bot) не тронуты без явной необходимости.
12. Валидация: build/lint/smoke-check проходят.

ФОРМАТ ОТВЕТА:
Вердикт: PASS | CONDITIONAL | FAIL
Находки:
- [P0/P1/P2] файл:строка — проблема — предлагаемый фикс
```

---

## Заметки

- **Слайсами, не всё разом** — так Codex-ревью точнее, а откат проще. После слайса 1 (edge) дай Lovable передеплоить и проверь `curl` функции (`401` = живо/JWT, `503` = boot-crash).
- **Стоп-точки в плане обязательны** — между слайсами ты ревьюишь дифф и гоняешь Codex; CC не должен катить P0 без остановок.
- **Продуктовые развилки** (квота, резолв тем) реши до слайсов 4/5 — CC спросит, не угадает.
- После P0 — `kb-ai-task-loader-tasks.md` Phase P1 (PDF-задачник + авто-темы и т.д.) тем же циклом.
