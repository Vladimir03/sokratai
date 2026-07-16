/**
 * Разовый Telegram-анонс реферальной программы всем репетиторам (Stage 3
 * рефералки, rule 101; решение владельца 2026-07-15 — дистрибуция фичи).
 *
 * Admin-guarded (`x-admin-key` == BROADCAST_SECRET, mirror telegram-migrate-push).
 * verify_jwt=false (config.toml; деплой ТОЛЬКО Lovable-синком — rule 96 §11a).
 * Body: { dry_run?: boolean } — dry_run возвращает размер аудитории без отправки.
 *
 * Аудитория — tutors.telegram_id NOT NULL (репетиторы, а не студенческая
 * bot-база telegram_sessions — поэтому НЕ telegram-broadcast). Повторный запуск
 * не предполагается (one-off ops-инструмент); идемпотентность не строим.
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import { sendTelegramMessage } from "../_shared/telegram-send.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-admin-key",
  "Cache-Control": "no-store",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BROADCAST_SECRET = Deno.env.get("BROADCAST_SECRET");

const SEND_DELAY_MS = 50; // Telegram rate-limit courtesy (mirror telegram-broadcast)

const ANNOUNCE_TEXT =
  "👋 Здравствуйте! Это СократAI.\n\n" +
  "Теперь у каждого репетитора есть личный код приглашения для коллег. " +
  "Если СократAI экономит вам время на проверке ДЗ — поделитесь: коллега получит " +
  "7 дней полного AI бесплатно, а вы увидите в профиле, как он осваивается.\n\n" +
  "Мы готовим бонусную программу для приглашающих — все привязки уже засчитываются, " +
  "бонусы начислим ретроактивно.\n\n" +
  "Ваш код и ссылка — в профиле: https://sokratai.ru/tutor/profile";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const adminKey = req.headers.get("x-admin-key");
  if (!BROADCAST_SECRET || adminKey !== BROADCAST_SECRET) {
    return json({ error: "Unauthorized" }, 401);
  }

  try {
    let dryRun = false;
    try {
      const body = await req.json();
      dryRun = body?.dry_run === true;
    } catch {
      // пустой body → боевой запуск
    }

    const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: tutors, error } = await db
      .from("tutors")
      .select("telegram_id")
      .not("telegram_id", "is", null);
    if (error) {
      console.error("referral_announce_query_failed", error.message);
      return json({ error: "Не удалось получить список репетиторов." }, 500);
    }

    const targets = (tutors ?? [])
      .map((t) => (typeof t.telegram_id === "string" ? t.telegram_id.trim() : ""))
      .filter(Boolean);

    if (dryRun) {
      return json({ dry_run: true, targets: targets.length });
    }

    let sent = 0;
    for (const chatId of targets) {
      if (await sendTelegramMessage(chatId, ANNOUNCE_TEXT)) sent++;
      await new Promise((r) => setTimeout(r, SEND_DELAY_MS));
    }

    console.log("referral_announce_done", JSON.stringify({ targets: targets.length, sent }));
    return json({ targets: targets.length, sent });
  } catch (e) {
    console.error("referral_announce_error", e instanceof Error ? e.message : String(e));
    return json({ error: "Internal error" }, 500);
  }
});
