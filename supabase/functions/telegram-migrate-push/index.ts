/**
 * One-off migration push (RU-compliance, rule 96 «406-ФЗ»).
 *
 * Sends existing Telegram-only users (email `telegram_<id>@temp.sokratai.ru`,
 * ever signed in) a «задай пароль» message with a one-time set-password link, so
 * they migrate to email+password after «Войти через Telegram» was removed. Each
 * message carries a per-user token (`telegram_login_tokens.action_type='set_password'`,
 * 7-day TTL) — the same token the `/parol` command issues.
 *
 * Admin-guarded (`x-admin-key` header == `BROADCAST_SECRET`, mirror
 * telegram-broadcast). `verify_jwt=false`. Body:
 *   { dry_run?: boolean, telegram_user_ids?: number[] }
 *   - dry_run: true       → return the target list WITHOUT sending.
 *   - telegram_user_ids   → push only to these (explicit); else auto-enumerate.
 *
 * The bot never mints a session here — it only issues set-password tokens — so
 * this is not «authorization through Telegram».
 */
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-admin-key",
  "Cache-Control": "no-store",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN");
const BROADCAST_SECRET = Deno.env.get("BROADCAST_SECRET");

const APP_URL = "https://sokratai.ru";
// email `telegram_<digits>@temp.sokratai.ru` — the digits ARE the Telegram chat id.
const TEMP_TG_EMAIL_RE = /^telegram_(\d+)@temp\.sokratai\.ru$/i;
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days for a proactive blast.
const SEND_DELAY_MS = 50; // Telegram rate-limit courtesy (same as telegram-broadcast).

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type Target = { userId: string; tgId: number };

async function sendMigrationMessage(chatId: number, token: string): Promise<boolean> {
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          parse_mode: "HTML",
          disable_web_page_preview: true,
          text:
            "🔐 Важно: вход через Telegram отключён по требованию закона РФ.\n\n" +
            "Чтобы не потерять доступ к своим занятиям и прогрессу — задай пароль по кнопке ниже " +
            "и дальше входи по email на сайте. Займёт минуту. Ссылка действует 7 дней.",
          reply_markup: {
            inline_keyboard: [[
              { text: "🔐 Задать пароль", url: `${APP_URL}/set-password?t=${token}` },
            ]],
          },
        }),
      },
    );
    return res.ok;
  } catch (e) {
    console.error("[telegram-migrate-push] send failed", e instanceof Error ? e.message : String(e));
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }

  // Admin guard (mirror telegram-broadcast).
  const adminKey = req.headers.get("x-admin-key");
  if (!BROADCAST_SECRET || adminKey !== BROADCAST_SECRET) {
    return json({ error: "unauthorized" }, 401);
  }
  if (!TELEGRAM_BOT_TOKEN) {
    return json({ error: "bot_token_missing" }, 500);
  }

  const body = await req.json().catch(() => ({}));
  const dryRun = body.dry_run === true;
  const explicitIds: number[] | null = Array.isArray(body.telegram_user_ids)
    ? body.telegram_user_ids.filter((n: unknown) => typeof n === "number" && Number.isFinite(n))
    : null;

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // ── Enumerate targets ──
  const targets: Target[] = [];

  if (explicitIds && explicitIds.length > 0) {
    // Explicit list: resolve each Telegram id → auth account; keep only those
    // still on a temp email (i.e. not yet migrated).
    for (const tgId of explicitIds) {
      const { data: prof } = await admin
        .from("profiles")
        .select("id")
        .eq("telegram_user_id", tgId)
        .maybeSingle();
      if (!prof?.id) continue;
      const { data: au } = await admin.auth.admin.getUserById(prof.id);
      const email = (au?.user?.email ?? "").toLowerCase();
      if (email.endsWith("@temp.sokratai.ru")) {
        targets.push({ userId: prof.id, tgId });
      }
    }
  } else {
    // Auto-enumerate: paginate all users, keep temp-telegram accounts that ever
    // signed in (the ones who actually had a working Telegram web login).
    const perPage = 1000;
    for (let page = 1; page <= 20; page++) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
      if (error) {
        console.error("[telegram-migrate-push] listUsers failed", error.message);
        break;
      }
      const users = data?.users ?? [];
      for (const u of users) {
        const m = (u.email ?? "").match(TEMP_TG_EMAIL_RE);
        if (m && u.last_sign_in_at) {
          targets.push({ userId: u.id, tgId: Number(m[1]) });
        }
      }
      if (users.length < perPage) break;
    }
  }

  if (dryRun) {
    return json({
      dry_run: true,
      target_count: targets.length,
      telegram_ids: targets.map((t) => t.tgId),
    });
  }

  // ── Send ──
  let sent = 0;
  let failed = 0;
  for (const t of targets) {
    const token = crypto.randomUUID().replace(/-/g, "");
    const { error: insErr } = await admin.from("telegram_login_tokens").insert({
      token,
      status: "pending",
      action_type: "set_password",
      user_id: t.userId,
      telegram_user_id: t.tgId,
      expires_at: new Date(Date.now() + TOKEN_TTL_MS).toISOString(),
    });
    if (insErr) {
      console.error("[telegram-migrate-push] token insert failed", insErr.message);
      failed++;
      continue;
    }
    const ok = await sendMigrationMessage(t.tgId, token);
    if (ok) sent++;
    else failed++;
    await new Promise((r) => setTimeout(r, SEND_DELAY_MS));
  }

  console.log(
    JSON.stringify({ event: "telegram_migrate_push", total: targets.length, sent, failed }),
  );
  return json({ total: targets.length, sent, failed });
});
