

## Проблема (root cause)

В чате `/homework/bc68b233-...` задача 1 имеет:
- `task_text = "[Задача на фото]"` (placeholder)
- `task_image_url = storage://kb-attachments/.../60c649be-9f7c-4dc6-adcd-401fda538dab.png` (электростатика)

AI ответил про **термодинамику с P-V диаграммой и 40 кДж** — это чистая галлюцинация. Найдено в логах edge function `chat`:

```
2026-04-22T05:47:14Z WARNING [SECURITY] Blocked unauthorized domain: vrsseotrfmsxpbciyqzc.supabase.co
2026-04-22T05:47:14Z ERROR   [SECURITY] Rejected generated task image signed URL
```

В `supabase/functions/chat/index.ts` whitelist `ALLOWED_IMAGE_DOMAINS` (строки 53-59) разрешает только 4 бакета:
`chat-images`, `homework-task-images`, `homework-submissions`, `homework-images`.

**`kb-attachments` отсутствует.** Когда KB-задача попадает в ДЗ через «В ДЗ», `task_image_url` остаётся `storage://kb-attachments/...`. `resolveTaskImageUrlsForAI` создаёт signed URL → `isValidImageUrl` отклоняет домен → `fetchImageAsBase64DataUrl` возвращает `null` → AI получает только текст «`Условие: [Задача на фото]`» + «ВАЖНО: условие на картинке» **без картинки** → Gemini выдумывает правдоподобную физическую задачу (один из самых частых сценариев → галлюцинирует термодинамику).

То же самое будет повторяться **для любого нового бакета** или нового write-path KB→ДЗ. Это архитектурная дыра, не разовый баг.

---

## Архитектурное решение (3 слоя защиты)

### Слой 1 — Fix immediate: whitelist `kb-attachments` в `/chat`

`supabase/functions/chat/index.ts`, `ALLOWED_IMAGE_DOMAINS`:

```ts
const ALLOWED_IMAGE_DOMAINS = [
  `${SUPABASE_URL}/storage/v1/object/sign/chat-images/`,
  `${SUPABASE_URL}/storage/v1/object/sign/homework-task-images/`,
  `${SUPABASE_URL}/storage/v1/object/sign/homework-submissions/`,
  `${SUPABASE_URL}/storage/v1/object/sign/homework-images/`,
  `${SUPABASE_URL}/storage/v1/object/sign/homework-materials/`,  // NEW
  `${SUPABASE_URL}/storage/v1/object/sign/kb-attachments/`,      // NEW — KB→ДЗ flow
];
```

Это разблокирует AI на электростатику немедленно.

### Слой 2 — Defense in depth: единый whitelist + предохранитель

Проблема: whitelist существует **только в `/chat`**, в `homework-api` (`vision_checker`, `guided_ai`) — другая логика. Это рассинхронизировано.

1. **Один источник истины** — выносим whitelist в `supabase/functions/_shared/image-domains.ts`:
   ```ts
   export const HOMEWORK_AI_BUCKETS = [
     "chat-images", "homework-task-images", "homework-submissions",
     "homework-images", "homework-materials", "kb-attachments",
   ] as const;
   export function isAllowedSignedUrl(url: string): boolean { ... }
   ```
   Импортирует и `chat/index.ts`, и любая будущая функция, работающая с AI-картинками.

2. **Предохранитель: блокировать ответ AI, если картинка УСЛОВИЯ ожидалась, но не дошла.** Сейчас сервер молча отдаёт «голый» промпт — AI галлюцинирует. Делаем явно:

   В `chat/index.ts` после `resolveTaskImageUrlsForAI` добавляем:
   ```ts
   const expectedTaskImages = (taskImageUrls ?? []).length;
   const resolvedTaskImages = taskPromptImageDataUrls.length;
   const taskTextIsPlaceholder = !taskContext ||
     /\[задача на фото\]|\[task on (the )?image\]/i.test(taskContext);

   if (expectedTaskImages > 0 && resolvedTaskImages === 0 && taskTextIsPlaceholder) {
     // Картинка задачи требовалась, но не доехала. Без неё условия нет вообще.
     // Не запускаем AI вслепую — возвращаем понятное сообщение.
     return safeStreamErrorResponse(
       "Не удалось загрузить картинку с условием задачи. " +
       "Это техническая проблема — попробуйте ещё раз через минуту, или " +
       "перешлите условие текстом. Мы уже залогировали инцидент.",
       { telemetry: "guided_chat_task_image_missing", assignmentId, taskId }
     );
   }
   ```
   Тот же гейт в `evaluateStudentAnswer` и `generateHint` (`homework-api/guided_ai.ts`) — если картинка ожидалась и текст-плейсхолдер, не зовём LLM, возвращаем пользовательское сообщение «не вижу условия, перепришлите».

