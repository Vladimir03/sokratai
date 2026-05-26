// Mock Exams v1 — heatmap dashboard (students × tasks 1–26) (TASK-10).
//
// Spec: docs/delivery/features/mock-exams-v1/spec.md §6 + AC-5.
// Mockup: SokratAI/docs/delivery/features/mock-exams-v1/mockup.html (Screen 3).
// Reference: src/components/tutor/results/HeatmapGrid.tsx (canonical pattern).
//
// Layout: 220px sticky name + 20×34px (Часть 1) + 12px spacer + 6×46px (Часть 2)
//   + 80px (Часть 1 итого) + 80px (Часть 2 итого) + 80px (Итого).
//
// КРИТИЧНО для iOS Safari (.claude/rules/80-cross-browser.md):
// - `border-separate border-spacing-0` + `<colgroup>` фиксированных ширин:
//   `border-collapse` ломает `position: sticky` на <td>/<th> в WebKit.
// - `width: max-content` + `tableLayout: 'fixed'`: иначе table-layout сжимает
//   столбцы под container и `overflow-x-auto` никогда не активируется.
// - `touch-pan-x` на wrapping <div>: row onClick может съесть touchstart на
//   iOS и заблокировать horizontal swipe.
// - `React.memo` на Row + Cell: 5×27 ≈ 135 ячеек, без memo ловится лаг.
//
// TASK-16 (2026-05-15): per-task hydration через `part1_answers` /
// `part2_solutions` массивы на каждой attempt'е. Backend handleGetAssignment
// batch-load'ит из mock_exam_attempt_part1_answers / mock_exam_attempt_part2_solutions.
// Колор-клетки 1-26 теперь реально показывают баллы (verно/частично/неверно/
// AI-черновик/пусто) после tutor approval.

import { memo, useMemo } from 'react';
import { ChevronRight, X } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  formatMockScore,
  getMockCellStyle,
  getMockTotalsStyle,
  legendChipClassName,
  MOCK_CELL_LEGEND,
  type MockCellKind,
} from './mockHeatmapStyles';
import type {
  MockExamAttemptListItem,
  MockExamAttemptStatus,
} from '@/types/mockExam';

// ─── Layout constants ────────────────────────────────────────────────────────

const PART1_KIM_NUMBERS = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
] as const;
const PART2_KIM_NUMBERS = [21, 22, 23, 24, 25, 26] as const;

const NAME_COL_WIDTH = 220;
const PART1_CELL_WIDTH = 34;
const SPACER_WIDTH = 12;
const PART2_CELL_WIDTH = 46;
const TOTALS_COL_WIDTH = 80;

/**
 * Per-KIM max score lookup для ЕГЭ физики 2026.
 * Сумма: Часть 1 = 28 баллов (kim 1-20), Часть 2 = 17 баллов (kim 21-26).
 *
 * Источник: ФИПИ 2026 «Изменения в КИМ ЕГЭ» (структура 2025 = 2026).
 * Не дублировать — для других контекстов (StudentMockExam etc.) используются
 * `task.max_score` напрямую из `mock_exam_variant_tasks`. Этот lookup нужен
 * только в heatmap, где per-task `max_score` не входит в payload роллапа.
 */
const KIM_MAX_SCORE: Record<number, number> = {
  // Часть 1 (28 баллов)
  1: 1, 2: 1, 3: 1, 4: 1, 5: 2, 6: 2, 7: 1, 8: 1, 9: 2, 10: 2,
  11: 1, 12: 1, 13: 1, 14: 2, 15: 2, 16: 1, 17: 2, 18: 2, 19: 1, 20: 1,
  // Часть 2 (17 баллов)
  21: 3, 22: 2, 23: 2, 24: 3, 25: 3, 26: 4,
};

// ─── Status helper for student name column ───────────────────────────────────

type AttemptDisplayStatus =
  | 'not_started'
  | 'in_progress'
  | 'paused' // AC-P10 (2026-05-25): multi-session pause
  | 'submitted'
  | 'awaiting_review'
  | 'approved'
  | 'manually_entered';

