# Tasks: Realtime Thread Viewer (Е9)

**Implementation status**: done

**Spec**: `docs/delivery/features/realtime-thread/spec.md`
**Feature**: Supabase Realtime подписка в `GuidedThreadViewer` — репетитор видит сообщения ученика без перезагрузки страницы.
**Priority**: P0 (pilot blocker, Егор 2026-04-06)
**Target deploy**: 7 апреля 2026

---

## TASK-1: Проверить/включить Realtime publication для `homework_tutor_thread_messages`

**Status**: done

**Job**: R2-3 (видимость прогресса ученика без дёрганий)
**Agent**: Claude Code
**Files**: `supabase/migrations/` (новая миграция, если таблицы нет в publication)
**AC**: Realtime INSERT-события доходят до клиента по каналу `thread-{threadId}`

**Промпт для агента**:

Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Контекст: сегмент — репетиторы физики ЕГЭ/ОГЭ (B2B-1), wedge — «рабочее место репетитора». AI = draft + action, не chat-only. Это pilot blocker: Егор не может смотреть как ученик решает ДЗ в реальном времени.

Прочитай:
1. `docs/delivery/features/realtime-thread/spec.md` (весь)
2. `CLAUDE.md`
3. `.claude/rules/40-homework-system.md` (секция Homework System + GuidedThreadViewer)
4. `.claude/rules/30-docs-structure.md`

Задача:
1. Выполни SQL-проверку: `SELECT * FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'homework_tutor_thread_messages';`
2. Если строка есть — ничего не делай, только зафиксируй в Summary что publication уже настроен.
3. Если строки нет — создай миграцию `supabase/migrations/{YYYYMMDDHHMMSS}_enable_realtime_homework_tutor_thread_messages.sql` с одной командой:
   ```sql
   alter publication supabase_realtime add table public.homework_tutor_thread_messages;
   ```
4. Не трогай другие таблицы в publication.

Acceptance Criteria:
- Given таблица `homework_tutor_thread_messages` в publication `supabase_realtime`
- When клиент подписывается на `postgres_changes` с этим table
- Then INSERT-события приходят в payload в течение 2 секунд

Guardrails:
- Не меняй RLS policies (они уже работают через `handleGetThread`)
- Не меняй схему таблицы
- Одна миграция, одна команда
- Если publication уже содержит таблицу — НЕ создавай миграцию

Mandatory end block:
- Changed files
- Summary (1-2 предложения)
- Validation: `npm run lint && npm run build && npm run smoke-check`
- Docs-to-update: отметить в `.claude/rules/40-homework-system.md` что Realtime thread viewer active
- Self-check: соответствует UX-принципу из doc 16 «видимость процесса, а не только результата»?

---

## TASK-2: Реализовать Realtime subscription + merge helper в `GuidedThreadViewer`

**Status**: done

**Job**: R2-3, R1-4
**Agent**: Claude Code
**Files**: `src/components/tutor/GuidedThreadViewer.tsx`, `src/lib/tutorHomeworkApi.ts`
**AC**: Новое сообщение ученика появляется в thread viewer < 2 секунд без ручного рефреша, без flicker

**Промпт для агента**:

Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Контекст: репетитор (B2B-1) во время занятия смотрит guided chat ученика. Сейчас приходится жать F5. Ты добавляешь Supabase Realtime подписку, которая мержит новые сообщения в React Query cache без рефетча. AI = draft + action: realtime усиливает action layer для репетитора.

Прочитай:
1. `docs/delivery/features/realtime-thread/spec.md` — секции 5 (Technical Design) и 8 (Risks)
2. `CLAUDE.md`
3. `.claude/rules/40-homework-system.md` (GuidedThreadViewer)
4. `.claude/rules/performance.md` (React Query key-конвенция — префикс `['tutor', ...]`)
5. `.claude/rules/80-cross-browser.md` (Safari WebSocket)
6. `docs/discovery/product/tutor-ai-agents/16-ux-principles-for-tutor-product-sokrat.md`
7. Существующий код: `src/components/tutor/GuidedThreadViewer.tsx`, `src/lib/tutorHomeworkApi.ts`, `src/lib/supabaseClient.ts`

