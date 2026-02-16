

## Запуск Telegram-бота для домашек: чеклист

### 1. Применить миграцию Sprint 1.1

Файл `supabase/migrations/20260215100000_homework_tutor_system.sql` уже существует в репозитории, но не применён к базе данных. Нужно выполнить его содержимое через инструмент миграции. Это создаст:

- 6 таблиц: `homework_tutor_assignments`, `homework_tutor_tasks`, `homework_tutor_submissions`, `homework_tutor_submission_items`, `homework_tutor_student_assignments`, `homework_tutor_user_bot_state`
- Индексы на все таблицы
- RLS-политики для tutors и students
- Storage bucket `homework-images` (private) с политиками доступа

### 2. Проверить secrets

Из 4 необходимых секретов:

| Secret | Статус |
|--------|--------|
| `TELEGRAM_BOT_TOKEN` | Есть |
| `LOVABLE_API_KEY` | Есть |
| `SUPABASE_URL` | Нужно добавить (значение: `https://vrsseotrfmsxpbciyqzc.supabase.co`) |
| `SUPABASE_SERVICE_ROLE_KEY` | Нужно добавить (взять из настроек Lovable Cloud) |

Эти два секрета нужны edge function'ам для работы с БД через service role client. Они есть в системных переменных Supabase, но должны быть доступны edge function'ам как env vars.

**Примечание**: судя по конфигурации Supabase, `SUPABASE_URL` и `SUPABASE_SERVICE_ROLE_KEY` уже перечислены в секретах Supabase (видны в `<secrets>` блоке). Они могут быть уже доступны edge function'ам автоматически. Нужно проверить, что функция запускается без ошибок.

### 3. Деплой edge function `telegram-bot`

Edge function `telegram-bot` автоматически деплоится при сохранении изменений в Lovable. Код уже содержит:
- Импорт homework handler'ов (`state_machine.ts`, `homework_handler.ts`, `vision_checker.ts`)
- Команды `/homework` и `/cancel` в `setMyCommands()`
- Callback-обработчики для `hw_start`, `hw_next`, `hw_submit`

Нужно убедиться, что деплой прошёл успешно, вызвав функцию и проверив логи.

### 4. Обновить команды бота

После деплоя edge function нужно вызвать `setMyCommands` -- это происходит автоматически при обработке первого webhook-запроса, либо можно вызвать `/start` в боте.

### Порядок действий

1. Применить миграцию (создать таблицы + bucket + RLS)
2. Верифицировать, что secrets `SUPABASE_URL` и `SUPABASE_SERVICE_ROLE_KEY` доступны edge function'ам
3. Задеплоить `telegram-bot` edge function
4. Проверить логи деплоя на ошибки
5. Отправить `/start` боту для регистрации команд

### Технические детали

Миграция содержит 582 строки SQL, включая:
- `CREATE TABLE IF NOT EXISTS` для всех 6 таблиц с constraints
- `CREATE INDEX IF NOT EXISTS` для 5 индексов
- `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` для всех таблиц
- 25+ RLS-политик (tutor и student доступ)
- `INSERT INTO storage.buckets` для `homework-images`
- Storage policies для upload/read с проверкой owner и path

