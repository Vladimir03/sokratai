import { supabase } from '@/lib/supabaseClient';
import { createLesson } from '@/lib/tutorSchedule';
import { calculateLessonPaymentAmount } from '@/lib/paymentAmount';
import type {
  LessonType,
  TutorLessonParticipantWithStudent,
  TutorLessonWithStudent,
} from '@/types/tutor';

export interface MiniGroupCreateMember {
  tutorStudentId: string;
  studentId: string;
  studentName: string;
  hourlyRateCents?: number | null;
}

export interface MiniGroupCreateLessonInput {
  start_at: string;
  duration_min: number;
  lesson_type: LessonType;
  subject?: string;
  notes?: string;
  group_session_id?: string;
  group_source_tutor_group_id?: string;
  group_title_snapshot?: string;
  group_size_snapshot?: number;
  // Recurring series support (group lessons, 2026-06-07). Mirrors the
  // individual createLessonSeries fields — passed straight to createLesson.
  is_recurring?: boolean;
  recurrence_rule?: string;
  parent_lesson_id?: string;
}

export interface MiniGroupCreateResult {
  ok: boolean;
  lesson?: TutorLessonWithStudent;
  participantsInserted: number;
  errorMessage?: string;
}

interface CreateMiniGroupLessonParams {
  members: MiniGroupCreateMember[];
  lessonInput: MiniGroupCreateLessonInput;
}

/**
 * Creates a single group lesson and inserts all members as participants.
 * Returns one lesson + N participants (atomic from the user's perspective).
 */
export async function createMiniGroupLesson({
  members,
  lessonInput,
}: CreateMiniGroupLessonParams): Promise<MiniGroupCreateResult> {
  if (members.length === 0) {
    return { ok: false, participantsInserted: 0, errorMessage: 'Нет участников' };
  }

  // 1. Create one lesson row (no tutor_student_id / student_id for group lessons)
  const lesson = await createLesson({
    start_at: lessonInput.start_at,
    duration_min: lessonInput.duration_min,
    lesson_type: lessonInput.lesson_type,
    subject: lessonInput.subject,
    notes: lessonInput.notes,
    group_session_id: lessonInput.group_session_id,
    group_source_tutor_group_id: lessonInput.group_source_tutor_group_id,
    group_title_snapshot: lessonInput.group_title_snapshot,
    group_size_snapshot: lessonInput.group_size_snapshot ?? members.length,
    is_recurring: lessonInput.is_recurring,
    recurrence_rule: lessonInput.recurrence_rule,
    parent_lesson_id: lessonInput.parent_lesson_id,
    // No tutor_student_id / student_id — this is a group lesson
  });

  if (!lesson) {
    return { ok: false, participantsInserted: 0, errorMessage: 'Не удалось создать занятие' };
  }

  // 2. Insert all participants
  const participantRows = members.map((member) => ({
    lesson_id: lesson.id,
    tutor_student_id: member.tutorStudentId,
    student_id: member.studentId,
    payment_amount: calculateLessonPaymentAmount(
      lessonInput.duration_min,
      member.hourlyRateCents ?? null,
    ),
  }));

  const { error: participantsError, data: insertedParticipants } = await supabase
    .from('tutor_lesson_participants')
    .insert(participantRows)
    .select();

  if (participantsError) {
    console.error('Error inserting participants:', participantsError);
    // Lesson was created but participants failed — still return the lesson so it can be cleaned up
    return {
      ok: false,
      lesson,
      participantsInserted: 0,
      errorMessage: `Занятие создано, но не удалось добавить участников: ${participantsError.message}`,
    };
  }

  return {
    ok: true,
    lesson,
    participantsInserted: insertedParticipants?.length ?? members.length,
  };
}

export interface MiniGroupCreateSeriesResult {
  ok: boolean;
  /** Первое занятие серии (корень, parent_lesson_id = null). */
  root?: TutorLessonWithStudent;
  /** Сколько занятий реально создано (root + успешные дочерние). */
  count: number;
  /** Сколько занятий ПЛАНИРОВАЛОСЬ создать (по сетке дат). */
  expected: number;
  /** Сколько повторов НЕ удалось создать (для предупреждения «N из M»). */
  failedCount: number;
  errorMessage?: string;
}

interface CreateMiniGroupLessonSeriesParams {
  members: MiniGroupCreateMember[];
  /** Параметры первого занятия (group_session_id уже задан вызывающим). */
  lessonInput: MiniGroupCreateLessonInput;
  /** ISO-дата окончания серии (включительно). */
  repeatUntil: string;
  /** Фабрика уникальных group_session_id (Safari-safe) для каждого повтора. */
  makeGroupSessionId: () => string;
}

/**
 * Создаёт еженедельную СЕРИЮ групповых занятий. Зеркалит individual
 * `createLessonSeries` (tutorSchedule.ts): MAX 60 экземпляров, неизменяемое
 * прибавление календарных дней (DST-safe), parent_lesson_id связывает серию.
 *
 * Каждый повтор — отдельный unified group lesson (student_id NULL) со СВОИМ
 * group_session_id + полным набором участников. Существующая логика
 * правки/отмены/удаления серий групп (rule 60 B-round) ключуется на
 * parent_lesson_id, поэтому созданная серия сразу управляема.
 *
 * Per-occurrence loop (1 lesson + N participants на повтор) — приемлемо для
 * ≤60 недель; падение одного повтора не валит остальные (best-effort).
 */
