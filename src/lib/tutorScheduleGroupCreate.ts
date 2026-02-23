import { createLesson } from '@/lib/tutorSchedule';
import type { LessonType } from '@/types/tutor';

export interface MiniGroupCreateMember {
  tutorStudentId: string;
  studentId: string;
  studentName: string;
}

export interface MiniGroupCreateLessonInput {
  start_at: string;
  duration_min: number;
  lesson_type: LessonType;
  subject?: string;
  notes?: string;
}

export interface MiniGroupCreateResultItem {
  tutorStudentId: string;
  studentId: string;
  studentName: string;
  ok: boolean;
  lessonId?: string;
  errorMessage?: string;
}

export interface MiniGroupCreateSummary {
  results: MiniGroupCreateResultItem[];
  totalCount: number;
  createdCount: number;
  failedCount: number;
}

interface CreateMiniGroupLessonsBatchParams {
  members: MiniGroupCreateMember[];
  lessonInput: MiniGroupCreateLessonInput;
  targetTutorStudentIds?: string[];
}

const DEFAULT_CREATE_ERROR_MESSAGE = 'Не удалось создать занятие';

export function summarizeMiniGroupCreateResults(
  results: MiniGroupCreateResultItem[]
): MiniGroupCreateSummary {
  const createdCount = results.filter((result) => result.ok).length;
  const totalCount = results.length;
  return {
    results,
    totalCount,
    createdCount,
    failedCount: totalCount - createdCount,
  };
}

export async function createMiniGroupLessonsBatch({
  members,
  lessonInput,
  targetTutorStudentIds,
}: CreateMiniGroupLessonsBatchParams): Promise<MiniGroupCreateSummary> {
  const targetSet = targetTutorStudentIds
    ? new Set(targetTutorStudentIds)
    : null;

  const targetMembers = targetSet
    ? members.filter((member) => targetSet.has(member.tutorStudentId))
    : members;

  const results: MiniGroupCreateResultItem[] = [];

  // Sequential mode is safer for MVP: stable ordering and clear per-member error mapping.
  for (const member of targetMembers) {
    try {
      const createdLesson = await createLesson({
        tutor_student_id: member.tutorStudentId,
        student_id: member.studentId,
        start_at: lessonInput.start_at,
        duration_min: lessonInput.duration_min,
        lesson_type: lessonInput.lesson_type,
        subject: lessonInput.subject,
        notes: lessonInput.notes,
      });

      if (!createdLesson) {
        results.push({
          tutorStudentId: member.tutorStudentId,
          studentId: member.studentId,
          studentName: member.studentName,
          ok: false,
          errorMessage: DEFAULT_CREATE_ERROR_MESSAGE,
        });
        continue;
      }

      results.push({
        tutorStudentId: member.tutorStudentId,
        studentId: member.studentId,
        studentName: member.studentName,
        ok: true,
        lessonId: createdLesson.id,
      });
    } catch (error) {
      results.push({
        tutorStudentId: member.tutorStudentId,
        studentId: member.studentId,
        studentName: member.studentName,
        ok: false,
        errorMessage:
          error instanceof Error && error.message
            ? error.message
            : DEFAULT_CREATE_ERROR_MESSAGE,
      });
    }
  }

  return summarizeMiniGroupCreateResults(results);
}
