

## План: Переключение с OpenRouter на Lovable AI Gateway

### Текущая логика (строки 536-602)

```typescript
// Приоритет: OpenRouter API Key, затем Lovable Gateway
const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY");
const useOpenRouter = Boolean(OPENROUTER_API_KEY);
const apiUrl = useOpenRouter
  ? "https://openrouter.ai/api/v1/chat/completions"
  : "https://ai.gateway.lovable.dev/v1/chat/completions";
const modelId = useOpenRouter
  ? "google/gemini-3-flash-preview"
  : "google/gemini-2.5-flash";
```

### Что будет изменено

| Аспект | Было | Станет |
|--------|------|--------|
| Провайдер | OpenRouter (если ключ есть) | Только Lovable AI Gateway |
| Модель | `gemini-2.5-flash` (fallback) | `gemini-3-flash-preview` |
| API URL | Условный выбор | Всегда `ai.gateway.lovable.dev` |
| API Key | `OPENROUTER_API_KEY` или `LOVABLE_API_KEY` | Только `LOVABLE_API_KEY` |

### Изменения в файле

**Файл:** `supabase/functions/chat/index.ts`

**Строки 536-602** будут упрощены:

```typescript
// ЗАКОММЕНТИРОВАНО: OpenRouter логика
// const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY");
// const useOpenRouter = Boolean(OPENROUTER_API_KEY);

// Используем Lovable AI Gateway напрямую
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
const apiUrl = "https://ai.gateway.lovable.dev/v1/chat/completions";
const modelId = "google/gemini-3-flash-preview";

if (!LOVABLE_API_KEY) {
  console.error("LOVABLE_API_KEY is not configured");
  throw new Error("LOVABLE_API_KEY is not configured");
}

console.log(`🤖 Using Lovable Gateway (Gemini 3 Flash Preview)`);
```

**Также будут закомментированы:**
- Дополнительные заголовки для OpenRouter (строки 570-574)
- Параметры `reasoning`, `route`, `models` (строки 589-602)

### Результат

- Все запросы идут через Lovable AI Gateway
- Используется модель `google/gemini-3-flash-preview` (самая новая)
- Код упрощается — нет условной логики
- Не требуется `OPENROUTER_API_KEY`

