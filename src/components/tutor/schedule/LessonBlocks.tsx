import { memo, forwardRef, useImperativeHandle, useState } from 'react';
import { format, addMinutes } from 'date-fns';
import { Ban } from 'lucide-react';
import { cn } from '@/lib/utils';
import { calculateLessonPaymentAmount } from '@/lib/paymentAmount';
import type { TutorCalendarEvent, TutorLessonWithStudent } from '@/types/tutor';
import { getLessonTypeColor, getLessonTypeStripeColor, normalizeEntityColor } from './scheduleColors';

// =============================================
// Блоки ячеек календаря расписания (извлечены из TutorSchedule.tsx, Волна 1).
// Все блоки — React.memo с data-first колбэками (performance.md): страница
// передаёт СТАБИЛЬНЫЕ useCallback-хендлеры, а не инлайн-стрелки, иначе memo мёртв.
// =============================================

export const PIXELS_PER_MINUTE = 1;
export const HOUR_HEIGHT = 60;

export function getLessonStudentName(lesson: TutorLessonWithStudent): string {
  return lesson.tutor_students?.profiles?.username
    || lesson.profiles?.username
    // Занятие без ученика (Волна 1): подписываем темой/предметом, а не «Ученик».
    || lesson.topic
    || lesson.subject
    || 'Без ученика';
}

export interface GroupLessonStatusCounts {
  booked: number;
  completed: number;
  cancelled: number;
}

export interface GroupLessonBucket {
  key: string;
  groupSessionId: string | null;
  groupId: string | null;
  groupSourceTutorGroupId: string | null;
  groupTitleSnapshot: string | null;
  groupSizeSnapshot: number | null;
  isLegacyFallback: boolean;
  groupName: string;
  startAt: string;
  durationMin: number;
  lessons: TutorLessonWithStudent[];
  memberNames: string[];
  statusCounts: GroupLessonStatusCounts;
}

export type DayLessonRenderItem =
  | { kind: 'single'; lesson: TutorLessonWithStudent }
  | { kind: 'group'; bucket: GroupLessonBucket };

/** Мини-бейджи «МЗ» (материалы занятия) / «ДЗ» (прикреплённое домашнее задание). */
function MaterialBadges({ hasMaterials, hasHomework }: { hasMaterials?: boolean; hasHomework?: boolean }) {
  if (!hasMaterials && !hasHomework) return null;
  return (
    <span className="flex items-center gap-0.5 shrink-0">
      {hasMaterials && (
        <span className="text-[9px] font-semibold leading-none bg-white/25 rounded px-0.5 py-px">МЗ</span>
      )}
      {hasHomework && (
        <span className="text-[9px] font-semibold leading-none bg-white/25 rounded px-0.5 py-px">ДЗ</span>
      )}
    </span>
  );
}

/** Полоска-индикатор типа занятия слева (видна, когда фон ячейки = цвет группы/ученика). */
function TypeStripe({ lessonType }: { lessonType: string }) {
  return (
    <div
      className={cn(
        'absolute left-0 top-0 bottom-0 w-1 rounded-l-md pointer-events-none',
        getLessonTypeStripeColor(lessonType),
      )}
    />
  );
}

// =============================================
// LessonBlock — индивидуальное занятие
// =============================================

