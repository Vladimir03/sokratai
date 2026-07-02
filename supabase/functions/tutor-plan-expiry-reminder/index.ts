/**
 * Cron-нудж «тариф AI-старт истекает через ≤3 дня» (round 3 конверсии, 2026-07-02).
 *
 * Триггер: pg_cron (daily) → POST с `Authorization: Bearer ${SCHEDULER_SECRET}`
 * (guard-паттерн homework-reminder). verify_jwt=false в config.toml.
 *
 * Логика: profiles c premium, истекающим в окне (now, now+3д] И имеющие строку
 * tutors (у учеников premium тоже живёт в profiles — их НЕ трогаем). Каскад
 * telegram (tutors.telegram_id) → email (auth.admin.getUserById, temp-guard в
 * sender). Идемпотентность: tutor_plan_expiry_reminder_log UNIQUE
 * (user_id, expires_at) — один нудж на конкретную дату истечения; продление
 * сдвигает expires_at → новый нудж в следующем цикле.
 *
 * Логи PII-free: счётчики и коды, без имён/email/chat id.
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import { sendTutorPlanExpiryEmail } from "../_shared/email-sender.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";

const REMINDER_WINDOW_DAYS = 3;
const PROFILE_URL = "https://sokratai.ru/tutor/profile";

// RU-дата без date-fns (Deno edge): «5 июля 2026».
const RU_MONTHS_GEN = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
];

function formatRuDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getDate()} ${RU_MONTHS_GEN[d.getMonth()]} ${d.getFullYear()}`;
}

// Mirror homework-reminder::sendTelegramMessage (1 retry на 429/5xx).
async function sendTelegramMessage(chatId: string, text: string): Promise<boolean> {
  if (!TELEGRAM_BOT_TOKEN) return false;
  const maxAttempts = 2;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const resp = await fetch(
        `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
        },
      );
      if (resp.ok) return true;
      const status = resp.status;
      if (attempt < maxAttempts - 1 && (status === 429 || status >= 500)) {
        await new Promise((r) => setTimeout(r, 500));
        continue;
      }
      return false;
    } catch {
      if (attempt < maxAttempts - 1) {
        await new Promise((r) => setTimeout(r, 500));
        continue;
      }
      return false;
    }
  }
  return false;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Scheduler guard (verbatim homework-reminder).
  const authHeader = req.headers.get("Authorization");
  const expectedSecret = Deno.env.get("SCHEDULER_SECRET");
  if (!expectedSecret || authHeader !== `Bearer ${expectedSecret}`) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const now = new Date();
    const windowEnd = new Date(now);
    windowEnd.setDate(windowEnd.getDate() + REMINDER_WINDOW_DAYS);

    // 1. Premium-профили, истекающие в окне (сюда попадают и ученики).
    const { data: expiring, error: expiringError } = await db
      .from("profiles")
      .select("id, subscription_expires_at")
      .eq("subscription_tier", "premium")
      .gt("subscription_expires_at", now.toISOString())
      .lte("subscription_expires_at", windowEnd.toISOString());
    if (expiringError) {
      console.error("expiring_profiles_query_failed", expiringError.message);
      return new Response(JSON.stringify({ error: "query failed" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!expiring || expiring.length === 0) {
      return new Response(JSON.stringify({ checked: 0, sent: 0 }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userIds = expiring.map((p) => p.id as string);
    const expiresByUser = new Map(
      expiring.map((p) => [p.id as string, p.subscription_expires_at as string]),
    );

    // 2. Только репетиторы (строка tutors) — премиум учеников не трогаем.
    const { data: tutorRows, error: tutorsError } = await db
      .from("tutors")
      .select("user_id, name, telegram_id")
      .in("user_id", userIds);
    if (tutorsError) {
      console.error("tutors_query_failed", tutorsError.message);
      return new Response(JSON.stringify({ error: "query failed" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const tutors = tutorRows ?? [];
    if (tutors.length === 0) {
      return new Response(JSON.stringify({ checked: expiring.length, tutors: 0, sent: 0 }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 3. Идемпотентность: убрать пары (user_id, expires_at), уже отработанные.
    const { data: alreadySent } = await db
      .from("tutor_plan_expiry_reminder_log")
      .select("user_id, expires_at")
      .in("user_id", tutors.map((t) => t.user_id as string));
    const sentKeys = new Set(
      (alreadySent ?? []).map(
        (r) => `${r.user_id}|${new Date(r.expires_at as string).getTime()}`,
      ),
    );

    let sentTelegram = 0;
    let sentEmail = 0;
    let noChannel = 0;

    for (const tutor of tutors) {
      const userId = tutor.user_id as string;
      const expiresAt = expiresByUser.get(userId);
      if (!expiresAt) continue;
      if (sentKeys.has(`${userId}|${new Date(expiresAt).getTime()}`)) continue;

      const expiryLabel = formatRuDate(expiresAt);
      const tutorName = typeof tutor.name === "string" && tutor.name.trim()
        ? tutor.name.trim()
        : "Коллега";

      let channel: string | null = null;

      // Каскад: telegram → email (first-success-wins).
      const telegramId = typeof tutor.telegram_id === "string" ? tutor.telegram_id.trim() : "";
      if (telegramId) {
        const text =
          `⏳ Ваш тариф AI-старт закончится ${expiryLabel}.\n` +
          `Продлите на ${PROFILE_URL} — иначе AI-проверка ДЗ отключится, ` +
          `а ученики вернутся на 10 сообщений в день.`;
        if (await sendTelegramMessage(telegramId, text)) {
          channel = "telegram";
        }
      }

      if (!channel) {
        try {
          const { data: userData } = await db.auth.admin.getUserById(userId);
          const email = userData?.user?.email;
          if (email) {
            const result = await sendTutorPlanExpiryEmail(
              db,
              email,
              { tutorName, expiryDate: expiryLabel, profileUrl: PROFILE_URL },
              userId,
              expiresAt,
            );
            if (result.success && !result.skipped) {
              channel = "email";
            }
          }
        } catch (emailErr) {
          console.error(
            "plan_expiry_email_failed",
            emailErr instanceof Error ? emailErr.message : String(emailErr),
          );
        }
      }

      if (channel === "telegram") sentTelegram++;
      else if (channel === "email") sentEmail++;
      else noChannel++;

      // Лог (идемпотентно: UNIQUE + ignoreDuplicates). channel=null тоже пишем —
      // не долбить репетитора без каналов каждый день.
      await db
        .from("tutor_plan_expiry_reminder_log")
        .upsert(
          { user_id: userId, expires_at: expiresAt, channel },
          { onConflict: "user_id,expires_at", ignoreDuplicates: true },
        );
    }

    const summary = {
      checked: expiring.length,
      tutors: tutors.length,
      sent_telegram: sentTelegram,
      sent_email: sentEmail,
      no_channel: noChannel,
    };
    console.log("tutor_plan_expiry_reminder_run", JSON.stringify(summary));

    return new Response(JSON.stringify(summary), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("tutor_plan_expiry_reminder_error", error instanceof Error ? error.message : String(error));
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
