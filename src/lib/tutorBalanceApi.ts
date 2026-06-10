// Student balance — Phase 2a frontend API (TASK-5).
// Units: РУБЛИ (integer), без копеек. Reads balance from tutor_students.balance + the
// ledger feed (RLS owns_tutor_student); writes via the SECURITY DEFINER RPCs.
// Errors: RPCs RAISE short codes → mapped to RU here (rule 97 mirror, like tutorSchedule.ts).
import { supabase } from '@/lib/supabaseClient';

export type LedgerKind = 'debit' | 'credit';
export type LedgerSource = 'lesson' | 'topup' | 'adjustment';

export interface LedgerEntry {
  id: string;
  kind: LedgerKind;
  amount: number; // РУБЛИ
  occurred_on: string;
  source_kind: LedgerSource;
  source_lesson_id: string | null;
  reverses_entry_id: string | null;
  reversed_by_entry_id: string | null;
  /** Правка: эта запись заменяет указанную (collapse «исправлено» в ленте). */
  replaces_entry_id: string | null;
  note: string | null;
  created_at: string;
}

export interface BalanceMutationResult {
  ok: boolean;
  entryId?: string;
  code?: string;
  error?: string;
}

/** Map RPC RAISE codes → RU phrase (rule 97). */
function mapBalanceError(rawMsg: string): { code?: string; error: string } {
  const msg = rawMsg || '';
  if (msg.includes('STUDENT_TUTOR_MISMATCH')) return { code: 'STUDENT_TUTOR_MISMATCH', error: 'Ученик принадлежит другому репетитору.' };
  if (msg.includes('STUDENT_NOT_FOUND')) return { code: 'STUDENT_NOT_FOUND', error: 'Ученик не найден.' };
  if (msg.includes('NOT_OWNED')) return { code: 'NOT_OWNED', error: 'Ученик не найден.' };
  if (msg.includes('INVALID_AMOUNT')) return { code: 'INVALID_AMOUNT', error: 'Сумма должна быть больше 0.' };
  if (msg.includes('ALREADY_REVERSED')) return { code: 'ALREADY_REVERSED', error: 'Эта запись уже отменена или исправлена.' };
  if (msg.includes('NOT_EDITABLE')) return { code: 'NOT_EDITABLE', error: 'Эту запись нельзя изменить здесь — списания за занятия правятся через занятие.' };
  if (msg.includes('ENTRY_NOT_FOUND')) return { code: 'ENTRY_NOT_FOUND', error: 'Операция не найдена.' };
  if (msg.includes('LEDGER_DEBIT_RACE') || msg.includes('LEDGER_DEBIT_LOST')) {
    return { code: 'LEDGER_CONFLICT', error: 'Не удалось применить — обновите страницу и попробуйте ещё раз.' };
  }
  return { error: 'Не удалось выполнить операцию. Попробуйте ещё раз.' };
}

/** Текущий баланс ученика (РУБЛИ). Отрицательный = должен. */
export async function getStudentBalance(tutorStudentId: string): Promise<number> {
  const { data, error } = await supabase
    .from('tutor_students')
    .select('balance')
    .eq('id', tutorStudentId)
    .single();
  if (error) {
    console.error('getStudentBalance error:', error);
    throw new Error('Не удалось загрузить баланс.');
  }
  return Number(data?.balance ?? 0);
}

/** Внести оплату (пополнение, credit). amount — РУБЛИ > 0. occurredOn — 'YYYY-MM-DD' (опц.). */
export async function recordTopup(
  tutorStudentId: string,
  amount: number,
  occurredOn?: string,
  note?: string,
): Promise<BalanceMutationResult> {
  const { data, error } = await supabase.rpc('tutor_record_topup', {
    _tutor_student_id: tutorStudentId,
    _amount: amount,
    _occurred_on: occurredOn || undefined,
    _note: note || undefined,
  });
  if (error) return { ok: false, ...mapBalanceError(error.message) };
  return { ok: true, entryId: typeof data === 'string' ? data : undefined };
}

/**
 * Исправить пополнение (опечатка в сумме/дате). Атомарно: сторно старой записи + новая
 * (append-only сохраняется), новая ссылается на старую через replaces_entry_id.
 * Только source_kind='topup' — списания за занятия правятся через занятие (re-complete).
 */
export async function editTopup(
  entryId: string,
  newAmount: number,
  occurredOn?: string,
  note?: string,
): Promise<BalanceMutationResult> {
  const { data, error } = await supabase.rpc('tutor_edit_topup', {
    _entry_id: entryId,
    _new_amount: newAmount,
    _occurred_on: occurredOn || undefined,
    _note: note || undefined,
  });
  if (error) return { ok: false, ...mapBalanceError(error.message) };
  return { ok: true, entryId: typeof data === 'string' ? data : undefined };
}

/** Отменить запись ledger (reverse, append-only). Идемпотентно (no-op-safe). */
export async function reverseLedgerEntry(
  entryId: string,
  note?: string,
): Promise<BalanceMutationResult> {
  const { data, error } = await supabase.rpc('tutor_reverse_ledger_entry', {
    _entry_id: entryId,
    _note: note || undefined,
  });
  if (error) return { ok: false, ...mapBalanceError(error.message) };
  return { ok: true, entryId: typeof data === 'string' ? data : undefined };
}

/** Лента операций ученика (новые сверху). Для TASK-6 «Все операции». */
export async function listLedger(tutorStudentId: string, limit = 50): Promise<LedgerEntry[]> {
  const { data, error } = await supabase
    .from('tutor_ledger_entries')
    .select('id, kind, amount, occurred_on, source_kind, source_lesson_id, reverses_entry_id, reversed_by_entry_id, replaces_entry_id, note, created_at')
    .eq('tutor_student_id', tutorStudentId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) {
    console.error('listLedger error:', error);
    throw new Error('Не удалось загрузить операции.');
  }
  return (data ?? []) as LedgerEntry[];
}