Задача:
1. В `src/lib/tutorHomeworkApi.ts` добавь чистую функцию `mergeThreadMessage(prev, newMessage)`:
   - Если `prev` == null — вернуть как есть
   - Если сообщение с таким `id` уже в `prev.messages` — вернуть `prev` (идемпотентность)
   - Иначе — вернуть `{ ...prev, messages: [...prev.messages, newMessage] }`, отсортированные по `created_at`
2. В `src/components/tutor/GuidedThreadViewer.tsx` добавь `useEffect`, который:
   - Запускается при `enabled && threadId`
   - Создаёт Supabase channel `thread-${threadId}` с фильтром `thread_id=eq.${threadId}` на событие `INSERT` таблицы `homework_tutor_thread_messages` в schema `public`
   - В callback вызывает `queryClient.setQueryData(['tutor', 'homework', 'thread', threadId], (prev) => mergeThreadMessage(prev, payload.new))`
   - В cleanup — `channel.unsubscribe()`
3. Импорт `queryClient` через `useQueryClient()` из `@tanstack/react-query`
4. Query key должен точно совпадать с тем, что использует `useTutorThread` / существующий fetcher — если ключ другой, обнови ссылку
5. НЕ вызывай `invalidateQueries` — только `setQueryData` (избегаем flicker и лишний сетевой запрос)

Acceptance Criteria:
- Given репетитор раскрыл карточку ученика, thread загружен
- When ученик отправляет сообщение из другого устройства
- Then сообщение появляется в viewer в течение 2 секунд без перезагрузки
- Given повторный INSERT с тем же id (например, при reconnect)
- When payload приходит второй раз
- Then сообщение не дублируется в UI
- Given `enabled=false` или размонтирование
- When компонент закрывается
- Then канал отписывается (проверить в Supabase logs)

Guardrails:
- НЕ ИСПОЛЬЗУЙ `framer-motion` (запрещён в проекте)
- НЕ используй `crypto.randomUUID` без проверки Safari 15.4+
- НЕ меняй backend, RLS, структуру таблиц
- НЕ меняй student-side код
- React Query key должен быть с префиксом `['tutor', ...]`
- Scope только `GuidedThreadViewer.tsx` + helper в `tutorHomeworkApi.ts`

Mandatory end block:
- Changed files
- Summary
- Validation: `npm run lint && npm run build && npm run smoke-check`
- Docs-to-update: секция «Realtime thread viewer» в `.claude/rules/40-homework-system.md`
- Self-check: doc 16 «минимум frictions, action layer для репетитора» — соответствует?

---

## TASK-3: Sticky-bottom auto-scroll

**Status**: done

**Job**: R2-3
**Agent**: Claude Code
**Files**: `src/components/tutor/GuidedThreadViewer.tsx`
**AC**: Если репетитор внизу треда — auto-scroll к новому сообщению; если scrolled up — не дёргать

**Промпт для агента**:

Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Контекст: репетитор читает историю треда выше, параллельно приходят новые сообщения. Auto-scroll при каждом новом сообщении ломает чтение. Нужен стандартный chat-паттерн: sticky bottom — если уже внизу, прокручиваем, если нет — оставляем.

Прочитай:
1. `docs/delivery/features/realtime-thread/spec.md` — секция 6 UX и 8 Risks (auto-scroll строка)
2. `.claude/rules/80-cross-browser.md` (iOS Safari scroll)
3. Текущий код `src/components/tutor/GuidedThreadViewer.tsx`

Задача:
1. Добавь `scrollContainerRef` на внешний скролл-контейнер списка сообщений
2. Перед каждым `setQueryData` (из TASK-2) вычисли `wasAtBottom`:
   ```ts
   const el = scrollContainerRef.current;
   const wasAtBottom = !el || (el.scrollHeight - el.scrollTop - el.clientHeight < 100);
   ```
