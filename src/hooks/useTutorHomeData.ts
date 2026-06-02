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
  /**
   * Error from a CRITICAL query (профиль / ученики / очередь проверки ДЗ) —
   * the only signal allowed to escalate to the full banner. A peripheral
   * failure never sets this.
   */
  criticalError: string | null;
  /** A non-critical block failed (оплаты / занятия / диалоги / активность). */
  degraded: boolean;
  /** True while any critical query is (re)fetching — drives the spinner. */
  criticalFetching: boolean;
  refetchAll: () => void;
  /** Refetch only the critical queries (used by the silent self-heal loop). */
  refetchCritical: () => void;
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

  // Tiered error model (2026-06-02). The banner ("кабинет реально пуст") fires
  // ONLY when a CRITICAL, load-bearing query fails — профиль + ученики; without
  // them /tutor/home has no usable content. EVERY block-level failure (очередь
  // проверки ДЗ / оплаты / занятия / диалоги / активность) is `degraded`: the
  // rest of the cabinet renders, so we show a subtle note + slow self-heal, not
  // an alarm. RU DPI drops ~1 of N parallel requests at random (rule 95) — the
  // old OR-of-7 banner fired a false "включите VPN" alarm on ~30% of healthy
  // loads. (review-queue is degraded, not critical: it is the heaviest/flakiest
  // block and the dashboard is useful without it.)
  const criticalError = tutorQuery.error || studentsQuery.error || null;

  const degraded = Boolean(
    reviewQueueQuery.error ||
      paymentsQuery.error ||
      todayLessonsQuery.error ||
      recentDialogsQuery.error ||
      studentActivityQuery.error,
  );

  const criticalFetching = tutorQuery.isFetching || studentsQuery.isFetching;

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

  const refetchCritical = () => {
    tutorQuery.refetch();
    studentsQuery.refetch();
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
    criticalError,
    degraded,
    criticalFetching,
    refetchAll,
    refetchCritical,
  };
}
