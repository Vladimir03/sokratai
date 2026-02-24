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
