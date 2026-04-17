# Tasks: Hint Quality + ban шаблона «перечитай условие» (Е10)

**Spec**: `docs/delivery/features/hint-quality/spec.md`
**Prompt patch**: `docs/delivery/features/hint-quality/prompt-patch.md`
**Feature**: убрать шаблонные no-op подсказки в guided chat и заставить AI давать содержательные hint'ы по конкретной физике задачи.
**Priority**: P0 (pilot blocker, Егор 2026-04-06 — ученики ненавидят «перечитай условие»)
**Target deploy**: Phase A — 6 апреля 2026; Phase B — 7-8 апреля; Phase C — 9 апреля

---

## TASK-1: `FORBIDDEN_HINT_PHRASES` + `validateHintContent`

**Job**: S1-2 (не застрять и не бросить ДЗ)
**Agent**: Claude Code
**Files**: `supabase/functions/homework-api/guided_ai.ts`
**AC**: модуль экспортирует/локально использует валидатор, который ловит все 5 запрещённых паттернов и помечает hint < 40 символов как `too_short`

**Промпт для агента**:

Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Контекст: pilot blocker Е10. AI в guided chat шлёт ученикам шаблонные подсказки вида «перечитай условие задачи и выдели ключевые данные». Это no-op, ученики бросают ДЗ, репетитор теряет доверие. Ты добавляешь deterministic ban list и валидатор, который пост-фактум проверяет ответ модели.

Прочитай:
1. `docs/delivery/features/hint-quality/spec.md` (целиком, особенно §5)
2. `docs/delivery/features/hint-quality/prompt-patch.md`
3. `CLAUDE.md`
4. `.claude/rules/40-homework-system.md` (Передача изображений в AI, generateHint)
5. `.claude/rules/80-cross-browser.md` (regex без lookbehind)
6. Существующий `supabase/functions/homework-api/guided_ai.ts` — секция `generateHint`

Задача:
1. На уровне модуля `guided_ai.ts` добавь `const FORBIDDEN_HINT_PHRASES: RegExp[]` со списком из spec §5 (5 паттернов: «перечитай условие», «выдели ключев», «подумай внимательн», «вспомни материал», «что тебе дано»).
2. Используй `i` flag, без lookbehind, чтобы Safari edge runtime не падал.
3. Добавь функцию `validateHintContent(text: string): { ok: boolean; reason?: string }`:
   - Возвращает `{ ok: false, reason: 'forbidden:<source>' }` если хоть один rx сматчился
   - Возвращает `{ ok: false, reason: 'too_short' }` если `text.trim().length < 40`
   - Иначе `{ ok: true }`
4. Не вызывай функцию пока — это TASK-4. Только определение + чистая логика.
5. Не меняй другие функции файла.

Acceptance Criteria:
- Given hint = «Попробуй перечитать условие задачи и выделить ключевые данные»
- When `validateHintContent(hint)` вызван
- Then `{ ok: false, reason: 'forbidden:перечитай\\s+условие' }`
- Given hint = «Подумай»
- When validate
- Then `{ ok: false, reason: 'too_short' }`
- Given hint = «По второму закону Ньютона ускорение тела равно отношению силы трения к массе. Запиши уравнение для бруска.»
- When validate
- Then `{ ok: true }`

Guardrails:
- НЕ используй RegExp lookbehind
- НЕ меняй сигнатуру `generateHint`
- НЕ трогай `evaluateStudentAnswer`
- Scope: только `guided_ai.ts`, ниже existing imports

Mandatory end block:
- Changed files
- Summary
- Validation: `npm run lint && npm run build && npm run smoke-check`
- Docs-to-update: ничего (TASK-7 финализирует)
- Self-check vs doc 16: подсказка как «action layer», не «chat-only»

---

## TASK-2: Hardened hint system prompt

**Job**: S1-1, S1-2, R1-3
**Agent**: Claude Code
**Files**: `supabase/functions/homework-api/guided_ai.ts`
**AC**: `buildGuidedSystemPrompt('hint', ...)` или эквивалентная ветка `generateHint` использует prompt из `prompt-patch.md` с явным запретом фраз и обязательным упоминанием физической величины/закона

