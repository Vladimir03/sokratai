import { calculateLessonPaymentAmount } from '@/lib/paymentAmount';
import {
  cancelLesson,
  completeLessonAndCreatePayment,
  updateLesson,
} from '@/lib/tutorSchedule';

export type GroupLessonActionType = 'move' | 'cancel' | 'complete';

export interface GroupActionLessonItem {
  lessonId: string;
  tutorStudentId?: string | null;
  studentName: string;
  status: 'booked' | 'completed' | 'cancelled';
  startAt: string;
  durationMin: number;
  hourlyRateCents?: number | null;
}

export interface GroupActionResultItem {
  lessonId: string;
  tutorStudentId?: string | null;
  studentName: string;
  ok: boolean;
  skipped: boolean;
  reason?: string;
}

export interface GroupActionSummary {
  action: GroupLessonActionType;
  results: GroupActionResultItem[];
  totalCount: number;
  successCount: number;
  failedCount: number;
  skippedCount: number;
}

interface GroupActionParams {
  lessons: GroupActionLessonItem[];
  targetLessonIds?: string[];
}

interface RunMoveGroupActionParams extends GroupActionParams {
  newStartAt: string;
}

function summarizeResults(
  action: GroupLessonActionType,
  results: GroupActionResultItem[],
): GroupActionSummary {
  const successCount = results.filter((result) => result.ok).length;
  const skippedCount = results.filter((result) => result.skipped).length;
  return {
    action,
    results,
    totalCount: results.length,
    successCount,
    failedCount: results.length - successCount - skippedCount,
    skippedCount,
  };
}

function resolveTargetLessons(
  lessons: GroupActionLessonItem[],
  targetLessonIds?: string[],
): GroupActionLessonItem[] {
  if (!targetLessonIds || targetLessonIds.length === 0) {
    return lessons;
  }
  const targetSet = new Set(targetLessonIds);
  return lessons.filter((lesson) => targetSet.has(lesson.lessonId));
}

function isLessonPast(lesson: GroupActionLessonItem): boolean {
  const startAt = new Date(lesson.startAt);
  const endAt = new Date(startAt.getTime() + lesson.durationMin * 60_000);
  return endAt.getTime() < Date.now();
}

export async function runMoveGroupAction({
  lessons,
  targetLessonIds,
  newStartAt,
}: RunMoveGroupActionParams): Promise<GroupActionSummary> {
  const targetLessons = resolveTargetLessons(lessons, targetLessonIds);
  const results: GroupActionResultItem[] = [];

  for (const lesson of targetLessons) {
    if (lesson.status !== 'booked') {
      results.push({
        lessonId: lesson.lessonId,
        tutorStudentId: lesson.tutorStudentId,
        studentName: lesson.studentName,
        ok: false,
        skipped: true,
        reason: 'Урок не в статусе "Запланировано"',
      });
      continue;
    }

    try {
      const updated = await updateLesson(lesson.lessonId, { start_at: newStartAt });
      if (updated) {
        results.push({
          lessonId: lesson.lessonId,
          tutorStudentId: lesson.tutorStudentId,
          studentName: lesson.studentName,
          ok: true,
          skipped: false,
        });
      } else {
        results.push({
          lessonId: lesson.lessonId,
          tutorStudentId: lesson.tutorStudentId,
          studentName: lesson.studentName,
          ok: false,
          skipped: false,
          reason: 'Не удалось перенести урок',
        });
      }
    } catch (error) {
      results.push({
        lessonId: lesson.lessonId,
        tutorStudentId: lesson.tutorStudentId,
        studentName: lesson.studentName,
        ok: false,
        skipped: false,
        reason: error instanceof Error ? error.message : 'Ошибка переноса',
      });
    }
  }

  return summarizeResults('move', results);
}

export async function runCancelGroupAction({
  lessons,
  targetLessonIds,
}: GroupActionParams): Promise<GroupActionSummary> {
  const targetLessons = resolveTargetLessons(lessons, targetLessonIds);
  const results: GroupActionResultItem[] = [];

  for (const lesson of targetLessons) {
    if (lesson.status !== 'booked') {
      results.push({
        lessonId: lesson.lessonId,
        tutorStudentId: lesson.tutorStudentId,
        studentName: lesson.studentName,
        ok: false,
        skipped: true,
        reason: 'Урок не в статусе "Запланировано"',
      });
      continue;
    }

    try {
      const cancelled = await cancelLesson(lesson.lessonId);
      if (cancelled) {
        results.push({
          lessonId: lesson.lessonId,
          tutorStudentId: lesson.tutorStudentId,
          studentName: lesson.studentName,
          ok: true,
          skipped: false,
        });
      } else {
        results.push({
          lessonId: lesson.lessonId,
          tutorStudentId: lesson.tutorStudentId,
          studentName: lesson.studentName,
          ok: false,
          skipped: false,
          reason: 'Не удалось отменить урок',
        });
      }
    } catch (error) {
      results.push({
        lessonId: lesson.lessonId,
        tutorStudentId: lesson.tutorStudentId,
        studentName: lesson.studentName,
        ok: false,
        skipped: false,
        reason: error instanceof Error ? error.message : 'Ошибка отмены',
      });
    }
  }

  return summarizeResults('cancel', results);
}

export async function runCompleteGroupAction({
  lessons,
  targetLessonIds,
}: GroupActionParams): Promise<GroupActionSummary> {
  const targetLessons = resolveTargetLessons(lessons, targetLessonIds);
  const results: GroupActionResultItem[] = [];

  for (const lesson of targetLessons) {
    if (lesson.status !== 'booked') {
      results.push({
        lessonId: lesson.lessonId,
        tutorStudentId: lesson.tutorStudentId,
        studentName: lesson.studentName,
        ok: false,
        skipped: true,
        reason: 'Урок не в статусе "Запланировано"',
      });
      continue;
    }

    if (!isLessonPast(lesson)) {
      results.push({
        lessonId: lesson.lessonId,
        tutorStudentId: lesson.tutorStudentId,
        studentName: lesson.studentName,
        ok: false,
        skipped: true,
        reason: 'Урок еще не завершился по времени',
      });
      continue;
    }

    const amount = calculateLessonPaymentAmount(
      lesson.durationMin,
      lesson.hourlyRateCents ?? null,
    ) ?? 0;

    try {
      const completed = await completeLessonAndCreatePayment(
        lesson.lessonId,
        amount,
        'pending',
      );
      if (completed) {
        results.push({
          lessonId: lesson.lessonId,
          tutorStudentId: lesson.tutorStudentId,
          studentName: lesson.studentName,
          ok: true,
          skipped: false,
        });
      } else {
        results.push({
          lessonId: lesson.lessonId,
          tutorStudentId: lesson.tutorStudentId,
          studentName: lesson.studentName,
          ok: false,
          skipped: false,
          reason: 'Не удалось отметить урок проведенным',
        });
      }
    } catch (error) {
      results.push({
        lessonId: lesson.lessonId,
        tutorStudentId: lesson.tutorStudentId,
        studentName: lesson.studentName,
        ok: false,
        skipped: false,
        reason: error instanceof Error ? error.message : 'Ошибка завершения урока',
      });
    }
  }

  return summarizeResults('complete', results);
}
