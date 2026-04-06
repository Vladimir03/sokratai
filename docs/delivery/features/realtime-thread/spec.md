# Feature Spec: Realtime Thread Viewer (Е9)

**Версия:** v0.1
**Дата:** 2026-04-06
**Автор:** Vladimir
**Статус:** draft

---

## 0. Job Context (обязательная секция)

### Какую работу закрывает эта фича?

| Участник | Core Job | Sub-job | Ссылка на Граф |
|---|---|---|---|
| Репетитор (B2B) | R2: Контроль процесса решения и вовлечённости ученика | R2-3: Видеть прогресс ученика по ДЗ без дёрганий | `SokratAI_AJTBD_elite-physics-finish-sprint-job-graph.md#R2` |
| Репетитор (B2B) | R1: Проверка ДЗ и разбор ошибок | R1-4: Видеть контекст решения, а не только финальный ответ | `...#R1` |

### Wedge-связка

- **B2B-сегмент:** B2B-1 (репетиторы физики ЕГЭ/ОГЭ, hourly 3000-4000 ₽)
- **B2C-сегмент:** S1 (школьник-финишёр 16-18)
- **Score матрицы:** высокий — усиливает core job «видимость ученика» без доп. инструментов

### Pilot impact

Убирает live-frustration Егора (*«приходится перезагружать страницу как в ВК»*). Делает guided chat первым местом, куда репетитор заходит во время занятия — без этого он открывает Telegram-чат с учеником параллельно, что ломает positioning «рабочее место репетитора».

---

## 1. Summary

В `GuidedThreadViewer` подписываемся на Supabase Realtime для `homework_tutor_thread_messages` по конкретному thread. Новые сообщения ученика и AI появляются в UI без перезагрузки страницы, с автоскроллом к низу, если репетитор уже внизу треда.

---

## 2. Problem

### Текущее поведение
`GuidedThreadViewer` (`src/components/tutor/GuidedThreadViewer.tsx`) грузит сообщения через React Query один раз при раскрытии карточки ученика. Если ученик сейчас решает задачу — репетитор видит устаревший snapshot и должен нажимать refresh в браузере.

### Боль
Егор (цитата от 2026-04-06): *«Хочется смотреть как ученик решает ДЗ в реальном времени, как в ВК — сейчас приходится перезагружать страницу»*. Репетитор физики на занятии не может параллельно следить за решением ученика — теряет главный value prop guided chat: «видимость процесса, а не только результата».

### Текущие «нанятые» решения
- F5 / pull-to-refresh
- Telegram-чат с учеником параллельно
- Скриншоты от ученика по запросу

---

## 3. Solution

### Описание
Подписка на Supabase Realtime канал `homework_tutor_thread_messages:thread_id=eq.{threadId}` внутри `GuidedThreadViewer`. При INSERT — мёрджим новое сообщение в локальный кеш React Query (`setQueryData`), без инвалидации и полного рефетча.

### Ключевые решения
- **Realtime, не polling**: Supabase уже в стеке, RLS на таблице уже настроен — нулевой overhead
- **Merge, не invalidate**: избегаем flicker и лишних запросов; `setQueryData` добавляет одно сообщение
- **Подписка только когда viewer раскрыт** — exisiting `enabled` prop контролирует и query, и realtime subscription
- **Один канал на thread** — не на assignment, чтобы не ловить чужие сообщения и не ловить RLS-отказы
- **Auto-scroll с sticky bottom**: если юзер scrolled up — не дёргаем; если внизу — прокручиваем к новому сообщению
- **Cleanup на unmount / enabled=false** — `channel.unsubscribe()` обязательно

### Scope

**In scope:**
- Supabase Realtime subscription в `GuidedThreadViewer` на INSERT в `homework_tutor_thread_messages`
- Merge новых сообщений в React Query cache без рефетча
- Sticky-bottom auto-scroll
- Cleanup subscription при закрытии карточки ученика / unmount
- Индикатор «ученик печатает» не требуется (Phase 1)

**Out of scope:**
- Realtime для `homework_tutor_task_states` (статусы задач) — Phase 2, если попросят
- Student side live updates (ученик и так видит свой чат мгновенно)
- Realtime для TutorHomeworkDetail bulk-view всех учеников разом — Phase 2
- Typing indicators
- Push-уведомления репетитору о новом сообщении ученика

---

## 4. User Stories

### Репетитор
> Когда ученик решает ДЗ во время нашего занятия, я хочу видеть его новые сообщения и ответы AI в `GuidedThreadViewer` мгновенно, чтобы комментировать решение по ходу, а не ждать конца задачи.

---

## 5. Technical Design

### Затрагиваемые файлы
- `src/components/tutor/GuidedThreadViewer.tsx` — добавить `useEffect` с Realtime subscription
- `src/lib/tutorHomeworkApi.ts` — (если нужен) тип helper для merge одного сообщения в кеш
- `src/lib/supabaseClient.ts` — проверить что `realtime: { params: { eventsPerSecond: 10 } }` уже настроен
- **НЕ трогать**: backend, RLS, миграции

