import { memo } from 'react';
import { BookOpen, FileText, Video } from 'lucide-react';
import { cn } from '@/lib/utils';
import { HW_REF_STATUS_CONFIG, type StudentLessonMaterial } from '@/lib/studentScheduleApi';

const CHIP_BASE =
  'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors';
const CHIP_NEUTRAL = 'border-socrat-border bg-white text-slate-700 hover:bg-slate-50';

interface MaterialChipsProps {
  materials: StudentLessonMaterial[];
  /** Navigate straight into the guided-homework problem screen (AC-6 one hop). */
  onOpenHomework: (assignmentId: string, entryTaskId: string | null) => void;
  /** Fallback when a chip can't open directly (multiple of a kind, or PDF without a signed url). */
  onOpenDetail: () => void;
}

const stop = (e: React.MouseEvent) => e.stopPropagation();

/**
 * Compact material chips for a lesson row: Запись / Конспект open the single
 * material directly in a new tab; multiple-of-a-kind or an unsignable PDF fall
 * back to the lesson detail. ДЗ chip carries its status colour and jumps to the
 * guided homework in one hop. Empty → muted «материалов пока нет».
 */
export const MaterialChips = memo(function MaterialChips({
  materials,
  onOpenHomework,
  onOpenDetail,
}: MaterialChipsProps) {
  if (materials.length === 0) {
    return <p className="text-xs text-muted-foreground">материалов пока нет</p>;
  }

  const recordings = materials.filter((m) => m.kind === 'recording');
  const pdfs = materials.filter((m) => m.kind === 'pdf');
  const homework = materials.find((m) => m.kind === 'homework_ref') ?? null;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {recordings.length > 0 &&
        (recordings.length === 1 && recordings[0].url ? (
          <a
            href={recordings[0].url}
            target="_blank"
            rel="noreferrer"
            onClick={stop}
            className={cn(CHIP_BASE, CHIP_NEUTRAL)}
            style={{ touchAction: 'manipulation' }}
          >
            <Video className="h-3.5 w-3.5" /> Запись
          </a>
        ) : (
          <button
            type="button"
            onClick={(e) => {
              stop(e);
              onOpenDetail();
            }}
            className={cn(CHIP_BASE, CHIP_NEUTRAL)}
            style={{ touchAction: 'manipulation' }}
          >
            <Video className="h-3.5 w-3.5" /> Запись{recordings.length > 1 ? ` · ${recordings.length}` : ''}
          </button>
        ))}

      {pdfs.length > 0 &&
        (pdfs.length === 1 && pdfs[0].url ? (
          <a
            href={pdfs[0].url}
            target="_blank"
            rel="noreferrer"
            onClick={stop}
            className={cn(CHIP_BASE, CHIP_NEUTRAL)}
            style={{ touchAction: 'manipulation' }}
          >
            <FileText className="h-3.5 w-3.5" /> Конспект
          </a>
        ) : (
          <button
            type="button"
            onClick={(e) => {
              stop(e);
              onOpenDetail();
            }}
            className={cn(CHIP_BASE, CHIP_NEUTRAL)}
            style={{ touchAction: 'manipulation' }}
          >
            <FileText className="h-3.5 w-3.5" /> Конспект{pdfs.length > 1 ? ` · ${pdfs.length}` : ''}
          </button>
        ))}

      {homework?.assignment_id && (
        <button
          type="button"
          onClick={(e) => {
            stop(e);
            onOpenHomework(homework.assignment_id!, homework.entry_task_id ?? null);
          }}
          className={cn(CHIP_BASE, HW_REF_STATUS_CONFIG[homework.status ?? 'assigned'].className)}
          style={{ touchAction: 'manipulation' }}
        >
          <BookOpen className="h-3.5 w-3.5" /> {HW_REF_STATUS_CONFIG[homework.status ?? 'assigned'].label}
        </button>
      )}
    </div>
  );
});
