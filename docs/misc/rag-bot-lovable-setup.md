# RAG Competitor Bot — Создание нового проекта в Lovable

Пошаговая инструкция по созданию RAG Telegram-бота в новом проекте Lovable AI + Cloud.

## Архитектура

```
Пользователь (Telegram)
      │
      ▼
Telegram Bot API (webhook)
      │
      ▼
Supabase Edge Function "rag-competitor-bot"
      │
      ├── читает базу знаний из Supabase Storage
      │
      ├── отправляет вопрос + KB в OpenAI GPT-4o-mini
      │
      └── отвечает пользователю в Telegram
```

---

## Часть 1. Подготовка

### 1.1. Создать Telegram-бота

1. Откройте [@BotFather](https://t.me/BotFather) в Telegram.
2. Отправьте `/newbot`.
3. Задайте имя (например, «Конкуренты Сократ») и username (должен заканчиваться на `bot`, например `sokrat_competitors_bot`).
4. Скопируйте токен (формат: `123456789:AABBccdd...`). Сохраните его — понадобится на шаге 3.3.

### 1.2. Получить OpenAI API Key

1. Перейдите на [platform.openai.com/api-keys](https://platform.openai.com/api-keys).
2. Создайте новый ключ (Create new secret key).
3. Скопируйте (формат: `sk-...`). Сохраните — понадобится на шаге 3.3.

### 1.3. Подготовить базу знаний

Файл `knowledge_base.txt` уже сгенерирован из экспорта Telegram-чата. Он лежит в:

```
sokratai/scripts/knowledge_base.txt
```

141 сообщение из чата «Изучение рынка, конкурентов», ~109 КБ, ~27 000 токенов — помещается в контекст GPT-4o-mini.

При необходимости пере-генерировать из нового экспорта:

```bash
python3 scripts/parse_telegram_export.py
```

---

## Часть 2. Создание проекта в Lovable

### 2.1. Создать новый проект

1. Откройте [lovable.dev](https://lovable.dev).
2. Нажмите **New Project**.
3. Название: `rag-competitor-bot` (или любое удобное).

### 2.2. Подключить Supabase

1. В проекте Lovable откройте **Settings → Supabase**.
2. Нажмите **Connect Supabase** — Lovable создаст новый Supabase-проект (или подключите существующий).
3. Запомните URL проекта (формат: `https://xxxxx.supabase.co`).

### 2.3. Скопировать ключи Supabase

1. Откройте ваш Supabase Dashboard → **Settings → API**.
2. Скопируйте:
   - **Project URL** (например `https://xxxxx.supabase.co`)
   - **anon public key** (для вызова setup-webhook)
   - **service_role key** (для загрузки KB — НИКОМУ не давайте)

---

## Часть 3. Настройка Supabase

### 3.1. Создать Storage bucket

1. Supabase Dashboard → **Storage**.
2. **New bucket** → Имя: `rag-knowledge-base` → Тип: **Private**.

### 3.2. Загрузить базу знаний

В бакете `rag-knowledge-base` нажмите **Upload file** → выберите `scripts/knowledge_base.txt`.

Или через терминал:

```bash
curl -X POST \
  "https://YOUR_PROJECT.supabase.co/storage/v1/object/rag-knowledge-base/knowledge_base.txt" \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" \
  -H "Content-Type: text/plain; charset=utf-8" \
  -H "x-upsert: true" \
  --data-binary "@scripts/knowledge_base.txt"
```

### 3.3. Установить секреты (Edge Function Environment)

Supabase Dashboard → **Edge Functions → Secrets** (или Settings → Edge Functions):

| Секрет | Значение |
|--------|----------|
| `RAG_BOT_TOKEN` | Токен Telegram-бота из шага 1.1 |
| `OPENAI_API_KEY` | Ключ OpenAI из шага 1.2 |

`SUPABASE_URL` и `SUPABASE_SERVICE_ROLE_KEY` уже доступны автоматически в Edge Functions.

---

## Часть 4. Создание Edge Functions

### 4.1. Промпт для Lovable (основная функция)

Скопируйте и отправьте в чат Lovable:

```
Создай Supabase Edge Function "rag-competitor-bot" (verify_jwt: false).

Функция принимает Telegram webhook updates (POST запросы с JSON body).

Логика:
1. Извлечь message.text и message.chat.id из body.
2. Если text = "/start" — ответить приветствием: "Привет! Я бот-ассистент по конкурентам и маркетингу. Задай мне вопрос, и я поищу ответ в базе знаний."
3. Если text = "/clear" — очистить историю диалога для этого chat_id, ответить "История очищена ✅".
4. Иначе:
   a. Загрузить файл knowledge_base.txt из Supabase Storage (бакет "rag-knowledge-base"). Кэшировать в памяти на 5 минут.
   b. Отправить запрос в OpenAI Chat Completions API (model: gpt-4o-mini, temperature: 0.3):
      - system message: системный промпт + вся база знаний
      - history: последние 6 сообщений диалога (хранить в Map по chat_id)
      - user message: текст от пользователя
   c. Отправить ответ в Telegram через sendMessage API.

Системный промпт:
"Ты — AI-ассистент по изучению рынка и конкурентов в сфере EdTech / онлайн-образования.
Отвечай СТРОГО на основе базы знаний ниже.
Если информации нет — честно скажи об этом.
Цитируй источники (автор, дата) когда уместно.
Отвечай на русском.
Если вопрос касается конкурентов, продуктов, метрик, трендов — ищи все релевантные упоминания."

Env vars: RAG_BOT_TOKEN, OPENAI_API_KEY (секреты), SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (автоматические).

Telegram API: https://api.telegram.org/bot{RAG_BOT_TOKEN}/sendMessage
OpenAI API: https://api.openai.com/v1/chat/completions

Всегда возвращай HTTP 200 (даже при ошибках), чтобы Telegram не ретраил.
Разбивай длинные ответы на чанки по 4000 символов (лимит Telegram = 4096).
Перед ответом отправляй typing action (sendChatAction).
```

### 4.2. Промпт для Lovable (функция настройки webhook)

```
Создай Supabase Edge Function "rag-bot-setup-webhook".

При вызове (GET или POST) она:
1. Берёт RAG_BOT_TOKEN из env.
2. Формирует webhook URL: {SUPABASE_URL}/functions/v1/rag-competitor-bot
3. Вызывает Telegram API setWebhook с этим URL и allowed_updates: ["message"].
4. Вызывает getWebhookInfo для проверки.
5. Возвращает JSON с результатом.
```

### 4.3. Если Lovable не создаёт Edge Functions напрямую

Lovable может не поддерживать прямое создание Edge Functions через чат. В этом случае:

**Вариант A: Через Supabase CLI (рекомендую)**

1. Установите Supabase CLI:
```bash
npm install -g supabase
```

2. Залогиньтесь:
```bash
supabase login
```

3. Привяжитесь к проекту:
```bash
supabase link --project-ref YOUR_PROJECT_REF
```
(project-ref — это часть URL между `https://` и `.supabase.co`)

4. Создайте функции локально:
```bash
supabase functions new rag-competitor-bot
supabase functions new rag-bot-setup-webhook
```

5. Замените содержимое файлов кодом из раздела «Код функций» ниже.

6. Задеплойте:
```bash
supabase functions deploy rag-competitor-bot --no-verify-jwt
supabase functions deploy rag-bot-setup-webhook --no-verify-jwt
```

**Вариант B: Через Supabase Dashboard**

1. Dashboard → **Edge Functions → New Function**.
2. Создайте `rag-competitor-bot` и `rag-bot-setup-webhook`.
3. Вставьте код из раздела «Код функций».
4. Для `rag-competitor-bot` снимите галочку **Verify JWT** (Telegram не отправляет токен авторизации).

---

## Часть 5. Код функций

### rag-competitor-bot/index.ts

```typescript
import { createClient } from "npm:@supabase/supabase-js@2";

const RAG_BOT_TOKEN = Deno.env.get("RAG_BOT_TOKEN");
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TELEGRAM_API = `https://api.telegram.org/bot${RAG_BOT_TOKEN}`;

const SYSTEM_PROMPT = `Ты — AI-ассистент по изучению рынка и конкурентов в сфере EdTech / онлайн-образования.

Правила:
1. Отвечай СТРОГО на основе базы знаний ниже.
2. Если информации нет — честно скажи об этом.
3. Цитируй источники (автор, дата) когда уместно.
4. Отвечай на русском языке.
5. Будь конкретным и полезным.
6. Если вопрос касается конкурентов, продуктов, метрик, трендов — ищи все релевантные упоминания.

БАЗА ЗНАНИЙ:
`;

// ── Кэш базы знаний ────────────────────────────────────────────────────────

let kbCache: string | null = null;
let cacheTs = 0;
const CACHE_TTL = 5 * 60 * 1000;

async function getKB(): Promise<string> {
  if (kbCache && Date.now() - cacheTs < CACHE_TTL) return kbCache;
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data, error } = await sb.storage
    .from("rag-knowledge-base")
    .download("knowledge_base.txt");
  if (error) throw new Error("KB not available: " + error.message);
  kbCache = await data.text();
  cacheTs = Date.now();
  console.log(`KB loaded: ${kbCache.length} chars`);
  return kbCache;
}

// ── Память диалога (in-memory, по chat_id) ──────────────────────────────────

const history = new Map<number, Array<{ role: string; content: string }>>();
const MAX_HISTORY = 6;

function getHist(chatId: number) { return history.get(chatId) || []; }

function addHist(chatId: number, role: string, content: string) {
  const h = getHist(chatId);
  h.push({ role, content });
  while (h.length > MAX_HISTORY) h.shift();
  history.set(chatId, h);
}

// ── OpenAI ──────────────────────────────────────────────────────────────────

async function askAI(question: string, chatId: number): Promise<string> {
  const kb = await getKB();
  const messages = [
    { role: "system", content: SYSTEM_PROMPT + kb },
    ...getHist(chatId),
    { role: "user", content: question },
  ];
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages,
      temperature: 0.3,
      max_tokens: 2000,
    }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const answer = data.choices?.[0]?.message?.content ?? "Не удалось получить ответ.";
  addHist(chatId, "user", question);
  addHist(chatId, "assistant", answer);
  return answer;
}

// ── Telegram helpers ────────────────────────────────────────────────────────

async function send(chatId: number, text: string) {
  const chunks: string[] = [];
  let rem = text;
  while (rem.length > 0) { chunks.push(rem.slice(0, 4000)); rem = rem.slice(4000); }
  for (const chunk of chunks) {
    await fetch(`${TELEGRAM_API}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: chunk, parse_mode: "Markdown" }),
    });
  }
}

async function typing(chatId: number) {
  await fetch(`${TELEGRAM_API}/sendChatAction`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, action: "typing" }),
  });
}

// ── Main ────────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      },
    });
  }
  try {
    if (!RAG_BOT_TOKEN) throw new Error("RAG_BOT_TOKEN not set");
    if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY not set");

    const body = await req.json();
    const msg = body.message;
    if (!msg?.text) return new Response(JSON.stringify({ ok: true }));

    const chatId = msg.chat.id;
    const text = msg.text.trim();

    if (text === "/start") {
      await send(chatId,
        "Привет! 👋 Я бот-ассистент по конкурентам и маркетингу.\n\n" +
        "Задай вопрос — я поищу ответ в базе знаний.\n\n" +
        "Примеры:\n• Какие конкуренты упоминались?\n• Какие маркетинговые стратегии обсуждались?\n• Что говорили про ценообразование?\n\n" +
        "/clear — очистить историю диалога"
      );
      return new Response(JSON.stringify({ ok: true }));
    }

    if (text === "/clear") {
      history.delete(chatId);
      await send(chatId, "История очищена ✅");
      return new Response(JSON.stringify({ ok: true }));
    }

    await typing(chatId);
    const answer = await askAI(text, chatId);
    await send(chatId, answer);
    return new Response(JSON.stringify({ ok: true }));
  } catch (e) {
    console.error("Error:", e);
    return new Response(JSON.stringify({ error: String(e) }), { status: 200 });
  }
});
```

### rag-bot-setup-webhook/index.ts

```typescript
const RAG_BOT_TOKEN = Deno.env.get("RAG_BOT_TOKEN");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      },
    });
  }
  try {
    if (!RAG_BOT_TOKEN) throw new Error("RAG_BOT_TOKEN not set");
    const url = `${SUPABASE_URL}/functions/v1/rag-competitor-bot`;
    console.log("Setting webhook to:", url);

    const res = await fetch(`https://api.telegram.org/bot${RAG_BOT_TOKEN}/setWebhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, allowed_updates: ["message"] }),
    });
    const result = await res.json();

    const info = await (await fetch(
      `https://api.telegram.org/bot${RAG_BOT_TOKEN}/getWebhookInfo`
    )).json();

    return new Response(JSON.stringify({ success: result.ok, webhook_url: url, result, info }), {
      headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" },
    });
  }
});
```

---

## Часть 6. Запуск

### 6.1. Установить webhook

После деплоя функций вызовите одноразово:

```bash
curl "https://YOUR_PROJECT.supabase.co/functions/v1/rag-bot-setup-webhook" \
  -H "Authorization: Bearer YOUR_ANON_KEY"
