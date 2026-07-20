/**
 * Онбординг-активация v2 — беспарольный claim ученика по per-student коду.
 *
 * Два режима (verify_jwt=false — публичный, авторизация по коду):
 *
 *   GET  ?t={token}  → OG-превью + meta-refresh/JS-redirect на SPA `/c/{token}`
 *                      (mirror invite-preview). Скрейперы Telegram/WhatsApp
 *                      видят только OG.
 *
 *   POST { token }   → минтит беспарольную сессию ДЛЯ плейсхолдера
 *                      (admin.generateLink magiclink → verifyOtp, паттерн
 *                      email-verify/oauth-google-callback), помечает первый
 *                      вход (claimed_at write-once), возвращает session +
 *                      tutor_name + preview первой ДЗ.
 *
 * Инварианты (rule 96, пересмотр 2026-07-20 — запрос №43 Егора):
 *   • Код МНОГОРАЗОВЫЙ до регистрации: НЕ обнуляется при claim; гаснет, когда
 *     ученик ставит реальную почту+пароль (student-register / student-set-password
 *     нуллят claim_token). TTL снят — граница безопасности = гейт «зарегистрирован»
 *     (реальный email И last_sign_in_at), не время.
 *   • Два формата: legacy 32-hex (ссылки в обороте) + короткий 8-символьный код
 *     (алфавит referral_code без I/L/O/0/1) — нормализация в normalizeToken.
 *   • Подбор кода гасится rate-limit'ом по IP (throttleCheck, 60/15 мин).
 *   • Сессию минтит edge server-side. Токены/PII не логируются. escapeHtml + no-store на OG.
 *   • Anti-leak: preview — только title/subject/N задач (column-whitelist), без solution/rubric.
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import { logAnalyticsEvent, logAnalyticsEventOnce } from "../_shared/analytics.ts";
import { throttleCheck } from "../_shared/throttle.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const PRODUCTION_URL = "https://sokratai.ru";
const OG_IMAGE_URL = `${PRODUCTION_URL}/sokrat-logo.png`;
// Legacy-токен — 32 hex (миграция 20260701120000, ссылки в обороте работают вечно).
const HEX_TOKEN_RE = /^[a-f0-9]{32}$/i;
// Короткий код — 8 символов из алфавита referral_code (без путающих I/L/O/0/1),
// хранится UPPERCASE без дефиса; репетитор диктует как XXXX-XXXX.
const SHORT_CODE_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/;

/**
 * Нормализация кода из ссылки/ручного ввода: дефисы/пробелы вырезаются,
 * hex → lowercase (формат хранения legacy), короткий → UPPERCASE.
 * null = не похоже ни на один формат (не ходим в БД).
 */
function normalizeToken(raw: string): string | null {
  const stripped = raw.trim().replace(/[\s-]/g, "");
  if (HEX_TOKEN_RE.test(stripped)) return stripped.toLowerCase();
  const up = stripped.toUpperCase();
  return SHORT_CODE_RE.test(up) ? up : null;
}