3. После `setQueryData` в `requestAnimationFrame` — если `wasAtBottom`, выполни `el.scrollTop = el.scrollHeight`
4. Порог `100` пикселей — закрепи как константу `STICKY_BOTTOM_THRESHOLD_PX`
5. НЕ используй `scrollIntoView({ behavior: 'smooth' })` на iOS Safari (лагает) — просто `scrollTop = scrollHeight`

Acceptance Criteria:
- Given репетитор прокрутил вверх (например, на 500 пикселей от дна)
- When приходит новое сообщение
- Then viewer не прокручивается автоматически
- Given репетитор внизу треда
- When приходит новое сообщение
- Then viewer прокручивается к новому сообщению в пределах 100мс
- Given iOS Safari
- When auto-scroll срабатывает
- Then нет лагов и скачков

Guardrails:
- НЕ `framer-motion`, НЕ smooth scroll на iOS
- Порог один — 100px — не делать конфиг
- Scope только `GuidedThreadViewer.tsx`

Mandatory end block:
- Changed files, Summary, Validation, Docs-to-update, Self-check vs doc 16

---

## TASK-4: Cleanup подписок + rapid toggle test

**Status**: done

**Job**: R2-3 (надёжность сессии)
**Agent**: Claude Code
**Files**: `src/components/tutor/GuidedThreadViewer.tsx`
**AC**: Нет утечек каналов после 10 open/close циклов карточек учеников

**Промпт для агента**:

Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Контекст: репетитор быстро раскрывает и сворачивает карточки учеников (их 5-15 на странице). Если cleanup подписок не работает — Supabase получает сотни параллельных каналов и может начать дропать события. Это уязвимость с высокой вероятностью в live pilot.

Прочитай:
1. `docs/delivery/features/realtime-thread/spec.md` — Risks «утечка каналов»
2. Код TASK-2 (useEffect c каналом)

Задача:
1. Убедись, что cleanup в `return () => { channel.unsubscribe(); }` выполняется при:
   - Размонтировании компонента
   - Изменении `threadId`
   - `enabled → false`
2. Добавь защиту: если `subscribe()` уже вызван — повторный subscribe на том же threadId не должен создавать второй канал. Используй `useEffect` dependency array `[enabled, threadId, queryClient]` и пусть React сам переинициализирует
3. Ручной smoke test в Chrome DevTools:
   - Открой `Application → Frames → top → WebSocket` (или Supabase dashboard → Realtime inspector)
   - 10 раз раскрой/сверни карточку ученика
   - Убедись что активных подписок не больше одной в любой момент
4. Задокументируй в комментарии внутри useEffect: «Cleanup обязателен — иначе утечка каналов при rapid toggle»

Acceptance Criteria:
- Given репетитор делает 10 циклов expand/collapse карточки
- When cleanup отработал корректно
- Then в Supabase Realtime inspector видна максимум 1 активная подписка на `thread-{id}` одновременно
- Given компонент размонтирован
- When пользователь переходит на другую страницу
- Then канал отписан, нет «висящих» подписок

Guardrails:
- НЕ добавляй ref-хранилище каналов без необходимости (лишняя сложность)
- НЕ меняй logic из TASK-2 кроме добавления гарантий cleanup

Mandatory end block:
- Changed files, Summary, Validation, Docs-to-update, Self-check

---

## TASK-5: Cross-browser smoke test

**Status**: partially done

**Job**: R2-3
**Agent**: Vladimir (manual QA)
**Files**: нет кодовых изменений
**AC**: Realtime работает в Chrome desktop, Safari 15.4+ desktop, Safari iOS

**Промпт / чек-лист**:

1. **Chrome desktop (Windows)**: открой thread viewer репетитора, с другого устройства ученик шлёт сообщение — появляется ≤ 2 сек, без flicker
2. **Safari desktop (macOS 15.4+)**: то же самое + закрой ноутбук на 1 минуту, открой — подписка должна переподключиться автоматически (Supabase JS reconnect)
3. **Safari iOS (iPhone)**: открой thread viewer в мобильном Safari, переведи в фон на 30 сек, вернись — должны прийти пропущенные сообщения при reconnect
4. **Rapid toggle**: 10 раз раскрой/сверни ученика — нет ошибок в консоли, нет висящих подписок

