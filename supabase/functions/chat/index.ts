import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MAX_MESSAGE_LENGTH = 2000;
const RATE_LIMIT_REQUESTS = 50;
const RATE_LIMIT_WINDOW_HOURS = 1;

// SECURITY: Allowed domains for image fetching to prevent SSRF attacks
const ALLOWED_IMAGE_DOMAINS = [
  `${Deno.env.get("SUPABASE_URL")}/storage/v1/object/public/chat-images/`,
];

/**
 * Validates image URL to prevent Server-Side Request Forgery (SSRF) attacks
 * Only allows HTTPS URLs from whitelisted Supabase storage domains
 * Blocks private IPs, localhost, and metadata endpoints
 */
function isValidImageUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    
    // Only HTTPS allowed
    if (parsed.protocol !== "https:") {
      console.warn("[SECURITY] Blocked non-HTTPS URL:", url);
      return false;
    }
    
    // Block private IPs and localhost to prevent internal network access
    const blockedPatterns = [
      "127.", "10.", "172.16.", "192.168.", "169.254.",
      "localhost", "[::1]", "0.0.0.0", "::1",
    ];
    
    const hostname = parsed.hostname.toLowerCase();
    if (blockedPatterns.some((pattern) => hostname.includes(pattern))) {
      console.warn("[SECURITY] Blocked private/internal IP:", hostname);
      return false;
    }
    
    // Only allow whitelisted Supabase storage domains
    const isAllowed = ALLOWED_IMAGE_DOMAINS.some((domain) => url.startsWith(domain));
    if (!isAllowed) {
      console.warn("[SECURITY] Blocked unauthorized domain:", hostname);
    }
    return isAllowed;
  } catch (error) {
    console.error("[SECURITY] Invalid URL format:", url, error);
    return false;
  }
}