export interface LessonBlockProps {
  lesson: TutorLessonWithStudent;
  workDayStart: number;
  /** Цвет ученика (#RRGGBB) — фон ячейки; null → фон по типу занятия (как раньше). */
  customColor?: string | null;
  hasMaterials?: boolean;
  hasHomework?: boolean;
  onClick: (lesson: TutorLessonWithStudent) => void;
  onDragStart: (lessonId: string, durationMin: number, event: React.DragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
}

export const LessonBlock = memo(function LessonBlock({
  lesson,
  workDayStart,
  customColor,
  hasMaterials,
  hasHomework,
  onClick,
  onDragStart,
  onDragEnd,
}: LessonBlockProps) {
  const startDate = new Date(lesson.start_at);
  const startMinutes = startDate.getHours() * 60 + startDate.getMinutes();
  const offsetMinutes = startMinutes - (workDayStart * 60);

  const top = offsetMinutes * PIXELS_PER_MINUTE;
  const height = Math.max(lesson.duration_min * PIXELS_PER_MINUTE, 20);

  const studentName = getLessonStudentName(lesson);

  const endDate = addMinutes(startDate, lesson.duration_min);
  const timeStr = `${format(startDate, 'HH:mm')} - ${format(endDate, 'HH:mm')}`;

  const lessonType = lesson.lesson_type || 'regular';
  const entityColor = normalizeEntityColor(customColor);
  const hourlyRateCents = lesson.tutor_students?.hourly_rate_cents;

  const isPast = endDate.getTime() < Date.now();
  const isCancelled = lesson.status === 'cancelled';
  // Phase 2b: деньги решает ЦЕНА, не статус. Эффективная стоимость = override ∥ ставка×длительность.
  const effectiveCost = lesson.payment_amount ?? calculateLessonPaymentAmount(lesson.duration_min, hourlyRateCents);

  // Visual state classes (без платёжной окраски — только отменённое приглушаем).
  const statusClasses = cn(isCancelled && 'opacity-40 grayscale');

  // Волна 2: прошедшие booked-занятия ТОЖЕ таскаются — перенос идёт через money-aware
  // RPC tutor_move_lesson (реверс/пересоздание debit), висящих списаний больше нет.
  // completed/cancelled не таскаются (ручной статус / приглушено).
  const isDraggable = lesson.status === 'booked';

  return (
    <div
      className={cn(
        'absolute left-0.5 right-0.5 text-white rounded-md px-1.5 py-0.5 cursor-pointer hover:opacity-90 transition-opacity overflow-hidden shadow-sm',
        entityColor ? 'pl-2.5' : getLessonTypeColor(lessonType),
        statusClasses,
      )}
      style={{
        top: `${top}px`,
        height: `${height}px`,
        minHeight: '20px',
        ...(entityColor ? { backgroundColor: entityColor } : null),
      }}
      draggable={isDraggable}
      onDragStart={isDraggable ? (e) => onDragStart(lesson.id, lesson.duration_min, e) : undefined}
      onDragEnd={isDraggable ? onDragEnd : undefined}
      onClick={(e) => { e.stopPropagation(); onClick(lesson); }}
    >
      {entityColor && <TypeStripe lessonType={lessonType} />}
      <div className="flex flex-col h-full justify-center">
        <span className="flex items-center gap-1 min-w-0">
          <span className={cn(
            'text-xs font-medium truncate leading-tight',
            isCancelled && 'line-through opacity-70',
          )}>
            {studentName}
          </span>
          <MaterialBadges hasMaterials={hasMaterials} hasHomework={hasHomework} />
        </span>
        {height >= 35 && (
          <span className="text-[10px] opacity-80 truncate leading-tight">{timeStr}</span>
        )}

        {/* Тема урока — навигация «глянул и понял, что проходим» (Волна 1) */}
        {height >= 50 && lesson.topic && (
          <span className="text-[10px] opacity-90 truncate leading-tight">{lesson.topic}</span>
        )}

        {/* Phase 2b: прошедшее → списанная стоимость (решает цена, не статус); будущее → ставка/предмет */}
        {height >= 35 && (isPast || isCancelled) && (
          <span className="text-[10px] leading-tight mt-0.5 truncate">
            {isCancelled
              ? (isPast && effectiveCost && effectiveCost > 0 ? `Отменено · −${effectiveCost} ₽` : 'Отменено')
              : (effectiveCost === 0 ? 'Бесплатно' : effectiveCost ? `−${effectiveCost} ₽` : 'Проведено')}
          </span>
        )}

        {/* Будущее занятие — ставка/предмет */}
        {!isPast && !isCancelled && (
          <>
            {height >= 50 && hourlyRateCents != null && (
              <span className="text-[10px] opacity-90 truncate font-semibold leading-tight">{hourlyRateCents / 100} ₽/ч</span>
            )}
            {height >= 50 && lesson.subject && (
              <span className="text-[10px] opacity-70 truncate leading-tight">{lesson.subject}</span>
            )}
          </>
        )}
      </div>
    </div>
  );
});

// =============================================
// CalendarEventBlock — личное дело (busy block) на сетке
// =============================================

export interface CalendarEventBlockProps {
  event: TutorCalendarEvent;
  workDayStart: number;
  onClick: (event: TutorCalendarEvent) => void;
  onDragStart: (eventId: string, durationMin: number, event: React.DragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
}

export const CalendarEventBlock = memo(function CalendarEventBlock({
  event,
  workDayStart,
  onClick,
  onDragStart,
  onDragEnd,
}: CalendarEventBlockProps) {
  const startDate = new Date(event.start_at);
  const startMinutes = startDate.getHours() * 60 + startDate.getMinutes();
  const offsetMinutes = startMinutes - (workDayStart * 60);
  const top = offsetMinutes * PIXELS_PER_MINUTE;
  const height = Math.max(event.duration_min * PIXELS_PER_MINUTE, 20);
  const endDate = addMinutes(startDate, event.duration_min);
  const timeStr = `${format(startDate, 'HH:mm')} - ${format(endDate, 'HH:mm')}`;

  return (
    <div
      // z-0: под занятиями (наложение лесона на дело = разрешённое мягкое предупреждение).
      className="absolute left-0.5 right-0.5 z-0 rounded-md px-1.5 py-0.5 cursor-pointer overflow-hidden border border-dashed border-slate-400 bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors"
      style={{
        top: `${top}px`,
        height: `${height}px`,
        minHeight: '20px',
        backgroundImage:
          'repeating-linear-gradient(45deg, transparent, transparent 6px, rgba(100,116,139,0.12) 6px, rgba(100,116,139,0.12) 12px)',
        touchAction: 'manipulation',
      }}
      draggable
      onDragStart={(e) => onDragStart(event.id, event.duration_min, e)}
      onDragEnd={onDragEnd}
      onClick={(e) => { e.stopPropagation(); onClick(event); }}
    >
      <div className="flex flex-col h-full justify-center">
        <span className="flex items-center gap-1 text-xs font-medium truncate leading-tight">
          <Ban className="h-3 w-3 shrink-0 opacity-70" />
          {/* notes НЕ показываем на блоке (приватно) — только в диалоге */}
          {event.title}
        </span>
        {height >= 35 && (
          <span className="text-[10px] opacity-80 truncate leading-tight">{timeStr}</span>
        )}
      </div>
    </div>
  );
});

// =============================================
// GroupLessonBlock — групповое занятие (bucket)
// =============================================

export interface GroupLessonBlockProps {
  bucket: GroupLessonBucket;
  workDayStart: number;
  /** Цвет группы (#RRGGBB) — фон ячейки; null → фон по типу занятия. */
  customColor?: string | null;
  hasMaterials?: boolean;
  hasHomework?: boolean;
  onClick: (bucket: GroupLessonBucket) => void;
  onDragStart?: (lessonId: string, durationMin: number, event: React.DragEvent<HTMLDivElement>) => void;
  onDragEnd?: () => void;
}

export const GroupLessonBlock = memo(function GroupLessonBlock({
  bucket,
  workDayStart,
  customColor,
  hasMaterials,
  hasHomework,
  onClick,
  onDragStart,
  onDragEnd,
}: GroupLessonBlockProps) {
  // Draggable only for a unified group (single tutor_lessons row + group_session_id)
  // that is still booked — moving that one row carries all participants. Legacy
  // multi-row groups stay click-only (would need N row moves).
  const isDraggable = !bucket.isLegacyFallback
    && !!bucket.groupSessionId
    && bucket.lessons.length === 1
    // Волна 2: прошедшая booked-группа тоже таскается — перенос через tutor_move_lesson
    // (реверс/пересоздание debit ПО КАЖДОМУ участнику под advisory-lock).
    && bucket.lessons[0].status === 'booked';
  const startDate = new Date(bucket.startAt);
  const startMinutes = startDate.getHours() * 60 + startDate.getMinutes();
  const offsetMinutes = startMinutes - (workDayStart * 60);
  const top = offsetMinutes * PIXELS_PER_MINUTE;
  const height = Math.max(bucket.durationMin * PIXELS_PER_MINUTE, 20);
  const endDate = addMinutes(startDate, bucket.durationMin);
  const timeStr = `${format(startDate, 'HH:mm')} - ${format(endDate, 'HH:mm')}`;

  const firstLesson = bucket.lessons[0];
  const lessonType = firstLesson?.lesson_type || 'regular';
  const entityColor = normalizeEntityColor(customColor);

  const isAllCompleted = bucket.statusCounts.completed === bucket.lessons.length;
  const isAllCancelled = bucket.statusCounts.cancelled === bucket.lessons.length;
  const isMixedStatuses = !isAllCompleted && !isAllCancelled && (
    bucket.statusCounts.completed > 0 || bucket.statusCounts.cancelled > 0
  );

  // Phase 2b: «требует действия» (amber ring для прошедших booked) убран — авто-debit списывает по стоимости.
  const statusClasses = cn(
    isAllCompleted && 'opacity-70',
    isAllCancelled && 'opacity-40 grayscale',
  );

  const statusLabel = isAllCompleted
    ? 'Все проведены'
    : isAllCancelled
      ? 'Все отменены'
      : isMixedStatuses
        ? 'Смешанные статусы'
        : 'Запланировано';

  return (
    <div
      className={cn(
        'absolute left-0.5 right-0.5 text-white rounded-md px-1.5 py-0.5 cursor-pointer hover:opacity-90 transition-opacity overflow-hidden shadow-sm',
        entityColor ? 'pl-2.5' : getLessonTypeColor(lessonType),
        statusClasses,
      )}
      style={{
        top: `${top}px`,
        height: `${height}px`,
        minHeight: '20px',
        ...(entityColor ? { backgroundColor: entityColor } : null),
      }}
      draggable={isDraggable}
      onDragStart={isDraggable && onDragStart
        ? (e) => onDragStart(bucket.lessons[0].id, bucket.durationMin, e)
        : undefined}
      onDragEnd={isDraggable ? onDragEnd : undefined}
      onClick={(e) => {
        e.stopPropagation();
        onClick(bucket);
      }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick(bucket);
        }
      }}
    >
      {entityColor && <TypeStripe lessonType={lessonType} />}
      <div className="flex flex-col h-full justify-center">
        <span className="flex items-center gap-1 min-w-0">
          <span className={cn(
            'text-xs font-medium truncate leading-tight',
            isAllCancelled && 'line-through opacity-70',
          )}>
            {bucket.groupName} • {bucket.groupSizeSnapshot ?? bucket.lessons.length}
          </span>
          <MaterialBadges hasMaterials={hasMaterials} hasHomework={hasHomework} />
        </span>
        {height >= 35 && (
          <span className="text-[10px] opacity-80 truncate leading-tight">{timeStr}</span>
        )}
        {height >= 50 && firstLesson?.topic && (
          <span className="text-[10px] opacity-90 truncate leading-tight">{firstLesson.topic}</span>
        )}
        {height >= 35 && (
          <span className="text-[10px] leading-tight mt-0.5 truncate">
            {statusLabel}{bucket.isLegacyFallback ? ' • legacy' : ''}
          </span>
        )}
      </div>
    </div>
  );
});

