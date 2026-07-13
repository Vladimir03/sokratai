// Карточка ДЗ — вынесена из TutorHomework.tsx для переиспользования на странице
// папки (HomeworkFolderPage). Запрос Елены (2026-06-17). Memoised list-item
// (rule performance.md). `animate={false}` (rule 10). transition-shadow (design).
//
// Доп. (2026-06-17): опц. меню «···» «Переместить в папку» (rule 90 — kebab, не drag).
import { memo } from 'react';
import { Link } from 'react-router-dom';
import {
  getDeadlineUrgency,
  URGENCY_CONFIG,
  formatDeadline,
} from '@/lib/homeworkDeadline';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { Users, BarChart3, Clock, CheckCircle2, WifiOff, MoreVertical, FolderInput, BadgeCheck, ClipboardCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getSubjectLabel } from '@/types/homework';
import { HOMEWORK_STATUS_CONFIG, formatHomeworkScore } from '@/lib/homeworkStatus';
import type { TutorHomeworkAssignmentListItem } from '@/lib/tutorHomeworkApi';
import { getGroupBadgeStyle } from './homeworkListShared';

interface AssignmentCardProps {
  item: TutorHomeworkAssignmentListItem;
  /** Если задан — показать меню «···» с действием «Переместить в папку». */
  onMoveToFolder?: (item: TutorHomeworkAssignmentListItem) => void;
}

