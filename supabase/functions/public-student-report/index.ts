// public-student-report — публичный read-only «Отчёт родителю» (Phase 2c).
// GET /report/:slug — без JWT (verify_jwt=false). Mirror public-homework-share:
// slug regex до DB, service_role client, телеметрия server-side.
//
// Anti-leak (PRD: «без решений/критериев»):
//   - Прогресс = SHARED buildStudentProgress (_shared/student-progress-build.ts —
//     тот же код, что тутор-вью R2; уже не селектит solution_*/rubric_*/ai_comment/hints).
//   - Поверх — PUBLIC REMAP: наружу НЕ уходят uuid'ы (student_id/work id/assignment_id),
//     avatar_url, pending_review_count; works cap = 10 последних.
//   - Выписка ledger: только активные записи (не reversed, не offsetting), БЕЗ note
//     (заметки тутора приватны), поля {occurred_on, kind, source_kind, amount}.
//   - Тутор-карточка: только name (rule 96 #10 — никаких telegram/booking/email).

import { createClient } from "npm:@supabase/supabase-js@2";
import { buildStudentProgress } from "../_shared/student-progress-build.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const REPORT_SLUG_RE = /^[a-z0-9]{8,64}$/i; // legacy 8-символьные + новые 24-символьные
const STATEMENT_LIMIT = 60;
const WORKS_LIMIT = 10;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      "Cache-Control": "no-store, must-revalidate",
    },
  });
}