**Промпт для агента**:

Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Контекст: продолжение Е10. После TASK-1 у нас есть валидатор, теперь нужно обновить сам system prompt, чтобы модель **изначально** не генерировала шаблон. Промпт берётся 1:1 из `prompt-patch.md`.

Прочитай:
1. `docs/delivery/features/hint-quality/spec.md` §3, §5
2. `docs/delivery/features/hint-quality/prompt-patch.md` — каноничный текст промпта
3. `CLAUDE.md`
4. `.claude/rules/40-homework-system.md` (Передача изображений в AI — четыре пути, секция про hint)
5. `docs/discovery/product/tutor-ai-agents/16-ux-principles-for-tutor-product-sokrat.md`
6. Текущий код `generateHint` и `buildGuidedSystemPrompt('hint', ...)` в `guided_ai.ts`

Задача:
1. Замени hint-ветку `buildGuidedSystemPrompt` (или inline-prompt в `generateHint`, в зависимости от текущей структуры) на содержимое промпта из `prompt-patch.md`.
2. Сохрани placeholder-плейсхолдеры: `{task_text}`, `{prior_hints}`, `{student_latest}`, и (если уже передаётся) `{level}`. Если параметра `level` ещё нет — используй фиксированный hardcoded «УРОВЕНЬ ПОДСКАЗКИ: 1/3» для Phase A.
3. Сохрани передачу изображения задачи (signed URL → data URL) — НЕ ломай существующий path.
4. НЕ добавляй level escalation сейчас (это Phase B / отдельная задача).
5. Сохрани сократический тон в первой версии (уровень 1).

Acceptance Criteria:
- Given задача про брусок и силу трения
- When `generateHint` вызван (мокнутый или live)
- Then в `messages[0].content` system prompt'а присутствуют строки «КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО» и «Упоминай конкретную величину»
- Given задача с пустым `task_text` и только изображением
- When prompt собран
- Then в нём есть инструкция «опиши что видишь и дай подсказку по видимым величинам»
- Given hint вызван без изменения сигнатуры
- When edge function задеплоен
- Then ни один существующий call site `generateHint` не сломан

Guardrails:
- НЕ трогай `evaluateStudentAnswer`
- НЕ меняй DB schema
- НЕ ломай image inline path (data URL)
- НЕ удаляй существующие FORBIDDEN_HINT_PHRASES из TASK-1
- Scope: только `guided_ai.ts`

Mandatory end block:
- Changed files
- Summary
- Validation: `npm run lint && npm run build && npm run smoke-check`
- Docs-to-update: пометить в `.claude/rules/40-homework-system.md` секцию hint quality (TASK-7)
- Self-check vs doc 16/17: AI = draft + action; формат hint в чате не меняется

---

## TASK-3: `buildFallbackHint` — детерминированный фолбэк

**Job**: S1-2
**Agent**: Claude Code
**Files**: `supabase/functions/homework-api/guided_ai.ts`
**AC**: функция возвращает осмысленный fallback, ссылающийся минимум на одно существительное из `task_text`, длиной ≥ 40 символов; не использует ни одной фразы из `FORBIDDEN_HINT_PHRASES`

**Промпт для агента**:

Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Контекст: даже с hardened prompt + retry бывает что модель упорно генерирует мусор (Lovable gateway хитёр). На этот случай нужен deterministic fallback, который **никогда** не вернёт шаблон и **всегда** упомянет хотя бы одно слово из задачи.

Прочитай:
1. `docs/delivery/features/hint-quality/spec.md` §5 (Post-generation validation, fallback)
2. `docs/delivery/features/hint-quality/prompt-patch.md` (раздел fallback, если есть)
3. Код TASK-1 (`FORBIDDEN_HINT_PHRASES`, `validateHintContent`) в `guided_ai.ts`

Задача:
1. Добавь функцию `buildFallbackHint(taskContext: { taskText?: string | null; hasImage?: boolean }): string`:
   - Извлеки первое значимое существительное/термин длиной > 4 символов из `taskText` (простой regex `/[А-Яа-яA-Za-z]{5,}/u`, первый матч)
   - Если нашёл слово `keyword`, верни строку:
     `Сосредоточься на том, что в задаче фигурирует «${keyword}». Какая физическая величина это описывает и какой закон с ней связан?`
   - Если `taskText` пустой и `hasImage` true, верни:
     `На изображении задачи есть конкретные величины — назови, что именно дано (силы, расстояния, время) и какой закон их связывает.`
   - Если не нашёл ни слов, ни изображения — верни:
     `Какая физическая величина является искомой в этой задаче и какие данные нужны, чтобы её найти?`