export const AssignmentCard = memo(function AssignmentCard({ item, onMoveToFolder }: AssignmentCardProps) {
  const statusCfg = HOMEWORK_STATUS_CONFIG[item.status];
  const deadlineStr = formatDeadline(item.deadline);
  const subjectLabel = getSubjectLabel(item.subject as unknown as string);
  const showGroupBadge = Boolean(item.source_group_id && item.source_group_name);
  const groupBadgeStyle = getGroupBadgeStyle(item.source_group_color);

  return (
    <Link to={`/tutor/homework/${item.id}`} className="block">
      <Card
        animate={false}
        className="cursor-pointer hover:shadow-md hover:border-slate-300 transition-[box-shadow,border-color] duration-200 ease-out"
      >
        <CardContent className="p-4 space-y-3">
          {/* Header: subject (eyebrow) + status + optional kebab */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {subjectLabel}
              </span>
              {showGroupBadge && (
                <Badge
                  variant="outline"
                  className={cn(
                    'gap-1 border text-[11px] font-medium',
                    groupBadgeStyle ? 'bg-transparent' : 'border-slate-200 bg-slate-50 text-slate-600',
                  )}
                  style={groupBadgeStyle}
                >
                  <Users className="h-3 w-3" aria-hidden="true" />
                  {`Группа ${item.source_group_name}`}
                </Badge>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Badge variant="outline" className={statusCfg.className}>
                {statusCfg.label}
              </Badge>
              {onMoveToFolder && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      aria-label="Действия с ДЗ"
                      // Внутри <Link> — preventDefault, чтобы клик по меню не навигировал.
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
                      className="rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
                      style={{ touchAction: 'manipulation' }}
                    >
                      <MoreVertical className="h-4 w-4" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}>
                    <DropdownMenuItem
                      onSelect={() => {
                        // НЕ preventDefault: пусть Radix-меню закроется штатно.
                        // Иначе меню (modal) держит pointer-events:none на body,
                        // и первый тап по модалке переноса съедается закрытием
                        // меню → «выбор папки только со 2-го клика» (баг Елены
                        // 2026-07-13). rAF: открыть модалку после закрытия меню.
                        requestAnimationFrame(() => onMoveToFolder(item));
                      }}
                    >
                      <FolderInput className="mr-2 h-4 w-4" />
                      Переместить в папку
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </div>

          {/* Title */}
          <h3 className="font-semibold text-base tracking-tight leading-snug line-clamp-2">
            {item.title}
          </h3>

          {/* Topic */}
          {item.topic && (
            <p className="text-sm text-muted-foreground line-clamp-1">{item.topic}</p>
          )}

          {/* Stats row */}
          <div className="flex items-center gap-3 text-sm text-muted-foreground tabular-nums pt-2 flex-wrap">
            <Tooltip delayDuration={150}>
              <TooltipTrigger asChild>
                <span
                  className="flex items-center gap-1"
                  title={
                    typeof item.started_count === 'number'
                      ? `Сдали ${item.submitted_count}, приступили ${item.started_count}, всего ${item.assigned_count}`
                      : `Сдали ${item.submitted_count} из ${item.assigned_count}`
                  }
                  aria-label={`Сдали ${item.submitted_count}${
                    typeof item.started_count === 'number' ? `, приступили ${item.started_count}` : ''
                  }, всего ${item.assigned_count}`}
                >
                  <Users className="h-3.5 w-3.5" aria-hidden="true" />
                  {item.submitted_count}
                  {typeof item.started_count === 'number' && item.started_count > item.submitted_count && (
                    <span className="text-muted-foreground/70">({item.started_count})</span>
                  )}
                  /{item.assigned_count}
                </span>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-[240px]">
                <ul className="space-y-0.5 text-xs leading-relaxed">
                  <li><span className="font-semibold">{item.submitted_count}</span> — сдали ДЗ</li>
                  {typeof item.started_count === 'number' && (
                    <li><span className="font-semibold">({item.started_count})</span> — приступили к ДЗ</li>
                  )}
                  <li><span className="font-semibold">{item.assigned_count}</span> — всего учеников</li>
                </ul>
              </TooltipContent>
            </Tooltip>

            {/* Отметка проверки (запрос Елены 2026-06-18): «✓ Проверено», когда все
                сдавшие подтверждены; «N на проверку» — пока есть неподтверждённые. */}
            {typeof item.review_pending_count === 'number' && item.submitted_count > 0 && (
              item.review_pending_count === 0 ? (
                <span
                  className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700"
                  title="Все сданные работы проверены"
                  aria-label="Все сданные работы проверены"
                >
                  <BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" /> Проверено
                </span>
              ) : (
                <span
                  className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700"
                  title={`${item.review_pending_count} работ ждут вашей проверки`}
                  aria-label={`${item.review_pending_count} на проверку`}
                >
                  <ClipboardCheck className="h-3.5 w-3.5" aria-hidden="true" />
                  {item.review_pending_count} на проверку
                </span>
              )
            )}

            {(item.delivered_count ?? 0) > 0 && (
              <span
                className="flex items-center gap-1 text-green-600"
                title="Доставлено"
                aria-label={`Доставлено ${item.delivered_count}`}
              >
                <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                {item.delivered_count}
              </span>
            )}

            {(item.not_connected_count ?? 0) > 0 && (
              <span
                className="flex items-center gap-1 text-amber-500"
                title="Нет каналов доставки"
                aria-label={`Нет каналов доставки: ${item.not_connected_count}`}
              >
                <WifiOff className="h-3.5 w-3.5" aria-hidden="true" />
                {item.not_connected_count}
              </span>
            )}

            <span
              className="flex items-center gap-1"
              title="Средний балл"
              aria-label={`Средний балл: ${formatHomeworkScore(item.avg_score, item.max_score_total)}`}
            >
              <BarChart3 className="h-3.5 w-3.5" aria-hidden="true" />
              {formatHomeworkScore(item.avg_score, item.max_score_total)}
            </span>

            {deadlineStr && (() => {
              const urgency = getDeadlineUrgency(item.deadline);
              const cfg = URGENCY_CONFIG[urgency];
              const fullText = cfg.label ? `${cfg.label} · ${deadlineStr}` : deadlineStr;
              return (
                <span
                  className={cn('flex items-center gap-1 ml-auto', cfg.className)}
                  title="Дедлайн"
                  aria-label={`Дедлайн: ${fullText}`}
                >
                  <Clock className={cn('h-3.5 w-3.5', cfg.iconClassName)} aria-hidden="true" />
                  {fullText}
                </span>
              );
            })()}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
});
