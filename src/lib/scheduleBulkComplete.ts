import { supabase } from '@/lib/supabaseClient';

// ─── schedule-bulk-complete client (CC-B) ─────────────────────────────────────
//
// Тонкий клиент над RPC CC-A (`tutor_confirm_lessons` / `tutor_revert_lesson`,
// миграция 20260602150000). Mirror транспорта `updateGroupParticipantPaymentStatus`
// (tutorScheduleGroupPayments.ts): supabase.rpc → { data, error }; error.message
// несёт код RAISE EXCEPTION. amount = РУБЛИ (как tutor_payments.amount / calculateLessonPaymentAmount).

export interface ConfirmLessonParticipant {
  tutor_student_id: string;
  /** rubles; 0 = «не был» → платёж не создаётся (RPC пропускает amount ≤ 0). */
  amount: number;
}

export type ConfirmLessonItem =
  | { lesson_id: string; amount: number }
  | { lesson_id: string; participants: ConfirmLessonParticipant[] };

export interface ConfirmLessonResultRow {
  lesson_id: string;
  status: 'ok' | 'skipped' | 'error';
  reason?: string;
}

export interface ConfirmLessonsResult {
  ok: boolean;
  confirmed: number;
  skipped: number;
  results: ConfirmLessonResultRow[];
  errorMessage: string | null;
}

/** POST tutor_confirm_lessons — bulk confirm (individual + group), per-lesson atomic. */
export async function confirmLessons(payload: ConfirmLessonItem[]): Promise<ConfirmLessonsResult> {
  const { data, error } = await supabase.rpc('tutor_confirm_lessons', {
    p_lessons: payload as unknown as never,
  });
  if (error) {
    console.error('confirmLessons error:', error.message);
    return {
      ok: false,
      confirmed: 0,
      skipped: payload.length,
      results: [],
      errorMessage: error.message || 'Не удалось подтвердить занятия',
    };
  }
  const raw = (data ?? {}) as { confirmed?: number; skipped?: number; results?: unknown };
  return {
    ok: true,
    confirmed: Number(raw.confirmed ?? 0),
    skipped: Number(raw.skipped ?? 0),
    results: Array.isArray(raw.results) ? (raw.results as ConfirmLessonResultRow[]) : [],
    errorMessage: null,
  };
}

export interface RevertLessonResult {
  ok: boolean;
  deleted_pending: number;
  /** true → у занятия остались оплаченные платежи (не удаляем) — UI предупреждает. */
  had_paid: boolean;
  errorMessage: string | null;
}

/** POST tutor_revert_lesson — откат подтверждённого занятия (pending-платёж удаляется, paid сохраняется). */
export async function revertLesson(lessonId: string): Promise<RevertLessonResult> {
  const { data, error } = await supabase.rpc('tutor_revert_lesson', { p_lesson_id: lessonId });
  if (error) {
    console.error('revertLesson error:', error.message);
    return {
      ok: false,
      deleted_pending: 0,
      had_paid: false,
      errorMessage: error.message || 'Не удалось отменить подтверждение',
    };
  }
  const raw = (data ?? {}) as { ok?: boolean; deleted_pending?: number; had_paid?: boolean };
  return {
    ok: Boolean(raw.ok),
    deleted_pending: Number(raw.deleted_pending ?? 0),
    had_paid: Boolean(raw.had_paid),
    errorMessage: null,
  };
}
