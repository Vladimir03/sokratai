// «Отчёт родителю» — публичный read-only отчёт (Phase 2c). Без auth (slug = bearer).
// RU-bypass: хардкод api.sokratai.ru (mirror mockExamPublicApi, rule 95).
import { SUPABASE_PUBLISHABLE_KEY } from '@/lib/supabaseClient';

const FUNCTIONS_BASE_URL = 'https://api.sokratai.ru/functions/v1';

// Шлём anon-ключ (Authorization+apikey): работает при verify_jwt=true И =false —
// не зависим от того, подхватил ли деплой config.toml для новой функции (rule 96 #11).
const PUBLIC_HEADERS = {
  apikey: SUPABASE_PUBLISHABLE_KEY,
  Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
};

export interface ReportWork {
  kind: 'homework' | 'mock';
  title: string;
  subject: string | null;
  date: string;
  score_kind: 'primary' | 'ege_scaled' | 'oge_grade';
  raw: number | null;
  raw_max: number;
  cells: Array<{ score: number | null; max: number }>;
  reviewed: boolean;
  status: 'none' | 'verified' | 'review' | 'manual';
}

export interface ReportStatementEntry {
  occurred_on: string;
  kind: 'debit' | 'credit';
  source_kind: 'lesson' | 'topup' | 'adjustment';
  amount: number; // РУБЛИ
}

export type ReportVerdict = 'good' | 'ok' | 'attention';

export interface PublicStudentReportData {
  student: { name: string; track: string; grade_class: string | null; subject: string | null };
  tutor: { name: string | null };
  target: { track: string; target_score: number | null; scale_year: number };
  summary: {
    done: number;
    total: number;
    current_level: number | null;
    target: number | null;
    trend: number[];
    // Homework-only счётчики (period-scoped). optional — старый edge их не шлёт (deploy-skew).
    hw_done?: number;
    hw_total?: number;
    hw_overdue?: number;
    hw_success_pct?: number | null;
  };
  works: ReportWork[];
  balance: number | null; // РУБЛИ, отрицательный = долг; null = тренер скрыл оплату
  statement: ReportStatementEntry[];
  generated_at: string;
  // v2 (ОС Елены, 2026-06-15) — все optional для backward-compat со старым edge (deploy-skew):
  // фронт деплоится отдельно (deploy-sokratai) от edge (Lovable), новый ReportBody должен
  // корректно деградировать на старом payload.
  verdict?: ReportVerdict | null;
  tutor_comment?: string | null;
  metrics?: { mock_score: boolean; hw_done: boolean; hw_success: boolean };
  attention?: string[];
  period?: { kind: string; start: string | null; end: string | null } | null;
  show_debt_line?: boolean;
}

export type PublicStudentReportResult =
  | { status: 'ok'; data: PublicStudentReportData }
  | { status: 'not_found' }
  | { status: 'revoked' }
  | { status: 'invalid_slug' }
  | { status: 'error'; message: string };

export async function fetchPublicStudentReport(slug: string): Promise<PublicStudentReportResult> {
  if (!/^[a-z0-9]{8,64}$/i.test(slug)) return { status: 'invalid_slug' }; // legacy 8 + новые 24
  try {
    const res = await fetch(
      `${FUNCTIONS_BASE_URL}/public-student-report/report/${slug.toLowerCase()}`,
      { headers: PUBLIC_HEADERS },
    );
    const body = await res.json().catch(() => null);
    if (res.ok && body?.revoked) return { status: 'revoked' };
    if (res.ok && body?.student) return { status: 'ok', data: body as PublicStudentReportData };
    if (res.status === 404) return { status: 'not_found' };
    if (res.status === 400) return { status: 'invalid_slug' };
    return { status: 'error', message: 'Не удалось загрузить отчёт.' };
  } catch {
    return { status: 'error', message: 'Не удалось загрузить отчёт. Проверьте интернет и обновите страницу.' };
  }
}
