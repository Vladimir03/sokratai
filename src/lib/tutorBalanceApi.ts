// Student balance — Phase 2a frontend API (TASK-5).
// Units: РУБЛИ (integer), без копеек. Reads balance from tutor_students.balance + the
// ledger feed (RLS owns_tutor_student); writes via the SECURITY DEFINER RPCs.
// Errors: RPCs RAISE short codes → mapped to RU here (rule 97 mirror, like tutorSchedule.ts).
import { supabase } from '@/lib/supabaseClient';
import { getCurrentTutor } from '@/lib/tutors';
import { calculateLessonPaymentAmount } from '@/lib/paymentAmount';

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
  if (msg.includes('LESSON_ENTRY_NOT_REVERSIBLE')) return { code: 'LESSON_ENTRY_NOT_REVERSIBLE', error: 'Оплату за занятие нельзя отменить здесь — измените статус занятия в «Расписании».' };
  if (msg.includes('NOT_EDITABLE')) return { code: 'NOT_EDITABLE', error: 'Эту запись нельзя изменить здесь — списания за занятия правятся через занятие.' };
  if (msg.includes('ENTRY_NOT_FOUND')) return { code: 'ENTRY_NOT_FOUND', error: 'Операция не найдена.' };
  if (msg.includes('LEDGER_DEBIT_RACE') || msg.includes('LEDGER_DEBIT_LOST')) {
    return { code: 'LEDGER_CONFLICT', error: 'Не удалось применить — обновите страницу и попробуйте ещё раз.' };
  }
  return { error: 'Не удалось выполнить операцию. Попробуйте ещё раз.' };
}

/**
 * Строгий парсер суммы в РУБЛЯХ: только положительное целое. Минус, запятые/точки
 * и прочие символы → null (НЕ вычищать их в другое число: «-5000»≠5000, «1,5»≠15).
 * Пробелы-разряды («4 000») допускаются.
 */