### Data Model
Без изменений. Таблица `homework_tutor_thread_messages` уже существует, RLS для репетитора уже работает (его проверяет `handleGetThread`).

### Realtime subscription
```ts
useEffect(() => {
  if (!enabled || !threadId) return;
  const channel = supabase
    .channel(`thread-${threadId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'homework_tutor_thread_messages',
        filter: `thread_id=eq.${threadId}`,
      },
      (payload) => {
        queryClient.setQueryData(
          ['tutor', 'homework', 'thread', threadId],
          (prev) => mergeThreadMessage(prev, payload.new)
        );
      }
    )
    .subscribe();
  return () => { channel.unsubscribe(); };
}, [enabled, threadId, queryClient]);
```

### Supabase Realtime publication
Проверить (одноразово), что таблица `homework_tutor_thread_messages` в publication `supabase_realtime`. Если нет — одна миграция:
```sql
alter publication supabase_realtime add table public.homework_tutor_thread_messages;
```
Эту миграцию ДЕЛАТЬ ТОЛЬКО если реально отсутствует — проверяется одним SQL до реализации.

### API
Без изменений.

### Миграции
Возможна 1 (см. выше, условно).

---

## 6. UX / UI

### Wireframe
Визуально ничего не меняется. Поведение — новые bubbles появляются снизу с `animate-in fade-in slide-in-from-bottom-2 duration-200`.

### UX-принципы (doc 16)
- «AI = draft + action, не chat-only output» — realtime усиливает action layer для репетитора
- Минимум frictions, mobile-first (многие репетиторы ведут занятие с планшета)

### UI-паттерны (doc 17)
- Sticky-bottom scroll = стандартный chat pattern
- Нет эмодзи / popover'ов / звуков

---

## 7. Validation

### Как проверяем успех?
- **Leading (3 дня)**: Егор не упоминает «перезагрузку страницы» в обратной связи; в Supabase logs видим стабильные подписки на `thread-*` каналы из tutor-сессий
- **Lagging (2 недели)**: Егор использует GuidedThreadViewer как primary surface во время занятия, Telegram-чат с учеником как fallback

### Связь с pilot KPI
Doc 18: «repeated usage by tutors during lesson hours». Realtime = необходимое условие для этого.

### Smoke check
```bash
npm run lint && npm run build && npm run smoke-check
```
Плюс manual: открыть thread viewer в Chrome, отправить сообщение от имени ученика с другого устройства — должно появиться в течение 1-2 сек.

---

## 8. Risks & Open Questions

| Риск | Вероятность | Митигация |
|---|---|---|
| Таблица не в publication supabase_realtime | Средняя | SQL-проверка до старта, одна миграция |
| RLS блокирует realtime payload (репетитор не видит свой thread) | Низкая | `handleGetThread` уже работает, тот же JWT даёт realtime доступ |
| Утечка каналов при быстром expand/collapse карточек | Средняя | Обязательный cleanup в return useEffect, тест rapid toggle |
| Auto-scroll ломает чтение истории | Средняя | Sticky-bottom: scroll только если юзер был внизу (`scrollHeight - scrollTop - clientHeight < 100`) |
| Safari < 16 WebSocket reconnect | Низкая | Supabase JS client уже умеет reconnect, проверить в Safari 15.4 |

### Открытые вопросы
1. Показывать ли индикатор «ученик онлайн» — отложено в Phase 2
2. Нужна ли подписка на UPDATE (если ученик редактирует последнее сообщение) — нет, student chat не даёт редактировать

---

## 9. Implementation Tasks

- [ ] Проверить, что `homework_tutor_thread_messages` в publication `supabase_realtime`; если нет — миграция
- [ ] Добавить `useRealtimeThreadMessages(threadId, enabled)` hook или inline useEffect в `GuidedThreadViewer`
- [ ] Merge helper для React Query cache (`mergeThreadMessage`)
- [ ] Sticky-bottom scroll logic
- [ ] Cleanup на unmount и при `enabled=false`
- [ ] Smoke test в Chrome + Safari (desktop) + Safari iOS
- [ ] Обновить `.claude/rules/40-homework-system.md` с секцией «Realtime thread viewer»

---

## Parking Lot

- Realtime для `homework_tutor_task_states` (live progress dots) — revisit: после feedback от Егора на Phase 1
- Typing indicator «ученик печатает» — revisit: если Егор попросит
- Push-уведомление репетитору «ученик начал решать ДЗ» — revisit: после Phase 1.3 каскадной доставки

---

## Checklist перед approve

- [x] Job Context заполнен
- [x] Привязка к R2-3 и R1-4
- [x] Scope чёткий (in/out)
- [x] UX-принципы учтены
- [x] Pilot impact описан
- [x] Метрики (leading + lagging)
- [x] High-risk файлы не затрагиваются
- [x] Student/Tutor изоляция сохранена (только tutor side)
