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
//
// Чистая часть (parseRoute/slug-валидация + весь PUBLIC REMAP) живёт в
// ./report_shape.ts и покрыта vitest'ом; здесь остаётся только I/O (db/Deno.serve).

import { createClient } from "npm:@supabase/supabase-js@2";
import { buildStudentProgress } from "../_shared/student-progress-build.ts";
import {
  buildPublicReportBody,
  type LedgerEntryRow,
  parseRoute,
  REPORT_SLUG_RE,
  resolveReportPeriod,
  shouldShowDebtLine,
  STATEMENT_LIMIT,
} from "./report_shape.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

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
    const { periodStart, periodEnd, period } = resolveReportPeriod(link);

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
    const showDebt = shouldShowDebtLine(link);
    let ledgerEntries: LedgerEntryRow[] | null = null;
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
      ledgerEntries = entries ?? [];
    }

    // Server-side telemetry, PII-free. slug = bearer-token → НЕ логируем его (даже в логах).
    console.warn(JSON.stringify({
      event: "student_report_visited",
      timestamp: new Date().toISOString(),
    }));

    // PUBLIC REMAP (attention/works cap/выписка/метрики) — чистый слой ./report_shape.ts.
    return jsonResponse(buildPublicReportBody({
      progress,
      link,
      studentSubject: ts.subject,
      studentBalance: ts.balance,
      tutorName: tutor.name,
      ledgerEntries,
    }));
  } catch (e) {
    console.error("student_report_unhandled", e instanceof Error ? e.message : String(e));
    return jsonResponse({ error: "Failed to load report" }, 500);
  }
});