2. Все три варианта **обязаны** проходить `validateHintContent` (длина ≥ 40, не матчат FORBIDDEN). Это твой acceptance.
3. Не вызывай fallback пока — это TASK-4.

Acceptance Criteria:
- Given `taskText = 'Брусок массой 2 кг скользит по горизонтальной поверхности'`
- When `buildFallbackHint({ taskText })`
- Then результат содержит «Брусок» и `validateHintContent` возвращает `{ ok: true }`
- Given `taskText = ''`, `hasImage = true`
- When fallback
- Then ответ упоминает «изображении» и `ok: true`
- Given пустой контекст
- When fallback
- Then ответ ≥ 40 символов и `ok: true`

Guardrails:
- НЕ используй lookbehind regex
- НЕ зови AI в fallback (он deterministic)
- НЕ трогай `generateHint` пока

Mandatory end block:
- Changed files
- Summary
- Validation: `npm run lint && npm run build && npm run smoke-check`
- Self-check: fallback соответствует «action layer» (всегда даёт ученику на чём сосредоточиться)

---

## TASK-4: Retry-once loop в `generateHint` + интеграция fallback

**Job**: S1-1, S1-2, R1-3
**Agent**: Claude Code
**Files**: `supabase/functions/homework-api/guided_ai.ts`
**AC**: при первом ответе модели, который не проходит `validateHintContent`, делается **ровно один** retry с усиленным reminder-промптом; если второй ответ снова не проходит — возвращается `buildFallbackHint`. Latency ≤ 2× baseline только при retry.

**Промпт для агента**:

Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Контекст: финальная склейка Е10 Phase A. Связываем prompt (TASK-2) + validator (TASK-1) + fallback (TASK-3) в единый flow внутри `generateHint`.

Прочитай:
1. `docs/delivery/features/hint-quality/spec.md` §5 (Flow строка `generate → validate → if !ok → regenerate ONCE → if still !ok → log + return fallback`)
2. `docs/delivery/features/hint-quality/prompt-patch.md` (replacement hint prompt — текст «ты нарушил правило»)
3. TASK-1, TASK-2, TASK-3 (твоя предыдущая работа)
4. `.claude/rules/40-homework-system.md`

Задача:
1. В `generateHint`, после получения первого ответа модели:
   - Вызови `validateHintContent(firstHint)`
   - Если `ok` — вернуть как раньше
2. Если `!ok`:
   - Собери replacement-промпт по шаблону из `prompt-patch.md` (передай оригинальный hint и `reason` из validator)
   - Сделай **один** повторный вызов AI с этим replacement system message
   - Прогони результат через `validateHintContent`
3. Если второй ответ тоже `!ok`:
   - Вызови `buildFallbackHint({ taskText, hasImage: !!resolvedImageDataUrl })`
   - Залогируй `console.warn('[hint-quality] fallback used', { reason1, reason2 })`
   - Верни fallback как обычный hint (тот же message_kind, тот же return shape)
4. **Никогда** не делай больше 1 retry — это контракт против latency blowout.
5. Сохрани передачу изображения во ВСЕХ вызовах (initial + retry). Не повторяй image resolve дважды — переиспользуй уже резолвленный data URL.

Acceptance Criteria:
- Given модель вернула «Перечитай условие задачи»
- When `generateHint` отработал
- Then был ровно 1 retry, и в финальном ответе нет `forbidden:` substring
- Given retry тоже вернул шаблон
- When validator снова `!ok`
- Then возвращён `buildFallbackHint` результат, в логах есть `[hint-quality] fallback used`
- Given первый ответ модели валидный
- When `generateHint` отработал
- Then **не было** второго вызова AI (latency не выросла)
- Given задача с изображением
- When retry happens
- Then изображение всё ещё передано в replacement-вызов (data URL переиспользован, не resolved заново)

Guardrails:
- НЕ делай >1 retry
- НЕ ломай возвращаемый shape `generateHint`
- НЕ трогай `handleRequestHint` — он работает по тому же контракту
- НЕ зови `Date` парсинг строк (Safari)
- Scope: только `guided_ai.ts`

