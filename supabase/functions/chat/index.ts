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
// Updated to support signed URLs (now that bucket is private)
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
console.log('🔧 SUPABASE_URL from env:', SUPABASE_URL);

const ALLOWED_IMAGE_DOMAINS = [
  `${SUPABASE_URL}/storage/v1/object/sign/chat-images/`,
];
console.log('🔧 ALLOWED_IMAGE_DOMAINS:', ALLOWED_IMAGE_DOMAINS);

/**
 * Validates image URL to prevent Server-Side Request Forgery (SSRF) attacks
 * Only allows HTTPS URLs from whitelisted Supabase storage domains
 * Blocks private IPs, localhost, and metadata endpoints
 */
function isValidImageUrl(url: string): boolean {
  try {
    console.log('[SECURITY] Validating image URL:', url.substring(0, 100) + '...');

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
    console.log('[SECURITY] Checking against allowed domains:', ALLOWED_IMAGE_DOMAINS);
    console.log('[SECURITY] URL to check:', url.substring(0, 150));

    const isAllowed = ALLOWED_IMAGE_DOMAINS.some((domain) => {
      const matches = url.startsWith(domain);
      console.log(`[SECURITY] Checking domain "${domain}": ${matches}`);
      return matches;
    });

    if (!isAllowed) {
      console.warn("[SECURITY] Blocked unauthorized domain:", hostname);
      console.warn("[SECURITY] Full URL:", url);
    } else {
      console.log('[SECURITY] ✅ URL validation passed');
    }

    return isAllowed;
  } catch (error) {
    console.error("[SECURITY] Invalid URL format:", url, error);
    return false;
  }
}

