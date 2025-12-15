import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ACTIVATION_MESSAGE = `👋 Привет! Ты записался, но так и не попробовал 😊

Смотри, как я работаю:

📝 "Реши уравнение: 2x² - 5x + 2 = 0"

✨ Ответ: x₁ = 2, x₂ = 0.5

Объяснение:
1️⃣ Используем формулу дискриминанта: D = 25 - 16 = 9
2️⃣ x = (5 ± 3) / 4
3️⃣ x₁ = 8/4 = 2, x₂ = 2/4 = 0.5

Скинь мне свою задачу — текстом или фото 📸
Математика, физика, информатика — решу всё! 💪`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
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

    // Current time in Moscow (UTC+3)
    const now = new Date();
    const mskOffset = 3 * 60 * 60 * 1000;
    const mskNow = new Date(now.getTime() + mskOffset);
    
    // Calculate time window for users to remind:
    // - If it's 21:00 MSK now, we want users who registered:
    //   - Today before 21:00 MSK
    //   - Yesterday after 21:00 MSK
    
    // Start of today 00:00 MSK
    const todayMskStart = new Date(mskNow);
    todayMskStart.setHours(0, 0, 0, 0);
    const todayUtcStart = new Date(todayMskStart.getTime() - mskOffset);
    
    // Yesterday 21:00 MSK
    const yesterday21Msk = new Date(todayMskStart);
    yesterday21Msk.setDate(yesterday21Msk.getDate() - 1);
    yesterday21Msk.setHours(21, 0, 0, 0);
    const yesterday21Utc = new Date(yesterday21Msk.getTime() - mskOffset);

    console.log(`Checking for users registered between ${yesterday21Utc.toISOString()} and now`);

    // Get all telegram sessions created in the time window
    const { data: sessions, error: sessionsError } = await supabase
      .from("telegram_sessions")
      .select("telegram_user_id, onboarding_state, user_id, created_at")
      .gte("created_at", yesterday21Utc.toISOString());

    if (sessionsError) {
      console.error("Error fetching sessions:", sessionsError);
      return new Response(
        JSON.stringify({ error: "Failed to fetch sessions" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Found ${sessions?.length || 0} sessions in time window`);

    // Filter inactive users
    const usersToRemind: number[] = [];
    
    for (const session of sessions || []) {
      // Check if user already received activation_reminder
      const { count: reminderCount } = await supabase
        .from("broadcast_logs")
        .select("id", { count: "exact", head: true })
        .eq("telegram_user_id", session.telegram_user_id)
        .eq("broadcast_type", "activation_reminder");

      if (reminderCount && reminderCount > 0) {
        console.log(`User ${session.telegram_user_id} already received reminder, skipping`);
        continue;
      }

      // Check if user is inactive
      const isStuckInOnboarding = !session.onboarding_state || 
        ["welcome", "waiting_grade", "waiting_subject", "waiting_goal"].includes(session.onboarding_state);
      
      if (isStuckInOnboarding) {
        usersToRemind.push(session.telegram_user_id);
        continue;
      }

      // If completed onboarding, check if they have any messages
      if (session.onboarding_state === "completed" && session.user_id) {
        const { count: messageCount } = await supabase
          .from("chat_messages")
          .select("id", { count: "exact", head: true })
          .eq("user_id", session.user_id);

        if (!messageCount || messageCount === 0) {
          usersToRemind.push(session.telegram_user_id);
        }
      }
    }

    console.log(`Found ${usersToRemind.length} inactive users to remind`);

    // Send reminders
    const results = {
      total: usersToRemind.length,
      sent: 0,
      failed: 0,
      errors: [] as { telegram_user_id: number; error: string }[]
    };

    for (const telegramUserId of usersToRemind) {
      try {
        const response = await fetch(
          `https://api.telegram.org/bot${telegramToken}/sendMessage`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: telegramUserId,
              text: ACTIVATION_MESSAGE,
              parse_mode: "HTML"
            })
          }
        );

        const result = await response.json();

        if (result.ok) {
          results.sent++;
          await supabase.from("broadcast_logs").insert({
            telegram_user_id: telegramUserId,
            broadcast_type: "activation_reminder",
            message_preview: ACTIVATION_MESSAGE.substring(0, 100),
            success: true
          });
        } else {
          results.failed++;
          const errorMsg = result.description || "Unknown error";
          results.errors.push({ telegram_user_id: telegramUserId, error: errorMsg });
          await supabase.from("broadcast_logs").insert({
            telegram_user_id: telegramUserId,
            broadcast_type: "activation_reminder",
            message_preview: ACTIVATION_MESSAGE.substring(0, 100),
            success: false,
            error_message: errorMsg
          });
        }

        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 50));

      } catch (error) {
        results.failed++;
        const errorMsg = error instanceof Error ? error.message : "Unknown error";
        results.errors.push({ telegram_user_id: telegramUserId, error: errorMsg });
        console.error(`Failed to send reminder to ${telegramUserId}:`, error);
      }
    }

    console.log(`Scheduled reminder complete: ${results.sent} sent, ${results.failed} failed`);

    return new Response(
      JSON.stringify(results),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Scheduled reminder error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
