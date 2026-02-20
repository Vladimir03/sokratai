import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

function calculateLessonPaymentAmount(
  durationMin: number,
  hourlyRateCents: number | null | undefined
): number | null {
  if (hourlyRateCents == null || hourlyRateCents <= 0 || durationMin <= 0) {
    return null;
  }
  return Math.round((durationMin / 60) * (hourlyRateCents / 100));
}

const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface LessonForReminder {
  lesson_id: string;
  tutor_id: string;
  tutor_telegram_id: string;
  student_name: string;
  lesson_date: string;
  lesson_time: string;
  duration_min: number;
  hourly_rate_cents: number | null;
}

async function sendPaymentReminder(
  chatId: string,
  lessonId: string,
  studentName: string,
  lessonDate: string,
  lessonTime: string,
  durationMin: number,
  hourlyRateCents: number | null
): Promise<boolean> {
  if (!TELEGRAM_BOT_TOKEN) {
    console.error("TELEGRAM_BOT_TOKEN not set");
    return false;
  }

  const amount = calculateLessonPaymentAmount(durationMin, hourlyRateCents);
  const amountText = amount ? `\nРасчетная сумма: <b>${amount} ₽</b>` : '';
  const amountLabel = amount ? ` (${amount} ₽)` : '';

  const message = `🎓 <b>Занятие завершилось?</b>

Урок с <b>${studentName}</b> подошел к концу (${durationMin} мин).${amountText}

📅 ${lessonDate}
🕐 ${lessonTime}

Ваши действия:`;

  const keyboard = {
      inline_keyboard: [
        [
          { text: `✅ Проведено, жду оплату${amountLabel}`, callback_data: `payment:pending:${lessonId}` },
        ],
        [
          { text: `💳 Уже оплачено${amountLabel}`, callback_data: `payment:paid:${lessonId}` },
        ],
        [
          { text: "❌ Урок отменен", callback_data: `payment:cancelled:${lessonId}` },
        ],
      ],
  };

  try {
    const response = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: message,
          parse_mode: "HTML",
          reply_markup: keyboard,
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
    // Create Supabase client with service role
    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    // Get lessons needing payment reminder
    const { data: lessons, error } = await supabase.rpc(
      "get_lessons_needing_payment_reminder"
    );

    if (error) {
      console.error("Error fetching lessons:", error);
      return new Response(
        JSON.stringify({ error: "Failed to fetch lessons" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!lessons || lessons.length === 0) {
      return new Response(
        JSON.stringify({ success: true, processed: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let processed = 0;
    let failed = 0;

    for (const lesson of lessons as LessonForReminder[]) {
      // Format date for display
      const dateObj = new Date(lesson.lesson_date);
      const formattedDate = dateObj.toLocaleDateString("ru-RU", {
        day: "numeric",
        month: "long",
      });
      const formattedTime = lesson.lesson_time.slice(0, 5);

      const sent = await sendPaymentReminder(
        lesson.tutor_telegram_id,
        lesson.lesson_id,
        lesson.student_name,
        formattedDate,
        formattedTime,
        lesson.duration_min,
        lesson.hourly_rate_cents
      );

      if (sent) {
        // Mark reminder as sent
        await supabase.rpc("mark_payment_reminder_sent", {
          _lesson_id: lesson.lesson_id,
        });
        processed++;
      } else {
        failed++;
      }
    }

    return new Response(
      JSON.stringify({ success: true, processed, failed }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error processing payment reminders:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
