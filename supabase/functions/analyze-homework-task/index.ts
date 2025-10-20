import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ANALYSIS_SYSTEM_PROMPT = `Ты экспертный репетитор ЕГЭ. Проанализируй условие задачи и предоставь структурированный анализ.

ВАЖНО: Отвечай ТОЛЬКО валидным JSON в таком формате:
{
  "type": "краткое описание типа задачи (например: линейное уравнение, задача на движение, геометрическая задача)",
  "solution_steps": [
    "Шаг 1",
    "Шаг 2",
    "Шаг 3",
    "Шаг 4"
  ]
}

Требования:
- type: одна короткая фраза (2-4 слова) о типе задачи
- solution_steps: массив из 4 четких шагов для решения задачи
- Никакого дополнительного текста, ТОЛЬКО JSON`;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Требуется авторизация" }), 
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { conditionText, conditionPhotoUrl, subject, topic } = await req.json();
    
    if (!conditionText && !conditionPhotoUrl) {
      return new Response(
        JSON.stringify({ error: "Требуется условие задачи (текст или фото)" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      console.error("LOVABLE_API_KEY not configured");
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    // Prepare message content
    let userContent: any;
    
    if (conditionPhotoUrl) {
      // Multimodal: image + text
      userContent = [
        {
          type: "text",
          text: `Предмет: ${subject || 'не указан'}\nТема: ${topic || 'не указана'}\n\nПроанализируй задачу на изображении.`
        },
        {
          type: "image_url",
          image_url: {
            url: conditionPhotoUrl
          }
        }
      ];
    } else {
      // Text only
      userContent = `Предмет: ${subject || 'не указан'}\nТема: ${topic || 'не указана'}\n\nУсловие задачи:\n${conditionText}`;
    }

    console.log("Calling AI for homework task analysis");

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: ANALYSIS_SYSTEM_PROMPT },
          { role: "user", content: userContent }
        ],
        temperature: 0.3, // Lower temperature for more consistent structured output
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      throw new Error(`AI gateway error: ${response.status}`);
    }

    const result = await response.json();
    const aiContent = result.choices?.[0]?.message?.content;

    if (!aiContent) {
      throw new Error("No content in AI response");
    }

    console.log("AI response:", aiContent);

    // Parse JSON from AI response
    let analysis;
    try {
      // Try to extract JSON if AI wrapped it in markdown
      const jsonMatch = aiContent.match(/```json\s*([\s\S]*?)\s*```/) || 
                       aiContent.match(/```\s*([\s\S]*?)\s*```/);
      const jsonStr = jsonMatch ? jsonMatch[1] : aiContent;
      analysis = JSON.parse(jsonStr);
    } catch (parseError) {
      console.error("JSON parse error:", parseError);
      console.error("AI content:", aiContent);
      throw new Error("Failed to parse AI response as JSON");
    }

    // Validate the structure
    if (!analysis.type || !Array.isArray(analysis.solution_steps)) {
      throw new Error("Invalid analysis structure from AI");
    }

    return new Response(
      JSON.stringify({ analysis }), 
      { 
        status: 200, 
        headers: { 
          ...corsHeaders, 
          "Content-Type": "application/json"
        } 
      }
    );
  } catch (e) {
    console.error("Analysis error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Неизвестная ошибка" }), 
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