3. **Telemetry на проблему**: события `guided_chat_task_image_missing`, `guided_check_task_image_missing`, `guided_hint_task_image_missing` → видны в логах для мониторинга.

### Слой 3 — Anti-regression: новый bucket в KB не валит AI

Корневая причина — write-path KB→ДЗ кладёт `storage://kb-attachments/...` в `homework_tutor_tasks.task_image_url`, но потребитель `/chat` не знает про этот bucket. Делаем два шага:

1. **Документ-инвариант** в `.claude/rules/40-homework-system.md` (одна короткая секция): «Любой bucket, который может попасть в `homework_tutor_tasks.task_image_url` или `solution_image_urls`, **обязан** быть в `_shared/image-domains.ts::HOMEWORK_AI_BUCKETS`. Чек-лист добавлен в pre-commit раздел rule 40.»

2. **Smoke-тест** в `scripts/smoke-check.mjs`: SELECT distinct prefix из `task_image_url`/`solution_image_urls`/`rubric_image_urls`/`task_image_url` через `storage://([^/]+)/`. Любой bucket, не входящий в `HOMEWORK_AI_BUCKETS`, → smoke-check fail с явным сообщением «bucket X в БД, но не в whitelist — добавьте в `_shared/image-domains.ts`». CI ловит до прода.

---

## UX для ученика (что увидит, если что-то ломается)

Сейчас: AI отвечает уверенно про несуществующую задачу. Ученик доверяет, тратит время, попадает в тупик.

После фикса:
- **Норма (99% случаев)**: картинка резолвится → AI видит электростатику → даёт корректный заход.
- **Деградация**: картинка реально не доехала (сеть/storage outage) → ученик видит явное «не удалось загрузить условие, попробуйте ещё раз через минуту» вместо галлюцинации. Кнопка «Повторить» рядом — ретрай шага без потери истории. Никакой ai_reply при missing image не сохраняется в БД.

---

## Ответ на вопрос «лучше OCR на стороне репетитора или multimodal у ученика?»

**Гибрид (multimodal + опциональный server-side OCR fallback)**, не выбор-один-из-двух:

- **Multimodal Gemini остаётся primary** — он держит схемы, графики, векторы, рукописный текст одновременно; OCR это потеряет.
- **Server-side OCR кэш** (`homework_tutor_tasks.ocr_text` колонка уже есть) запускается background-jobом при создании задачи KB→ДЗ. Если multimodal путь падает (как сейчас с whitelist) — fallback в текстовый промпт с OCR-условием. Это **второй слой anti-hallucination**, не замена.
- **Tutor-side OCR ввод** — отдельно: репетитору при создании KB-задачи показываем превью авто-OCR и даём поле «Уточнить ключевые данные» (например, «потенциалы 1 ГВ и 1.5 ГВ, заряд −1 нКл»). Эти данные склеиваются в `task_text` и страхуют от любой проблемы с картинкой.

Это **уже опционально** — задачи без поправок репетитора всё равно работают через multimodal. Но даёт нулевой риск галлюцинаций на критических ДЗ.

Этот гибрид я предлагаю **отдельной итерацией** после фикса whitelist + предохранителя. Сейчас в скоупе — слои 1-3 выше.

---

## Файлы

**Изменяются:**
- `supabase/functions/chat/index.ts` — whitelist + image-missing guard.
- `supabase/functions/homework-api/guided_ai.ts` — image-missing guard в `evaluateStudentAnswer` и `generateHint` (fail closed, не зовём LLM).
- `supabase/functions/_shared/image-domains.ts` — **новый**, single source of truth.
- `scripts/smoke-check.mjs` — новая проверка bucket-список vs whitelist.
- `.claude/rules/40-homework-system.md` — секция «AI image bucket whitelist invariant» + памятка.

**Не трогаем:** DB-схема, RLS, KB write-path (`HWDrawer.tsx`), фронтенд `GuidedHomeworkWorkspace.tsx`, существующие edge functions кроме `chat` и `homework-api/guided_ai.ts`.

## Деплой

1. Apply changes → deploy `chat` и `homework-api`.
2. `npm run smoke-check && npm run build`.
3. Никаких миграций, секретов, VAPID-ключей.

## Валидация

1. Открыть `/homework/bc68b233-...`, нажать «Шаг решения» → AI описывает **электростатику** (2 точки, потенциалы 1 ГВ и 1.5 ГВ, заряд -1 нКл), **не термодинамику**.
2. Логов `[SECURITY] Blocked unauthorized domain: ...kb-attachments` больше нет.
3. Симулировать «картинка не доехала» (временно сломать parseStorageRef) → ученик видит «не удалось загрузить условие», AI **не вызывается**, `homework_tutor_thread_messages` не получает фейковый ai_reply.
4. `npm run smoke-check` падает, если в БД есть bucket вне whitelist.

