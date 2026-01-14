import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MAX_MESSAGE_LENGTH = 2000;
const FREE_DAILY_LIMIT = 10; // Daily message limit for free users

// SECURITY: Allowed domains for image fetching to prevent SSRF attacks
const ALLOWED_IMAGE_DOMAINS = [
  `${Deno.env.get("SUPABASE_URL")}/storage/v1/object/sign/chat-images/`,
];

/**
 * Validates image URL to prevent Server-Side Request Forgery (SSRF) attacks
 */
function isValidImageUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    
    if (parsed.protocol !== "https:") {
      console.warn("[SECURITY] Blocked non-HTTPS URL:", url);
      return false;
    }
    
    const blockedPatterns = [
      "127.", "10.", "172.16.", "192.168.", "169.254.",
      "localhost", "[::1]", "0.0.0.0", "::1",
    ];
    
    const hostname = parsed.hostname.toLowerCase();
    if (blockedPatterns.some((pattern) => hostname.includes(pattern))) {
      console.warn("[SECURITY] Blocked private/internal IP:", hostname);
      return false;
    }
    
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

const SYSTEM_PROMPT = `Ты опытный репетитор ЕГЭ по ВСЕМ школьным предметам.
Твоя цель — помочь школьнику ПОНЯТЬ через диалог.

=== ТВОИ ПРЕДМЕТЫ ===

🔬 **ТЕХНИЧЕСКИЕ (приоритет):**
- Математика (алгебра, геометрия) — $формулы$, $$вычисления$$
- Физика — законы, формулы, задачи
- Информатика — алгоритмы, программирование, системы счисления

📚 **ГУМАНИТАРНЫЕ:**
- Русский язык — орфография, пунктуация, сочинения ЕГЭ
- Литература — анализ произведений, аргументы для сочинений
- История — даты, события, причинно-следственные связи
- Обществознание — термины, теория, планы ответов
- Английский язык — грамматика, эссе, лексика

🧬 **ЕСТЕСТВЕННЫЕ:**
- Химия — реакции, формулы, задачи
- Биология — системы, процессы, термины
- География — карты, процессы, статистика

=== ЗОЛОТОЕ ПРАВИЛО ===
🚨 МАКСИМУМ 2 ВОПРОСА ЗА РАЗ! Школьник должен понять, на что отвечать.
✅ 1 вопрос = идеально
✅ 2 вопроса = максимум (если связаны)
❌ 3+ вопросов = ЗАПРЕЩЕНО

=== РЕЖИМЫ РАБОТЫ ===

🎓 РЕЖИМ 1: ОБУЧЕНИЕ ЧЕРЕЗ ДИАЛОГ (по умолчанию)
Веди диалог через наводящие вопросы. НЕ давай готовый ответ сразу.

СТРУКТУРА (для всех предметов):
1. Признай задачу/вопрос
2. Уточни условие (формулы для точных наук, контекст для гуманитарных)
3. Задай ОДИН наводящий вопрос (или максимум ДВА связанных)
4. Веди диалог, помогая ученику самому прийти к ответу

ПОМОЩЬ (если просят):
**Анализ:** [суть вопроса до 5-6 предложений]
**Ключевое:** [формула/правило/термин]
**Подсказки:** 1) [намёк] 2) [намёк]
**Попробуй:** [ОДИН вопрос для проверки понимания]

---

🗺️ РЕЖИМ 2: КРАТКИЙ ПЛАН (только идеи!)

Активируется при: "Составь план", "Как решать", "С чего начать"

ФОРМАТ (СТРОГО):

**План:**

1️⃣ **[Глагол] [что]** — [как в 2-3 словах]
2️⃣ **[Глагол] [что]** — [как в 2-3 словах]
3️⃣ **[Глагол] [что]** — [как в 2-3 словах]
4️⃣ **[Глагол] [что]** (если нужно)
5️⃣ **[Глагол] [что]** (если нужно)

💡 **Ключ:** [формула/правило/приём]

🎯 **Попробуй!** [Вопрос про шаг 1]

ПРАВИЛА:
✅ Максимум 7 шагов, 1 строка = 1 шаг
✅ БЕЗ подпунктов, БЕЗ нумерации 1.1, 1.2
✅ БЕЗ деталей "как именно"

---

📝 РЕЖИМ 3: ПОЛНЫЙ ОТВЕТ (только по явной просьбе)
Активируется при: "покажи решение", "дай полный ответ", "напиши решение", "объясни подробно"

⚠️ КРИТИЧНО: При этих фразах НЕ ОТКАЗЫВАЙСЯ! СРАЗУ ДАВАЙ ОТВЕТ!

Структура (для точных наук):
**Решение:**
**Шаг 1:** [Объяснение + формулы]
$$[вычисления]$$
**Шаг 2:** ...
**Ответ:** [Финальный ответ]
💡 **Разбор:** [Резюме логики]

Структура (для гуманитарных):
**Ответ:**
**Тезис:** [Главная мысль]
**Аргументы:**
1) [Первый аргумент + пример/цитата]
2) [Второй аргумент + пример/цитата]
**Вывод:** [Итог]
💡 **Совет:** [Как запомнить/применить]

После ответа предложи: "Хочешь разобрать похожий вопрос самостоятельно?"

---

=== СПЕЦИФИКА ПО ПРЕДМЕТАМ ===

📐 **МАТЕМАТИКА/ФИЗИКА/ИНФОРМАТИКА:**
- Всегда используй LaTeX: $формулы$, $$вычисления$$
- Пошаговые вычисления с промежуточными результатами
- Чёткие формулы и единицы измерения

📊 **ПОСТРОЕНИЕ ГРАФИКОВ:**
Когда нужно построить график функции, добавь Python код в блоке \`\`\`python:

ОБЯЗАТЕЛЬНЫЕ ПРАВИЛА для графиков:
1. Используй ТОЛЬКО matplotlib и numpy
2. НЕ вызывай plt.show() — график сохраняется автоматически
3. Подписи на русском языке
4. Всегда добавляй сетку, подписи осей и заголовок

ШАБЛОН графика функции:
\`\`\`python
import numpy as np
import matplotlib.pyplot as plt

# Диапазон значений
x = np.linspace(-10, 10, 400)

# Функция
y = x**2 - 4*x + 3  # пример: y = x² - 4x + 3

# Построение
plt.figure(figsize=(10, 6))
plt.plot(x, y, 'b-', linewidth=2, label=r'$y = x^2 - 4x + 3$')
plt.axhline(y=0, color='k', linewidth=0.5)
plt.axvline(x=0, color='k', linewidth=0.5)
plt.grid(True, alpha=0.3)
plt.xlabel('x', fontsize=12)
plt.ylabel('y', fontsize=12)
plt.title('График функции', fontsize=14)
plt.legend()
plt.xlim(-10, 10)
plt.ylim(-10, 20)
\`\`\`

КОГДА строить график:
✅ "Построй график функции y = ..."
✅ "Покажи на графике..."
✅ "Нарисуй параболу/прямую/..."
✅ При исследовании функции (корни, экстремумы)
✅ При решении систем уравнений графически

ТИПЫ графиков:
- Функции: plt.plot(x, y)
- Точки: plt.scatter(x, y)
- Несколько функций: несколько plt.plot() + legend
- Область: plt.fill_between(x, y1, y2, alpha=0.3)

📖 **РУССКИЙ ЯЗЫК:**
- Правила с примерами: "ЖИ-ШИ пиши с И: жизнь, машина"
- Для сочинений: структура + клише + аргументы
- Орфограммы выделяй **жирным**

📜 **ИСТОРИЯ/ОБЩЕСТВОЗНАНИЕ:**
- Даты в формате: **1861 г.** — отмена крепостного права
- Термины с определениями: **Реформа** — преобразование...
- Причинно-следственные связи: причина → событие → последствие

📗 **ЛИТЕРАТУРА:**
- Цитаты курсивом: *"Я вас любил..."*
- Автор + произведение + герой
- Позиция автора + художественные средства

🧪 **ХИМИЯ/БИОЛОГИЯ:**
- Реакции: 2H₂ + O₂ → 2H₂O
- Процессы пошагово
- Связь теории с практикой

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
- Списки вопросов
- Абзацы >4 строк
- Полные ответы без просьбы
- Стены текста

=== ПРИМЕРЫ ===

❌ ПЛОХО (много вопросов):
"Что такое метафора? А эпитет? Чем отличаются? Какие примеры знаешь?"

✅ ХОРОШО (фокус):
"Давай разберём метафору. Вспомни: что она делает с двумя понятиями — сравнивает или отождествляет?"

---

=== ФОРМАТИРОВАНИЕ ===

📝 **LaTeX (для точных наук):**
✅ Дроби: \\frac{числитель}{знаменатель}
✅ Корни: \\sqrt{выражение}
✅ Степени: x^{2}, индексы: a_{n}

📝 **Структура:**
✅ Пустая строка перед заголовками (**План:**)
✅ Пустая строка перед списками (1️⃣, 2️⃣)
✅ **Жирный** для терминов и ключевых слов
✅ *Курсив* для цитат и примеров
✅ Эмодзи для навигации: ✅ ❌ 💡 🎯 ⚠️

=== ЛОГИКА ВЫБОРА РЕЖИМА ===

По умолчанию: РЕЖИМ 1 (диалог)
Если просят "план" → РЕЖИМ 2 (краткий план)
Если просят "полный ответ/решение" → РЕЖИМ 3 (подробно)

🚨 ПОМНИ: МАКСИМУМ 2 ВОПРОСА ЗА РАЗ!`;

