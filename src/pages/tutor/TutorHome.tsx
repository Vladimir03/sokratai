import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { parseISO, subDays } from 'date-fns';
import { Skeleton } from '@/components/ui/skeleton';
import TutorGuard from '@/components/TutorGuard';
import { TutorLayout } from '@/components/tutor/TutorLayout';
import { TutorDataStatus } from '@/components/tutor/TutorDataStatus';
import { AddStudentDialog } from '@/components/tutor/AddStudentDialog';
import {
  HomeHeader,
  HomeCTAs,
  StatStrip,
  TodayBlock,
  ReviewQueueBlock,
  RecentDialogsBlock,
  StudentsActivityBlock,
} from '@/components/tutor/home';
import type { DialogItem, TodaySession } from '@/components/tutor/home';
import { useTutor, useTutorStudents, useTutorPayments } from '@/hooks/useTutor';
import { useTutorHomeData } from '@/hooks/useTutorHomeData';
import {
  getTutorInviteTelegramLink,
  getTutorInviteWebLink,
} from '@/utils/telegramLinks';

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  const sum = values.reduce((acc, v) => acc + v, 0);
  return sum / values.length;
}

function roundTo(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function HomeSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-20 w-full" />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
      <Skeleton className="h-28 w-full" />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Skeleton className="h-56" />
        <Skeleton className="h-56" />
      </div>
      <Skeleton className="h-48 w-full" />
      <Skeleton className="h-72 w-full" />
    </div>
  );
}