function deriveDisplayStatus(
  status: MockExamAttemptStatus,
  startedAt: string | null,
): AttemptDisplayStatus {
  // Backend creates mock_exam_attempts с status='in_progress' при assignment,
  // но started_at = NULL пока student не открыл /student/mock-exams/:id.
  // Реальный «в процессе» = status='in_progress' AND started_at IS NOT NULL.
  if (status === 'in_progress') {
    return startedAt === null ? 'not_started' : 'in_progress';
  }
  // AC-P10: paused ученик — отдельный chip с pause icon.
  if (status === 'paused') return 'paused';
  if (status === 'submitted' || status === 'ai_checking') return 'submitted';
  if (status === 'awaiting_review') return 'awaiting_review';
  if (status === 'approved') return 'approved';
  if (status === 'manually_entered') return 'manually_entered';
  return 'not_started';
}

const STATUS_CHIP: Record<
  AttemptDisplayStatus,
  { label: string; className: string }
> = {
  not_started: {
    label: 'Не приступал',
    className: 'bg-slate-100 text-slate-600',
  },
  in_progress: {
    label: 'В процессе',
    className: 'bg-amber-100 text-amber-900',
  },
  paused: {
    // AC-P10: visual differentiation от «В процессе» через icon в label.
    // Tutor видит ⏸ → понимает что ученик активно прервался.
    label: '⏸ На паузе',
    className: 'bg-amber-100 text-amber-900',
  },
  submitted: {
    label: 'AI проверяет',
    className: 'bg-amber-100 text-amber-900',
  },
  awaiting_review: {
    label: 'Ждёт проверки',
    className: 'bg-amber-100 text-amber-900',
  },
  approved: {
    label: 'Подтверждено',
    className: 'bg-emerald-100 text-emerald-900',
  },
  manually_entered: {
    label: 'Внесён вручную',
    className: 'bg-slate-100 text-slate-700',
  },
};

// ─── HeatmapCell ─────────────────────────────────────────────────────────────

interface HeatmapCellProps {
  kim: number;
  /** Future: per-task earned score. Phase 1 → null (rendered as cell-empty). */
  score: number | null;
  maxScore: number;
  /** Future: 'draft' | 'low-conf' for Часть 2 AI-без-tutor states. */
  forcedKind?: MockCellKind | null;
}

const HeatmapCell = memo(function HeatmapCell({
  kim,
  score,
  maxScore,
  forcedKind,
}: HeatmapCellProps) {
  const { className, text } = getMockCellStyle(score, maxScore, {
    kind: forcedKind ?? null,
  });
  return (
    <td
      className={cn(
        'h-10 px-1 text-center text-xs font-semibold tabular-nums border-b border-white',
        className,
      )}
      title={`№${kim}${maxScore > 0 ? ` · макс. ${maxScore} б.` : ''}`}
    >
      {text ?? '—'}
    </td>
  );
});

// ─── HeatmapRow ──────────────────────────────────────────────────────────────

interface HeatmapRowProps {
  attempt: MockExamAttemptListItem;
  part1Max: number;
  part2Max: number;
  totalMax: number;
  onSelect: (attempt: MockExamAttemptListItem) => void;
  /**
   * TASK-17 (2026-05-17): optional callback для удаления ученика из пробника.
   * Если передан — рендерим ✕ icon в sticky name column.
   */
  onRemoveAttempt?: (attempt: MockExamAttemptListItem) => void;
}

