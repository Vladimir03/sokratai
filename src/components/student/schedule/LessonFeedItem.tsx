import { memo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { format, isToday, parseISO } from 'date-fns';
import { ru } from 'date-fns/locale';
import { Atom, BookOpen, ChevronRight, Cpu, FlaskConical, Leaf, Sigma } from 'lucide-react';
import { MaterialChips } from './MaterialChips';
import type { StudentLesson } from '@/lib/studentScheduleApi';

/** Best-effort subject → Lucide icon (free-text `tutor_lessons.subject`); default BookOpen. */
function subjectIcon(subject: string | null) {
  const s = (subject ?? '').toLowerCase();
  if (s.includes('физ')) return Atom;
  if (s.includes('мат') || s.includes('алгебр') || s.includes('геометр')) return Sigma;
  if (s.includes('хим')) return FlaskConical;
  if (s.includes('био')) return Leaf;
  if (s.includes('информ')) return Cpu;
  return BookOpen;
}

function formatLessonTime(startAt: string): string {
  try {
    const d = parseISO(startAt); // rule 80: parseISO, never new Date("…")
    if (Number.isNaN(d.getTime())) return '';
    return isToday(d) ? format(d, 'HH:mm', { locale: ru }) : format(d, 'd MMM, HH:mm', { locale: ru });
  } catch {
    return '';
  }
}

interface LessonFeedItemProps {
  lesson: StudentLesson;
}

/** Compact lesson row: subject icon + title + «репетитор · время» + material chips + chevron.
 *  Row/chevron → detail; chips navigate directly (recording/PDF/ДЗ). */
export const LessonFeedItem = memo(function LessonFeedItem({ lesson }: LessonFeedItemProps) {
  const navigate = useNavigate();
  const Icon = subjectIcon(lesson.subject);
  const title = lesson.subject?.trim() || lesson.group_title_snapshot?.trim() || 'Занятие';
  const meta = [lesson.tutor?.name?.trim(), formatLessonTime(lesson.start_at)].filter(Boolean).join(' · ');

  const openDetail = useCallback(() => navigate(`/student/schedule/${lesson.id}`), [navigate, lesson.id]);
  // AC-6: one hop straight to the problem screen when the backend resolved the
  // entry task; fall back to the redirect-only entry only when it didn't.
  const openHomework = useCallback(
    (assignmentId: string, entryTaskId: string | null) =>
      navigate(
        entryTaskId
          ? `/student/homework/${assignmentId}/problem/${entryTaskId}`
          : `/homework/${assignmentId}`,
      ),
    [navigate],
  );

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={openDetail}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openDetail();
        }
      }}
      className="flex cursor-pointer items-start gap-3 rounded-xl border border-socrat-border bg-card px-3.5 py-3 transition-colors hover:bg-socrat-surface"
      style={{ touchAction: 'manipulation' }}
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
        <Icon className="h-[18px] w-[18px]" />
      </div>
      <div className="min-w-0 flex-1 space-y-1.5">
        <p className="truncate text-sm font-semibold text-slate-900">{title}</p>
        {meta && <p className="truncate text-xs text-muted-foreground">{meta}</p>}
        <MaterialChips
          materials={lesson.materials}
          onOpenHomework={openHomework}
          onOpenDetail={openDetail}
        />
      </div>
      <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-slate-300" aria-hidden="true" />
    </div>
  );
});
