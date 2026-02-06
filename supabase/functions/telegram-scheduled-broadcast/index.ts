import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Утреннее сообщение (9:00 МСК)
const MORNING_MESSAGE = `🎓 Привет! Готов к подготовке к ЕГЭ по математике?

Специально для тебя мы запустили два инструмента:

📝 <b>Тренажёр ЕГЭ</b> — решай задания 1-12 части с моментальной проверкой. Выбирай номер и тренируйся сколько хочешь!

🎯 <b>Диагностика</b> — пройди тест из 12 заданий и узнай свой текущий уровень. Покажу, какие темы знаешь хорошо, а над какими стоит поработать.

Начни с диагностики — это займёт 15-20 минут, зато поймёшь, на что делать упор 💪

Жми кнопку ниже 👇`;

const MORNING_BUTTONS = [
  { text: "🎯 Пройти диагностику", callback_data: "diagnostic_start" },
  { text: "📝 Открыть тренажёр", callback_data: "practice_start" }
];

// Вечернее сообщение (19:00 МСК)
const EVENING_MESSAGE = `🌙 Вечер — отличное время для подготовки!

Если утром не успел — самое время попробовать тренажёр ЕГЭ:

✅ Задания 1-12 части — база для уверенных 60+ баллов
✅ Моментальная проверка ответов
✅ Разбор решений, если ошибся

Всего 15 минут в день — и результат не заставит ждать 🚀

Попробуй прямо сейчас 👇`;

const EVENING_BUTTONS = [
  { text: "📝 Решить 5 задач", callback_data: "practice_start" },
  { text: "🎯 Диагностика", callback_data: "diagnostic_start" }
];

interface ScheduledBroadcastRequest {
  broadcast_type: "morning" | "evening";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { broadcast_type }: ScheduledBroadcastRequest = await req.json();
    
    console.log(`📬 Starting scheduled broadcast: ${broadcast_type}`);

    // Initialize Supabase
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get Telegram bot token
    const telegramToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
    if (!telegramToken) {
      console.error("TELEGRAM_BOT_TOKEN not configured");
      return new Response(
        JSON.stringify({ error: "TELEGRAM_BOT_TOKEN not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Select message and buttons based on broadcast type
    const message = broadcast_type === "morning" ? MORNING_MESSAGE : EVENING_MESSAGE;
    const buttons = broadcast_type === "morning" ? MORNING_BUTTONS : EVENING_BUTTONS;

    // Fetch math_ege users (completed onboarding with math subject)
    const { data: mathUsers, error: mathError } = await supabase
      .from("telegram_sessions")
      .select("telegram_user_id, onboarding_state, onboarding_data")
      .eq("onboarding_state", "completed");

    if (mathError) {
      console.error("Error fetching users:", mathError);
      return new Response(
        JSON.stringify({ error: "Failed to fetch users" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Filter users with math subject
    const targetUsers: number[] = [];
    for (const user of mathUsers || []) {
      const onboardingData = user.onboarding_data as { subject?: string } | null;
      if (onboardingData?.subject === "math") {
        targetUsers.push(user.telegram_user_id);
      }
    }

    console.log(`📊 Found ${targetUsers.length} math users for ${broadcast_type} broadcast`);

    // Send messages
    const results = {
      broadcast_type,
      total: targetUsers.length,
      sent: 0,
      failed: 0,
      errors: [] as { telegram_user_id: number; error: string }[]
    };

    for (const telegramUserId of targetUsers) {
      try {
        const response = await fetch(
          `https://api.telegram.org/bot${telegramToken}/sendMessage`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: telegramUserId,
              text: message,
              parse_mode: "HTML",
              reply_markup: {
                inline_keyboard: [buttons.map(b => ({
                  text: b.text,
                  callback_data: b.callback_data
                }))]
              }
            })
          }
        );

        const result = await response.json();

        if (result.ok) {
          results.sent++;
          // Log successful send
          await supabase.from("broadcast_logs").insert({
            telegram_user_id: telegramUserId,
            broadcast_type: `scheduled_${broadcast_type}`,
            message_preview: message.substring(0, 500),
            success: true
          });
        } else {
          results.failed++;
          const errorMsg = result.description || "Unknown error";
          results.errors.push({ telegram_user_id: telegramUserId, error: errorMsg });
          // Log failed send
          await supabase.from("broadcast_logs").insert({
            telegram_user_id: telegramUserId,
            broadcast_type: `scheduled_${broadcast_type}`,
            message_preview: message.substring(0, 500),
            success: false,
            error_message: errorMsg
          });
        }

        // Rate limiting: 50ms delay between messages
        await new Promise(resolve => setTimeout(resolve, 50));

      } catch (error) {
        results.failed++;
        const errorMsg = error instanceof Error ? error.message : "Unknown error";
        results.errors.push({ telegram_user_id: telegramUserId, error: errorMsg });
        console.error(`Failed to send to ${telegramUserId}:`, error);
      }
    }

    console.log(`✅ Broadcast complete: ${results.sent} sent, ${results.failed} failed`);

    return new Response(
      JSON.stringify(results),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Scheduled broadcast error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
