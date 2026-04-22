

## План: Telegram-style счётчик непрочитанных в «Последние диалоги»

### Что не так сейчас
В `ChatRow.tsx` unread = маленькая 6×6 px точка слева от имени. На скрине 2 её действительно почти не видно. Telegram (скрин 1) показывает синий **бейдж со счётчиком** справа, под временем — это сразу считывается и даёт понимание масштаба «пропустил 3 vs 45 сообщений».

### Целевой UX (по Telegram)

```text
┌──────────────────────────────────────────────────────────┐
│ [V] VladimirKam  ЕГЭ AI                          1 ч  >  │
│     Задача 1 выполнена! Переходим к задаче 2.    ╭──╮    │
│                                                  │ 3│    │
│                                                  ╰──╯    │
└──────────────────────────────────────────────────────────┘
```

- **Время** — всегда сверху справа (как сейчас).
- **Бейдж со счётчиком** — снизу справа, под временем, появляется только если `unreadCount > 0`.
- Счётчик `>99` отображается как `99+`.
- Имя становится **жирным** (`font-weight: 700`) при наличии непрочитанных — единственный второй визуальный сигнал, как в Telegram.
- Точка слева от имени **удаляется**.

### Цвет бейджа
Используем уже существующий токен `--sokrat-green-700` (фон) + белый текст — соответствует бренду «Сократ AI» (зелёный — это акцент, а не индиго). Это устранит «красную точку, которая выглядит как ошибка» (текущий `--sokrat-state-warning-fg`). Хук на токены design-system, без новых hex.

### Backend: считаем `unreadCount` точно

Сейчас `handleGetRecentDialogs` (`supabase/functions/homework-api/index.ts:5761`) возвращает `unread: boolean`. Нужен `unreadCount: number` — количество **student-сообщений** с `created_at > tutor_last_viewed_at` (или всех student-сообщений, если `tutor_last_viewed_at IS NULL`).

**Изменения в `handleGetRecentDialogs`:**

1. Расширить выборку `homework_tutor_thread_messages`:
   - Уже грузим до `pickedThreadIds.length * 12` сообщений за один batch — этого мало для подсчёта (если ученик прислал 50 сообщений после визита — недосчитаем). Делаем отдельный SELECT count по группам:
   ```ts
   // Per-thread unread count: count student messages where created_at > viewed_at.
   // Один query через .or() с массивом условий per thread тяжело; вместо этого —
   // n легких COUNT-запросов через Promise.all (n ≤ 5, RECENT_DIALOGS_DISPLAY_LIMIT).
   const unreadCounts = await Promise.all(
     pickedThreads.map(async (t) => {
       const viewedAtIso = t.tutor_last_viewed_at ?? '1970-01-01T00:00:00Z';
       const { count } = await db
         .from('homework_tutor_thread_messages')
         .select('id', { count: 'exact', head: true })
         .eq('thread_id', t.id)
         .eq('role', 'user')
         .neq('visible_to_student', false)
         .gt('created_at', viewedAtIso);
       return { threadId: t.id, count: count ?? 0 };
     }),
   );
   ```
   `n ≤ 5` (`RECENT_DIALOGS_DISPLAY_LIMIT`) — нагрузка приемлема, индекс `(thread_id, created_at)` уже эффективен.

2. В сборке `items`:
   ```ts
   const unreadCount = unreadMap.get(t.id) ?? 0;
   const unread = unreadCount > 0; // оставляем boolean для backward-compat
   return { ..., unread, unreadCount, ... };
   ```

3. `RecentDialogItem` (тип) в `src/lib/tutorHomeworkApi.ts` получает `unreadCount: number`.

### Frontend: рендер бейджа

**`src/hooks/useTutorRecentDialogs.ts`:**
- Добавить `unreadCount: number` в `DialogItem`.
- В `mapItem` пробрасывать `unreadCount: raw.unreadCount ?? 0` (graceful fallback пока не задеплоилась edge-функция).

**`src/components/tutor/home/primitives/ChatRow.tsx`:**
- Удалить строку с 6×6 точкой (line ~76–88).
- Имя: оставить `fontWeight: chat.unread ? 700 : 600` — теперь это вторичный сигнал.
- В правом столбце (где сейчас только `<ChevronRight>`) — стек: время сверху (мигрирует из `chat-row__top`), счётчик-бейдж снизу.

Структура правого столбца:
```tsx
<span className="chat-row__meta">
  <span className="chat-row__time">{chat.at}</span>
  {chat.unreadCount > 0 && (
    <span
      className="chat-row__badge"
      aria-label={`${chat.unreadCount} непрочитанных сообщений`}
    >
      {chat.unreadCount > 99 ? '99+' : chat.unreadCount}
    </span>
  )}
</span>
<ChevronRight ... />
```

ARIA-метка строки расширяется: вместо «есть непрочитанные» → `${unreadCount} непрочитанных`.

### CSS (`src/styles/tutor-dashboard.css`)

Дополнить (additive):
```css
.chat-row__meta {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
  flex: none;
}

.chat-row__badge {
  min-width: 20px;
  height: 20px;
  padding: 0 7px;
  border-radius: 10px;
  background: var(--sokrat-green-700);
  color: #fff;
  font-size: 12px;
  font-weight: 700;
  line-height: 20px;
  text-align: center;
  display: inline-block;
}
```

Время (`.chat-row__time`) уже стилизовано — оставляем как есть, просто переносим из `chat-row__top` в `chat-row__meta`. Из `__top` уходит `chat.at`.

### Что НЕ делаем

- Не трогаем `tutor_last_viewed_at` schema/index — уже есть.
- Не трогаем POST `/threads/:id/viewed-by-tutor` — он уже корректно сбрасывает счётчик при открытии чата.
- Не вводим realtime-подписку на счётчик — refetch на focus + 30s staleTime достаточно для пилота (согласовано с текущим UX).
- Не меняем «Все чаты», другие блоки `/tutor/home` или другие экраны.

### Файлы

**Изменяются:**
- `supabase/functions/homework-api/index.ts` — `handleGetRecentDialogs` + `RecentDialogItem` type (если есть).
- `src/lib/tutorHomeworkApi.ts` — добавить `unreadCount` в `RecentDialogItem`.
- `src/hooks/useTutorRecentDialogs.ts` — `unreadCount` в `DialogItem` + `mapItem`.
- `src/components/tutor/home/primitives/ChatRow.tsx` — удалить точку, добавить бейдж, перенести время.
- `src/styles/tutor-dashboard.css` — `.chat-row__meta`, `.chat-row__badge`.

**Не трогаем:**
- DB-схема, миграции, RLS.
- POST `/viewed-by-tutor` логика.
- `RecentDialogsBlock.tsx` (контейнер).
- Другие потребители `DialogItem`.

### Деплой

1. Деплой edge-функции `homework-api` (новое поле `unreadCount` в response).
2. Frontend rebuild — `npm run build`.
3. Никаких новых secrets / migrations.

### Валидация

1. `npm run lint && npm run build && npm run smoke-check`.
2. На `/tutor/home`: чаты с непрочитанными показывают зелёный бейдж со счётчиком справа под временем + жирное имя. Чаты без непрочитанных — без бейджа, имя обычной плотности.
3. Открыть чат → вернуться на `/tutor/home` → бейдж исчез (через `invalidateQueries` который уже есть).
4. Если у студента >99 непрочитанных → отображается `99+`.
5. Точка слева от имени отсутствует.