export function parseRubleAmount(raw: string): number | null {
  const s = raw.trim().replace(/\s+/g, '');
  if (!/^\d{1,7}$/.test(s)) return null;
  const n = parseInt(s, 10);
  return n > 0 ? n : null;
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

export interface MonthIncome {
  /** Заработано: Σ активных lesson-списаний месяца (РУБЛИ). */
  earned: number;
  /** Ожидается за месяц = earned + Σ цен запланированных (booked) занятий месяца. */
  expected: number;
}

/**
 * Доход репетитора за календарный месяц (запрос Егора, план rustling-herding-hare).
 * «Заработано» — ОДИН запрос ledger: активные lesson-debits с occurred_on внутри месяца
 * (occurred_on = дата занятия; правки сумм и отмены/удаления учтены реверсами).
 * «Ожидается» — заработано + цены booked-занятий месяца: индивидуальное → ставка×длительность
 * (calculateLessonPaymentAmount, РУБЛИ); группа → Σ payment_amount участников (проставлены
 * при создании). Cancelled не считаются; completed входят через ledger-часть.
 */
export async function getMonthIncome(year: number, monthIndex0: number): Promise<MonthIncome> {
  const tutor = await getCurrentTutor();
  if (!tutor) throw new Error('Не удалось определить репетитора.');

  const start = new Date(year, monthIndex0, 1);
  const end = new Date(year, monthIndex0 + 1, 1); // exclusive
  const toDateStr = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  // 1) Заработано (ledger, кросс-ученически — RLS owns_tutor_student + defensive tutor_id).
  const { data: debits, error: ledgerErr } = await supabase
    .from('tutor_ledger_entries')
    .select('amount')
    .eq('tutor_id', tutor.id)
    .eq('kind', 'debit')
    .eq('source_kind', 'lesson')
    .is('reversed_by_entry_id', null)
    .gte('occurred_on', toDateStr(start))
    .lt('occurred_on', toDateStr(end));
  if (ledgerErr) {
    console.error('getMonthIncome ledger error:', ledgerErr);
    throw new Error('Не удалось загрузить доход за месяц.');
  }
  const earned = (debits ?? []).reduce((s, r) => s + Number(r.amount ?? 0), 0);

  // 2) Запланированное: booked-занятия месяца (mirror getTutorLessons date-range query).
  const { data: lessonsRaw, error: lessonsErr } = await supabase
    .from('tutor_lessons')
    .select('id, student_id, duration_min, tutor_students ( hourly_rate_cents )')
    .eq('tutor_id', tutor.id)
    .eq('status', 'booked')
    .gte('start_at', start.toISOString())
    .lt('start_at', end.toISOString());
  if (lessonsErr) {
    console.error('getMonthIncome lessons error:', lessonsErr);
    throw new Error('Не удалось загрузить запланированные занятия.');
  }
  const lessons = (lessonsRaw ?? []) as unknown as Array<{
    id: string;
    student_id: string | null;
    duration_min: number;
    tutor_students: { hourly_rate_cents: number | null } | null;
  }>;

  let expectedExtra = 0;
  const groupIds: string[] = [];
  for (const l of lessons) {
    if (l.student_id === null) {
      groupIds.push(l.id); // unified-группа — цена по участникам
    } else {
      expectedExtra += calculateLessonPaymentAmount(l.duration_min, l.tutor_students?.hourly_rate_cents) ?? 0;
    }
  }
  if (groupIds.length > 0) {
    const { data: parts, error: partsErr } = await supabase
      .from('tutor_lesson_participants')
      .select('payment_amount')
      .in('lesson_id', groupIds);
    if (partsErr) {
      console.error('getMonthIncome participants error:', partsErr);
      throw new Error('Не удалось загрузить участников групп.');
    }
    expectedExtra += (parts ?? []).reduce((s, p) => s + Number(p.payment_amount ?? 0), 0);
  }

  return { earned, expected: earned + expectedExtra };
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

/** Полученная оплата (active credit) для кросс-ученического журнала «Оплаты». */
export interface TutorReceivedPayment {
  id: string;
  tutor_student_id: string;
  amount: number; // РУБЛИ, всегда credit (положительное)
  occurred_on: string; // 'YYYY-MM-DD' — дата оплаты
  source_kind: LedgerSource; // 'topup' | 'lesson' | 'adjustment'
  source_lesson_id: string | null;
  note: string | null;
  created_at: string;
}

/**
 * Кросс-ученический журнал ПОЛУЧЕННЫХ оплат (credits) для страницы «Оплаты» — сверка с поступлениями
 * на карту. Только активные кредиты (topup + lesson-payment + reconcile), без offsetting/сторнированных
 * → каждая оплата ровно раз. Списания (debits) не входят (они в балансе ученика и на «Доходе»).
 * Имя ученика резолвится на странице из уже загруженного useTutorStudents (ledger имени не несёт).
 */
export async function listTutorReceivedPayments(params?: {
  from?: string; // 'YYYY-MM-DD' inclusive (occurred_on >=)
  to?: string; // 'YYYY-MM-DD' inclusive (occurred_on <=)
  studentId?: string;
  limit?: number;
}): Promise<TutorReceivedPayment[]> {
  const tutor = await getCurrentTutor();
  if (!tutor) throw new Error('Не удалось определить репетитора.');

  let q = supabase
    .from('tutor_ledger_entries')
    .select('id, tutor_student_id, amount, occurred_on, source_kind, source_lesson_id, note, created_at')
    .eq('tutor_id', tutor.id) // defensive + индекс; RLS owns_tutor_student тоже применяется
    .eq('kind', 'credit')
    .is('reverses_entry_id', null) // не показываем offsetting-аудит-строки
    .is('reversed_by_entry_id', null) // не показываем сторнированные/заменённые оригиналы
    .order('occurred_on', { ascending: false })
    .order('created_at', { ascending: false });

  if (params?.studentId) q = q.eq('tutor_student_id', params.studentId);
  if (params?.from) q = q.gte('occurred_on', params.from);
  if (params?.to) q = q.lte('occurred_on', params.to);
  q = q.limit(params?.limit ?? 200);

  const { data, error } = await q;
  if (error) {
    console.error('listTutorReceivedPayments error:', error);
    throw new Error('Не удалось загрузить оплаты.');
  }
  return (data ?? []) as TutorReceivedPayment[];
}

/** Максимум строк журнала «Оплаты» в одном запросе (отображение). */
export const RECEIVED_PAYMENTS_LIST_LIMIT = 200;

/**
 * Точный итог «Получено» (Σ + count) по фильтру — SQL-aggregate RPC (round-3 #6: без клиент-капа и без
 * молчаливого фолбэка). Ошибку прокидываем наверх → страница показывает «—», а не неверное число.
 * Имя RPC кастится `as never` (escape-hatch для RPC вне generated types.ts, конвенция rule 99).
 */
export async function getReceivedPaymentsTotal(params?: {
  from?: string;
  to?: string;
  studentId?: string;
}): Promise<{ total: number; count: number }> {
  const { data, error } = await supabase.rpc('tutor_received_payments_summary' as never, {
    _from: params?.from || undefined,
    _to: params?.to || undefined,
    _student_id: params?.studentId || undefined,
  } as never);
  if (error) {
    console.error('getReceivedPaymentsTotal error:', error);
    throw new Error('Не удалось посчитать итог оплат.');
  }
  const row = (data ?? {}) as { total?: number | string; count?: number | string };
  return { total: Number(row.total ?? 0), count: Number(row.count ?? 0) };
}
