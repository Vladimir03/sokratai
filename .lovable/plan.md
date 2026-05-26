# Fix: «Сообщений нет» в админке ДЗ

## Root cause

Edge function `admin-homework` падает на запросе `threadDetails` с ошибкой Postgres `42703`:

```
column homework_tutor_thread_messages.message_delivery_status does not exist
```

(подтверждено в edge function logs и через `information_schema.columns` — колонки нет).

SELECT в `supabase/functions/admin-homework/index.ts:651` запрашивает `message_delivery_status`, которой нет в схеме `homework_tutor_thread_messages`. Из-за этого весь запрос падает и фронт получает пустой массив → «Сообщений нет».

В типе `AdminThreadMessage` (`src/lib/adminHomeworkApi.ts`) поле уже помечено как optional (`message_delivery_status?: string | null`), так что фронт переживёт его отсутствие.

## Fix

1. В `supabase/functions/admin-homework/index.ts` (строка 651) убрать `, message_delivery_status` из SELECT-строки `threadDetails`.
2. Передеплоить edge function `admin-homework`.

Frontend менять не нужно — поле и так optional.

## Не делаем

- Не добавляем колонку в БД миграцией — нигде в реальной схеме её нет, фича delivery-status для thread messages пока отсутствует.
- Не трогаем остальные SELECT'ы / типы / UI.
