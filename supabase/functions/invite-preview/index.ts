// Edge function `invite-preview` (2026-05-23) — RU-friendly Telegram link preview
// для tutor invite-ссылок. Решает проблему пилотных учеников: репетитор копирует
// `sokratai.ru/invite/AR7LWHTZ`, Telegram подтягивает GLOBAL OG из index.html
// («Сократ AI для репетиторов… 7 дней бесплатно… Потом 200 ₽»), и ученик пугается
// «как это, я платить должен?». Этот endpoint возвращает HTML с invite-specific
// OG (приветствие + имя репетитора, без paywall messaging), а HTML body содержит
// `<meta http-equiv="refresh">` который мгновенно редиректит **браузер** ученика
// на canonical `/invite/{code}` React-страницу. Telegram/WhatsApp/Discord bot'ы
// НЕ выполняют meta-refresh (они scrape HTML only) → видят только custom OG.
//
// Tutor share UI (AddStudentDialog, HWAssignSection и т.д.) теперь генерирует
// URL вида `https://api.sokratai.ru/functions/v1/invite-preview?c={code}` через
// helper getTutorInvitePreviewLink(code) — см. src/utils/telegramLinks.ts.
//
// Legacy `/invite/{code}` URLs (если репетитор уже шарил их раньше) продолжают
// работать — просто показывают legacy preview из index.html. Backward compatible.
//
// Spec: ~/.claude/plans/1-1-serene-finch.md «Task 2 — Invite preview text».

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Mirror `generate_invite_code()` format (PL/pgSQL function в миграции
// 20260201140000_tutor_invite_code_c21.sql): 8 chars, alphanumeric lowercase.
const INVITE_CODE_RE = /^[a-z0-9]{8}$/i;

// Канонический public landing URL для browser redirect target.
const PRODUCTION_URL = "https://sokratai.ru";

// OG image — stable public asset. См. public/sokrat-logo.png (36KB hero version).
const OG_IMAGE_URL = `${PRODUCTION_URL}/sokrat-logo.png`;

// Anti-XSS escape для tutor name (репетитор может ввести в `tutors.name` всё что
// угодно, включая `<script>`). Применяется ко всему что попадает в HTML body /
// attribute от внешнего ввода.
function escapeHtml(s: string): string {
  return s.replace(/[<>"'&]/g, (c) => {
    switch (c) {
      case "<": return "&lt;";
      case ">": return "&gt;";
      case '"': return "&quot;";
      case "'": return "&#39;";
      case "&": return "&amp;";
      default: return c;
    }
  });
}

// Первое слово имени для дружелюбного preview («Виталий подключил тебя...»
// вместо «Виталий Иванович Петров подключил тебя...»). Защита от пустых строк.
function firstName(fullName: string | null | undefined): string | null {
  if (!fullName) return null;
  const trimmed = fullName.trim();
  if (!trimmed) return null;
  const first = trimmed.split(/\s+/)[0];
  return first.length > 0 ? first : null;
}

function buildDescription(tutorFirstName: string | null): string {
  // С именем — personalized. Без имени — generic «твой репетитор».
  // Текст согласован с user (план §«Текст — variants»): hybrid message
  // «приглашение от репетитора» + «AI-помощник для домашки», subject-agnostic,
  // без цены / 200₽ / 7 дней / «не беспокоя учителя».
  const subject = tutorFirstName
    ? `${tutorFirstName} подключил тебя к Сократ AI`
    : `Твой репетитор подключил тебя к Сократ AI`;
  return `${subject} — AI-помощнику для домашки. Задавай вопросы по задачам, AI поможет разобраться.`;
}

function buildHtml(params: {
  code: string;
  description: string;
  redirectUrl: string;
}): string {
  const { code, description, redirectUrl } = params;
  const escDesc = escapeHtml(description);
  const escRedirect = escapeHtml(redirectUrl);
  const escCode = escapeHtml(code);
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
<meta property="og:url" content="${PRODUCTION_URL}/invite/${escCode}">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="Тебя пригласили в Сократ AI">
<meta name="twitter:description" content="${escDesc}">
<meta name="twitter:image" content="${OG_IMAGE_URL}">
<meta http-equiv="refresh" content="0; url=${escRedirect}">
<link rel="canonical" href="${escRedirect}">
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; padding: 24px; color: #0F172A; background: #F8FAFC; }
  a { color: #1B6B4A; }
</style>
</head>
<body>
<p>Перенаправляем на Сократ AI... Если ничего не произошло, <a href="${escRedirect}">нажми сюда</a>.</p>
<script>
  // Belt-and-suspenders для браузеров где meta refresh отключён.
  window.location.replace(${JSON.stringify(redirectUrl)});
</script>
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
      // Не кешируем у браузера: preview сам по себе для bot scrape, у
      // browser-юзера он живёт миллисекунды до redirect. У Telegram свой кеш
      // (~3 дня обычно), на это мы повлиять не можем.
      "Cache-Control": "no-store, must-revalidate",
    },
  });
}