export async function createMiniGroupLessonSeries({
  members,
  lessonInput,
  repeatUntil,
  makeGroupSessionId,
}: CreateMiniGroupLessonSeriesParams): Promise<MiniGroupCreateSeriesResult> {
  if (members.length === 0) {
    return { ok: false, count: 0, expected: 0, failedCount: 0, errorMessage: 'Нет участников' };
  }

  const MAX_INSTANCES = 60;
  const startDate = new Date(lessonInput.start_at);
  const untilDate = new Date(new Date(repeatUntil).setHours(23, 59, 59, 999));

  const dates: Date[] = [];
  for (let week = 0; dates.length < MAX_INSTANCES; week++) {
    const d = new Date(startDate);
    d.setDate(startDate.getDate() + week * 7);
    if (d > untilDate) break;
    dates.push(d);
  }

  if (dates.length === 0) {
    return { ok: false, count: 0, expected: 0, failedCount: 0, errorMessage: 'Нет дат для серии занятий' };
  }

  const expected = dates.length;

  const isSeries = dates.length > 1;

  // Root (first occurrence). Keeps its caller-supplied group_session_id.
  const rootResult = await createMiniGroupLesson({
    members,
    lessonInput: {
      ...lessonInput,
      start_at: dates[0].toISOString(),
      is_recurring: isSeries,
      recurrence_rule: isSeries ? 'weekly' : undefined,
      parent_lesson_id: undefined,
    },
  });

  if (!rootResult.ok || !rootResult.lesson) {
    return {
      ok: false,
      count: 0,
      expected,
      failedCount: expected,
      errorMessage: rootResult.errorMessage ?? 'Не удалось создать первое занятие серии',
    };
  }

  const rootLesson = rootResult.lesson;
  let created = 1;

  // Remaining weekly occurrences — each its own session + participants.
  for (let i = 1; i < dates.length; i++) {
    const occurrence = await createMiniGroupLesson({
      members,
      lessonInput: {
        ...lessonInput,
        start_at: dates[i].toISOString(),
        group_session_id: makeGroupSessionId(),
        is_recurring: true,
        recurrence_rule: 'weekly',
        parent_lesson_id: rootLesson.id,
      },
    });
    if (occurrence.ok) {
      created += 1;
    } else {
      console.error('Mini-group series occurrence failed:', occurrence.errorMessage);
    }
  }

  return { ok: true, root: rootLesson, count: created, expected, failedCount: expected - created };
}

/**
 * Fetch participants for a given lesson.
 */
export async function getLessonParticipants(lessonId: string): Promise<TutorLessonParticipantWithStudent[]> {
  const { data, error } = await supabase
    .from('tutor_lesson_participants')
    .select(`
      *,
      tutor_students (
        id,
        student_id,
        hourly_rate_cents,
        profiles (
          id,
          username,
          telegram_username
        )
      )
    `)
    .order('created_at', { ascending: true })
    .eq('lesson_id', lessonId);

  if (error) {
    console.error('Error fetching lesson participants:', error);
    return [];
  }

  return (data ?? []) as unknown as TutorLessonParticipantWithStudent[];
}

export interface LessonParticipantMutationResult {
  ok: boolean;
  error?: string;
  code?: string;
}

function mapParticipantError(message: string): { error: string; code?: string } {
  if (message.includes('NOT_GROUP')) return { error: 'Добавлять участников можно только в групповое занятие.', code: 'NOT_GROUP' };
  if (message.includes('NOT_BOOKED')) return { error: 'Менять состав можно только у запланированных занятий.', code: 'NOT_BOOKED' };
  if (message.includes('LAST_PARTICIPANT')) return { error: 'Нельзя убрать последнего участника — удалите занятие целиком.', code: 'LAST_PARTICIPANT' };
  if (message.includes('INVALID_STUDENT')) return { error: 'Ученик не найден.', code: 'INVALID_STUDENT' };
  if (message.includes('NOT_OWNED')) return { error: 'Занятие не найдено.', code: 'NOT_OWNED' };
  return { error: 'Не удалось изменить состав занятия.' };
}

/** Add a student to an existing GROUP lesson (booked). SECURITY DEFINER RPC. */
export async function addLessonParticipant(
  lessonId: string,
  tutorStudentId: string,
): Promise<LessonParticipantMutationResult> {
  const { error } = await supabase.rpc('tutor_add_lesson_participant', {
    _lesson_id: lessonId,
    _tutor_student_id: tutorStudentId,
  });
  if (error) {
    console.error('Error adding lesson participant:', error);
    return { ok: false, ...mapParticipantError(error.message || '') };
  }
  return { ok: true };
}

/** Remove a student from an existing GROUP lesson (booked, not the last one). */
export async function removeLessonParticipant(
  lessonId: string,
  tutorStudentId: string,
): Promise<LessonParticipantMutationResult> {
  const { error } = await supabase.rpc('tutor_remove_lesson_participant', {
    _lesson_id: lessonId,
    _tutor_student_id: tutorStudentId,
  });
  if (error) {
    console.error('Error removing lesson participant:', error);
    return { ok: false, ...mapParticipantError(error.message || '') };
  }
  return { ok: true };
}
