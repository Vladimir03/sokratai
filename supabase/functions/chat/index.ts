import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MAX_MESSAGE_LENGTH = 2000;
const RATE_LIMIT_REQUESTS = 50;
const RATE_LIMIT_WINDOW_HOURS = 1;

const SYSTEM_PROMPT = `Ты опытный репетитор ЕГЭ по математике. Твоя цель — помочь школьнику ПОНЯТЬ через диалог.

ГЛАВНОЕ ПРАВИЛО: Не давай сразу полное решение! Веди диалог через подсказки.

ВИЗУАЛИЗАЦИЯ ГРАФИКОВ:
Когда объясняешь графики функций, предложи:
'Хочешь, покажу график? Это поможет визуализировать!'

И используй Desmos embed:
<iframe src="https://www.desmos.com/calculator/..." width="100%" height="400" style="border: 1px solid #ccc; border-radius: 8px;"></iframe>

СТРУКТУРА ОТВЕТА:
1. Признай задачу: 'Отлично! Вот ещё одна похожая задача для практики...'
2. Дай условие задачи с форматированием (если нужно используй LaTeX)
3. Дай ПОДСКАЗКУ через наводящий вопрос или намек на метод решения
4. Веди диалог через вопросы, помогая ученику самому прийти к решению

ЕСЛИ УЧЕНИК ПРОСИТ БОЛЬШЕ ПОМОЩИ:
**Анализ:** Что нужно применить

**Ключевая формула:** $...$ 

**Подсказки:**
1. [Первый шаг] — намек
2. [Второй шаг] — намек

**Вопрос:** Попробуешь применить это?

ПОЛНОЕ РЕШЕНИЕ (только если явно попросят 'покажи полное решение' или 'покажи ответ'):

**Решение:**
1. [Шаг с объяснением]
2. [Шаг с объяснением]

**Ответ:** ...

ФОРМАТИРОВАНИЕ:
✅ Используй **жирный** для важного
✅ Нумерованные списки для шагов
✅ Эмодзи: ✅ ❌ 💡 🎯 ⚠️
✅ LaTeX: $\\sin(x)$, $$\\frac{a}{b}$$
✅ Пустые строки между блоками

❌ НЕ ДЕЛАЙ:
- Абзацы >4 строк
- Полные решения без просьбы
- Стены текста
- Вопросы типа "Какой уровень помощи тебе нужен?" с вариантами ответов

ПРИМЕРЫ:

Запрос: 'Дай мне похожую задачу для практики'

✅ ХОРОШО:
'Отлично! Вот ещё одна похожая задача для практики, чтобы ты мог самостоятельно применить этот алгоритм.

**Реши уравнение:** $3x^2 - 14x - 5 = 0$

💡 Подсказка: используй тот же метод, что и в предыдущей задаче

Попробуешь решить?'

Помни: ты НЕ решаешь ЗА ученика, а учишь его решать САМОМУ через наводящие вопросы! 🎣`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    // Get user from JWT
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Требуется авторизация" }), 
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: "Неверный токен" }), 
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check rate limit
    const { data: rateLimitData } = await supabase
      .from('api_rate_limits')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle();

    const now = new Date();
    if (rateLimitData) {
      const windowStart = new Date(rateLimitData.window_start);
      const hoursDiff = (now.getTime() - windowStart.getTime()) / (1000 * 60 * 60);

      if (hoursDiff < RATE_LIMIT_WINDOW_HOURS && rateLimitData.request_count >= RATE_LIMIT_REQUESTS) {
        const resetMinutes = Math.ceil((RATE_LIMIT_WINDOW_HOURS * 60) - (hoursDiff * 60));
        return new Response(
          JSON.stringify({ 
            error: `Превышен лимит запросов (${RATE_LIMIT_REQUESTS}/${RATE_LIMIT_WINDOW_HOURS}ч). Попробуйте через ${resetMinutes} мин.` 
          }), 
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Reset or increment counter
      if (hoursDiff >= RATE_LIMIT_WINDOW_HOURS) {
        await supabase
          .from('api_rate_limits')
          .update({ request_count: 1, window_start: now.toISOString() })
          .eq('user_id', user.id);
      } else {
        await supabase
          .from('api_rate_limits')
          .update({ request_count: rateLimitData.request_count + 1 })
          .eq('user_id', user.id);
      }
    } else {
      // First request - create entry
      await supabase
        .from('api_rate_limits')
        .insert({ user_id: user.id, request_count: 1, window_start: now.toISOString() });
    }

    // Validate request body
    const { messages } = await req.json();
    
    if (!Array.isArray(messages) || messages.length === 0) {
      return new Response(
        JSON.stringify({ error: "Некорректный формат сообщений" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate only the last user message (new message)
    const lastMessage = messages[messages.length - 1];
    if (!lastMessage || !lastMessage.content || typeof lastMessage.content !== 'string') {
      return new Response(
        JSON.stringify({ error: "Некорректное содержимое сообщения" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    
    // Only validate length for user messages, assistant responses can be longer
    if (lastMessage.role === 'user' && lastMessage.content.length > MAX_MESSAGE_LENGTH) {
      return new Response(
        JSON.stringify({ error: `Сообщение слишком длинное (макс. ${MAX_MESSAGE_LENGTH} символов)` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Transform messages to support multimodal (text + images)
    const transformedMessages = messages.map((msg: any) => {
      // If message has an image, use multimodal format
      if (msg.image_url) {
        return {
          role: msg.role,
          content: [
            {
              type: "text",
              text: msg.content
            },
            {
              type: "image_url",
              image_url: {
                url: msg.image_url
              }
            }
          ]
        };
      }
      // Otherwise, keep as simple text message
      return {
        role: msg.role,
        content: msg.content
      };
    });

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    
    if (!LOVABLE_API_KEY) {
      console.error("LOVABLE_API_KEY not configured");
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    console.log("Calling AI gateway with messages:", transformedMessages.length);

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-pro",
        messages: [
          { 
            role: "system", 
            content: SYSTEM_PROMPT
          },
          ...transformedMessages,
        ],
        stream: true,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Превышен лимит запросов. Попробуйте позже." }), 
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "Требуется пополнение баланса." }), 
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      throw new Error(`AI gateway error: ${response.status}`);
    }

    return new Response(response.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("Chat error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Неизвестная ошибка" }), 
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