Если хотя бы один кейс не проходит — возврат в TASK-2 или TASK-4.

---

## TASK-6: Обновить `.claude/rules/40-homework-system.md`

**Status**: done

---

## Implementation notes (2026-04-06)

- Realtime заработал только после трёх additive-миграций:
  - `20260406143000_enable_realtime_homework_tutor_thread_messages.sql`
  - `20260406173000_enable_tutor_realtime_read_homework_thread_messages.sql`
  - `20260406181500_fix_tutor_realtime_thread_message_policy.sql`
- Критичный нюанс: для Supabase browser Realtime недостаточно того, что tutor может читать тред через backend `handleGetThread`
- Tutor `SELECT` policy на `homework_tutor_thread_messages` должна идти через `SECURITY DEFINER` helper `is_homework_thread_visible_to_tutor(thread_id)`
- Raw JOIN policy на homework-таблицы внутри `USING (...)` ломалась из-за RLS на промежуточных таблицах и не пропускала live events
- Фактическая проверка пройдена: ученик пишет с телефона, репетитор видит новые сообщения без `F5`

**Job**: R2-3 (документация для будущих агентов)
**Agent**: Claude Code
**Files**: `.claude/rules/40-homework-system.md`
**AC**: Секция «Realtime thread viewer» содержит описание подписки, query key, cleanup, sticky-bottom поведение

**Промпт для агента**:

Твоя роль: технический писатель проекта SokratAI.

Прочитай:
1. `docs/delivery/features/realtime-thread/spec.md`
2. Готовый код из TASK-2/3/4 (после merge)
3. Текущий `.claude/rules/40-homework-system.md`

Задача: добавь новую секцию под «GuidedThreadViewer — UX improvements» со следующим содержанием (короткое, 10-15 строк):
- Название: `### Realtime thread viewer (Е9, 2026-04-07)`
- Что: Supabase Realtime подписка на `homework_tutor_thread_messages` по `thread_id`
- Query key: `['tutor', 'homework', 'thread', threadId]`, merge через `mergeThreadMessage` в `tutorHomeworkApi.ts`
- Cleanup: `channel.unsubscribe()` в useEffect return, обязателен при rapid expand/collapse
- Sticky-bottom: порог `STICKY_BOTTOM_THRESHOLD_PX = 100`
- Publication: `homework_tutor_thread_messages` в `supabase_realtime` (миграция из TASK-1)
- Правило: НЕ добавлять новые подписки в `GuidedThreadViewer` без merge-helper — иначе flicker от invalidate

Guardrails:
- Секция должна соответствовать формату существующих секций файла (рус., короткая, с файлами)
- Не дублируй содержимое спеки
- Ссылка на `docs/delivery/features/realtime-thread/spec.md` в конце

Mandatory end block:
- Changed files, Summary, Validation (`npm run lint`), Self-check

---

## Copy-paste промпты для агентов

### TASK-1 (Claude Code)

```
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Контекст: pilot blocker Е9. Репетитор физики ЕГЭ/ОГЭ (B2B-1) во время занятия не может смотреть guided chat ученика в реальном времени — приходится F5. Нужно включить Supabase Realtime publication для таблицы homework_tutor_thread_messages.

Прочитай:
1. docs/delivery/features/realtime-thread/spec.md
2. CLAUDE.md
3. .claude/rules/40-homework-system.md
4. .claude/rules/30-docs-structure.md

Задача:
1. Проверь SQL: SELECT * FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'homework_tutor_thread_messages';
2. Если строки нет — создай миграцию supabase/migrations/{timestamp}_enable_realtime_homework_tutor_thread_messages.sql с одной командой:
   alter publication supabase_realtime add table public.homework_tutor_thread_messages;
3. Если publication уже содержит таблицу — не создавай миграцию, зафиксируй в Summary.

Acceptance Criteria:
- Given таблица в publication supabase_realtime
- When клиент подписывается на postgres_changes
- Then INSERT-события приходят в payload ≤ 2 сек

Guardrails:
- Не меняй RLS, не меняй схему, не трогай другие таблицы в publication.
- Одна миграция — одна команда.

Mandatory end block:
- Changed files
- Summary (1-2 предложения)
- Validation: npm run lint && npm run build && npm run smoke-check
- Docs-to-update: отметить в .claude/rules/40-homework-system.md
- Self-check vs doc 16 (UX principles)
```