const TEMP_EMAIL_SUFFIX = "@temp.sokratai.ru";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function escapeHtml(s: string): string {
  return s.replace(/[<>"'&]/g, (c) =>
    c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : c === "'" ? "&#39;" : "&amp;",
  );
}

function firstName(fullName: string | null | undefined): string | null {
  if (!fullName) return null;
  const t = fullName.trim();
  if (!t) return null;
  const f = t.split(/\s+/)[0];
  return f.length > 0 ? f : null;
}

function buildPreviewHtml(tutorFirstName: string | null, redirectUrl: string): string {
  const desc = tutorFirstName
    ? `${tutorFirstName} подключил тебя к Сократ AI — помощнику для домашки. Открой, чтобы начать.`
    : `Твой репетитор подключил тебя к Сократ AI — помощнику для домашки. Открой, чтобы начать.`;
  const escDesc = escapeHtml(desc);
  const escRedirect = escapeHtml(redirectUrl);
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<title>Тебя пригласили в Сократ AI</title>
<meta name="description" content="${escDesc}">
<meta name="robots" content="noindex">
<meta property="og:type" content="website">
<meta property="og:title" content="Тебя пригласили в Сократ AI">
<meta property="og:description" content="${escDesc}">
<meta property="og:image" content="${OG_IMAGE_URL}">
<meta property="og:url" content="${escRedirect}">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="Тебя пригласили в Сократ AI">
<meta name="twitter:description" content="${escDesc}">
<meta name="twitter:image" content="${OG_IMAGE_URL}">
<meta http-equiv="refresh" content="0; url=${escRedirect}">
<link rel="canonical" href="${escRedirect}">
<style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;padding:24px;color:#0F172A;background:#F8FAFC}a{color:#1B6B4A}</style>
</head>
<body>
<p>Открываем Сократ AI… Если ничего не произошло, <a href="${escRedirect}">нажми сюда</a>.</p>
<script>window.location.replace(${JSON.stringify(redirectUrl)});</script>
</body>
</html>
`;
}

function htmlResponse(html: string, status = 200): Response {
  return new Response(html, {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store, must-revalidate",
    },
  });
}

/** Превью первой невыполненной ДЗ ученика (anti-leak: только безопасные поля). */
async function resolvePreview(
  admin: ReturnType<typeof createClient>,
  studentId: string,
): Promise<
  | {
      assignment_id: string;
      title: string;
      subject: string | null;
      task_count: number;
      entry_task_id: string | null;
    }
  | null
> {
  try {
    // Самая свежая активная привязка ученика.
    const { data: links } = await admin
      .from("homework_tutor_student_assignments")
      .select("id, assignment_id, created_at")
      .eq("student_id", studentId)
      .order("created_at", { ascending: false })
      .limit(10);
    if (!links || links.length === 0) return null;

    for (const link of links) {
      const { data: assignment } = await admin
        .from("homework_tutor_assignments")
        .select("id, title, subject, status")
        .eq("id", link.assignment_id)
        .maybeSingle();
      if (!assignment) continue;
      if (assignment.status !== "active" && assignment.status !== "draft") continue;

      const { data: tasks } = await admin
        .from("homework_tutor_tasks")
        .select("id, order_num")
        .eq("assignment_id", assignment.id)
        .order("order_num", { ascending: true });
      const taskList = tasks ?? [];

      // entry_task_id: thread.current_task_id → первая задача по order_num.
      let entryTaskId: string | null = taskList[0]?.id ?? null;
      const { data: thread } = await admin
        .from("homework_tutor_threads")
        .select("current_task_id")
        .eq("student_assignment_id", link.id)
        .maybeSingle();
      if (thread?.current_task_id) entryTaskId = thread.current_task_id as string;

      return {
        assignment_id: assignment.id as string,
        title: (assignment.title as string) ?? "Домашнее задание",
        subject: (assignment.subject as string | null) ?? null,
        task_count: taskList.length,
        entry_task_id: entryTaskId,
      };
    }
    return null;
  } catch (e) {
    console.warn(JSON.stringify({ event: "student_claim_preview_failed", error: e instanceof Error ? e.message : String(e) }));
    return null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // ── GET: OG-превью + redirect (НЕ consume) ────────────────────────────────
  if (req.method === "GET" || req.method === "HEAD") {
    const url = new URL(req.url);
    const token = normalizeToken(url.searchParams.get("t") ?? "");
    const redirectUrl = `${PRODUCTION_URL}/c/${token ?? ""}`;

    let tutorFirstNameVal: string | null = null;
    if (token) {
      try {
        const { data: link } = await admin
          .from("tutor_students")
          .select("tutor_id")
          .eq("claim_token", token)
          .maybeSingle();
        if (link?.tutor_id) {
          const { data: tutor } = await admin
            .from("tutors")
            .select("name")
            .eq("id", link.tutor_id)
            .maybeSingle();
          tutorFirstNameVal = firstName(tutor?.name as string | null);
        }
      } catch {
        // best-effort — generic preview
      }
    }
    return htmlResponse(buildPreviewHtml(tutorFirstNameVal, redirectUrl));
  }

  if (req.method !== "POST") {
    return json({ code: "METHOD_NOT_ALLOWED", error: "Метод не поддерживается." }, 405);
  }

  // ── POST: mint session (multi-use до регистрации) ─────────────────────────
  try {
    const body = await req.json().catch(() => ({}));
    const rawToken = typeof body.token === "string" ? body.token : "";
    const channel = typeof body.channel === "string" ? body.channel.slice(0, 32) : "link";

    const token = normalizeToken(rawToken);
    if (!token) {
      return json({ code: "INVALID_TOKEN", error: "Код или ссылка недействительны. Попроси у репетитора новый код." }, 400);
    }

    // Rate-limit ДО lookup: короткий код — bearer, подбор гасим по IP.
    // 60/15 мин (выше OTP-шных 30: класс за одним CGNAT-IP сканирует один QR).
    const clientIp = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim();
    if (clientIp && !(await throttleCheck(admin, `claim_ip:${clientIp}`, 60, 15 * 60 * 1000))) {
      return json({ code: "RATE_LIMITED", error: "Слишком много попыток. Подожди несколько минут и попробуй ещё раз." }, 429);
    }

    const { data: link, error: linkError } = await admin
      .from("tutor_students")
      .select("id, tutor_id, student_id, claim_token_created_at, claimed_at")
      .eq("claim_token", token)
      .maybeSingle();

    if (linkError) {
      console.error(JSON.stringify({ event: "student_claim_lookup_failed", error: linkError.message }));
      return json({ code: "LOOKUP_FAILED", error: "Не удалось проверить код. Попробуй ещё раз через минуту." }, 503);
    }
    if (!link) {
      // Код погашен регистрацией, ротирован репетитором или никогда не существовал.
      return json({ code: "TOKEN_USED", error: "Код больше не действует. Если ты уже регистрировался — войди по паролю; иначе попроси у репетитора новый код." }, 410);
    }

    const studentId = link.student_id as string;
    const isFirstClaim = !link.claimed_at;

    // Email плейсхолдера (temp или реальный) для минта magiclink-сессии.
    const { data: authUser, error: authErr } = await admin.auth.admin.getUserById(studentId);
    const email = authUser?.user?.email ?? "";
    if (authErr || !email) {
      console.error(JSON.stringify({ event: "student_claim_no_email", error: authErr?.message ?? "no_email" }));
      return json({ code: "ACCOUNT_UNRESOLVED", error: "Не удалось открыть аккаунт ученика. Попроси у репетитора новый код." }, 500);
    }

    // Гейт «зарегистрирован» (фикс lockout №43, зеркало RPC + connect-by-email):
    // реальный email И был вход = ученик владеет аккаунтом сам (пароль/OTP/recovery)
    // → сессию по коду не минтим. temp-email или ни-разу-не-входил = плейсхолдер,
    // код работает многоразово. Оба условия через AND: реальный email без входа —
    // это email, проставленный репетитором/connect-by-email ДО первого захода.
    const isRegistered =
      !!authUser?.user?.last_sign_in_at && !email.toLowerCase().endsWith(TEMP_EMAIL_SUFFIX);
    if (isRegistered) {
      return json(
        { code: "ALREADY_ACTIVE", error: "Этот аккаунт уже зарегистрирован — войди по паролю или запроси ссылку на почту." },
        403,
      );
    }

    // Готовим magiclink.
    const { data: linkData, error: genErr } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email,
    });
    const hashedToken = linkData?.properties?.hashed_token;
    if (genErr || !hashedToken) {
      console.error(JSON.stringify({ event: "student_claim_generatelink_failed", error: genErr?.message ?? "no_hash" }));
      return json({ code: "SESSION_MINT_FAILED", error: "Не удалось войти автоматически. Попробуй ещё раз." }, 500);
    }

    // Минтим беспарольную сессию (verifyOtp, паттерн email-verify).
    const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: verifyData, error: verifyErr } = await anon.auth.verifyOtp({
      token_hash: hashedToken,
      type: "magiclink",
    });
    if (verifyErr || !verifyData?.session) {
      console.error(JSON.stringify({ event: "student_claim_verify_failed", error: verifyErr?.message ?? "no_session" }));
      return json({ code: "SESSION_MINT_FAILED", error: "Не удалось войти автоматически. Попробуй ещё раз." }, 500);
    }

    // Multi-use (решение владельца 2026-07-20, №43): код НЕ обнуляется — живёт,
    // пока ученик не зарегистрируется (student-register/student-set-password нуллят).
    // claimed_at/claim_channel — write-once (первый вход, аналитика; `.is(null)` —
    // race-safe). Сбой маркировки не блокирует вход (non-fatal): граница
    // безопасности — гейт «зарегистрирован» выше, не consume.
    if (isFirstClaim) {
      const { error: markErr } = await admin
        .from("tutor_students")
        .update({ claimed_at: new Date().toISOString(), claim_channel: channel })
        .eq("id", link.id)
        .is("claimed_at", null);
      if (markErr) {
        console.error(JSON.stringify({ event: "student_claim_mark_failed", error: markErr.message }));
      }
    }

    // Имя репетитора для экрана «вы подключены».
    let tutorName: string | null = null;
    try {
      const { data: tutor } = await admin
        .from("tutors")
        .select("name")
        .eq("id", link.tutor_id)
        .maybeSingle();
      tutorName = (tutor?.name as string | null) ?? null;
    } catch {
      // non-fatal
    }

    const preview = await resolvePreview(admin, studentId);

    // Телеметрия (PII-free).
    await logAnalyticsEvent(admin, {
      event_name: "invite_claimed",
      tutor_id: link.tutor_id as string,
      student_id: studentId,
      tutor_student_id: link.id as string,
      assignment_id: preview?.assignment_id ?? null,
      source: channel,
      meta: { first_claim: isFirstClaim },
    });
    if (isFirstClaim) {
      await logAnalyticsEventOnce(
        admin,
        {
          event_name: "student_first_login",
          tutor_id: link.tutor_id as string,
          student_id: studentId,
          tutor_student_id: link.id as string,
          source: channel,
        },
        { student_id: studentId },
      );
    }

    return json({
      access_token: verifyData.session.access_token,
      refresh_token: verifyData.session.refresh_token,
      expires_in: verifyData.session.expires_in ?? 3600,
      tutor_name: tutorName,
      preview,
    });
  } catch (e) {
    console.error(JSON.stringify({ event: "student_claim_error", error: e instanceof Error ? e.message : String(e) }));
    return json({ code: "INTERNAL_ERROR", error: "Внутренняя ошибка. Попробуй ещё раз." }, 500);
  }
});