Mandatory end block:
- Changed files
- Summary
- Validation: `npm run lint && npm run build && npm run smoke-check`
- Docs-to-update: TASK-7 (rules)
- Self-check vs doc 16: «AI = draft + action, не chat-only output»

---

## TASK-5: Structured logging для rejected hints (Phase C — telemetry)

**Job**: R1-3 (репетитор / разработчик видит как часто AI шлёт мусор)
**Agent**: Claude Code
**Files**: `supabase/functions/homework-api/guided_ai.ts` (опционально `index.ts`)
**AC**: каждое срабатывание validator с `!ok` пишет в `console.warn` структурный JSON `{ event: 'hint_rejected', reason, retry: 1|2, task_id, assignment_id }`. Без PII (без полного hint и student answer).

**Промпт для агента**:

Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Контекст: Phase C Е10 — нужно понимать, насколько часто validator срабатывает в production. Это вход для решения «менять prompt дальше или ок».

Прочитай:
1. `docs/delivery/features/hint-quality/spec.md` §7 (Validation), §9 (Phase C)
2. Код TASK-4 (`generateHint` flow)
3. `.claude/rules/40-homework-system.md`

Задача:
1. В точках, где `validateHintContent` возвращает `!ok`, добавь структурное логирование:
   ```ts
   console.warn(JSON.stringify({
     event: 'hint_rejected',
     reason,
     retry: attempt, // 1 для первого rejection, 2 если retry тоже не прошёл
     task_id,
     assignment_id,
   }));
   ```
2. Передай `task_id` и `assignment_id` в `generateHint` через params, если их там ещё нет (в spec они доступны через caller `handleRequestHint`).
3. Логируй также `{ event: 'hint_fallback_used', task_id, assignment_id }` когда вернулся `buildFallbackHint`.
4. **НЕ** логируй сам текст hint, student answer или task_text — только метаданные.
5. Если параметров для каких-то полей нет — поставь `null`, не падай.

Acceptance Criteria:
- Given первый hint отброшен по `forbidden:`
- When validator сработал
- Then в Supabase logs есть `{"event":"hint_rejected","reason":"forbidden:...","retry":1,...}`
- Given fallback использован
- When generateHint вернул fallback
- Then в логах есть `hint_fallback_used`
- Given валидный первый hint
- When ничего не сработало
- Then логов rejected/fallback нет

Guardrails:
- НЕ логируй текст hint / answer / task_text
- НЕ ломай return shape
- НЕ добавляй npm dependencies (Deno edge runtime)

Mandatory end block:
- Changed files
- Summary
- Validation: `npm run lint && npm run build && npm run smoke-check`
- Docs-to-update: TASK-7
- Self-check vs doc 18 pilot KPI: «hint quality measurable»

---

## TASK-6: Manual smoke test на 5 KIM-задачах × 3 уровня

**Job**: S1-2, R1-3
**Agent**: Vladimir (manual QA)
**Files**: нет кодовых изменений
**AC**: ни в одном из 15 hint'ов нет фраз из `FORBIDDEN_HINT_PHRASES`; ≥ 14 из 15 hint'ов содержат конкретный физический термин/закон

**Промпт / чек-лист**:

1. Подготовь 5 задач из KB разных топиков:
   - Кинематика (текст)
   - Динамика (текст с цифрами)
   - Электричество (формула в условии)
   - Молекулярка (текст)
   - Любая задача с изображением (без `task_text`)
2. Создай ДЗ → назначь себе test-студенту → открой guided chat
3. На каждой задаче запроси Hint **3 раза подряд** (пока без level escalation — все три должны быть содержательные, не повторы)
4. Для каждого из 15 ответов отметь:
   - Содержит ли запрещённую фразу? (должно быть 0)
   - Упоминает ли физическую величину или закон? (должно быть ≥ 14)
   - Длина 1–3 предложения?
5. Открой Supabase logs → проверь, как часто `hint_rejected` / `hint_fallback_used` сработали (ожидание: rejected ≤ 2, fallback = 0 при адекватной модели)
6. Если хотя бы 1 запрещённая фраза или > 1 fallback — возврат в TASK-2 / TASK-4

---