### TASK-2 (Claude Code)

```
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Контекст: pilot blocker Е9. Ты добавляешь Supabase Realtime подписку в GuidedThreadViewer, которая мержит новые сообщения в React Query cache через setQueryData (без invalidate/refetch, без flicker). AI = draft + action, realtime усиливает action layer для репетитора.

Прочитай:
1. docs/delivery/features/realtime-thread/spec.md (Technical Design §5, Risks §8)
2. CLAUDE.md
3. .claude/rules/40-homework-system.md (GuidedThreadViewer)
4. .claude/rules/performance.md (React Query key prefix ['tutor', ...])
5. .claude/rules/80-cross-browser.md (Safari WebSocket)
6. docs/discovery/product/tutor-ai-agents/16-ux-principles-for-tutor-product-sokrat.md
7. src/components/tutor/GuidedThreadViewer.tsx, src/lib/tutorHomeworkApi.ts, src/lib/supabaseClient.ts

Задача:
1. В src/lib/tutorHomeworkApi.ts добавь чистую функцию mergeThreadMessage(prev, newMessage):
   - prev == null → вернуть как есть
   - сообщение с таким id уже в prev.messages → вернуть prev (идемпотентность)
   - иначе → { ...prev, messages: [...prev.messages, newMessage] }, сортированные по created_at
2. В src/components/tutor/GuidedThreadViewer.tsx добавь useEffect:
   - запускается при enabled && threadId
   - supabase.channel(`thread-${threadId}`).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'homework_tutor_thread_messages', filter: `thread_id=eq.${threadId}` }, (payload) => queryClient.setQueryData(['tutor', 'homework', 'thread', threadId], (prev) => mergeThreadMessage(prev, payload.new))).subscribe()
   - cleanup: channel.unsubscribe()
3. useQueryClient() из @tanstack/react-query.
4. Query key должен совпадать с существующим fetcher. Если другой — обнови.
5. НЕ вызывай invalidateQueries, только setQueryData.

Acceptance Criteria:
- Given thread загружен, When ученик шлёт сообщение, Then viewer обновляется ≤ 2 сек без reload
- Given INSERT с тем же id повторно, When payload приходит, Then нет дубликата в UI
- Given enabled=false/unmount, When компонент закрывается, Then channel отписан

Guardrails:
- НЕТ framer-motion (запрещён)
- НЕТ crypto.randomUUID без Safari 15.4+ guard
- НЕ меняй backend, RLS, структуру таблиц, student-side код
- React Query key с префиксом ['tutor', ...]
- Scope: GuidedThreadViewer.tsx + helper в tutorHomeworkApi.ts

Mandatory end block:
- Changed files
- Summary
- Validation: npm run lint && npm run build && npm run smoke-check
- Docs-to-update: секция "Realtime thread viewer" в .claude/rules/40-homework-system.md
- Self-check vs doc 16 (минимум frictions, action layer)
```

### TASK-3 (Claude Code)

