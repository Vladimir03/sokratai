
## Исправление ошибки "Failed to fetch" при создании ДЗ

### Причина 1: CORS блокирует запросы

Edge function `homework-api` разрешает запросы только с 4 доменов:
- `sokratai.ru`
- `sokratai.lovable.app`
- `localhost:8080`
- `localhost:5173`

Но превью Lovable работает на домене `*.lovableproject.com`, который не в списке. Браузер блокирует все запросы.

### Причина 2: Неправильный `tutor_id` при создании

В главном обработчике `getTutorOrThrow` возвращает `tutor.id` (ID записи из таблицы `tutors`), но в `handleCreateAssignment` передаётся `userId` (auth user ID) вместо `tutor.id`. Это значит:
- При INSERT в `homework_tutor_assignments` записывается auth user ID вместо ID из таблицы tutors
- Последующие проверки ownership могут ломаться

### План исправления

**Файл: `supabase/functions/homework-api/index.ts`**

1. Добавить `*.lovableproject.com` в `FALLBACK_ORIGINS` (а лучше -- сделать wildcard-проверку для lovableproject.com)

2. В главном обработчике (строки 1196-1237): передавать `tutor.id` вместо `userId` во все handler-функции, которые работают с `tutor_id`:
   - `handleCreateAssignment(db, tutor.id, body, cors)` -- вместо `userId`
   - `handleListAssignments(db, tutor.id, searchParams, cors)` -- вместо `userId`
   - `handleGetAssignment(db, tutor.id, seg[1], cors)` -- вместо `userId`
   - и т.д. для всех остальных handlers

3. Задеплоить обновлённую функцию

### Техническая деталь

CORS-фикс: вместо жёсткого списка, добавить проверку паттерна:

```text
const FALLBACK_ORIGINS = [
  "https://sokratai.ru",
  "https://sokratai.lovable.app",
  "http://localhost:8080",
  "http://localhost:5173",
];

// + в getCorsHeaders добавить проверку:
// if (origin.endsWith(".lovableproject.com")) -- разрешить
```

Это покроет все превью-домены Lovable без необходимости обновлять список при каждом новом проекте.
