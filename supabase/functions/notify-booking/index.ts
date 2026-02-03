import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface BookingNotification {
  tutor_id: string;
  student_name: string;
  lesson_date: string;
  lesson_time: string;
}

async function sendTelegramMessage(chatId: string, text: string): Promise<boolean> {
  if (!TELEGRAM_BOT_TOKEN) {
    console.error("TELEGRAM_BOT_TOKEN not set");
    return false;
  }

  try {
    const response = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: "HTML",
        }),
      }
    );

    const result = await response.json();
    if (!result.ok) {
      console.error("Telegram API error:", result);
      return false;
    }
    return true;
  } catch (error) {
    console.error("Failed to send Telegram message:", error);
    return false;
  }
}

serve(async (req) => {
  // Handle CORS
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { tutor_id, student_name, lesson_date, lesson_time }: BookingNotification = await req.json();

    if (!tutor_id || !student_name || !lesson_date || !lesson_time) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create Supabase client
    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    // Get tutor's telegram_id
    const { data: tutor, error: tutorError } = await supabase
      .from("tutors")
      .select("telegram_id, name")
      .eq("id", tutor_id)
      .single();

    if (tutorError || !tutor) {
      console.error("Tutor not found:", tutorError);
      return new Response(
        JSON.stringify({ error: "Tutor not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!tutor.telegram_id) {
      // Tutor doesn't have Telegram connected, skip notification
      return new Response(
        JSON.stringify({ success: true, message: "Tutor has no Telegram connected" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Send notification
    const message = `🎉 <b>Новая запись!</b>

Ученик <b>${student_name}</b> записался на занятие.

📅 Дата: <b>${lesson_date}</b>
🕐 Время: <b>${lesson_time}</b>

Откройте календарь для подробностей.`;

    const sent = await sendTelegramMessage(tutor.telegram_id, message);

    return new Response(
      JSON.stringify({ success: sent }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error processing notification:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
