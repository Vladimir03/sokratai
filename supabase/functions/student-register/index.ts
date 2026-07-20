/**
 * Онбординг-активация v2 — обязательная регистрация ученика ДО задачи.
 *
 * Ученик уже залогинен беспарольной claim-сессией (student-claim). Регистрация —
 * это ДОУСТАНОВКА email+пароля поверх активной сессии, НЕ новый signUp.
 *
 * verify_jwt=true — авторизация по claim-сессии (student-claim её сминтил).
 *
 * Почему edge (а не client supabase.auth.updateUser):
 *   client updateUser({ email }) форсит письмо-подтверждение смены email;
 *   PRD требует «без верификации» → admin.updateUserById(email_confirm:true)
 *   меняет email сразу. Пароль ставится тем же вызовом.
 *
 * Инварианты:
 *   • Email-collision → 409 (rule 97 flat-shape). Не молчим.
 *   • Реальный email из плейсхолдера (@temp.sokratai.ru → считается пустым).
 *   • PII-free телеметрия student_registered (once per student).
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import { logAnalyticsEventOnce } from "../_shared/analytics.ts";
import { mintFreshSession } from "../_shared/mint-session.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TEMP_EMAIL_SUFFIX = "@temp.sokratai.ru";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
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
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return json({ code: "NO_AUTH", error: "Нет авторизации." }, 401);
    }
    const jwt = authHeader.replace(/^Bearer\s+/i, "");

    const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
    const { data: { user }, error: userError } = await anon.auth.getUser(jwt);
    if (userError || !user) {
      return json({ code: "UNAUTHORIZED", error: "Сессия истекла. Открой ссылку заново." }, 401);
    }

    const body = await req.json().catch(() => ({}));
    const emailRaw = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";

    if (!password || password.length < 6) {
      return json({ code: "WEAK_PASSWORD", error: "Пароль должен быть не короче 6 символов." }, 400);
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // Least-privilege (review P0 #1): endpoint только для онбординг-ученика —
    // claim'нувшего ссылку. Иначе любой залогиненный аккаунт мог бы через
    // admin.updateUserById проставить себе email_confirm:true на не-своём адресе
    // (email-squatting) и сменить credentials в обход нормального флоу.
    const { data: roleRows } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id);
    if ((roleRows ?? []).some((r) => r.role === "tutor" || r.role === "admin")) {
      return json({ code: "NOT_STUDENT", error: "Регистрация доступна только ученику." }, 403);
    }
    const { data: claimedLink } = await admin
      .from("tutor_students")
      .select("id")
      .eq("student_id", user.id)
      .not("claimed_at", "is", null)
      .limit(1)
      .maybeSingle();
    if (!claimedLink) {
      return json(
        { code: "NOT_ONBOARDING", error: "Регистрация доступна только по ссылке-подключению от репетитора." },
        403,
      );
    }

    const currentEmail = user.email ?? "";
    const currentIsTemp = isTempEmail(currentEmail);

    // Email меняем ТОЛЬКО при первичной регистрации (temp → real). Если email уже
    // реальный — оставляем текущий и игнорируем ввод (review P1, anti-squatting):
    // иначе залогиненный ученик мог бы циклически проставлять email_confirm:true
    // на чужих адресах без верификации. Смена email после регистрации — через
    // обычные настройки аккаунта, не этот onboarding-endpoint.
    let targetEmail: string;
    if (currentIsTemp) {
      targetEmail = emailRaw;
      if (!targetEmail) {
        return json({ code: "EMAIL_REQUIRED", error: "Укажи свою почту, чтобы не потерять доступ." }, 400);
      }
      if (!EMAIL_RE.test(targetEmail) || isTempEmail(targetEmail)) {
        return json({ code: "INVALID_EMAIL", error: "Некорректный email." }, 400);
      }
    } else {
      targetEmail = currentEmail; // уже реальный — не трогаем (только пароль)
    }

    const emailChanged = currentIsTemp && targetEmail !== currentEmail.toLowerCase();

    // Collision: email уже принадлежит другому аккаунту.
    if (emailChanged) {
      const { data: foundId, error: lookupErr } = await admin.rpc("find_auth_user_id_by_email", {
        p_email: targetEmail,
      });
      if (lookupErr) {
        return json({ code: "EMAIL_LOOKUP_FAILED", error: "Не удалось проверить email. Попробуй ещё раз через минуту." }, 503);
      }
      if (foundId && foundId !== user.id) {
        return json(
          { code: "EMAIL_TAKEN", error: "Эта почта уже занята. Войди со своим паролем на странице входа." },
          409,
        );
      }
    }

    // Доустановка credentials БЕЗ верификации (email_confirm:true).
    const updatePayload: Record<string, unknown> = { password };
    if (emailChanged) {
      updatePayload.email = targetEmail;
      updatePayload.email_confirm = true;
    }
    const { error: updErr } = await admin.auth.admin.updateUserById(user.id, updatePayload);
    if (updErr) {
      const taken = (updErr as { code?: string })?.code === "email_exists" ||
        updErr.message?.includes("already been registered");
      if (taken) {
        return json(
          { code: "EMAIL_TAKEN", error: "Эта почта уже занята. Войди со своим паролем на странице входа." },
          409,
        );
      }
      console.error(JSON.stringify({ event: "student_register_update_failed", error: updErr.message }));
      return json({ code: "REGISTER_FAILED", error: "Не удалось сохранить доступ. Попробуй ещё раз." }, 500);
    }

    // «Код умирает» (№43, 2026-07-20): аккаунт зарегистрирован → все claim-коды
    // ученика гаснут (по всем связкам tutor_students). Retry-once на transient
    // (ревью 5.6 P1 #3). Non-fatal: для ЭТОГО пути registered-гейт в
    // student-claim/RPC — реальный backstop (после register у ученика real email
    // И last_sign_in_at от claim-сессии → минт блокируется даже при живом коде).
    let killErr = (await admin.from("tutor_students").update({ claim_token: null }).eq("student_id", user.id)).error;
    if (killErr) {
      killErr = (await admin.from("tutor_students").update({ claim_token: null }).eq("student_id", user.id)).error;
    }
    if (killErr) {
      console.error(JSON.stringify({ event: "student_register_token_kill_failed", error: killErr.message }));
    }

    // Профиль: пометить источник регистрации (best-effort).
    await admin
      .from("profiles")
      .update({ registration_source: "onboarding_v2_claim" })
      .eq("id", user.id);

    // Телеметрия (PII-free), tutor-контекст best-effort.
    let tutorId: string | null = null;
    let tutorStudentId: string | null = null;
    try {
      const { data: link } = await admin
        .from("tutor_students")
        .select("id, tutor_id")
        .eq("student_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      tutorId = (link?.tutor_id as string | null) ?? null;
      tutorStudentId = (link?.id as string | null) ?? null;
    } catch {
      // non-fatal
    }
    await logAnalyticsEventOnce(
      admin,
      {
        event_name: "student_registered",
        actor_user_id: user.id,
        student_id: user.id,
        tutor_id: tutorId,
        tutor_student_id: tutorStudentId,
        meta: { email_changed: emailChanged },
      },
      { student_id: user.id },
    );

    // Смена пароля отозвала ВСЕ сессии ученика (GoTrue) → минтим свежую, иначе
    // клиент держит мёртвые токены и разлогинивается на первом edge-запросе
    // (баг «вылет на выборе класса», Егор 2026-07-20). Клиент делает setSession.
    // Fail-soft: null → клиент останется на старой (как до фикса).
    const session = await mintFreshSession(admin, SUPABASE_URL, SUPABASE_ANON_KEY, targetEmail, user.id);

    return json({ ok: true, email: targetEmail, session });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(JSON.stringify({ event: "student_register_error", error: msg }));
    // rule 97: e.message инлайнится в ответ.
    return json({ code: "INTERNAL_ERROR", error: `Внутренняя ошибка: ${msg}. Попробуй ещё раз.` }, 500);
  }
});