## TASK-7: Обновить `.claude/rules/40-homework-system.md`

**Job**: R1-3 (документация для будущих агентов)
**Agent**: Claude Code
**Files**: `.claude/rules/40-homework-system.md`
**AC**: новая секция `### Hint quality — FORBIDDEN_HINT_PHRASES + retry-once + fallback (Е10, 2026-04-06)` короткая (10–15 строк), упоминает все ключевые компоненты и ссылается на спеку

**Промпт для агента**:

Твоя роль: технический писатель проекта SokratAI.

Прочитай:
1. `docs/delivery/features/hint-quality/spec.md`
2. Готовый код после TASK-1..5 в `supabase/functions/homework-api/guided_ai.ts`
3. Текущий `.claude/rules/40-homework-system.md`

Задача: добавь новую секцию рядом с другими секциями homework system со следующими пунктами:
- Заголовок: `### Hint quality — FORBIDDEN_HINT_PHRASES + retry-once + fallback (Е10, 2026-04-06)`
- Что: deterministic ban list + post-gen validator в `generateHint`
- Список запрещённых фраз: «перечитай условие», «выдели ключевые данные», «подумай внимательнее», «вспомни материал», «что тебе дано»
- Flow: `generate → validate → 1 retry с replacement prompt → fallback (`buildFallbackHint`)`
- Контракт: **≤ 1 retry**, никогда больше — иначе latency blowout
- Logging: `console.warn` JSON `hint_rejected` / `hint_fallback_used`, без PII
- Phase B (level escalation 1–3) — отдельная итерация
- Ссылка: `docs/delivery/features/hint-quality/spec.md`

Guardrails:
- Не дублируй содержимое спеки целиком
- Формат соответствует существующим секциям файла
- Не трогай другие секции

Mandatory end block:
- Changed files
- Summary
- Validation: `npm run lint`
- Self-check

---

## Copy-paste промпты для агентов

### TASK-1 (Claude Code)

```
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Контекст: pilot blocker Е10. AI шлёт ученикам шаблон «перечитай условие задачи и выдели ключевые данные». Надо добавить deterministic ban list + post-gen валидатор в guided_ai.ts.

Прочитай:
1. docs/delivery/features/hint-quality/spec.md (целиком, особенно §5)
2. docs/delivery/features/hint-quality/prompt-patch.md
3. CLAUDE.md
4. .claude/rules/40-homework-system.md (секция Передача изображений в AI, generateHint)
5. .claude/rules/80-cross-browser.md (regex без lookbehind)
6. supabase/functions/homework-api/guided_ai.ts (текущий generateHint)

Задача:
1. Module-level const FORBIDDEN_HINT_PHRASES: RegExp[] с 5 паттернами из spec §5 (перечитай условие / выдели ключев / подумай внимательн / вспомни материал / что тебе дано), флаг i, без lookbehind.
2. Функция validateHintContent(text): { ok, reason? }:
   - if matches forbidden → { ok:false, reason:'forbidden:<rx.source>' }
   - if text.trim().length < 40 → { ok:false, reason:'too_short' }
   - else { ok:true }
3. НЕ вызывай функцию пока — это TASK-4.

Acceptance Criteria:
- Given «Попробуй перечитать условие...», When validate, Then ok:false reason starts with 'forbidden:'
- Given «Подумай», When validate, Then reason='too_short'
- Given «По второму закону Ньютона ускорение бруска равно...» (>40 chars, no forbidden), When validate, Then ok:true

Guardrails:
- НЕТ RegExp lookbehind
- НЕ меняй сигнатуры существующих функций
- НЕ трогай evaluateStudentAnswer
- Scope: только guided_ai.ts

Mandatory end block:
- Changed files
- Summary
- Validation: npm run lint && npm run build && npm run smoke-check
- Docs-to-update: TASK-7
- Self-check vs doc 16
```

### TASK-2 (Claude Code)