const HeatmapRow = memo(function HeatmapRow({
  attempt,
  part1Max,
  part2Max,
  totalMax,
  onSelect,
  onRemoveAttempt,
}: HeatmapRowProps) {
  const display = deriveDisplayStatus(attempt.status, attempt.started_at);
  const chip = STATUS_CHIP[display];

  const part1Cells = PART1_KIM_NUMBERS;
  const part2Cells = PART2_KIM_NUMBERS;

  // TASK-16: per-task hydration. Lookup map kim → earned_score / tutor_score.
  const part1Map = useMemo(() => {
    const map = new Map<number, number | null>();
    for (const row of attempt.part1_answers ?? []) {
      map.set(row.kim_number, row.earned_score);
    }
    return map;
  }, [attempt.part1_answers]);

  const part2Map = useMemo(() => {
    const map = new Map<
      number,
      { tutor_score: number | null; status: string }
    >();
    for (const row of attempt.part2_solutions ?? []) {
      map.set(row.kim_number, {
        tutor_score: row.tutor_score,
        status: row.status,
      });
    }
    return map;
  }, [attempt.part2_solutions]);

  const handleClick = () => onSelect(attempt);
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTableRowElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect(attempt);
    }
  };

  const part1Style = getMockTotalsStyle(attempt.total_part1_score, part1Max);
  const part2Style = getMockTotalsStyle(attempt.total_part2_score, part2Max);
  const totalStyle = getMockTotalsStyle(attempt.total_score, totalMax);

  const studentName = attempt.student_display_name?.trim()
    ? attempt.student_display_name
    : attempt.anonymous_id
      ? 'Анонимный лид'
      : 'Без имени';

  return (
    <tr
      className="group cursor-pointer transition-colors hover:bg-slate-50 focus-within:bg-slate-50"
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      aria-label={`${studentName} · ${chip.label}`}
    >
      {/* Sticky name column. z-10, flat bg so sticky never shows through. */}
      <td
        className={cn(
          'sticky left-0 z-10 px-3 py-2 align-middle border-b border-slate-200',
          'shadow-[4px_0_8px_-6px_rgba(15,23,42,0.12)]',
          'bg-white',
        )}
      >
        <div className="flex items-center gap-2">
          <ChevronRight
            className="h-4 w-4 text-slate-400 flex-shrink-0"
            aria-hidden="true"
          />
          <div className="min-w-0 flex-1">
            <p className="font-medium text-sm truncate">{studentName}</p>
            <span
              className={cn(
                'inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium tabular-nums mt-0.5',
                chip.className,
              )}
            >
              {chip.label}
            </span>
          </div>
          {onRemoveAttempt && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onRemoveAttempt(attempt);
              }}
              onKeyDown={(e) => e.stopPropagation()}
              className={cn(
                'flex-shrink-0 inline-flex items-center justify-center rounded',
                'min-w-8 min-h-8 touch-manipulation',
                'text-slate-400 hover:text-rose-600 hover:bg-rose-50',
                'dark:hover:text-rose-400 dark:hover:bg-rose-950/30',
                'transition-colors',
                // Always visible on mobile; hover-revealed on desktop (md+).
                'md:opacity-0 md:group-hover:opacity-100 md:focus:opacity-100',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500/50',
              )}
              aria-label={`Убрать ${studentName} из пробника`}
              title="Убрать ученика из пробника"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>
      </td>

      {/* Часть 1 — 20 cells. Per-kim earned_score из part1_answers. */}
      {part1Cells.map((kim) => {
        const max = KIM_MAX_SCORE[kim] ?? 1;
        const earnedScore = part1Map.has(kim) ? part1Map.get(kim) ?? null : null;
        return (
          <HeatmapCell
            key={`p1-${kim}`}
            kim={kim}
            score={earnedScore}
            maxScore={max}
          />
        );
      })}

      {/* Spacer between Часть 1 and Часть 2 */}
      <td className="border-b border-slate-200 bg-white" aria-hidden="true" />

      {/* Часть 2 — 6 cells (KIM 21–26). */}
      {part2Cells.map((kim) => {
        const max = KIM_MAX_SCORE[kim] ?? 2;
        const row = part2Map.get(kim);

        // Финальный балл tutor'а или AI-черновик пометка:
        // - row.tutor_score !== null → tutor подтвердил/изменил → реальный балл
        // - row.status='awaiting_review' (или submitted/ai_checking attempt) → AI-draft
        // - иначе → пусто
        let forcedKind: MockCellKind | null = null;
        let score: number | null = null;

        if (row && row.tutor_score !== null) {
          score = row.tutor_score;
        } else if (
          row?.status === 'awaiting_review' ||
          display === 'awaiting_review' ||
          display === 'submitted'
        ) {
          forcedKind = 'draft';
        }

        return (
          <HeatmapCell
            key={`p2-${kim}`}
            kim={kim}
            score={score}
            maxScore={max}
            forcedKind={forcedKind}
          />
        );
      })}

      {/* Часть 1 итого */}
      <td
        className={cn(
          'border-b border-slate-200 px-3 py-2 align-middle text-right text-sm tabular-nums',
          part1Style.className,
        )}
      >
        {attempt.total_part1_score !== null
          ? `${formatMockScore(attempt.total_part1_score)}/${formatMockScore(part1Max)}`
          : '—'}
      </td>

      {/* Часть 2 итого */}
      <td
        className={cn(
          'border-b border-slate-200 px-3 py-2 align-middle text-right text-sm tabular-nums',
          part2Style.className,
        )}
      >
        {attempt.total_part2_score !== null
          ? `${formatMockScore(attempt.total_part2_score)}/${formatMockScore(part2Max)}`
          : '—'}
      </td>

      {/* Итого (border-l-2 для визуального отделения) */}
      <td
        className={cn(
          'border-b border-l-2 border-slate-200 px-3 py-2 align-middle text-right text-sm tabular-nums',
          totalStyle.className,
        )}
      >
        {attempt.total_score !== null
          ? `${formatMockScore(attempt.total_score)}/${formatMockScore(totalMax)}`
          : '—'}
      </td>
    </tr>
  );
});