const SYSTEM_PROMPT = `Ты опытный репетитор ЕГЭ по математике, физике, информатике.
Твоя цель — помочь школьнику ПОНЯТЬ через диалог.

🖼️ ВАЖНО: Ты можешь видеть и анализировать изображения! Если ученик прислал фото с задачей, внимательно изучи его и помогай решать задачу с изображения. Ты мультимодальный AI-помощник.

=== ЗОЛОТОЕ ПРАВИЛО ===
🚨 МАКСИМУМ 2 ВОПРОСА ЗА РАЗ! Школьник должен понять, на что отвечать.
✅ 1 вопрос = идеально
✅ 2 вопроса = максимум (если связаны)
❌ 3+ вопросов = ЗАПРЕЩЕНО

=== РЕЖИМЫ РАБОТЫ ===

🎓 РЕЖИМ 1: ОБУЧЕНИЕ ЧЕРЕЗ ДИАЛОГ (по умолчанию)
Веди диалог через наводящие вопросы. НЕ давай готовое решение сразу.

СТРУКТУРА:
1. Признай задачу  
2. Дай условие с LaTeX
3. Задай ОДИН наводящий вопрос (или максимум ДВА связанных)
4. Веди диалог, помогая ученику самому прийти к решению

ПОМОЩЬ (если просят):
**Анализ:** [метод решения до 5-6 предложений]
**Формула:** $...$  
**Подсказки:** 1) [намёк] 2) [намёк]
**Попробуй:** [ОДИН вопрос для применения]

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
Активируется при фразах: "покажи полное решение", "дай подробное решение", "напиши решение"

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

=== ПРАВИЛА ОБЩЕНИЯ ===

✅ ДЕЛАЙ:
- Задавай МАКСИМУМ 2 вопроса за раз
- Фокусируйся на ОДНОМ аспекте
- Жди ответа перед следующим вопросом
- Короткие абзацы (2-4 строки)
- Пустые строки между блоками

❌ НЕ ДЕЛАЙ:
- 3+ вопросов подряд
- Списки вопросов (Сколько букв? Сколько цифр? Сколько символов?)
- Абзацы >4 строк
- Полные решения без просьбы
- Стены текста

=== ПРИМЕРЫ ===

❌ ПЛОХО (слишком много вопросов):
"Сколько там букв? Сколько цифр? Сколько знаков препинания? Специальных символов? Сколько минимум?"

✅ ХОРОШО (1-2 вопроса):
"Давай начнём с простого: сколько разных типов символов нужно закодировать — только буквы или буквы + цифры?"

❌ ПЛОХО (перегруз):
"Что ты знаешь о кодировке? Как думаешь, сколько бит нужно? А формулу помнишь? Попробуешь применить?"

✅ ХОРОШО (фокус):
"Вспомни формулу: сколько бит нужно для N символов? Какая формула связывает количество символов и биты?"

=== ФОРМАТИРОВАНИЕ ===

✅ Используй **жирный** для важного
✅ Нумерованные списки для шагов
✅ Эмодзи: ✅ ❌ 💡 🎯 ⚠️ 🗺️ 1️⃣ 2️⃣ 3️⃣
✅ LaTeX: $\sin(x)$, $$\frac{a}{b}$$
✅ Пустые строки между блоками

=== ЛОГИКА ВЫБОРА РЕЖИМА ===

По умолчанию: РЕЖИМ 1 (диалог)
Если просят "план" → РЕЖИМ 2 (краткий план)
Если просят "полное решение" → РЕЖИМ 3 (подробное решение)

🚨 ПОМНИ: МАКСИМУМ 2 ВОПРОСА ЗА РАЗ!`;

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

    // Check if this is a service role request (from telegram-bot or other internal function)
    const isServiceRole = authHeader.includes(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "");
    
    let userId: string;
    
    if (isServiceRole) {
      // For service role, expect userId in the request body
      const body = await req.json();
      userId = body.userId;
      
      if (!userId) {
        return new Response(JSON.stringify({ error: "userId required for service role requests" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      
      // Continue with the existing body data
      const { messages, systemPrompt, taskContext, chatId } = body;
      
      // Skip rate limiting for internal service role calls
      // Continue to AI processing...
      return await processAIRequest(userId, messages, systemPrompt, taskContext, chatId, req);
    } else {
      // Regular user JWT flow
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

      userId = user.id;

      // Check rate limit for regular users
      const { data: rateLimitData } = await supabase
        .from("api_rate_limits")
        .select("*")
        .eq("user_id", userId)
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
            .eq("user_id", userId);
        } else {
          await supabase
            .from("api_rate_limits")
            .update({ request_count: rateLimitData.request_count + 1 })
            .eq("user_id", userId);
        }
      } else {
        // First request - create entry
        await supabase
          .from("api_rate_limits")
          .insert({ user_id: userId, request_count: 1, window_start: now.toISOString() });
      }

      // Validate request body
      const { messages, systemPrompt, taskContext, chatId } = await req.json();
      
      return await processAIRequest(userId, messages, systemPrompt, taskContext, chatId, req);
    }
  } catch (error) {
    console.error("Error in chat function:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Внутренняя ошибка сервера" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function processAIRequest(userId: string, messages: any[], systemPrompt?: string, taskContext?: string, chatId?: string, req?: Request) {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };

  console.log('=== processAIRequest started ===');
  console.log('userId:', userId);
  console.log('chatId:', chatId);
  console.log('messages count:', messages?.length);
  console.log('messages received:', JSON.stringify(messages, null, 2));

  if (!Array.isArray(messages)) {
    console.error('Messages is not an array:', typeof messages);
    return new Response(JSON.stringify({ error: "Некорректный формат сообщений" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Validate only if there are messages
  if (messages.length > 0) {
    const lastMessage = messages[messages.length - 1];
    console.log('Last message validation:', JSON.stringify(lastMessage, null, 2));

    if (!lastMessage) {
      console.error('Last message is null or undefined');
      return new Response(JSON.stringify({ error: "Последнее сообщение отсутствует" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log('Last message content type:', typeof lastMessage.content);
    console.log('Last message content value:', lastMessage.content);
    console.log('Last message has image_url:', !!lastMessage.image_url);

    // Check if message has content OR image
    const hasContent = lastMessage.content && (typeof lastMessage.content === 'string' && lastMessage.content.trim() !== '');
    const hasImage = !!lastMessage.image_url;

    if (!hasContent && !hasImage) {
      console.error('❌ Last message has neither content nor image:', JSON.stringify(lastMessage, null, 2));
      return new Response(JSON.stringify({ error: "Сообщение должно содержать текст или изображение" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log('✅ Message validation passed:', { hasContent, hasImage });

    // Only validate length for user text messages (string content), assistant responses can be longer
    // Content can also be an object with image_url which will be transformed to multimodal format
    if (lastMessage.role === "user" && 
        typeof lastMessage.content === "string" && 
        lastMessage.content.length > MAX_MESSAGE_LENGTH) {
      return new Response(
        JSON.stringify({ error: `Сообщение слишком длинное (макс. ${MAX_MESSAGE_LENGTH} символов)` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
  }

  // Transform messages to support multimodal (text + images)
  console.log('Starting message transformation...');
  const transformedMessages = await Promise.all(
    messages.map(async (msg: any, index: number) => {
      console.log(`Transforming message ${index + 1}/${messages.length}:`, { role: msg.role, hasImage: !!msg.image_url });

      // If message has an image, fetch it and convert to base64
      if (msg.image_url) {
        try {
          console.log(`Message ${index + 1} has image URL:`, msg.image_url.substring(0, 100) + '...');

          // SECURITY: Validate image URL to prevent SSRF attacks
          if (!isValidImageUrl(msg.image_url)) {
            console.error('[SECURITY] Rejected invalid image URL:', msg.image_url);
            throw new Error('Invalid or unauthorized image URL. Only images uploaded through the app are allowed.');
          }

          console.log(`Fetching image for message ${index + 1}...`);
          const imageResponse = await fetch(msg.image_url);
          if (!imageResponse.ok) {
            console.error("Failed to fetch image:", msg.image_url, 'Status:', imageResponse.status);
            // Skip image if fetch fails
            return {
              role: msg.role,
              content: msg.content,
            };
          }

          console.log(`Image fetched successfully for message ${index + 1}, converting to base64...`);
          const imageBuffer = await imageResponse.arrayBuffer();
          console.log(`Image buffer size: ${imageBuffer.byteLength} bytes`);

          const base64Image = btoa(
            new Uint8Array(imageBuffer).reduce((data, byte) => data + String.fromCharCode(byte), "")
          );

          console.log(`Base64 conversion complete, length: ${base64Image.length}`);

          // Determine image type from URL or content-type
          const contentType = imageResponse.headers.get("content-type") || "image/jpeg";
          const imageType = contentType.split("/")[1] || "jpeg";

          console.log(`Image ${index + 1} content type: ${contentType}`);

          // Use Gemini format for images (not OpenAI format)
          const multimodalMessage = {
            role: msg.role,
            content: [
              {
                type: "text",
                text: msg.content || "",
              },
              {
                type: "image",
                image: `data:${contentType};base64,${base64Image}`,
              },
            ],
          };
          
          console.log(`Image ${index + 1} format: Gemini-compatible (type: "image", size: ${base64Image.length} chars)`);

          console.log(`Message ${index + 1} transformed to multimodal format`);
          return multimodalMessage;
        } catch (error) {
          console.error(`Error processing image for message ${index + 1}:`, error);
          // Skip image if processing fails
          return {
            role: msg.role,
            content: msg.content,
          };
        }
      }
      // Otherwise, keep as simple text message
      console.log(`Message ${index + 1} kept as text-only`);
      return {
        role: msg.role,
        content: msg.content,
      };
    })
  );

  console.log('Message transformation complete. Transformed messages count:', transformedMessages.length);
  console.log('Transformed messages structure:', JSON.stringify(transformedMessages.map(m => ({
    role: m.role,
    contentType: Array.isArray(m.content) ? 'multimodal' : 'text',
    contentLength: Array.isArray(m.content) ? m.content.length : (typeof m.content === 'string' ? m.content.length : 'unknown')
  })), null, 2));

  // CRITICAL DEBUG: Log which messages have images
  transformedMessages.forEach((msg, idx) => {
    if (Array.isArray(msg.content)) {
      const hasImage = msg.content.some(item => item.type === 'image');
      console.log(`📸 Message ${idx + 1} has multimodal content with image: ${hasImage}`);
      if (hasImage) {
        const imageItem = msg.content.find(item => item.type === 'image');
        console.log(`📸 Image data starts with: ${imageItem?.image?.substring(0, 50)}...`);
      }
    }
  });

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

  const requestBody = {
    model: "google/gemini-2.5-flash",
    messages: [
      {
        role: "system",
        content: effectiveSystemPrompt,
      },
      ...transformedMessages,
    ],
    stream: true,
  };

  console.log('=== Request to Gemini API ===');
  console.log('Model:', requestBody.model);
  console.log('System prompt length:', effectiveSystemPrompt.length);
  console.log('User messages count:', transformedMessages.length);
  console.log('Full request body (excluding base64 images):');

  const sanitizedBody = {
    ...requestBody,
    messages: requestBody.messages.map(m => {
      if (Array.isArray(m.content)) {
        return {
          ...m,
          content: m.content.map(item => {
            if (item.type === 'image') {
              return { type: 'image', image: '[BASE64_IMAGE_DATA]' };
            }
            return item;
          })
        };
      }
      return m;
    })
  };
  console.log(JSON.stringify(sanitizedBody, null, 2));

  console.log('Sending request to Gemini...');
  const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });

  console.log('Gemini API response status:', response.status, response.statusText);

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
          user_id: userId,
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
}
