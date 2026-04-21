import { useMemo } from 'react';
import { useTutor, useTutorStudents, useTutorPayments } from '@/hooks/useTutor';
import { useTutorTodayLessons, type TodaySession } from '@/hooks/useTutorTodayLessons';
import { useTutorReviewQueue, type ReviewItem } from '@/hooks/useTutorReviewQueue';
import { useTutorRecentDialogs, type DialogItem } from '@/hooks/useTutorRecentDialogs';
import {
  useTutorStudentActivity,
  type StudentActivity,
} from '@/hooks/useTutorStudentActivity';
import type {
  Tutor,
  TutorPaymentWithStudent,
  TutorStudentWithProfile,
} from '@/types/tutor';

export type {
  TodaySession,
  ReviewItem,
  DialogItem,
  StudentActivity,
};

export interface TutorHomeData {
  tutor: Tutor | null;
  students: TutorStudentWithProfile[];
  payments: TutorPaymentWithStudent[];
  todayLessons: TodaySession[];
  reviewQueue: ReviewItem[];
  recentDialogs: DialogItem[];
  studentActivity: StudentActivity[];
  studentActivityTotalCount: number;
  loading: boolean;
  /** True once at least one query has successfully returned data. */
  anySettled: boolean;
  error: string | null;
  refetchAll: () => void;
}

/**
 * Aggregator for the /tutor/home surface. Composes the 7 composable hooks so
 * `TutorHome.tsx` only interacts with a single data hook. All hooks use
 * `['tutor', 'home', entity]` query keys and run in parallel by default
 * (react-query dedups cache entries across consumers).
 */
export function useTutorHomeData(): TutorHomeData {
  const tutorQuery = useTutor();
  const studentsQuery = useTutorStudents();
  const paymentsQuery = useTutorPayments();
  const todayLessonsQuery = useTutorTodayLessons();
  const reviewQueueQuery = useTutorReviewQueue();
  const recentDialogsQuery = useTutorRecentDialogs();
  const studentActivityQuery = useTutorStudentActivity();

  const loading =
    tutorQuery.loading ||
    studentsQuery.loading ||
    paymentsQuery.loading ||
    todayLessonsQuery.loading ||
    reviewQueueQuery.loading ||
    recentDialogsQuery.loading ||
    studentActivityQuery.loading;

  const error =
    tutorQuery.error ||
    studentsQuery.error ||
    paymentsQuery.error ||
    todayLessonsQuery.error ||
    reviewQueueQuery.error ||
    recentDialogsQuery.error ||
    studentActivityQuery.error ||
    null;

  const anySettled = useMemo(
    () =>
      !tutorQuery.loading ||
      !studentsQuery.loading ||
      !paymentsQuery.loading ||
      !todayLessonsQuery.loading ||
      !reviewQueueQuery.loading ||
      !recentDialogsQuery.loading ||
      !studentActivityQuery.loading,
    [
      tutorQuery.loading,
      studentsQuery.loading,
      paymentsQuery.loading,
      todayLessonsQuery.loading,
      reviewQueueQuery.loading,
      recentDialogsQuery.loading,
      studentActivityQuery.loading,
    ],
  );

  const refetchAll = () => {
    tutorQuery.refetch();
    studentsQuery.refetch();
    paymentsQuery.refetch();
    todayLessonsQuery.refetch();
    reviewQueueQuery.refetch();
    recentDialogsQuery.refetch();
    studentActivityQuery.refetch();
  };

  return {
    tutor: tutorQuery.tutor,
    students: studentsQuery.students,
    payments: paymentsQuery.payments,
    todayLessons: todayLessonsQuery.sessions,
    reviewQueue: reviewQueueQuery.items,
    recentDialogs: recentDialogsQuery.dialogs,
    studentActivity: studentActivityQuery.items,
    studentActivityTotalCount: studentActivityQuery.totalCount,
    loading,
    anySettled,
    error,
    refetchAll,
  };
}