// ─── MockExamHeatmap ─────────────────────────────────────────────────────────

interface MockExamHeatmapProps {
  attempts: MockExamAttemptListItem[];
  part1Max: number;
  part2Max: number;
  totalMax: number;
  /**
   * Click row → drill-down. Caller обычно делает navigate
   * `/tutor/mock-exams/:id/review/:studentId`.
   */
  onSelectAttempt: (attempt: MockExamAttemptListItem) => void;
  /**
   * TASK-17 (2026-05-17): optional — если передан, рендерим ✕ icon
   * в sticky name column для удаления ученика из пробника.
   */
  onRemoveAttempt?: (attempt: MockExamAttemptListItem) => void;
}

export function MockExamHeatmap({
  attempts,
  part1Max,
  part2Max,
  totalMax,
  onSelectAttempt,
  onRemoveAttempt,
}: MockExamHeatmapProps) {
  const sortedAttempts = useMemo(() => {
    // Order: in-progress first (нужно действие), then awaiting_review,
    // then approved, then manually_entered, then not_started.
    const priority: Record<AttemptDisplayStatus, number> = {
      awaiting_review: 0,
      submitted: 1,
      in_progress: 2,
      approved: 3,
      manually_entered: 4,
      not_started: 5,
    };
    return [...attempts].sort((a, b) => {
      const pa = priority[deriveDisplayStatus(a.status, a.started_at)];
      const pb = priority[deriveDisplayStatus(b.status, b.started_at)];
      if (pa !== pb) return pa - pb;
      return (a.student_display_name ?? '').localeCompare(
        b.student_display_name ?? '',
        'ru',
      );
    });
  }, [attempts]);

  if (attempts.length === 0) {
    return (
      <Card animate={false} className="bg-muted/30">
        <CardContent className="py-8 text-center">
          <p className="text-muted-foreground">Ученики ещё не назначены</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card animate={false}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <CardTitle className="text-lg flex items-center gap-2">
            Результаты по ученикам
            <Badge variant="outline" className="font-medium tabular-nums">
              {attempts.length} × 26
            </Badge>
          </CardTitle>
          {/* Legend chips — same colors as cells. Wraps on narrow screens. */}
          <div className="flex items-center gap-3 text-xs text-slate-500 flex-wrap">
            {MOCK_CELL_LEGEND.map((item) => (
              <span
                key={item.kind}
                className="flex items-center gap-1.5"
                title={item.label}
              >
                <span
                  className={cn(
                    'w-3 h-3 rounded',
                    legendChipClassName(item.kind),
                  )}
                  aria-hidden="true"
                />
                {item.label}
              </span>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {/* `touch-pan-x` allows native horizontal swipe on iOS Safari even
            when row has onClick — without it touchstart can be swallowed. */}
        <div className="overflow-x-auto touch-pan-x">
          <table
            className="border-separate border-spacing-0"
            style={{ tableLayout: 'fixed', width: 'max-content' }}
          >
            <colgroup>
              <col style={{ width: `${NAME_COL_WIDTH}px` }} />
              {PART1_KIM_NUMBERS.map((kim) => (
                <col key={`p1-${kim}`} style={{ width: `${PART1_CELL_WIDTH}px` }} />
              ))}
              <col style={{ width: `${SPACER_WIDTH}px` }} />
              {PART2_KIM_NUMBERS.map((kim) => (
                <col key={`p2-${kim}`} style={{ width: `${PART2_CELL_WIDTH}px` }} />
              ))}
              <col style={{ width: `${TOTALS_COL_WIDTH}px` }} />
              <col style={{ width: `${TOTALS_COL_WIDTH}px` }} />
              <col style={{ width: `${TOTALS_COL_WIDTH}px` }} />
            </colgroup>
            <thead>
              {/* Row 1: Часть 1 / Часть 2 / Итого section labels. */}
              <tr>
                <th
                  scope="col"
                  rowSpan={2}
                  className="sticky left-0 z-20 bg-white border-b border-slate-200 text-left px-3 py-2 text-[11px] font-semibold text-slate-600 uppercase tracking-wider align-bottom shadow-[4px_0_8px_-6px_rgba(15,23,42,0.12)]"
                >
                  Ученик
                </th>
                <th
                  scope="colgroup"
                  colSpan={PART1_KIM_NUMBERS.length}
                  className="bg-slate-50 border-b border-slate-200 px-2 py-1.5 text-center text-[11px] font-semibold text-slate-600 uppercase tracking-wider"
                >
                  Часть 1 (1–20) · авто
                </th>
                <th className="bg-white border-b border-slate-200" aria-hidden="true" />
                <th
                  scope="colgroup"
                  colSpan={PART2_KIM_NUMBERS.length}
                  className="bg-slate-50 border-b border-slate-200 px-2 py-1.5 text-center text-[11px] font-semibold text-slate-600 uppercase tracking-wider"
                >
                  Часть 2 (21–26) · AI-черновик
                </th>
                <th
                  scope="col"
                  rowSpan={2}
                  className="border-b border-slate-200 px-3 py-2 text-right text-[11px] font-semibold text-slate-600 uppercase tracking-wider align-bottom"
                >
                  Часть 1
                </th>
                <th
                  scope="col"
                  rowSpan={2}
                  className="border-b border-slate-200 px-3 py-2 text-right text-[11px] font-semibold text-slate-600 uppercase tracking-wider align-bottom"
                >
                  Часть 2
                </th>
                <th
                  scope="col"
                  rowSpan={2}
                  className="border-b border-l-2 border-slate-200 px-3 py-2 text-right text-[11px] font-semibold text-slate-600 uppercase tracking-wider align-bottom"
                >
                  Итого
                </th>
              </tr>
              {/* Row 2: KIM numbers. */}
              <tr>
                {PART1_KIM_NUMBERS.map((kim) => (
                  <th
                    key={`h-p1-${kim}`}
                    scope="col"
                    className="border-b border-slate-200 text-center py-1 text-[10px] font-medium tabular-nums text-slate-400"
                  >
                    {kim}
                  </th>
                ))}
                <th className="bg-white border-b border-slate-200" aria-hidden="true" />
                {PART2_KIM_NUMBERS.map((kim) => (
                  <th
                    key={`h-p2-${kim}`}
                    scope="col"
                    className="border-b border-slate-200 text-center py-1 text-[10px] font-medium tabular-nums text-slate-400"
                  >
                    {kim}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedAttempts.map((attempt) => (
                <HeatmapRow
                  key={attempt.id}
                  attempt={attempt}
                  part1Max={part1Max}
                  part2Max={part2Max}
                  totalMax={totalMax}
                  onSelect={onSelectAttempt}
                  onRemoveAttempt={onRemoveAttempt}
                />
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
