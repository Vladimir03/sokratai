## Проблема

На `/tutor/mock-exams` и при сабмите формы создания пробника появляется toast «Failed to fetch» и в консоли — `tutor_query_network_failed` для `tutor:mock-exams:assignments`.

Прямой curl в `https://api.sokratai.ru/functions/v1/mock-exam-tutor-api/assignments` возвращает:

```text
HTTP 404
{"code":"NOT_FOUND","message":"Requested function was not found"}
```

Все четыре функции пробников (`mock-exam-tutor-api`, `mock-exam-student-api`, `mock-exam-public`, `mock-exam-grade`) присутствуют в репо, но **не задеплоены** в Supabase project `vrsseotrfmsxpbciyqzc`. Из-за 404 без CORS-заголовков браузер репортит ошибку как «Failed to fetch».

## План

1. Задеплоить через `supabase--deploy_edge_functions` четыре функции:
   - `mock-exam-tutor-api`
   - `mock-exam-student-api`
   - `mock-exam-public`
   - `mock-exam-grade`
2. Верифицировать деплой curl-запросом к `/mock-exam-tutor-api/assignments` (ожидаем 401 без Bearer вместо 404).
3. Сообщить пользователю обновить страницу `/tutor/mock-exams` — список и форма создания должны заработать.

## Что НЕ трогаем

- Код фронтенда и edge functions — только деплой.
- Никаких миграций БД (TASK-1..7 миграции уже применены, иначе функции бы возвращали 500, а не 404).

## Деплой sokratai.ru

Не требуется — изменений в `src/**` нет.
