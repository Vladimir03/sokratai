/**
 * Онбординг-активация v2 — беспарольный claim ученика по per-student токену.
 *
 * Два режима (verify_jwt=false — публичный, авторизация по токену):
 *
 *   GET  ?t={token}  → OG-превью + meta-refresh/JS-redirect на SPA `/c/{token}`
 *                      (mirror invite-preview). НЕ consume — скрейперы Telegram/
 *                      WhatsApp видят только OG, токен не тратится.
 *
 *   POST { token }   → consume: минтит беспарольную сессию ДЛЯ плейсхолдера
 *                      (admin.generateLink magiclink → verifyOtp, паттерн
 *                      email-verify/oauth-google-callback), помечает claimed,
 *                      ОБНУЛЯЕТ токен (одноразовость, rule 96), возвращает
 *                      session + tutor_name + preview первой ДЗ.
 *
 * Инварианты (rule 96):
 *   • Токен одноразовый — claim_token := NULL при первом успешном минте.
 *     Persistent session проносит ученика через регистрацию. НЕ вечный bearer.
 *   • Короткоживущий — TTL от claim_token_created_at (30 дней).
 *   • Сессию минтит edge server-side. Токены/PII не логируются. escapeHtml + no-store на OG.
 *   • Anti-leak: preview — только title/subject/N задач (column-whitelist), без solution/rubric.
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import { logAnalyticsEvent, logAnalyticsEventOnce } from "../_shared/analytics.ts";

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
// Токен — encode(gen_random_bytes(16),'hex') = 32 hex (миграция 20260701120000).
const TOKEN_RE = /^[a-f0-9]{32}$/i;
const CLAIM_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 дней до первого использования

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
    const token = (url.searchParams.get("t") ?? "").trim();
    const redirectUrl = `${PRODUCTION_URL}/c/${TOKEN_RE.test(token) ? token : ""}`;

    let tutorFirstNameVal: string | null = null;
    if (TOKEN_RE.test(token)) {
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

  // ── POST: consume + mint session ──────────────────────────────────────────
  try {
    const body = await req.json().catch(() => ({}));
    const token = typeof body.token === "string" ? body.token.trim() : "";
    const channel = typeof body.channel === "string" ? body.channel.slice(0, 32) : "link";

    if (!TOKEN_RE.test(token)) {
      return json({ code: "INVALID_TOKEN", error: "Ссылка недействительна. Попроси у репетитора новую." }, 400);
    }

    const { data: link, error: linkError } = await admin
      .from("tutor_students")
      .select("id, tutor_id, student_id, claim_token_created_at, claimed_at")
      .eq("claim_token", token)
      .maybeSingle();

    if (linkError) {
      console.error(JSON.stringify({ event: "student_claim_lookup_failed", error: linkError.message }));
      return json({ code: "LOOKUP_FAILED", error: "Не удалось проверить ссылку. Попробуй ещё раз через минуту." }, 503);
    }
    if (!link) {
      // Токен уже использован (обнулён) или не существует.
      return json({ code: "TOKEN_USED", error: "Ссылка уже использована или недействительна. Попроси у репетитора новую." }, 410);
    }

    // TTL — короткоживущий токен (rule 96).
    const createdAt = link.claim_token_created_at ? Date.parse(link.claim_token_created_at as string) : 0;
    if (createdAt > 0 && Date.now() - createdAt > CLAIM_TTL_MS) {
      return json({ code: "TOKEN_EXPIRED", error: "Срок действия ссылки истёк. Попроси у репетитора новую." }, 410);
    }

    const studentId = link.student_id as string;
    const isFirstClaim = !link.claimed_at;

    // Email плейсхолдера (temp или реальный) для минта magiclink-сессии.
    const { data: authUser, error: authErr } = await admin.auth.admin.getUserById(studentId);
    const email = authUser?.user?.email ?? "";
    if (authErr || !email) {
      console.error(JSON.stringify({ event: "student_claim_no_email", error: authErr?.message ?? "no_email" }));
      return json({ code: "ACCOUNT_UNRESOLVED", error: "Не удалось открыть аккаунт ученика. Попроси у репетитора новую ссылку." }, 500);
    }

    // P0 (review round 2) belt-and-suspenders к RPC-гейту: НЕ минтить сессию
    // аккаунту, который уже аутентифицировался (last_sign_in_at) — это уже
    // зарегистрированный/активный ученик, вход только паролем/OTP (не impersonation
    // репетитором). Плейсхолдер до первого claim имеет last_sign_in_at = NULL.
    if (authUser?.user?.last_sign_in_at) {
      return json(
        { code: "ALREADY_ACTIVE", error: "Этот аккаунт уже активен — войди по паролю или запроси код на почту." },
        403,
      );
    }

    // Готовим magiclink (без сессии — consume ещё не выигран).
    const { data: linkData, error: genErr } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email,
    });
    const hashedToken = linkData?.properties?.hashed_token;
    if (genErr || !hashedToken) {
      console.error(JSON.stringify({ event: "student_claim_generatelink_failed", error: genErr?.message ?? "no_hash" }));
      return json({ code: "SESSION_MINT_FAILED", error: "Не удалось войти автоматически. Попробуй ещё раз." }, 500);
    }

    // Атомарный consume ДО минта (review P0 #2): CAS по claim_token гарантирует
    // одноразовость — только победитель гонки нуллит токен и получает сессию;
    // проигравший → 410. Проверяем error + affected rows (иначе молчаливый сбой
    // update оставил бы токен живым = переиспользуемый bearer, rule 96).
    const { data: consumed, error: consumeErr } = await admin
      .from("tutor_students")
      .update({
        claimed_at: link.claimed_at ?? new Date().toISOString(),
        claim_channel: (link.claimed_at ? undefined : channel) as string | undefined,
        claim_token: null,
      })
      .eq("id", link.id)
      .eq("claim_token", token)
      .select("id");
    if (consumeErr) {
      console.error(JSON.stringify({ event: "student_claim_consume_failed", error: consumeErr.message }));
      return json({ code: "CONSUME_FAILED", error: "Не удалось открыть ссылку. Попробуй ещё раз через минуту." }, 503);
    }
    if (!consumed || consumed.length === 0) {
      return json({ code: "TOKEN_USED", error: "Ссылка уже использована или недействительна. Попроси у репетитора новую." }, 410);
    }

    // Победитель consume — минтим беспарольную сессию (verifyOtp, паттерн email-verify).
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