```

Ответ должен содержать `"success": true`.

### 6.2. Протестировать бота

1. Откройте бота в Telegram (по username из шага 1.1).
2. Отправьте `/start`.
3. Задайте вопрос: «Какие конкуренты упоминались?» или «Что обсуждали про реферальные программы?»

---

## Часть 7. Обновление базы знаний

Когда появятся новые данные в чате:

1. Выгрузите историю из Telegram Desktop: три точки в чате → **Export chat history** → формат **HTML**.
2. Скопируйте папку экспорта.
3. Отредактируйте путь в `scripts/parse_telegram_export.py` (переменная `filepath`).
4. Запустите: `python3 scripts/parse_telegram_export.py`
5. Загрузите новый `knowledge_base.txt` в Supabase Storage (бакет `rag-knowledge-base`, кнопка Upload, перезаписать файл).

Кэш Edge Function сбросится автоматически через 5 минут.

---

## Часть 8. Следующие шаги (roadmap)

### Фаза 2: Прямое чтение из Telegram (без экспорта)

Вместо ручного экспорта — Telegram Bot API для мониторинга чата в реальном времени:
- Добавить бота в чат-источник как участника
- Edge Function сохраняет новые сообщения в Supabase таблицу
- Scheduled task (cron) пересобирает knowledge_base.txt из таблицы

### Фаза 3: Векторный RAG (если данных станет >100K токенов)

Переход на полноценный RAG с эмбеддингами:
- pgvector в Supabase (уже встроен)
- Разбиение текста на чанки по 500 токенов
- Embedding через OpenAI text-embedding-3-small
- Поиск топ-5 релевантных чанков вместо передачи всей базы

### Фаза 4: Веб-интерфейс в Lovable

Lovable может сгенерировать фронтенд:
- Страница поиска по базе знаний
- Дашборд с аналитикой (топ тем, частота упоминаний конкурентов)
- Управление базой знаний (добавление/удаление источников)

---

## Стоимость

| Компонент | Стоимость |
|-----------|-----------|
| Lovable | Free tier или Pro ($20/мес) |
| Supabase | Free tier (500MB, 50K Edge Function invocations) |
| OpenAI gpt-4o-mini | ~$0.004 за запрос (~27K input tokens) |
| Telegram Bot | Бесплатно |
| **Итого при 100 запросах/день** | **~$12/мес** (в основном OpenAI) |

Можно снизить до ~$1-2/мес используя gpt-4o-mini с shorter context (обрезая KB до релевантных секций).

---

## Troubleshooting

**Бот не отвечает:**
1. Проверьте webhook: `curl https://api.telegram.org/bot{TOKEN}/getWebhookInfo`
2. Проверьте логи: Supabase Dashboard → Edge Functions → rag-competitor-bot → Logs

**"KB not available":**
- Проверьте что файл загружен в бакет `rag-knowledge-base`
- Проверьте имя файла: `knowledge_base.txt` (без пробелов, регистр важен)

**OpenAI ошибка 401:**
- Проверьте что `OPENAI_API_KEY` установлен в секретах Edge Functions
- Проверьте что ключ действительный и на аккаунте есть средства

**Webhook setup возвращает ошибку:**
- Проверьте что `RAG_BOT_TOKEN` установлен в секретах
- Проверьте что функция `rag-competitor-bot` задеплоена с `--no-verify-jwt`
