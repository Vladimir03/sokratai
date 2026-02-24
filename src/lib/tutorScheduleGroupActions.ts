import { calculateLessonPaymentAmount } from '@/lib/paymentAmount';
import {
  cancelLesson,
  completeLessonAndCreatePayment,
  updateLesson,
} from '@/lib/tutorSchedule';
import { supabase } from '@/lib/supabaseClient';

export type GroupLessonActionType = 'move' | 'cancel' | 'complete';

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

// =============================================
// Unified group lesson (single row) actions
// =============================================

interface UnifiedGroupLessonInfo {
  lessonId: string;
  status: 'booked' | 'completed' | 'cancelled';
  startAt: string;
  durationMin: number;
  /** Participant names for result reporting */
  participantNames: string[];
}

function isLessonPast(startAt: string, durationMin: number): boolean {
  const endAt = new Date(new Date(startAt).getTime() + durationMin * 60_000);
  return endAt.getTime() < Date.now();
}

export async function runMoveGroupLesson(
  lesson: UnifiedGroupLessonInfo,
  newStartAt: string,
): Promise<GroupActionSummary> {
  const results: GroupActionResultItem[] = [];
  const allNames = lesson.participantNames.join(', ') || 'Группа';

  if (lesson.status !== 'booked') {
    results.push({
      lessonId: lesson.lessonId,
      studentName: allNames,
      ok: false,
      skipped: true,
      reason: 'Урок не в статусе "Запланировано"',
    });
    return summarizeResults('move', results);
  }

  try {
    const updated = await updateLesson(lesson.lessonId, { start_at: newStartAt });
    results.push({
      lessonId: lesson.lessonId,
      studentName: allNames,
      ok: !!updated,
      skipped: false,
      reason: updated ? undefined : 'Не удалось перенести урок',
    });
  } catch (error) {
    results.push({
      lessonId: lesson.lessonId,
      studentName: allNames,
      ok: false,
      skipped: false,
      reason: error instanceof Error ? error.message : 'Ошибка переноса',
    });
  }

  return summarizeResults('move', results);
}

export async function runCancelGroupLesson(
  lesson: UnifiedGroupLessonInfo,
): Promise<GroupActionSummary> {
  const results: GroupActionResultItem[] = [];
  const allNames = lesson.participantNames.join(', ') || 'Группа';

  if (lesson.status !== 'booked') {
    results.push({
      lessonId: lesson.lessonId,
      studentName: allNames,
      ok: false,
      skipped: true,
      reason: 'Урок не в статусе "Запланировано"',
    });
    return summarizeResults('cancel', results);
  }

  try {
    const cancelled = await cancelLesson(lesson.lessonId);
    results.push({
      lessonId: lesson.lessonId,
      studentName: allNames,
      ok: !!cancelled,
      skipped: false,
      reason: cancelled ? undefined : 'Не удалось отменить урок',
    });
  } catch (error) {
    results.push({
      lessonId: lesson.lessonId,
      studentName: allNames,
      ok: false,
      skipped: false,
      reason: error instanceof Error ? error.message : 'Ошибка отмены',
    });
  }

  return summarizeResults('cancel', results);
}

export async function runCompleteGroupLesson(
  lesson: UnifiedGroupLessonInfo,
): Promise<GroupActionSummary> {
  const results: GroupActionResultItem[] = [];
  const allNames = lesson.participantNames.join(', ') || 'Группа';

  if (lesson.status !== 'booked') {
    results.push({
      lessonId: lesson.lessonId,
      studentName: allNames,
      ok: false,
      skipped: true,
      reason: 'Урок не в статусе "Запланировано"',
    });
    return summarizeResults('complete', results);
  }

  if (!isLessonPast(lesson.startAt, lesson.durationMin)) {
    results.push({
      lessonId: lesson.lessonId,
      studentName: allNames,
      ok: false,
      skipped: true,
      reason: 'Урок еще не завершился по времени',
    });
    return summarizeResults('complete', results);
  }

  // Use the RPC which now handles group payments via tutor_lesson_participants
  try {
    const completed = await completeLessonAndCreatePayment(
      lesson.lessonId,
      0, // amount=0, actual amounts are per-participant in tutor_lesson_participants
      'pending',
    );
    results.push({
      lessonId: lesson.lessonId,
      studentName: allNames,
      ok: !!completed,
      skipped: false,
      reason: completed ? undefined : 'Не удалось отметить урок проведенным',
    });
  } catch (error) {
    results.push({
      lessonId: lesson.lessonId,
      studentName: allNames,
      ok: false,
      skipped: false,
      reason: error instanceof Error ? error.message : 'Ошибка завершения урока',
    });
  }

  return summarizeResults('complete', results);
}

// =============================================
// Legacy per-student actions (backward compat for old data)
// =============================================

export interface GroupActionLessonItem {
  lessonId: string;
  tutorStudentId?: string | null;
  studentName: string;
  status: 'booked' | 'completed' | 'cancelled';
  startAt: string;
  durationMin: number;
  hourlyRateCents?: number | null;
}

interface GroupActionParams {
  lessons: GroupActionLessonItem[];
  targetLessonIds?: string[];
}

interface RunMoveGroupActionParams extends GroupActionParams {
  newStartAt: string;
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
      results.push({
        lessonId: lesson.lessonId,
        tutorStudentId: lesson.tutorStudentId,
        studentName: lesson.studentName,
        ok: !!updated,
        skipped: false,
        reason: updated ? undefined : 'Не удалось перенести урок',
      });
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
      results.push({
        lessonId: lesson.lessonId,
        tutorStudentId: lesson.tutorStudentId,
        studentName: lesson.studentName,
        ok: !!cancelled,
        skipped: false,
        reason: cancelled ? undefined : 'Не удалось отменить урок',
      });
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

    if (!isLessonPast(lesson.startAt, lesson.durationMin)) {
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
      results.push({
        lessonId: lesson.lessonId,
        tutorStudentId: lesson.tutorStudentId,
        studentName: lesson.studentName,
        ok: !!completed,
        skipped: false,
        reason: completed ? undefined : 'Не удалось отметить урок проведенным',
      });
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
