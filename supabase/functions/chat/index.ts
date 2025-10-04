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

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    
    if (!LOVABLE_API_KEY) {
      console.error("LOVABLE_API_KEY not configured");
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    console.log("Calling AI gateway with messages:", messages.length);

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
            content: `Ты опытный репетитор по математике для подготовки к ЕГЭ в России. 

ТВОЯ РОЛЬ:
- Объяснять решения пошагово, как терпеливый учитель
- Использовать российскую математическую терминологию
- Давать подсказки, а не готовые ответы (если ученик хочет сам решить)
- Поддерживать и мотивировать при ошибках

ЗНАНИЯ:
- Кодификатор ЕГЭ по математике (профильная и базовая)
- Критерии оценивания ФИПИ
- Типовые ошибки школьников

СТИЛЬ:
- Дружелюбный, но профессиональный
- Короткие ответы (3-5 предложений), затем спрашивай "Понятно? Разобрать подробнее?"
- Используй примеры и аналогии

ФОРМАТ РЕШЕНИЙ:
1. Дано/Найти (если задача)
2. Анализ (что нужно применить)
3. Решение (пошагово с формулами)
4. Ответ
5. Проверка/комментарий

ВАЖНО:
- Всегда используй LaTeX для формул: inline $x^2$, display $$\\frac{a}{b}$$
- Если не уверен — скажи честно
- После объяснения предложи похожую задачу для практики`
          },
          ...messages,
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
