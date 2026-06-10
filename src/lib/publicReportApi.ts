// «Отчёт родителю» — публичный read-only отчёт (Phase 2c). Без auth (slug = bearer).
// RU-bypass: хардкод api.sokratai.ru (mirror mockExamPublicApi, rule 95).

const FUNCTIONS_BASE_URL = 'https://api.sokratai.ru/functions/v1';

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
  };
  works: ReportWork[];
  balance: number; // РУБЛИ, отрицательный = долг
  statement: ReportStatementEntry[];
  generated_at: string;
}

export type PublicStudentReportResult =
  | { status: 'ok'; data: PublicStudentReportData }
  | { status: 'not_found' }
  | { status: 'revoked' }
  | { status: 'invalid_slug' }
  | { status: 'error'; message: string };

export async function fetchPublicStudentReport(slug: string): Promise<PublicStudentReportResult> {
  if (!/^[a-z0-9]{8}$/i.test(slug)) return { status: 'invalid_slug' };
  try {
    const res = await fetch(`${FUNCTIONS_BASE_URL}/public-student-report/report/${slug.toLowerCase()}`);
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