```
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Контекст: продолжение Е10. После TASK-1 (валидатор) надо обновить системный промпт для hint, чтобы модель изначально не генерировала шаблон. Текст промпта берётся 1:1 из prompt-patch.md.

Прочитай:
1. docs/delivery/features/hint-quality/spec.md §3, §5
2. docs/delivery/features/hint-quality/prompt-patch.md (canonical prompt text)
3. CLAUDE.md
4. .claude/rules/40-homework-system.md (Передача изображений в AI — четыре пути)
5. docs/discovery/product/tutor-ai-agents/16-ux-principles-for-tutor-product-sokrat.md
6. supabase/functions/homework-api/guided_ai.ts (текущий buildGuidedSystemPrompt('hint',...) и generateHint)

Задача:
1. Замени hint-ветку buildGuidedSystemPrompt (или inline промпт в generateHint) на версию из prompt-patch.md.
2. Сохрани placeholders {task_text}, {prior_hints}, {student_latest}. Параметр {level} — если уже есть, пробрось; иначе hardcode «УРОВЕНЬ ПОДСКАЗКИ: 1/3» для Phase A.
3. Сохрани передачу изображения задачи (signed URL → data URL inline).
4. НЕ добавляй level escalation сейчас.
5. Сохрани сократический тон в Level 1.

Acceptance Criteria:
- Given задача про брусок, When generateHint вызван, Then в system prompt есть «КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО» и «Упоминай конкретную величину»
- Given пустой task_text + изображение, When prompt собран, Then в нём «опиши что видишь и дай подсказку по видимым величинам»
- Given существующие callers generateHint, When deploy, Then ничего не сломано (сигнатура сохранена)

Guardrails:
- НЕ трогай evaluateStudentAnswer
- НЕ ломай image inline path
- НЕ удаляй FORBIDDEN_HINT_PHRASES из TASK-1
- Scope: только guided_ai.ts

Mandatory end block:
- Changed files
- Summary
- Validation: npm run lint && npm run build && npm run smoke-check
- Docs-to-update: TASK-7
- Self-check vs doc 16/17
```

### TASK-3 (Claude Code)

```
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Контекст: даже с hardened prompt + retry бывает что Lovable gateway возвращает мусор. Нужен deterministic fallback, который НИКОГДА не даст шаблон и ВСЕГДА упомянет хотя бы одно слово из задачи.

Прочитай:
1. docs/delivery/features/hint-quality/spec.md §5 (fallback, validation flow)
2. docs/delivery/features/hint-quality/prompt-patch.md (раздел fallback)
3. Код TASK-1 в guided_ai.ts

Задача:
1. Функция buildFallbackHint(taskContext: { taskText?: string|null; hasImage?: boolean }): string
2. Извлечь первое существительное/термин длиной >4 символов через /[А-Яа-яA-Za-z]{5,}/u (первый матч).
3. Если keyword найден →
   `Сосредоточься на том, что в задаче фигурирует «${keyword}». Какая физическая величина это описывает и какой закон с ней связан?`
4. Если taskText пустой и hasImage true →
   `На изображении задачи есть конкретные величины — назови, что именно дано (силы, расстояния, время) и какой закон их связывает.`
5. Иначе →
   `Какая физическая величина является искомой в этой задаче и какие данные нужны, чтобы её найти?`
6. Все три варианта должны проходить validateHintContent (>=40 chars, no forbidden).
7. НЕ вызывай fallback пока — это TASK-4.

Acceptance Criteria:
- Given taskText='Брусок массой 2 кг скользит...', When fallback, Then содержит «Брусок» и validateHintContent ok:true
- Given empty taskText + hasImage=true, When fallback, Then упоминает «изображении» и ok:true
- Given пустой контекст, When fallback, Then >=40 chars и ok:true

Guardrails:
- НЕТ lookbehind regex
- НЕ зови AI в fallback (deterministic)
- НЕ трогай generateHint пока

Mandatory end block:
- Changed files, Summary, Validation, Self-check
```

### TASK-4 (Claude Code)