```
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Контекст: Sticky-bottom auto-scroll для GuidedThreadViewer. Если репетитор внизу треда — прокручиваем к новому сообщению; если scrolled up — не дёргаем, чтобы не ломать чтение истории.

Прочитай:
1. docs/delivery/features/realtime-thread/spec.md (§6 UX, §8 Risks auto-scroll)
2. .claude/rules/80-cross-browser.md (iOS Safari scroll)
3. src/components/tutor/GuidedThreadViewer.tsx (после TASK-2)

Задача:
1. scrollContainerRef на внешний scroll-контейнер сообщений.
2. Перед каждым setQueryData (из TASK-2) считай wasAtBottom:
   const el = scrollContainerRef.current;
   const wasAtBottom = !el || (el.scrollHeight - el.scrollTop - el.clientHeight < STICKY_BOTTOM_THRESHOLD_PX);
3. После setQueryData в requestAnimationFrame — если wasAtBottom, el.scrollTop = el.scrollHeight.
4. Константа STICKY_BOTTOM_THRESHOLD_PX = 100.
5. НЕ используй scrollIntoView({ behavior: 'smooth' }) — лагает на iOS.

Acceptance Criteria:
- Given репетитор прокрутил вверх на 500px, When приходит сообщение, Then auto-scroll НЕ срабатывает
- Given репетитор внизу, When приходит сообщение, Then scroll к новому ≤ 100мс
- Given iOS Safari, When auto-scroll срабатывает, Then нет лагов и скачков

Guardrails:
- НЕТ framer-motion, НЕТ smooth scroll на iOS
- Порог один, не конфигурируемый
- Scope: GuidedThreadViewer.tsx

Mandatory end block:
- Changed files, Summary, Validation, Docs-to-update, Self-check vs doc 16
```

### TASK-4 (Claude Code)

```
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Контекст: защита от утечки Supabase Realtime каналов при rapid expand/collapse карточек учеников. Без cleanup — сотни параллельных подписок в live pilot.

Прочитай:
1. docs/delivery/features/realtime-thread/spec.md (Risks «утечка каналов»)
2. Код GuidedThreadViewer.tsx после TASK-2

Задача:
1. Убедись что channel.unsubscribe() в cleanup useEffect срабатывает при: unmount, смене threadId, enabled → false.
2. Dependency array useEffect: [enabled, threadId, queryClient]. React сам переинициализирует — не надо ref-хранилища каналов.
3. Ручной smoke test: Chrome DevTools → Application → Frames → WebSocket (или Supabase Realtime inspector). 10 циклов expand/collapse. Максимум 1 активная подписка на thread-{id} одновременно.
4. Комментарий в useEffect: "Cleanup обязателен — иначе утечка каналов при rapid toggle".

Acceptance Criteria:
- Given 10 циклов expand/collapse, When cleanup отработал, Then ≤ 1 активная подписка
- Given unmount, When переход на другую страницу, Then канал отписан

Guardrails:
- НЕ добавляй ref-хранилище каналов (лишняя сложность)
- НЕ меняй логику из TASK-2 кроме cleanup гарантий

Mandatory end block:
- Changed files, Summary, Validation, Docs-to-update, Self-check
```

### TASK-6 (Claude Code)

```
Твоя роль: технический писатель проекта SokratAI.

Прочитай:
1. docs/delivery/features/realtime-thread/spec.md
2. Готовый код из TASK-2/3/4
3. .claude/rules/40-homework-system.md

Задача: добавь секцию "### Realtime thread viewer (Е9, 2026-04-07)" в .claude/rules/40-homework-system.md под "GuidedThreadViewer — UX improvements". 10-15 строк:
- Что: Supabase Realtime подписка на homework_tutor_thread_messages по thread_id
- Query key: ['tutor', 'homework', 'thread', threadId], merge через mergeThreadMessage в tutorHomeworkApi.ts
- Cleanup: channel.unsubscribe() в useEffect return, обязателен при rapid expand/collapse
- Sticky-bottom: порог STICKY_BOTTOM_THRESHOLD_PX = 100
- Publication: homework_tutor_thread_messages в supabase_realtime (миграция из TASK-1)
- Правило: НЕ добавлять новые подписки без merge-helper — иначе flicker от invalidate
- Ссылка: docs/delivery/features/realtime-thread/spec.md

Guardrails:
- Формат как у существующих секций файла (рус., короткая, с файлами)
- Не дублируй содержимое спеки

Mandatory end block:
- Changed files, Summary, Validation (npm run lint), Self-check
```
