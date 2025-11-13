import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ANALYSIS_SYSTEM_PROMPT = `Ты экспертный репетитор ЕГЭ. Проанализируй условие задачи и предоставь структурированный анализ.

🖼️ ВАЖНО: Ты можешь видеть и анализировать изображения с условиями задач. Если задача на изображении, внимательно изучи его.

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

// Input validation schema
const requestSchema = z.object({
  conditionText: z.string().max(5000, "Условие задачи слишком длинное (макс 5000 символов)").optional(),
  conditionPhotoUrl: z.string().url("Невалидный URL изображения").max(2048, "URL слишком длинный")
    .refine(url => {
      try {
        const u = new URL(url);
        // Only allow HTTPS and block internal/private network addresses
        if (u.protocol !== 'https:') return false;
        const blockedHosts = ['localhost', '127.0.0.1', '0.0.0.0', '169.254.169.254', '10.', '172.16.', '192.168.'];
        return !blockedHosts.some(blocked => u.hostname.includes(blocked));
      } catch {
        return false;
      }
    }, { message: 'Недопустимый URL изображения' })
    .optional(),
  subject: z.string().max(100, "Предмет слишком длинный").optional(),
  topic: z.string().max(200, "Тема слишком длинная").optional()
}).refine(data => data.conditionText || data.conditionPhotoUrl, {
  message: 'Требуется условие задачи (текст или фото)'
});

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Требуется авторизация" }), 
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate and sanitize input
    const rawBody = await req.json();
    const validation = requestSchema.safeParse(rawBody);
    
    if (!validation.success) {
      console.error("Validation error:", validation.error.errors);
      return new Response(
        JSON.stringify({ 
          error: validation.error.errors[0]?.message || "Невалидные данные запроса" 
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    
    const { conditionText, conditionPhotoUrl, subject, topic } = validation.data;

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      console.error("LOVABLE_API_KEY not configured");
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    // Prepare message content
    let userContent: any;

    if (conditionPhotoUrl) {
      // Multimodal: image + text
      // First, fetch the image and convert to base64 for Gemini
      console.log('Fetching image for homework analysis:', conditionPhotoUrl.substring(0, 100) + '...');

      const imageResponse = await fetch(conditionPhotoUrl);
      if (!imageResponse.ok) {
        console.error("Failed to fetch image:", conditionPhotoUrl, 'Status:', imageResponse.status);
        throw new Error(`Failed to fetch image: ${imageResponse.status}`);
      }

      console.log('Converting image to base64...');
      const imageBuffer = await imageResponse.arrayBuffer();
      const base64Image = btoa(
        new Uint8Array(imageBuffer).reduce((data, byte) => data + String.fromCharCode(byte), "")
      );

      const contentType = imageResponse.headers.get("content-type") || "image/jpeg";
      console.log('Image content type:', contentType, 'Base64 length:', base64Image.length);

      // Use Gemini format for images (not OpenAI format)
      userContent = [
        {
          type: "text",
          text: `Предмет: ${subject || 'не указан'}\nТема: ${topic || 'не указана'}\n\nПроанализируй задачу на изображении.`
        },
        {
          type: "image",
          image: `data:${contentType};base64,${base64Image}`
        }
      ];

      console.log('Image prepared in Gemini-compatible format');
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
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("Analysis error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Неизвестная ошибка" }), 
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