```
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Контекст: финальная склейка Е10 Phase A. prompt (TASK-2) + validator (TASK-1) + fallback (TASK-3) в единый flow внутри generateHint. Контракт: ≤1 retry, никогда больше.

Прочитай:
1. docs/delivery/features/hint-quality/spec.md §5 (flow generate → validate → 1 retry → fallback)
2. docs/delivery/features/hint-quality/prompt-patch.md (replacement prompt)
3. TASK-1/2/3 в guided_ai.ts
4. .claude/rules/40-homework-system.md

Задача:
1. После initial AI ответа в generateHint → validateHintContent(firstHint).
2. Если ok → return как раньше.
3. Если !ok:
   - Собрать replacement system message по шаблону из prompt-patch.md (передать оригинальный hint и reason)
   - Один повторный вызов AI с replacement
   - validateHintContent(secondHint)
4. Если second тоже !ok → buildFallbackHint({ taskText, hasImage: !!resolvedImageDataUrl }), console.warn('[hint-quality] fallback used', { reason1, reason2 }), return fallback в том же shape.
5. Никогда не делать >1 retry.
6. Сохрани передачу изображения в обоих вызовах. Image data URL резолвить ОДИН раз и переиспользовать.

Acceptance Criteria:
- Given модель вернула «Перечитай условие задачи», When generateHint, Then ровно 1 retry, в финальном ответе нет forbidden substring
- Given retry тоже шаблон, When validator !ok, Then возвращён fallback, лог fallback used
- Given первый ответ валидный, When generateHint, Then НЕ было второго вызова AI
- Given задача с изображением, When retry, Then картинка всё ещё передана (data URL переиспользован)

Guardrails:
- НЕ >1 retry
- НЕ ломай return shape
- НЕ трогай handleRequestHint
- НЕ парсь даты строкой (Safari)
- Scope: только guided_ai.ts

Mandatory end block:
- Changed files, Summary, Validation, Docs-to-update (TASK-7), Self-check vs doc 16
```

### TASK-5 (Claude Code)

```
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Контекст: Phase C Е10 — telemetry. Понять как часто validator срабатывает и как часто включается fallback. Без PII.

Прочитай:
1. docs/delivery/features/hint-quality/spec.md §7, §9
2. Код TASK-4 (generateHint flow)
3. .claude/rules/40-homework-system.md

Задача:
1. На каждом !ok validateHintContent: console.warn(JSON.stringify({ event:'hint_rejected', reason, retry: 1|2, task_id, assignment_id }))
2. На fallback: console.warn(JSON.stringify({ event:'hint_fallback_used', task_id, assignment_id }))
3. Пробросить task_id / assignment_id в generateHint params (через handleRequestHint), если их там нет.
4. НЕ логируй текст hint, student answer, task_text.
5. Если поле недоступно — null, не падай.

Acceptance Criteria:
- Given первый rejection, When happens, Then в логах JSON с event:'hint_rejected', retry:1
- Given fallback used, When happens, Then в логах event:'hint_fallback_used'
- Given валидный первый hint, When ok, Then логов rejected/fallback нет

Guardrails:
- НЕ логируй text/answer/task_text
- НЕ ломай return shape
- НЕ добавляй npm dependencies

Mandatory end block:
- Changed files, Summary, Validation, Docs-to-update, Self-check vs doc 18 pilot KPI
```

### TASK-7 (Claude Code)

```
Твоя роль: технический писатель проекта SokratAI.

Прочитай:
1. docs/delivery/features/hint-quality/spec.md
2. Готовый код guided_ai.ts после TASK-1..5
3. Текущий .claude/rules/40-homework-system.md

Задача: добавь в .claude/rules/40-homework-system.md новую секцию рядом с другими секциями homework:

### Hint quality — FORBIDDEN_HINT_PHRASES + retry-once + fallback (Е10, 2026-04-06)

- generateHint в supabase/functions/homework-api/guided_ai.ts использует deterministic ban list FORBIDDEN_HINT_PHRASES + post-gen validateHintContent
- Запрещённые фразы: «перечитай условие», «выдели ключевые данные», «подумай внимательнее», «вспомни материал», «что тебе дано»
- Flow: generate → validate → 1 retry с replacement prompt → buildFallbackHint
- Контракт: ≤ 1 retry, никогда больше — иначе latency blowout
- Fallback всегда упоминает существительное из task_text или фразу про изображение, длина ≥ 40 chars
- Telemetry: console.warn JSON event 'hint_rejected' / 'hint_fallback_used' — без текста hint, без PII
- Phase B (level escalation 1–3) — отдельная итерация после 8 апреля
- Спека: docs/delivery/features/hint-quality/spec.md

Guardrails:
- Не дублируй спеку целиком
- Формат как у соседних секций (рус., короткий, с файлами)
- Не трогай другие секции

Mandatory end block:
- Changed files, Summary, Validation: npm run lint, Self-check
```
