// report_shape.ts — ЧИСТЫЙ слой публичного «Отчёта родителю»: разбор маршрута,
// slug-валидация и PUBLIC REMAP полного payload'а buildStudentProgress в публичный
// объект. Вынесен ДОСЛОВНО из index.ts (там top-level Deno.serve → в vitest не
// импортируется), чтобы анти-утечечный слой был покрыт тестами. Никакого db/fetch/Deno.
//
// Anti-leak (PRD: «без решений/критериев»):
//   - Поверх buildStudentProgress — PUBLIC REMAP: наружу НЕ уходят uuid'ы
//     (student_id/work id/assignment_id), avatar_url, pending_review_count;
//     works cap = 10 последних.
//   - Выписка ledger: только активные записи (не reversed, не offsetting), БЕЗ note
//     (заметки тутора приватны), поля {occurred_on, kind, source_kind, amount}.
//   - Тутор-карточка: только name (rule 96 #10 — никаких telegram/booking/email).

import type { StudentProgressPayload } from "../_shared/student-progress-build.ts";

export type { StudentProgressPayload } from "../_shared/student-progress-build.ts";

export const REPORT_SLUG_RE = /^[a-z0-9]{8,64}$/i; // legacy 8-символьные + новые 24-символьные
export const STATEMENT_LIMIT = 60;
export const WORKS_LIMIT = 10;

export function parseRoute(req: Request): { slug: string | null } {
  const url = new URL(req.url);
  const parts = url.pathname.split("/").filter(Boolean);
  const functionIdx = parts.indexOf("public-student-report");
  const routeParts = functionIdx >= 0 ? parts.slice(functionIdx + 1) : parts;
  if (routeParts.length === 2 && routeParts[0] === "report") {
    return { slug: routeParts[1] };
  }
  return { slug: null };
}

/** Строка student_report_links в объёме, нужном ремапу (настройки отчёта). */
export interface ReportLinkSettings {
  verdict?: unknown;
  show_mock_score?: unknown;
  show_hw_done?: unknown;
  show_hw_success?: unknown;
  tutor_comment?: unknown;
  period_kind?: unknown;
  period_start?: unknown;
  period_end?: unknown;
  show_debt_line?: unknown;
}

// Период отчёта (ОС Елены): конкретные даты-снимок хранятся на ссылке.
// period_kind='all' → даты NULL → all-time (как было). Иначе фильтруем агрегат.
export function resolveReportPeriod(link: ReportLinkSettings): {
  periodStart: string | null;
  periodEnd: string | null;
  period: { start: string | null; end: string | null } | null;
} {
  const periodStart = (link.period_start as string | null) ?? null;
  const periodEnd = (link.period_end as string | null) ?? null;
  const period = (periodStart || periodEnd) ? { start: periodStart, end: periodEnd } : null;
  return { periodStart, periodEnd, period };
}

// Оплата (ОС Елены): тренер может ПОЛНОСТЬЮ скрыть строку баланса (часть оплат вне
// Сократа). show_debt_line=false → НЕ грузим ledger и НЕ кладём ни баланс, ни выписку.
// Выписка period-scoped (операции за период); баланс — текущий (ответ «должен/ок сейчас»).
export function shouldShowDebtLine(link: ReportLinkSettings): boolean {
  return link.show_debt_line !== false;
}

/**
 * Строка tutor_ledger_entries в объёме SELECT'а выписки. `note` НЕ селектится
 * (заметки тутора приватны); даже если лишнее поле приедет — маппер ниже его срежет.
 */
export interface LedgerEntryRow {
  kind?: unknown;
  amount?: unknown;
  occurred_on?: unknown;
  source_kind?: unknown;
  created_at?: unknown;
  [extra: string]: unknown;
}

export interface PublicStatementEntry {
  occurred_on: unknown;
  kind: unknown;
  source_kind: unknown;
  amount: number;
}

export interface PublicReportInput {
  /** Полный payload buildStudentProgress — внутренние uuid/avatar срезаются здесь. */
  progress: StudentProgressPayload;
  /** Строка student_report_links (настройки отчёта). */
  link: ReportLinkSettings;
  /** tutor_students.subject (student row whitelist в index.ts). */
  studentSubject: unknown;
  /** tutor_students.balance — сырое значение; в число приводится здесь. */
  studentBalance: unknown;
  /** tutors.name — только имя (rule 96 #10 — никаких telegram/booking/email). */
  tutorName: unknown;
  /** Активные ledger-записи периода. index.ts грузит их ТОЛЬКО при showDebt; иначе null. */
  ledgerEntries: LedgerEntryRow[] | null;
}

/**
 * PUBLIC REMAP — единственное место, где полный payload превращается в публичный
 * ответ `/p/report/:slug`. Логика перенесена из index.ts байт-в-байт.
 */
export function buildPublicReportBody(input: PublicReportInput): Record<string, unknown> {
  const { progress, link } = input;
  const { periodStart, periodEnd } = resolveReportPeriod(link);

  const showDebt = shouldShowDebtLine(link);
  let balance: number | null = null;
  let statement: PublicStatementEntry[] = [];
  if (showDebt) {
    balance = Number(input.studentBalance ?? 0);
    statement = (input.ledgerEntries ?? []).map((e) => ({
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

  return {
    student: {
      name: progress.student.name,
      track: progress.student.track,
      grade_class: progress.student.grade_class,
      subject: (input.studentSubject as string | null) ?? null,
    },
    tutor: { name: (input.tutorName as string | null) ?? null },
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
  };
}
