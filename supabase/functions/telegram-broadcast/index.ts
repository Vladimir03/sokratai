import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-admin-key",
};

const DEFAULT_MESSAGE = `👋 Привет! Ты записался, но так и не попробовал 😊

Смотри, как я работаю:

📝 "Реши уравнение: 2x² - 5x + 2 = 0"

✨ Ответ: x₁ = 2, x₂ = 0.5

Объяснение:
1️⃣ Используем формулу дискриминанта: D = 25 - 16 = 9
2️⃣ x = (5 ± 3) / 4
3️⃣ x₁ = 8/4 = 2, x₂ = 2/4 = 0.5

Скинь мне свою задачу — текстом или фото 📸
Математика, физика, информатика — решу всё! 💪`;

interface BroadcastRequest {
  segment: "all" | "stuck_onboarding" | "no_messages";
  message?: string;
  dry_run?: boolean; // If true, just return users without sending
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Verify admin key
    const adminKey = req.headers.get("x-admin-key");
    const expectedKey = Deno.env.get("BROADCAST_SECRET");
    
    if (!expectedKey) {
      console.error("BROADCAST_SECRET not configured");
      return new Response(
        JSON.stringify({ error: "Server configuration error" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    
    if (adminKey !== expectedKey) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { segment, message, dry_run }: BroadcastRequest = await req.json();
    const broadcastMessage = message || DEFAULT_MESSAGE;

    // Initialize Supabase
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get Telegram bot token
    const telegramToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
    if (!telegramToken) {
      return new Response(
        JSON.stringify({ error: "TELEGRAM_BOT_TOKEN not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build query based on segment
    let users: { telegram_user_id: number; onboarding_state: string | null }[] = [];

    if (segment === "stuck_onboarding" || segment === "all") {
      // Users stuck in onboarding (null, welcome, waiting_grade, waiting_subject, waiting_goal)
      const { data: stuckUsers, error: stuckError } = await supabase
        .from("telegram_sessions")
        .select("telegram_user_id, onboarding_state")
        .or("onboarding_state.is.null,onboarding_state.eq.welcome,onboarding_state.eq.waiting_grade,onboarding_state.eq.waiting_subject,onboarding_state.eq.waiting_goal");

      if (stuckError) {
        console.error("Error fetching stuck users:", stuckError);
      } else {
        users = [...users, ...(stuckUsers || [])];
      }
    }

    if (segment === "no_messages" || segment === "all") {
      // Users who completed onboarding but have 0 messages
      const { data: completedUsers, error: completedError } = await supabase
        .from("telegram_sessions")
        .select("telegram_user_id, onboarding_state, user_id")
        .eq("onboarding_state", "completed");

      if (completedError) {
        console.error("Error fetching completed users:", completedError);
      } else if (completedUsers) {
        // Check which of these users have no messages
        for (const user of completedUsers) {
          if (user.user_id) {
            const { count } = await supabase
              .from("chat_messages")
              .select("id", { count: "exact", head: true })
              .eq("user_id", user.user_id);

            if (count === 0) {
              // Don't add duplicates
              if (!users.find(u => u.telegram_user_id === user.telegram_user_id)) {
                users.push({
                  telegram_user_id: user.telegram_user_id,
                  onboarding_state: user.onboarding_state
                });
              }
            }
          }
        }
      }
    }

    // Remove duplicates
    const uniqueUsers = Array.from(
      new Map(users.map(u => [u.telegram_user_id, u])).values()
    );

    console.log(`Found ${uniqueUsers.length} users for segment "${segment}"`);

    if (dry_run) {
      return new Response(
        JSON.stringify({
          dry_run: true,
          segment,
          user_count: uniqueUsers.length,
          users: uniqueUsers
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Send messages
    const results = {
      total: uniqueUsers.length,
      sent: 0,
      failed: 0,
      errors: [] as { telegram_user_id: number; error: string }[]
    };

    for (const user of uniqueUsers) {
      try {
        const response = await fetch(
          `https://api.telegram.org/bot${telegramToken}/sendMessage`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: user.telegram_user_id,
              text: broadcastMessage,
              parse_mode: "HTML"
            })
          }
        );

        const result = await response.json();

        if (result.ok) {
          results.sent++;
          // Log successful send
          await supabase.from("broadcast_logs").insert({
            telegram_user_id: user.telegram_user_id,
            broadcast_type: "manual",
            message_preview: broadcastMessage.substring(0, 500),
            success: true
          });
        } else {
          results.failed++;
          const errorMsg = result.description || "Unknown error";
          results.errors.push({ telegram_user_id: user.telegram_user_id, error: errorMsg });
          // Log failed send
          await supabase.from("broadcast_logs").insert({
            telegram_user_id: user.telegram_user_id,
            broadcast_type: "manual",
            message_preview: broadcastMessage.substring(0, 500),
            success: false,
            error_message: errorMsg
          });
        }

        // Rate limiting: 50ms delay between messages
        await new Promise(resolve => setTimeout(resolve, 50));

      } catch (error) {
        results.failed++;
        const errorMsg = error instanceof Error ? error.message : "Unknown error";
        results.errors.push({ telegram_user_id: user.telegram_user_id, error: errorMsg });
        console.error(`Failed to send to ${user.telegram_user_id}:`, error);
      }
    }

    console.log(`Broadcast complete: ${results.sent} sent, ${results.failed} failed`);

    return new Response(
      JSON.stringify(results),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Broadcast error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
