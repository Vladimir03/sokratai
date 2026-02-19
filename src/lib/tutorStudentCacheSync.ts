import type { QueryClient } from '@tanstack/react-query';
import type { TutorStudentWithProfile } from '@/types/tutor';

export type TutorStudentCachePatch = {
  tutorStudentId: string;
  studentId?: string;
  username?: string;
  telegramUsername?: string | null;
  learningGoal?: string | null;
  grade?: number | null;
  examType?: 'ege' | 'oge' | null;
  subject?: string | null;
  startScore?: number | null;
  targetScore?: number | null;
  parentContact?: string | null;
  notes?: string | null;
  lastLessonAt?: string | null;
};

function patchStudentRow(
  student: TutorStudentWithProfile,
  patch: TutorStudentCachePatch,
): TutorStudentWithProfile {
  let changed = false;

  const nextProfiles = { ...student.profiles };
  if (patch.username !== undefined && nextProfiles.username !== patch.username) {
    nextProfiles.username = patch.username;
    changed = true;
  }
  if (
    patch.telegramUsername !== undefined &&
    nextProfiles.telegram_username !== patch.telegramUsername
  ) {
    nextProfiles.telegram_username = patch.telegramUsername;
    changed = true;
  }
  if (
    patch.learningGoal !== undefined &&
    nextProfiles.learning_goal !== patch.learningGoal
  ) {
    nextProfiles.learning_goal = patch.learningGoal;
    changed = true;
  }
  if (patch.grade !== undefined && nextProfiles.grade !== patch.grade) {
    nextProfiles.grade = patch.grade;
    changed = true;
  }

  const nextStudent = {
    ...student,
    profiles: nextProfiles,
  };

  if (patch.examType !== undefined && nextStudent.exam_type !== patch.examType) {
    nextStudent.exam_type = patch.examType;
    changed = true;
  }
  if (patch.subject !== undefined && nextStudent.subject !== patch.subject) {
    nextStudent.subject = patch.subject;
    changed = true;
  }
  if (patch.startScore !== undefined && nextStudent.start_score !== patch.startScore) {
    nextStudent.start_score = patch.startScore;
    changed = true;
  }
  if (patch.targetScore !== undefined && nextStudent.target_score !== patch.targetScore) {
    nextStudent.target_score = patch.targetScore;
    changed = true;
  }
  if (patch.parentContact !== undefined && nextStudent.parent_contact !== patch.parentContact) {
    nextStudent.parent_contact = patch.parentContact;
    changed = true;
  }
  if (patch.notes !== undefined && nextStudent.notes !== patch.notes) {
    nextStudent.notes = patch.notes;
    changed = true;
  }
  if (patch.lastLessonAt !== undefined && nextStudent.last_lesson_at !== patch.lastLessonAt) {
    nextStudent.last_lesson_at = patch.lastLessonAt;
    changed = true;
  }

  return changed ? nextStudent : student;
}

export function applyTutorStudentPatchToCache(
  queryClient: QueryClient,
  patch: TutorStudentCachePatch,
): void {
  queryClient.setQueryData<TutorStudentWithProfile | null>(
    ['tutor', 'student', patch.tutorStudentId],
    (current) => {
      if (!current) return current;
      return patchStudentRow(current, patch);
    },
  );

  queryClient.setQueryData<TutorStudentWithProfile[] | undefined>(
    ['tutor', 'students'],
    (current) => {
      if (!current || current.length === 0) return current;

      let hasTarget = false;
      const next = current.map((student) => {
        if (student.id !== patch.tutorStudentId) {
          return student;
        }
        hasTarget = true;
        return patchStudentRow(student, patch);
      });

      return hasTarget ? next : current;
    },
  );
}

export function removeTutorStudentFromCache(
  queryClient: QueryClient,
  tutorStudentId: string,
): void {
  queryClient.setQueryData<TutorStudentWithProfile[] | undefined>(
    ['tutor', 'students'],
    (current) => {
      if (!current || current.length === 0) return current;
      const next = current.filter((student) => student.id !== tutorStudentId);
      return next.length === current.length ? current : next;
    },
  );

  queryClient.removeQueries({
    queryKey: ['tutor', 'student', tutorStudentId],
    exact: true,
  });
}

export async function invalidateTutorStudentDependentQueries(
  queryClient: QueryClient,
  tutorStudentId: string,
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({
      queryKey: ['tutor', 'students'],
      refetchType: 'active',
    }),
    queryClient.invalidateQueries({
      queryKey: ['tutor', 'student', tutorStudentId],
      refetchType: 'active',
    }),
    queryClient.invalidateQueries({
      queryKey: ['tutor', 'payments'],
      refetchType: 'active',
    }),
    queryClient.invalidateQueries({
      queryKey: ['tutor', 'lessons'],
      refetchType: 'active',
    }),
    queryClient.invalidateQueries({
      queryKey: ['tutor', 'homework'],
      refetchType: 'active',
    }),
  ]);
}
