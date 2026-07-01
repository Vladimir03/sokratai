/**
 * Онбординг-активация v2 (T7) — «войти по коду»: RU-safe magic-link на email.
 *
 * verify_jwt=false (публичный — запросить вход может любой по своему email).
 *
 * Поток (rule 96 — НЕ дефолтный Supabase magic-link, он ведёт на заблокированный
 * *.supabase.co):
 *   1. find_auth_user_id_by_email (rule 97, не listUsers).
 *   2. admin.generateLink({type:'magiclink'}) → properties.hashed_token.
 *   3. Письмо через наш RU-safe email-пайплайн со ссылкой на
 *      api.sokratai.ru/functions/v1/email-verify?type=magiclink (тот делает
 *      verifyOtp + redirect-with-hash → сессия).
 *
 * Anti-enumeration: ответ всегда нейтральный «если аккаунт есть — прислали ссылку».
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import { sendStudentLoginLinkEmail } from "../_shared/email-sender.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// RU-safe proxy host для ссылки в письме (НЕ raw *.supabase.co).
const VERIFY_BASE = "https://api.sokratai.ru/functions/v1/email-verify";
const DEFAULT_LANDING = "https://sokratai.ru/student/schedule";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

/**
 * Счётчик rate-limit по ключу за окно (auth_otp_throttle, service-role).
 * Возвращает allowed. Fail-open при сбое (вход важнее). Read-modify-write —
 * приблизительно (гонка допустима для троттлинга).
 */
async function throttleCheck(
  admin: ReturnType<typeof createClient>,
  key: string,
  max: number,
  windowMs: number,
): Promise<boolean> {
  try {
    const nowMs = Date.now();
    const { data: row } = await admin
      .from("auth_otp_throttle")
      .select("attempts, window_start")
      .eq("throttle_key", key)
      .maybeSingle();
    if (row) {
      const ws = Date.parse(row.window_start as string);
      if (nowMs - ws < windowMs) {
        if ((row.attempts as number) >= max) return false;
        await admin.from("auth_otp_throttle").update({ attempts: (row.attempts as number) + 1 }).eq("throttle_key", key);
      } else {
        await admin.from("auth_otp_throttle").update({ attempts: 1, window_start: new Date().toISOString() }).eq("throttle_key", key);
      }
    } else {
      await admin.from("auth_otp_throttle").insert({ throttle_key: key, attempts: 1, window_start: new Date().toISOString() });
    }
    return true;
  } catch (e) {
    console.warn(JSON.stringify({ event: "student_otp_throttle_failed", error: e instanceof Error ? e.message : String(e) }));
    return true; // fail-open
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ code: "METHOD_NOT_ALLOWED", error: "Метод не поддерживается." }, 405);
  }

  // Нейтральный ответ (anti-enumeration) — один и тот же для «нашли/не нашли».
  const neutral = json({ ok: true });

  try {
    const body = await req.json().catch(() => ({}));
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!EMAIL_RE.test(email)) {
      return json({ code: "INVALID_EMAIL", error: "Введите корректный email." }, 400);
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // Rate-limit (review P1 #5 + round-2 P2): email — строгий лимит (bombing
    // одного адреса), IP — мягкий (spraying разных email из одного источника).
    // Троттлим ДО lookup. Ответ всегда нейтральный (anti-enumeration).
    const WINDOW_MS = 15 * 60 * 1000;
    const clientIp = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim();
    const emailOk = await throttleCheck(admin, `email:${email}`, 5, WINDOW_MS);
    const ipOk = clientIp ? await throttleCheck(admin, `ip:${clientIp}`, 30, WINDOW_MS) : true;
    if (!emailOk || !ipOk) {
      return neutral;
    }

    const { data: foundId, error: lookupErr } = await admin.rpc("find_auth_user_id_by_email", {
      p_email: email,
    });
    if (lookupErr) {
      console.warn(JSON.stringify({ event: "student_otp_lookup_failed", error: lookupErr.message }));
      return neutral; // не раскрываем; пользователь повторит
    }
    if (!foundId) {
      return neutral; // аккаунта нет — молчим
    }

    // OTP «войти по коду» — только для УЖЕ активированных (returning) аккаунтов.
    // Пустой плейсхолдер (last_sign_in_at NULL), даже с реальным email от
    // connect-student-email, активируется ТОЛЬКО claim-ссылкой. Иначе OTP-first →
    // last_sign_in_at set, но claimed_at NULL → ученик застревает между
    // ALREADY_ACTIVE (claim) и NOT_ONBOARDING (register). review round-3 P1.
    const { data: otpUser } = await admin.auth.admin.getUserById(foundId as string);
    if (!otpUser?.user?.last_sign_in_at) {
      return neutral; // не активирован → OTP не его путь; молчим (anti-enumeration)
    }

    const { data: linkData, error: genErr } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email,
    });
    const hashedToken = linkData?.properties?.hashed_token;
    if (genErr || !hashedToken) {
      console.warn(JSON.stringify({ event: "student_otp_generatelink_failed", error: genErr?.message ?? "no_hash" }));
      return neutral;
    }

    const loginUrl =
      `${VERIFY_BASE}?token_hash=${encodeURIComponent(hashedToken)}` +
      `&type=magiclink&redirect_to=${encodeURIComponent(DEFAULT_LANDING)}`;

    await sendStudentLoginLinkEmail(admin, email, loginUrl);
    return neutral;
  } catch (e) {
    console.error(JSON.stringify({ event: "student_otp_error", error: e instanceof Error ? e.message : String(e) }));
    return neutral; // не раскрываем внутренние ошибки на публичном endpoint
  }
});
