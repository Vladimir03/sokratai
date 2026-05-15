# Fix: «HTTP 429» → дружелюбный toast по-русски

## Симптом

Репетитор открыл своё ДЗ через student-view, упёрся в дневной лимит AI (free-аккаунт = 50/день в homework-контексте, см. CLAUDE.md §17). Бэкенд корректно вернул 429 с понятным payload, но фронт показал сырое «HTTP 429».

## Корень

`supabase/functions/_shared/subscription-limits.ts::buildLimitReachedResponse` возвращает:
```json
{ "error": "limit_reached", "message": "Вы достигли дневного лимита в 50 сообщений…", "limit": 50, "messages_used": 50, "tutor_can_upgrade": false }
```

Но 4 API-helper'а парсят `body?.error?.message`, как если бы `error` был объектом `{message}`. Поскольку `error` — строка, `.message` undefined → fallback `HTTP ${status}`.

Затронутые места (одинаковая ошибка):
- `src/lib/studentHomeworkApi.ts` — 3 `let message = "HTTP ${response.status}"` (строки 131, 192, 520). **Это и есть источник toast'а в guided homework chat / submission flow.**
- `src/lib/mockExamApi.ts:71`
- `src/lib/studentMockExamApi.ts:76`
- `src/lib/tutorHomeworkApi.ts:260`

`streamChat.ts` (для `/chat` discuss-path) уже обрабатывает 429 правильно — там не трогаем.

## Изменения

### 1. Общий парсер ошибок (DRY)

Добавить helper в `src/lib/apiErrorMessage.ts` (новый файл):

```ts
export function extractApiErrorMessage(body: unknown, fallback: string): string {
  if (!body || typeof body !== 'object') return fallback;
  const b = body as Record<string, unknown>;
  // Top-level message (limit_reached shape)
  if (typeof b.message === 'string' && b.message.trim()) return b.message;
  // Nested error.message shape
  if (b.error && typeof b.error === 'object') {
    const msg = (b.error as Record<string, unknown>).message;
    if (typeof msg === 'string' && msg.trim()) return msg;
  }
  return fallback;
}
```

### 2. Применить в 4 API-обёртках

В каждом из 4 файлов заменить блок `let message = "HTTP ${status}"; try { body = await ...; if (body?.error?.message) message = ...; } catch {}` на вызов `extractApiErrorMessage(body, \`HTTP ${status}\`)`. Поведение для уже корректных responses (`{error:{message}}`) не меняется.

### 3. (Опционально) Nudge для tutor_can_upgrade

В `studentHomeworkApi.ts::apiFetch` после извлечения message, если `body.error === 'limit_reached'` И `body.tutor_can_upgrade === true`, добавить к сообщению хвост: `" Попроси репетитора подключить тариф AI-старт — лимит 50/день в каждом ДЗ."` Это не «новая фича», а полнее раскрывает payload, который уже шлёт бэкенд.

## Что НЕ трогаем

- `_shared/subscription-limits.ts` — payload корректный.
- Лимиты (50/день в homework / 10/день вне) — без изменений.
- `streamChat.ts` — 429 уже обработан правильно.
- Бэкенд edge functions — никаких миграций / редеплоев.

## Деплой

Только frontend (`src/lib/*`). После merge — `deploy-sokratai` на VPS Selectel (CLAUDE.md §«Production Deploy»).

## QA

1. Открыть ДЗ как ученик-без-премиума с уже исчерпанным лимитом → отправить сообщение в guided chat / submit задачи → toast: «Вы достигли дневного лимита в 50 сообщений. Оформите подписку для безлимитного доступа!» вместо «HTTP 429».
2. Регрессия: 401/500 ошибки от homework-api продолжают показывать прежний текст (`error.message` shape).
