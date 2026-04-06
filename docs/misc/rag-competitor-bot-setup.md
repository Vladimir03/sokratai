# RAG Competitor Bot — Инструкция по настройке

In-context RAG бот для Telegram, отвечающий на вопросы по данным из чата конкурентов/маркетинга.

## Архитектура

```
Telegram → Supabase Edge Function (rag-competitor-bot) → OpenAI GPT-4o-mini → Telegram
                          ↑
              Supabase Storage (knowledge_base.txt)
```

## Шаг 1. Создать Telegram-бота

1. Откройте [@BotFather](https://t.me/BotFather) в Telegram.
2. Отправьте `/newbot`, задайте имя и username (должен оканчиваться на `bot`).
3. Скопируйте токен (формат: `123456789:AABBccdd...`).

## Шаг 2. Получить OpenAI API Key

1. Перейдите на [platform.openai.com/api-keys](https://platform.openai.com/api-keys).
2. Создайте новый ключ.
3. Скопируйте (формат: `sk-...`).

## Шаг 3. Создать бакет в Supabase Storage

1. Откройте Supabase Dashboard → Storage.
2. Нажмите **New bucket**.
3. Имя: `rag-knowledge-base`.
4. Тип: **Private** (без публичного доступа).

## Шаг 4. Загрузить базу знаний

### 4a. Спарсить экспорт Telegram (если ещё не сделано)

```bash
python3 scripts/parse_telegram_export.py
```

Скрипт создаст `knowledge_base.txt` и `knowledge_base.json`.

### 4b. Загрузить в Supabase Storage

Через Dashboard: откройте бакет `rag-knowledge-base` → Upload → выберите `knowledge_base.txt`.

Или через CLI:

```bash
export SUPABASE_URL="https://your-project.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"
bash scripts/upload-rag-kb.sh scripts/knowledge_base.txt
```

## Шаг 5. Установить секреты

```bash
npx supabase secrets set RAG_BOT_TOKEN="your-telegram-bot-token"
npx supabase secrets set OPENAI_API_KEY="sk-your-openai-key"
```

## Шаг 6. Задеплоить Edge Functions

```bash
npx supabase functions deploy rag-competitor-bot --no-verify-jwt
npx supabase functions deploy rag-bot-setup-webhook --no-verify-jwt
```

**`--no-verify-jwt`** обязателен для `rag-competitor-bot`, потому что Telegram не передаёт JWT.

## Шаг 7. Установить вебхук

Вызовите функцию настройки вебхука (одноразово):

```bash
curl "https://your-project.supabase.co/functions/v1/rag-bot-setup-webhook" \
  -H "Authorization: Bearer your-anon-key"
```

Должен вернуться JSON с `"success": true`.

## Шаг 8. Тестирование

1. Откройте бота в Telegram.
2. Отправьте `/start` — бот должен поприветствовать.
3. Задайте вопрос, например: «Какие конкуренты упоминались в обсуждениях?»
4. Бот ответит на основе базы знаний.

## Обновление базы знаний

При появлении новых данных:

1. Выгрузите историю чата из Telegram Desktop (Export chat history → HTML).
2. Запустите `python3 scripts/parse_telegram_export.py` с путём к `messages.html`.
3. Загрузите обновлённый `knowledge_base.txt` в Supabase Storage.

Кэш Edge Function обновится автоматически через 5 минут.

## Команды бота

| Команда | Действие |
|---------|----------|
| `/start` | Приветствие и примеры вопросов |
| `/clear` | Очистка истории диалога |

## Конфигурация

В `rag-competitor-bot/index.ts` можно настроить:

- `model` — модель OpenAI (по умолчанию `gpt-4o-mini`, можно `gpt-4o`)
- `temperature` — креативность ответов (0.3 по умолчанию)
- `MAX_HISTORY` — количество сообщений в памяти диалога (6 по умолчанию)
- `CACHE_TTL_MS` — время кэширования базы знаний (5 минут)
- `SYSTEM_PROMPT` — системный промпт бота

## Стоимость

- **gpt-4o-mini**: ~$0.15 / 1M input tokens. База знаний ~20K tokens → ~$0.003 за запрос.
- При 100 запросах/день ≈ $9/мес.
- **gpt-4o**: ~$2.50 / 1M input → ~$0.05 за запрос → $150/мес при 100 запросах/день.