function TutorHomeContent() {
  const navigate = useNavigate();
  const home = useTutorHomeData();
  const { tutor, students, payments, studentActivity } = home;

  // Pull per-query refetchers so TutorDataStatus can retry everything.
  const tutorQuery = useTutor();
  const studentsQuery = useTutorStudents();
  const paymentsQuery = useTutorPayments();

  const isFetching =
    tutorQuery.isFetching ||
    studentsQuery.isFetching ||
    paymentsQuery.isFetching;
  const isRecovering =
    tutorQuery.isRecovering ||
    studentsQuery.isRecovering ||
    paymentsQuery.isRecovering;
  const failureCount = Math.max(
    tutorQuery.failureCount,
    studentsQuery.failureCount,
    paymentsQuery.failureCount,
  );

  const [inviteModalOpen, setInviteModalOpen] = useState(false);

  const inviteCode = tutor?.invite_code ?? undefined;
  const inviteWebLink = inviteCode ? getTutorInviteWebLink(inviteCode) : '';
  const inviteTelegramLink = inviteCode
    ? getTutorInviteTelegramLink(inviteCode)
    : '';

  // ─── Derived stats (all client-side from aggregator data) ──────────────
  const stats = useMemo(() => {
    const now = new Date();
    const weekAgo = subDays(now, 7);

    const activeStudents = students.filter((s) => s.status === 'active');
    const activeWeekDelta = activeStudents.filter((s) => {
      if (!s.created_at) return false;
      try {
        return parseISO(s.created_at) > weekAgo;
      } catch {
        return false;
      }
    }).length;

    const attentionCount = studentActivity.filter((s) => s.attention).length;

    const hwAvgValues = studentActivity
      .map((s) => s.hwAvg)
      .filter((v): v is number => v != null);
    const avgScoreMean = mean(hwAvgValues);
    const avgScoreWeek =
      avgScoreMean == null ? null : roundTo(avgScoreMean, 1);

    const hwDeltaValues = studentActivity
      .map((s) => s.hwAvgDelta)
      .filter((v): v is number => v != null);
    const avgDeltaMean = mean(hwDeltaValues);
    const avgScoreDelta =
      avgDeltaMean == null ? null : roundTo(avgDeltaMean, 1);

    const pendingPayments = payments.filter((p) => p.status === 'pending');
    const overduePayments = payments.filter((p) => p.status === 'overdue');
    const toPay =
      pendingPayments.reduce((sum, p) => sum + (p.amount ?? 0), 0) +
      overduePayments.reduce((sum, p) => sum + (p.amount ?? 0), 0);

    return {
      activeStudents: activeStudents.length,
      activeWeekDelta,
      attentionCount,
      avgScoreWeek,
      avgScoreDelta,
      toPay,
      pendingCount: pendingPayments.length,
      overdueCount: overduePayments.length,
    };
  }, [students, payments, studentActivity]);

  // ─── Handlers ──────────────────────────────────────────────────────────
  const handleNewLesson = useCallback(() => {
    navigate('/tutor/schedule');
  }, [navigate]);

  const handleAddStudent = useCallback(() => {
    setInviteModalOpen(true);
  }, []);

  const handleAssignHomework = useCallback(() => {
    navigate('/tutor/homework/create');
  }, [navigate]);

  const handleAddPayment = useCallback(() => {
    navigate('/tutor/payments');
  }, [navigate]);

  const handleOpenSchedule = useCallback(() => {
    navigate('/tutor/schedule');
  }, [navigate]);

  const handleOpenSession = useCallback(
    (session: TodaySession) => {
      // Schedule page owns lesson detail; open schedule for the day.
      navigate(`/tutor/schedule?lesson=${session.lessonId}`);
    },
    [navigate],
  );

  const handleOpenHomeworkList = useCallback(() => {
    navigate('/tutor/homework');
  }, [navigate]);

  const handleOpenSubmission = useCallback(
    (assignmentId: string) => {
      navigate(`/tutor/homework/${assignmentId}`);
    },
    [navigate],
  );

  const handleOpenDialog = useCallback(
    (dialog: DialogItem) => {
      navigate(`/tutor/homework/${dialog.hwId}`);
    },
    [navigate],
  );

  const handleOpenStudentList = useCallback(() => {
    navigate('/tutor/students');
  }, [navigate]);

  const handleOpenStudent = useCallback(
    (id: string) => {
      navigate(`/tutor/students/${id}`);
    },
    [navigate],
  );

  const handleRetryAll = useCallback(() => {
    home.refetchAll();
  }, [home]);

  const tutorName = tutor?.name?.trim() ?? '';

  // ─── Render ────────────────────────────────────────────────────────────
  const showSkeleton = home.loading && !home.anySettled;

  return (
    <TutorLayout>
      <div className="sokrat" data-sokrat-mode="tutor">
        <TutorDataStatus
          error={home.error}
          isFetching={isFetching}
          isRecovering={isRecovering}
          failureCount={failureCount}
          onRetry={handleRetryAll}
        />

        {showSkeleton ? (
          <HomeSkeleton />
        ) : (
          <>
            <HomeHeader
              tutorName={tutorName}
              todaySummary={{
                lessons: home.todayLessons.length,
                toReview: home.reviewQueue.length,
                attention: stats.attentionCount,
              }}
              onNewLesson={handleNewLesson}
              onAddStudent={handleAddStudent}
            />

            <HomeCTAs
              onAssignHomework={handleAssignHomework}
              onAddPayment={handleAddPayment}
              paymentSummary={{
                pending: stats.pendingCount,
                overdue: stats.overdueCount,
              }}
            />

            <StatStrip
              activeStudents={stats.activeStudents}
              activeWeekDelta={stats.activeWeekDelta}
              attentionCount={stats.attentionCount}
              avgScoreWeek={stats.avgScoreWeek}
              avgScoreDelta={stats.avgScoreDelta}
              toPay={stats.toPay}
              pendingCount={stats.pendingCount}
              overdueCount={stats.overdueCount}
            />

            <div className="t-grid-2" style={{ marginBottom: 16 }}>
              <TodayBlock
                sessions={home.todayLessons}
                onOpenSchedule={handleOpenSchedule}
                onOpenSession={handleOpenSession}
              />
              <ReviewQueueBlock
                items={home.reviewQueue}
                onOpenAll={handleOpenHomeworkList}
                onOpenSubmission={handleOpenSubmission}
              />
            </div>

            <RecentDialogsBlock
              dialogs={home.recentDialogs}
              onOpenDialog={handleOpenDialog}
              onOpenAll={handleOpenHomeworkList}
            />

            <StudentsActivityBlock
              items={home.studentActivity}
              totalCount={home.studentActivityTotalCount}
              onOpenStudent={handleOpenStudent}
              onOpenAll={handleOpenStudentList}
              onAddStudent={handleAddStudent}
            />
          </>
        )}
      </div>

      <AddStudentDialog
        open={inviteModalOpen}
        onOpenChange={setInviteModalOpen}
        inviteCode={inviteCode}
        inviteWebLink={inviteWebLink}
        inviteTelegramLink={inviteTelegramLink}
        miniGroupsEnabled={false}
        groups={[]}
        onCreateGroup={async () => null}
        onSyncStudentMembership={async () => {}}
        onManualAdded={(tutorStudentId) => {
          navigate(`/tutor/students/${tutorStudentId}`);
        }}
      />
    </TutorLayout>
  );
}

export default function TutorHome() {
  return (
    <TutorGuard>
      <TutorHomeContent />
    </TutorGuard>
  );
}