// =============================================
// DragPreviewLayer — превью перетаскивания СВОИМ стейтом (через ref),
// чтобы dragover не ререндерил страницу-монолит (performance.md).
// Абсолютный оверлей над grid-обёрткой (.relative): колонка dayIndex занимает
// 1/8 ширины со смещением (dayIndex+1)/8 (первая колонка — время).
// =============================================

interface DragPreviewState {
  dayIndex: number;
  topPx: number;
  durationMin: number;
}

export interface DragPreviewHandle {
  set(preview: DragPreviewState): void;
  clear(): void;
}

export const DragPreviewLayer = forwardRef<DragPreviewHandle>(function DragPreviewLayer(_props, ref) {
  const [preview, setPreview] = useState<DragPreviewState | null>(null);

  useImperativeHandle(ref, () => ({
    set: (next: DragPreviewState) => {
      setPreview(prev => (
        prev
        && prev.dayIndex === next.dayIndex
        && prev.topPx === next.topPx
        && prev.durationMin === next.durationMin
          ? prev
          : next
      ));
    },
    clear: () => setPreview(null),
  }), []);

  if (!preview) return null;

  return (
    <div
      className="absolute inset-y-0 pointer-events-none"
      style={{ left: `${(preview.dayIndex + 1) * 12.5}%`, width: '12.5%' }}
    >
      <div
        className="absolute left-0.5 right-0.5 rounded-md border border-primary/40 bg-primary/15 z-20"
        style={{
          top: `${preview.topPx}px`,
          height: `${Math.max(4, preview.durationMin * PIXELS_PER_MINUTE)}px`,
        }}
      />
      <div className="absolute left-0 right-0 h-0.5 bg-primary z-30" style={{ top: `${preview.topPx}px` }} />
    </div>
  );
});
