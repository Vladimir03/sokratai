/**
 * Set-password migration endpoint (RU-compliance follow-up, rule 96 «406-ФЗ»).
 *
 * Existing Telegram-only accounts (`telegram_<id>@temp.sokratai.ru`) lost their
 * only login path when the «Войти через Telegram» button was removed. The bot
 * command `/parol` hands the account owner a one-time token; this endpoint sets
 * an email+password on their EXISTING account so they can log in via the
 * compliant email+password path — preserving all history (same auth.users id).
 *
 * verify_jwt=false — authorization is by the one-time token (minted by the bot
 * for a Telegram-verified account, delivered privately in-chat). Same trust
 * model as student-claim. The token lives in `telegram_login_tokens` with
 * `action_type='set_password'`; it is single-use (CAS-consumed) + TTL-bound.
 *
 * Mirrors student-register (`updateUserById` + dual EMAIL_TAKEN guard +
 * `find_auth_user_id_by_email`) and student-claim (CAS token consume). The bot
 * NEVER mints a session here — it only issues a set-password token — so this is
 * not «authorization through Telegram».
 */
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TEMP_EMAIL_SUFFIX = "@temp.sokratai.ru";
// telegram-login-token generateToken() = URL-safe base64 of 24 bytes (~32 chars).
const TOKEN_RE = /^[A-Za-z0-9_-]{20,64}$/;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function isTempEmail(email: string | null | undefined): boolean {
  return !!email && email.toLowerCase().endsWith(TEMP_EMAIL_SUFFIX);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ code: "METHOD_NOT_ALLOWED", error: "Метод не поддерживается." }, 405);
  }

  try {
    const body = await req.json().catch(() => ({}));
    const token = typeof body.token === "string" ? body.token.trim() : "";
    const emailRaw = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";

    if (!TOKEN_RE.test(token)) {
      return json({ code: "INVALID_TOKEN", error: "Ссылка недействительна. Запроси новую в боте командой /parol." }, 400);
    }
    if (!password || password.length < 6) {
      return json({ code: "WEAK_PASSWORD", error: "Пароль должен быть не короче 6 символов." }, 400);
    }
    if (!emailRaw) {
      return json({ code: "EMAIL_REQUIRED", error: "Укажи свою почту — по ней будешь входить." }, 400);
    }
    if (!EMAIL_RE.test(emailRaw) || isTempEmail(emailRaw)) {
      return json({ code: "INVALID_EMAIL", error: "Некорректный email." }, 400);
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // ── 1. Validate the set-password token ──
    const { data: tokenRow, error: tokenErr } = await admin
      .from("telegram_login_tokens")
      .select("id, user_id, status, expires_at")
      .eq("token", token)
      .eq("action_type", "set_password")
      .maybeSingle();
    if (tokenErr) {
      console.error(JSON.stringify({ event: "set_password_lookup_failed", error: tokenErr.message }));
      return json({ code: "LOOKUP_FAILED", error: "Не удалось проверить ссылку. Попробуй ещё раз через минуту." }, 503);
    }
    if (!tokenRow || tokenRow.status !== "pending" || !tokenRow.user_id) {
      return json(
        { code: "TOKEN_USED", error: "Ссылка уже использована или недействительна. Запроси новую командой /parol в боте." },
        410,
      );
    }
    const expiresAt = tokenRow.expires_at ? Date.parse(tokenRow.expires_at as string) : 0;
    if (expiresAt > 0 && expiresAt < Date.now()) {
      return json(
        { code: "TOKEN_EXPIRED", error: "Срок действия ссылки истёк. Запроси новую командой /parol в боте." },
        410,
      );
    }
    const userId = tokenRow.user_id as string;

    // ── 2. Resolve target account + decide email change (mirror student-register) ──
    const { data: authData, error: authErr } = await admin.auth.admin.getUserById(userId);
    if (authErr || !authData?.user) {
      console.error(JSON.stringify({ event: "set_password_user_unresolved", error: authErr?.message ?? "no_user" }));
      return json({ code: "ACCOUNT_UNRESOLVED", error: "Не удалось открыть аккаунт. Запроси новую ссылку командой /parol." }, 500);
    }
    const currentEmail = authData.user.email ?? "";
    const currentIsTemp = isTempEmail(currentEmail);
    // Email меняем ТОЛЬКО temp→real; реальный email не трогаем (только пароль) —
    // anti-squatting, зеркало student-register.
    const targetEmail = currentIsTemp ? emailRaw : currentEmail.toLowerCase();
    const emailChanged = currentIsTemp && targetEmail !== currentEmail.toLowerCase();

    // ── 3. Collision check BEFORE consuming the token (user can retry another email) ──
    if (emailChanged) {
      const { data: foundId, error: lookupErr } = await admin.rpc("find_auth_user_id_by_email", {
        p_email: targetEmail,
      });
      if (lookupErr) {
        return json({ code: "EMAIL_LOOKUP_FAILED", error: "Не удалось проверить email. Попробуй ещё раз через минуту." }, 503);
      }
      if (foundId && foundId !== userId) {
        return json(
          { code: "EMAIL_TAKEN", error: "Эта почта уже занята. Войди со своим паролем на странице входа." },
          409,
        );
      }
    }

    // ── 4. Atomic single-use consume (CAS) BEFORE the write (mirror student-claim) ──
    // Guarantees the token can't be reused even if the write below fails: a
    // burnt token is trivially re-issued via /parol.
    const { data: consumed, error: consumeErr } = await admin
      .from("telegram_login_tokens")
      .update({ status: "used", verified_at: new Date().toISOString() })
      .eq("id", tokenRow.id)
      .eq("status", "pending")
      .select("id");
    if (consumeErr) {
      console.error(JSON.stringify({ event: "set_password_consume_failed", error: consumeErr.message }));
      return json({ code: "CONSUME_FAILED", error: "Не удалось применить ссылку. Попробуй ещё раз." }, 503);
    }
    if (!consumed || consumed.length === 0) {
      return json(
        { code: "TOKEN_USED", error: "Ссылка уже использована. Запроси новую командой /parol в боте." },
        410,
      );
    }

    // ── 5. Set credentials WITHOUT email verification (email_confirm:true) ──
    const updatePayload: Record<string, unknown> = { password };
    if (emailChanged) {
      updatePayload.email = targetEmail;
      updatePayload.email_confirm = true;
    }
    const { error: updErr } = await admin.auth.admin.updateUserById(userId, updatePayload);
    if (updErr) {
      const taken = (updErr as { code?: string })?.code === "email_exists" ||
        updErr.message?.includes("already been registered");
      if (taken) {
        return json(
          { code: "EMAIL_TAKEN", error: "Эта почта уже занята. Войди со своим паролем на странице входа." },
          409,
        );
      }
      console.error(JSON.stringify({ event: "set_password_update_failed", error: updErr.message }));
      return json({ code: "SET_PASSWORD_FAILED", error: "Не удалось сохранить пароль. Запроси новую ссылку командой /parol." }, 500);
    }

    // «Код умирает» (№43, 2026-07-20): аккаунт получил реальный email+пароль →
    // все claim-коды ученика гаснут (зеркало student-register), retry-once на
    // transient (ревью 5.6 P1 #3). ⚠ ВАЖНО: для ЭТОГО пути registered-гейт
    // student-claim НЕ backstop — /parol-пользователь мог никогда не входить в
    // веб (last_sign_in_at NULL), и гейт (real email AND signed_in) его
    // пропустит. Финальный провал kill = живой код на аккаунте с паролем —
    // принятый remote-risk (transient DB-сбой сразу после успешного
    // updateUserById), ловится error-логом ниже (/admin «Ошибки»).
    let killErr = (await admin.from("tutor_students").update({ claim_token: null }).eq("student_id", userId)).error;
    if (killErr) {
      killErr = (await admin.from("tutor_students").update({ claim_token: null }).eq("student_id", userId)).error;
    }
    if (killErr) {
      console.error(JSON.stringify({ event: "set_password_token_kill_failed", error: killErr.message }));
    }

    console.warn(
      JSON.stringify({
        event: "set_password_succeeded",
        email_changed: emailChanged,
        timestamp: new Date().toISOString(),
      }),
    );
    return json({ ok: true, email: targetEmail });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(JSON.stringify({ event: "set_password_error", error: msg }));
    // rule 97: e.message инлайнится в ответ.
    return json({ code: "INTERNAL_ERROR", error: `Внутренняя ошибка: ${msg}. Попробуй ещё раз.` }, 500);
  }
});