function extractInviteCode(req: Request): string | null {
  const url = new URL(req.url);
  // Predominant pattern — `?c={code}` query. Также поддерживаем path-style
  // `/functions/v1/invite-preview/{code}` для гибкости (бот может ругаться на
  // ?query в URL).
  const queryCode = url.searchParams.get("c") ?? url.searchParams.get("code");
  if (queryCode && queryCode.trim()) return queryCode.trim();
  const parts = url.pathname.split("/").filter(Boolean);
  const idx = parts.indexOf("invite-preview");
  if (idx >= 0 && idx + 1 < parts.length) {
    const tail = parts[idx + 1].trim();
    if (tail) return tail;
  }
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    return new Response("Method not allowed", {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "text/plain" },
    });
  }

  const rawCode = extractInviteCode(req);
  const normalizedCode = rawCode ? rawCode.toLowerCase() : null;
  const validCode = normalizedCode && INVITE_CODE_RE.test(normalizedCode)
    ? normalizedCode
    : null;

  // Generic fallback: для invalid/missing code отдаём preview без tutor name
  // и redirect на main landing. Не 404 — иначе preview в Telegram chat
  // выглядит broken у того кто получает (вытряхиваем доверие).
  if (!validCode) {
    console.warn(JSON.stringify({
      event: "invite_preview_visited",
      has_code: Boolean(rawCode),
      valid_code: false,
      has_tutor_name: false,
    }));
    const fallbackRedirect = `${PRODUCTION_URL}/invite/${escapeHtml(rawCode ?? "")}`;
    return htmlResponse(buildHtml({
      code: rawCode ?? "",
      description: buildDescription(null),
      redirectUrl: rawCode ? fallbackRedirect : PRODUCTION_URL,
    }));
  }

  let tutorFirstName: string | null = null;
  try {
    const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });
    const { data, error } = await db
      .from("tutors")
      .select("name")
      .eq("invite_code", validCode)
      .maybeSingle();

    if (error) {
      console.warn(JSON.stringify({
        event: "invite_preview_lookup_failed",
        error: error.message,
      }));
    } else if (data?.name) {
      tutorFirstName = firstName(data.name);
    }
  } catch (e) {
    // Lookup failure — non-fatal, отдаём generic «твой репетитор» preview.
    console.warn(JSON.stringify({
      event: "invite_preview_lookup_exception",
      error: e instanceof Error ? e.message : String(e),
    }));
  }

  console.warn(JSON.stringify({
    event: "invite_preview_visited",
    has_code: true,
    valid_code: true,
    has_tutor_name: Boolean(tutorFirstName),
  }));

  const redirectUrl = `${PRODUCTION_URL}/invite/${validCode}`;
  return htmlResponse(buildHtml({
    code: validCode,
    description: buildDescription(tutorFirstName),
    redirectUrl,
  }));
});