function parseRoute(req: Request): { slug: string | null } {
  const url = new URL(req.url);
  const parts = url.pathname.split("/").filter(Boolean);
  const functionIdx = parts.indexOf("public-student-report");
  const routeParts = functionIdx >= 0 ? parts.slice(functionIdx + 1) : parts;
  if (routeParts.length === 2 && routeParts[0] === "report") {
    return { slug: routeParts[1] };
  }
  return { slug: null };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "GET") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const { slug } = parseRoute(req);
  if (!slug) return jsonResponse({ error: "Route not found" }, 404);

  const normalizedSlug = slug.toLowerCase();
  if (!REPORT_SLUG_RE.test(normalizedSlug)) {
    return jsonResponse({ error: "Invalid slug format", code: "invalid_slug" }, 400);
  }

  try {
    const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    const { data: link, error: linkErr } = await db
      .from("student_report_links")
      .select(
        "slug, tutor_student_id, revoked_at, verdict, show_mock_score, show_hw_done, show_hw_success, tutor_comment, period_kind, period_start, period_end, show_debt_line",
      )
      .eq("slug", normalizedSlug)
      .maybeSingle();
    if (linkErr) {
      console.error("student_report_link_load_failed", linkErr.message);
      return jsonResponse({ error: "Failed to load report link" }, 500);
    }
    if (!link) {
      return jsonResponse({ error: "Report link not found", code: "not_found" }, 404);
    }
    if (link.revoked_at) {
      return jsonResponse({ revoked: true });
    }

    // Student row (whitelist) + tutor (name + user_id для builder'а; rule 40 FK-drift).
    const { data: ts, error: tsErr } = await db
      .from("tutor_students")
      .select("id, tutor_id, subject, exam_type, balance")
      .eq("id", link.tutor_student_id as string)
      .maybeSingle();
    if (tsErr || !ts) {
      return jsonResponse({ error: "Report link not found", code: "not_found" }, 404);
    }
    const { data: tutor } = await db
      .from("tutors")
      .select("user_id, name")
      .eq("id", ts.tutor_id as string)
      .maybeSingle();
    if (!tutor?.user_id) {
      return jsonResponse({ error: "Report link not found", code: "not_found" }, 404);
    }

    // Период отчёта (ОС Елены): конкретные даты-снимок хранятся на ссылке.
    // period_kind='all' → даты NULL → all-time (как было). Иначе фильтруем агрегат.
    const periodStart = (link.period_start as string | null) ?? null;
    const periodEnd = (link.period_end as string | null) ?? null;
    const period = (periodStart || periodEnd) ? { start: periodStart, end: periodEnd } : null;

    // Прогресс — SHARED builder (single source с тутор-вью R2), period-scoped.
    const progress = await buildStudentProgress(
      db,
      tutor.user_id as string,
      ts.tutor_id as string,
      link.tutor_student_id as string,
      period,
    );
    if (!progress) {
      return jsonResponse({ error: "Report link not found", code: "not_found" }, 404);
    }

    // Оплата (ОС Елены): тренер может ПОЛНОСТЬЮ скрыть строку баланса (часть оплат вне
    // Сократа). show_debt_line=false → НЕ грузим ledger и НЕ кладём ни баланс, ни выписку.
    // Выписка period-scoped (операции за период); баланс — текущий (ответ «должен/ок сейчас»).
    const showDebt = link.show_debt_line !== false;
    let balance: number | null = null;
    let statement: { occurred_on: unknown; kind: unknown; source_kind: unknown; amount: number }[] = [];
    if (showDebt) {
      let ledgerQuery = db
        .from("tutor_ledger_entries")
        .select("kind, amount, occurred_on, source_kind, created_at")
        .eq("tutor_student_id", link.tutor_student_id as string)
        .is("reversed_by_entry_id", null)
        .is("reverses_entry_id", null);
      if (periodStart) ledgerQuery = ledgerQuery.gte("occurred_on", periodStart);
      if (periodEnd) ledgerQuery = ledgerQuery.lte("occurred_on", periodEnd);
      const { data: entries, error: ledgerErr } = await ledgerQuery
        .order("occurred_on", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(STATEMENT_LIMIT);
      if (ledgerErr) {
        console.error("student_report_ledger_load_failed", ledgerErr.message);
        return jsonResponse({ error: "Failed to load report" }, 500);
      }
      balance = Number(ts.balance ?? 0);
      statement = (entries ?? []).map((e) => ({
        occurred_on: e.occurred_on,
        kind: e.kind,
        source_kind: e.source_kind,
        amount: Number(e.amount ?? 0),
      }));
    }

    // «Что требует внимания» — авто-факты (счётчики, anti-leak-safe). Тон/нажим тренер
    // добавляет словами в комментарий (ОС Елены, Q3). Здесь — только факты.
    const s = progress.summary;
    const hwTotal = Number(s.hw_total ?? 0);
    const hwDone = Number(s.hw_done ?? 0);
    const overdue = Number(s.hw_overdue ?? 0);
    const notDone = Math.max(0, hwTotal - hwDone);
    const attention: string[] = [];
    // overdue (срок прошёл + не завершено) ⊆ notDone → одна строка, без двойного счёта.
    if (notDone > 0) {
      const overduePart = overdue > 0 ? ` (из них просрочено ${overdue})` : "";
      attention.push(`Не выполнено ${notDone} из ${hwTotal} ДЗ${overduePart} — напомните`);
    }
    if (s.hw_success_pct != null && s.hw_success_pct < 60 && hwDone > 0) {
      attention.push(`Невысокий процент верных ответов: ${s.hw_success_pct}%`);
    }

    // PUBLIC REMAP — наружу только безопасные поля (никаких uuid/avatar/comments).
    const works = (progress.works as Record<string, unknown>[])
      .slice(0, WORKS_LIMIT)
      .map((w) => ({
        kind: w.kind,
        title: w.title,
        subject: w.subject,
        date: w.date,
        score_kind: w.score_kind,
        raw: w.raw,
        raw_max: w.raw_max,
        cells: w.cells,
        reviewed: w.reviewed,
        status: w.status,
      }));

    // Server-side telemetry, PII-free. slug = bearer-token → НЕ логируем его (даже в логах).
    console.warn(JSON.stringify({
      event: "student_report_visited",
      timestamp: new Date().toISOString(),
    }));

    return jsonResponse({
      student: {
        name: progress.student.name,
        track: progress.student.track,
        grade_class: progress.student.grade_class,
        subject: (ts.subject as string | null) ?? null,
      },
      tutor: { name: (tutor.name as string | null) ?? null },
      target: progress.target,
      summary: progress.summary,
      works,
      // Конфиг отчёта (ОС Елены): вердикт-чип, комментарий тренера, метрики-галочки, период.
      verdict: (link.verdict as string | null) ?? null,
      tutor_comment: (link.tutor_comment as string | null) ?? null,
      metrics: {
        mock_score: link.show_mock_score !== false,
        hw_done: link.show_hw_done !== false,
        hw_success: link.show_hw_success !== false,
      },
      attention,
      period: { kind: (link.period_kind as string) ?? "all", start: periodStart, end: periodEnd },
      show_debt_line: showDebt,
      balance,
      statement,
      generated_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error("student_report_unhandled", e instanceof Error ? e.message : String(e));
    return jsonResponse({ error: "Failed to load report" }, 500);
  }
});