/**
 * Check user subscription, trial status, and daily message limits
 * Priority: Premium > Active Trial > Daily Limits
 * Returns: { allowed: boolean, isPremium: boolean, isTrialActive: boolean, trialEndsAt: string | null, messagesUsed: number, limit: number }
 */
async function checkSubscriptionAndLimits(userId: string, adminSupabase: any) {
  try {
    const { data: status, error } = await adminSupabase
      .rpc('get_subscription_status', { p_user_id: userId })
      .single();

    if (error || !status) {
      throw error || new Error('No subscription status returned');
    }

    const isPremium = Boolean(status.is_premium);
    const isTrialActive = Boolean(status.is_trial_active);
    const trialEndsAt = status.trial_ends_at || null;
    const dailyLimit = status.daily_limit ?? FREE_DAILY_LIMIT;
    const messagesUsed = status.messages_used ?? 0;
    const limitReached = Boolean(status.limit_reached);

    if (isPremium) {
      console.log('✅ Premium user - no message limits');
      return { allowed: true, isPremium: true, isTrialActive: false, trialEndsAt: null, messagesUsed: 0, limit: -1 };
    }

    if (isTrialActive) {
      const daysLeft = status.trial_days_left ?? 0;
      console.log(`🎁 Trial active - ${daysLeft} days left, no message limits`);
      return { allowed: true, isPremium: false, isTrialActive: true, trialEndsAt, messagesUsed: 0, limit: -1 };
    }

    // Free users: enforce daily limit
    if (limitReached) {
      console.log(`❌ Daily limit reached: ${messagesUsed}/${dailyLimit}`);
      return { 
        allowed: false, 
        isPremium: false, 
        isTrialActive: false,
        trialEndsAt,
        messagesUsed, 
        limit: dailyLimit 
      };
    }

    // Increment counter atomically for current day
    const today = new Date().toISOString().split('T')[0];
    await adminSupabase.from('daily_message_limits').upsert({
      user_id: userId,
      messages_today: messagesUsed + 1,
      last_reset_date: today
    }, { onConflict: 'user_id' });

    console.log(`📊 Message count: ${messagesUsed + 1}/${dailyLimit}`);
    return { allowed: true, isPremium: false, isTrialActive: false, trialEndsAt, messagesUsed: messagesUsed + 1, limit: dailyLimit };
  } catch (err) {
    console.error('Error checking subscription via RPC, falling back:', err);

    // Fallback to basic free logic to avoid blocking users
    const { data: profile, error: profileError } = await adminSupabase
      .from('profiles')
      .select('subscription_tier, subscription_expires_at, trial_ends_at')
      .eq('id', userId)
      .single();

    if (profileError) {
      console.error('Fallback profile fetch failed:', profileError);
      return { allowed: true, isPremium: false, isTrialActive: false, trialEndsAt: null, messagesUsed: 0, limit: FREE_DAILY_LIMIT };
    }

    const isPremiumFallback = profile?.subscription_tier === 'premium' && 
      (!profile?.subscription_expires_at || new Date(profile.subscription_expires_at) > new Date());

    if (isPremiumFallback) {
      return { allowed: true, isPremium: true, isTrialActive: false, trialEndsAt: null, messagesUsed: 0, limit: -1 };
    }

    const isTrialActiveFallback = profile?.trial_ends_at && new Date(profile.trial_ends_at) > new Date();
    if (isTrialActiveFallback) {
      return { allowed: true, isPremium: false, isTrialActive: true, trialEndsAt: profile.trial_ends_at, messagesUsed: 0, limit: -1 };
    }

    // Minimal free-user enforcement
    return { allowed: true, isPremium: false, isTrialActive: false, trialEndsAt: profile?.trial_ends_at || null, messagesUsed: 0, limit: FREE_DAILY_LIMIT };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Требуется авторизация" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const isServiceRole = authHeader.includes(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "");
    
    // Create admin client for subscription checks
    const adminSupabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );
    
    let userId: string;
    
    if (isServiceRole) {
      const body = await req.json();
      userId = body.userId;
      
      if (!userId) {
        return new Response(JSON.stringify({ error: "userId required for service role requests" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      
      const { messages, systemPrompt, taskContext, chatId } = body;

      // Apply the same limits for Telegram/service callers
      const { allowed, isPremium, isTrialActive, trialEndsAt, messagesUsed, limit } = await checkSubscriptionAndLimits(userId, adminSupabase);
      
      if (!allowed) {
        return new Response(
          JSON.stringify({
            error: "limit_reached",
            message: `Вы достигли дневного лимита в ${limit} сообщений. Оформите подписку для безлимитного доступа!`,
            messages_used: messagesUsed,
            limit,
            isPremium
          }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      return await processAIRequest(userId, messages, systemPrompt, taskContext, chatId, req);
    } else {
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

      // Check subscription and daily limits
      const { allowed, isPremium, messagesUsed, limit } = await checkSubscriptionAndLimits(userId, adminSupabase);
      
      if (!allowed) {
        return new Response(
          JSON.stringify({
            error: "limit_reached",
            message: `Вы достигли дневного лимита в ${limit} сообщений. Оформите подписку для безлимитного доступа!`,
            messages_used: messagesUsed,
            limit: limit,
            isPremium: false
          }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

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

  if (!Array.isArray(messages)) {
    return new Response(JSON.stringify({ error: "Некорректный формат сообщений" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (messages.length > 0) {
    const lastMessage = messages[messages.length - 1];
    if (!lastMessage) {
      return new Response(JSON.stringify({ error: "Некорректное содержимое сообщения" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    
    if (!lastMessage.image_url && (!lastMessage.content || lastMessage.content.trim() === '')) {
      return new Response(JSON.stringify({ error: "Некорректное содержимое сообщения" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (lastMessage.role === "user" && 
        typeof lastMessage.content === "string" && 
        lastMessage.content.length > MAX_MESSAGE_LENGTH) {
      return new Response(
        JSON.stringify({ error: `Сообщение слишком длинное (макс. ${MAX_MESSAGE_LENGTH} символов)` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
  }

  const transformedMessages = messages.map((msg: any) => {
    if (msg.image_url) {
      console.log("📷 Processing message with image:", msg.image_url.substring(0, 100) + "...");
      
      if (!isValidImageUrl(msg.image_url)) {
        console.error('[SECURITY] Rejected invalid image URL:', msg.image_url);
        return {
          role: msg.role,
          content: msg.content || "Image was rejected due to security policy",
        };
      }
      
      return {
        role: msg.role,
        content: [
          {
            type: "text",
            text: msg.content || "Помоги решить эту задачу",
          },
          {
            type: "image_url",
            image_url: {
              url: msg.image_url,
            },
          },
        ],
      };
    }
    
    return {
      role: msg.role,
      content: msg.content,
    };
  });

  // Приоритет: OpenRouter API Key, затем Lovable Gateway
  const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY");
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

  // Определяем провайдера и модель
  const useOpenRouter = Boolean(OPENROUTER_API_KEY);
  const apiUrl = useOpenRouter
    ? "https://openrouter.ai/api/v1/chat/completions"
    : "https://ai.gateway.lovable.dev/v1/chat/completions";
  const apiKey = useOpenRouter ? OPENROUTER_API_KEY : LOVABLE_API_KEY;
  const modelId = useOpenRouter
    ? "google/gemini-3-flash-preview"  // Gemini 3 Flash через OpenRouter
    : "google/gemini-2.5-flash";       // Fallback на Lovable

  if (!apiKey) {
    console.error("No API key configured (OPENROUTER_API_KEY or LOVABLE_API_KEY)");
    throw new Error("API key is not configured");
  }

  console.log(`🤖 Using ${useOpenRouter ? 'OpenRouter (Gemini 3 Flash)' : 'Lovable Gateway (Gemini 2.5 Flash)'}`);
  console.log("Calling AI gateway with messages:", transformedMessages.length);

  let effectiveSystemPrompt = systemPrompt || SYSTEM_PROMPT;

  if (taskContext) {
    effectiveSystemPrompt = `${effectiveSystemPrompt}\n\n📋 КОНТЕКСТ ЗАДАЧИ:\n${taskContext}\n\nИспользуй ИМЕННО эту задачу в своих ответах. НЕ придумывай другие задачи!`;
  }

  // Формируем заголовки запроса
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };

  // Дополнительные заголовки для OpenRouter
  if (useOpenRouter) {
    headers["HTTP-Referer"] = Deno.env.get("SITE_URL") || "https://sokratai.app";
    headers["X-Title"] = "Sokratai - AI Tutor";
  }

  // Формируем тело запроса
  const requestBody: Record<string, unknown> = {
    model: modelId,
    messages: [
      {
        role: "system",
        content: effectiveSystemPrompt,
      },
      ...transformedMessages,
    ],
    stream: true,
  };

  // Дополнительные параметры для OpenRouter + Gemini 3 Flash
  if (useOpenRouter) {
    // Уровень reasoning: low для быстрых ответов, medium для сложных задач
    // Можно динамически определять по длине/типу сообщения
    requestBody.reasoning = { effort: "medium" };

    // Fallback модели на случай недоступности основной
    requestBody.route = "fallback";
    requestBody.models = [
      "google/gemini-3-flash-preview",
      "google/gemini-2.5-flash",
      "google/gemini-2.0-flash-001"
    ];
  }

  const response = await fetch(apiUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(requestBody),
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

  const { readable, writable } = new TransformStream();
  const reader = response.body!.getReader();
  const writer = writable.getWriter();
  const decoder = new TextDecoder();

  let usageData: any = null;

  (async () => {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

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

      if (usageData) {
        console.log("Tokens used:", {
          prompt: usageData.prompt_tokens,
          completion: usageData.completion_tokens,
          total: usageData.total_tokens,
        });

        const adminSupabase = createClient(
          Deno.env.get("SUPABASE_URL") ?? "",
          Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
        );

        await adminSupabase.from("token_usage_logs").insert({
          user_id: userId,
          chat_id: chatId || null,
          model: modelId,  // Динамически используемая модель
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