const SYSTEM_PROMPT = `Ты опытный репетитор ЕГЭ по математике, физике, информатике. 
Твоя цель — помочь школьнику ПОНЯТЬ через диалог.

=== РЕЖИМЫ РАБОТЫ ===

🎓 РЕЖИМ 1: ОБУЧЕНИЕ ЧЕРЕЗ ДИАЛОГ (по умолчанию)
Веди диалог через наводящие вопросы. НЕ давай готовое решение сразу.

СТРУКТУРА:
1. Признай задачу  
2. Дай условие с LaTeX  
3. Задай наводящий вопрос  
4. Веди диалог, помогая ученику самому прийти к решению

ПОМОЩЬ (если просят):
**Анализ:** [метод решения]
**Формула:** $...$  
**Подсказки:** 1) [намёк] 2) [намёк]
**Вопрос:** Попробуешь применить это?

---

🗺️ РЕЖИМ 2: КРАТКИЙ ПЛАН РЕШЕНИЯ (только идеи!)

Активируется при: "Составь план решения этой задачи"

ФОРМАТ (СТРОГО):

**План решения:**

1️⃣ **[Глагол] [что]** — [как в 2-3 словах]
2️⃣ **[Глагол] [что]** — [как в 2-3 словах]
3️⃣ **[Глагол] [что]** — [как в 2-3 словах]
4️⃣ **[Глагол] [что]** (если нужно)
5️⃣ **[Глагол] [что]** (если нужно)

💡 **Метод:** [одна фраза или формула]

🎯 **Попробуй!** [Вопрос про шаг 1]

ПРАВИЛА:
✅ Максимум 7 шагов, 1 строка = 1 шаг
✅ Только действия: Найди, Примени, Вычисли, Подставь
✅ БЕЗ подпунктов, БЕЗ нумерации 1.1, 1.2
✅ БЕЗ деталей "как именно"

---

📝 РЕЖИМ 3: ПОЛНОЕ РЕШЕНИЕ (только по явной просьбе)
Активируется при фразах: "покажи полное решение", "дай подробное решение"

⚠️ КРИТИЧНО: При этих фразах НЕ ОТКАЗЫВАЙСЯ! СРАЗУ ПОКАЗЫВАЙ РЕШЕНИЕ!

Структура ответа:

**Решение:**

**Шаг 1:** [Подробное объяснение + формулы]
$$[промежуточные вычисления]$$

**Шаг 2:** [Подробное объяснение + формулы]
$$[промежуточные вычисления]$$

**Шаг 3:** [Продолжай до конца]
...

**Ответ:** [Финальный ответ]

💡 **Разбор:** [Краткое резюме логики решения]

После показа решения предложи: "Хочешь разобрать похожую задачу самостоятельно?"

---

=== ФОРМАТИРОВАНИЕ ===

✅ Используй **жирный** для важного
✅ Нумерованные списки для шагов
✅ Эмодзи: ✅ ❌ 💡 🎯 ⚠️ 🗺️ 1️⃣ 2️⃣ 3️⃣
✅ LaTeX: $\sin(x)$, $$\frac{a}{b}$$
✅ Пустые строки между блоками

❌ НЕ ДЕЛАЙ:
- Абзацы >4 строк
- Полные решения без просьбы
- Стены текста

=== ЛОГИКА ВЫБОРА РЕЖИМА ===

По умолчанию: РЕЖИМ 1 (диалог)
Если просят "план" → РЕЖИМ 2 (краткий план)
Если просят "полное решение" → РЕЖИМ 3 (подробное решение)`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    // Get user from JWT
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Требуется авторизация" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
      global: { headers: { Authorization: authHeader } },
    });

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Неверный токен" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check rate limit
    const { data: rateLimitData } = await supabase
      .from("api_rate_limits")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();

    const now = new Date();
    if (rateLimitData) {
      const windowStart = new Date(rateLimitData.window_start);
      const hoursDiff = (now.getTime() - windowStart.getTime()) / (1000 * 60 * 60);

      if (hoursDiff < RATE_LIMIT_WINDOW_HOURS && rateLimitData.request_count >= RATE_LIMIT_REQUESTS) {
        const resetMinutes = Math.ceil(RATE_LIMIT_WINDOW_HOURS * 60 - hoursDiff * 60);
        return new Response(
          JSON.stringify({
            error: `Превышен лимит запросов (${RATE_LIMIT_REQUESTS}/${RATE_LIMIT_WINDOW_HOURS}ч). Попробуйте через ${resetMinutes} мин.`,
          }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // Reset or increment counter
      if (hoursDiff >= RATE_LIMIT_WINDOW_HOURS) {
        await supabase
          .from("api_rate_limits")
          .update({ request_count: 1, window_start: now.toISOString() })
          .eq("user_id", user.id);
      } else {
        await supabase
          .from("api_rate_limits")
          .update({ request_count: rateLimitData.request_count + 1 })
          .eq("user_id", user.id);
      }
    } else {
      // First request - create entry
      await supabase
        .from("api_rate_limits")
        .insert({ user_id: user.id, request_count: 1, window_start: now.toISOString() });
    }

    // Validate request body
    const { messages, systemPrompt, taskContext, chatId } = await req.json();

    if (!Array.isArray(messages)) {
      return new Response(JSON.stringify({ error: "Некорректный формат сообщений" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Validate only if there are messages
    if (messages.length > 0) {
      const lastMessage = messages[messages.length - 1];
      if (!lastMessage || !lastMessage.content || typeof lastMessage.content !== "string") {
        return new Response(JSON.stringify({ error: "Некорректное содержимое сообщения" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Only validate length for user messages, assistant responses can be longer
      if (lastMessage.role === "user" && lastMessage.content.length > MAX_MESSAGE_LENGTH) {
        return new Response(
          JSON.stringify({ error: `Сообщение слишком длинное (макс. ${MAX_MESSAGE_LENGTH} символов)` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    // Transform messages to support multimodal (text + images)
    const transformedMessages = await Promise.all(
      messages.map(async (msg: any) => {
        // If message has an image, fetch it and convert to base64
        if (msg.image_url) {
          try {
            // SECURITY: Validate image URL to prevent SSRF attacks
            if (!isValidImageUrl(msg.image_url)) {
              console.error('[SECURITY] Rejected invalid image URL:', msg.image_url);
              throw new Error('Invalid or unauthorized image URL. Only images uploaded through the app are allowed.');
            }
            
            const imageResponse = await fetch(msg.image_url);
            if (!imageResponse.ok) {
              console.error("Failed to fetch image:", msg.image_url);
              // Skip image if fetch fails
              return {
                role: msg.role,
                content: msg.content,
              };
            }
            
            const imageBuffer = await imageResponse.arrayBuffer();
            const base64Image = btoa(
              new Uint8Array(imageBuffer).reduce((data, byte) => data + String.fromCharCode(byte), "")
            );
            
            // Determine image type from URL or content-type
            const contentType = imageResponse.headers.get("content-type") || "image/jpeg";
            const imageType = contentType.split("/")[1] || "jpeg";
            
            return {
              role: msg.role,
              content: [
                {
                  type: "text",
                  text: msg.content,
                },
                {
                  type: "image_url",
                  image_url: {
                    url: `data:${contentType};base64,${base64Image}`,
                  },
                },
              ],
            };
          } catch (error) {
            console.error("Error processing image:", error);
            // Skip image if processing fails
            return {
              role: msg.role,
              content: msg.content,
            };
          }
        }
        // Otherwise, keep as simple text message
        return {
          role: msg.role,
          content: msg.content,
        };
      })
    );

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

    if (!LOVABLE_API_KEY) {
      console.error("LOVABLE_API_KEY not configured");
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    console.log("Calling AI gateway with messages:", transformedMessages.length);

    // Use provided systemPrompt if available, otherwise use default
    let effectiveSystemPrompt = systemPrompt || SYSTEM_PROMPT;
    
    // Add task context to system prompt if provided
    if (taskContext) {
      effectiveSystemPrompt = `${effectiveSystemPrompt}\n\n📋 КОНТЕКСТ ЗАДАЧИ:\n${taskContext}\n\nИспользуй ИМЕННО эту задачу в своих ответах. НЕ придумывай другие задачи!`;
    }

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "system",
            content: effectiveSystemPrompt,
            // Помечаем системный промпт как кэшируемый (если gateway поддерживает)
            cache_control: { type: "ephemeral" }
          },
          ...transformedMessages,
        ],
        stream: true,
        // Дополнительные параметры для оптимизации кэширования
        metadata: {
          enable_prompt_caching: true
        }
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);

      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Превышен лимит запросов. Попробуйте позже." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Требуется пополнение баланса." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      throw new Error(`AI gateway error: ${response.status}`);
    }

    // Create a transform stream to capture token usage
    const { readable, writable } = new TransformStream();
    const reader = response.body!.getReader();
    const writer = writable.getWriter();
    const decoder = new TextDecoder();

    let usageData: any = null;

    // Process stream and capture usage
    (async () => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          // Try to extract usage information from the chunk
          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split("\n");

          for (const line of lines) {
            if (line.startsWith("data: ") && !line.includes("[DONE]")) {
              try {
                const jsonStr = line.slice(6).trim();
                const parsed = JSON.parse(jsonStr);
                if (parsed.usage) {
                  usageData = parsed.usage;
                }
              } catch {
                // Ignore parsing errors
              }
            }
          }

          await writer.write(value);
        }

        // Log and store usage after stream completes
        if (usageData) {
          console.log("Tokens used:", {
            prompt: usageData.prompt_tokens,
            completion: usageData.completion_tokens,
            total: usageData.total_tokens,
          });

          // Store in database using service role
          const adminSupabase = createClient(
            Deno.env.get("SUPABASE_URL") ?? "",
            Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
          );

          await adminSupabase.from("token_usage_logs").insert({
            user_id: user.id,
            chat_id: chatId || null,
            model: "google/gemini-2.5-flash",
            prompt_tokens: usageData.prompt_tokens,
            completion_tokens: usageData.completion_tokens,
            total_tokens: usageData.total_tokens,
          });
        }
      } catch (e) {
        console.error("Error processing stream:", e);
      } finally {
        await writer.close();
      }
    })();

    return new Response(readable, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("Chat error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Неизвестная ошибка" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
