import { memo, useMemo, type KeyboardEvent } from 'react';
import { ChevronRight, UserPlus, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Sparkline,
  WeeklyStrip,
  type WeeklyCell,
} from '@/components/tutor/home/primitives';
import type { StudentActivity } from '@/hooks/useTutorStudentActivity';
import {
  pluralize,
  PLURAL_STUDENTS,
} from '@/lib/ru/pluralize';

export interface StudentsActivityBlockProps {
  items: StudentActivity[];
  totalCount: number;
  onOpenStudent: (id: string) => void;
  onOpenAll: () => void;
  onAddStudent?: () => void;
}

const CELL_LEGEND_COLOR: Record<Exclude<WeeklyCell, 'part' | 'none'>, string> = {
  ok: 'var(--sokrat-state-success-fg)',
  late: 'var(--sokrat-state-warning-fg)',
  miss: 'var(--sokrat-state-danger-fg)',
};

function formatDecimalRu(value: number, fractionDigits = 1): string {
  return new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value);
}

function sparklineStroke(delta: number): string {
  if (delta > 0) return 'var(--sokrat-state-success-fg)';
  if (delta < 0) return 'var(--sokrat-state-danger-fg)';
  return 'var(--sokrat-fg2)';
}

interface RowProps {
  student: StudentActivity;
  onOpen: (id: string) => void;
}

const ActivityRow = memo(function ActivityRow({ student, onOpen }: RowProps) {
  const chipClass =
    student.stream === 'ЕГЭ' ? 't-chip t-chip--ege' : 't-chip t-chip--oge';

  const handleKeyDown = (event: KeyboardEvent<HTMLTableRowElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onOpen(student.id);
    }
  };

  return (
    <tr
      onClick={() => onOpen(student.id)}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
      aria-label={`Открыть статистику ${student.name}`}
      style={{ cursor: 'pointer', touchAction: 'manipulation' }}
    >
      <td className="is-primary">
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          {student.attention ? (
            <span
              title={student.attentionReason ?? 'Требует внимания'}
              aria-label={student.attentionReason ?? 'Требует внимания'}
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: 'var(--sokrat-state-warning-fg)',
                flex: 'none',
                display: 'inline-block',
              }}
            />
          ) : (
            <span style={{ width: 6, height: 6, flex: 'none' }} aria-hidden="true" />
          )}
          <span>{student.name}</span>
          <span className={chipClass}>{student.stream}</span>
        </span>
      </td>
      <td>
        <WeeklyStrip cells={student.weekly} />
      </td>
      <td className="is-num">
        {student.hwAvg != null ? formatDecimalRu(student.hwAvg) : '—'}
      </td>
      <td style={{ padding: '0 12px' }}>
        {student.hwTrend && student.hwTrend.length > 1 ? (
          <Sparkline
            values={student.hwTrend}
            stroke={sparklineStroke(student.hwAvgDelta)}
            ariaLabel={`Тренд ${student.name}`}
          />
        ) : (
          <span className="t-muted" style={{ fontSize: 12 }}>
            —
          </span>
        )}
      </td>
      <td className="is-num">
        <span className="t-muted">—</span>
      </td>
      <td style={{ fontSize: 12 }}>
        {student.attention && student.attentionReason ? (
          <span
            style={{
              color: 'var(--sokrat-state-warning-fg)',
              fontWeight: 600,
            }}
          >
            {student.attentionReason}
          </span>
        ) : (
          <span className="t-muted">всё хорошо</span>
        )}
      </td>
      <td className="is-actions">
        <div className="row-actions">
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Открыть статистику ${student.name}`}
            onClick={(event) => {
              event.stopPropagation();
              onOpen(student.id);
            }}
            style={{
              minHeight: 40,
              minWidth: 40,
              touchAction: 'manipulation',
            }}
          >
            <ChevronRight aria-hidden="true" />
          </Button>
        </div>
      </td>
    </tr>
  );
});

function StudentsActivityBlockImpl({
  items,
  totalCount,
  onOpenStudent,
  onOpenAll,
  onAddStudent,
}: StudentsActivityBlockProps) {
  const sorted = useMemo(() => {
    const clone = items.slice();
    clone.sort((a, b) => {
      // attention desc: true first
      const aAttention = a.attention ? 0 : 1;
      const bAttention = b.attention ? 0 : 1;
      if (aAttention !== bAttention) return aAttention - bAttention;
      // hwAvgDelta desc: higher delta first (healthier first among non-attention;
      // among attention students we still surface stabilizing ones first).
      const deltaDiff = (b.hwAvgDelta ?? 0) - (a.hwAvgDelta ?? 0);
      if (deltaDiff !== 0) return deltaDiff;
      // name asc (ru)
      return a.name.localeCompare(b.name, 'ru');
    });
    return clone;
  }, [items]);

  const metaLabel = `за 5 недель · ${totalCount} ${pluralize(totalCount, PLURAL_STUDENTS)}`;

  if (items.length === 0) {
    return (
      <section className="t-section">
        <div className="t-section__header">
          <h2>Активность учеников</h2>
          <span className="t-section__meta">{metaLabel}</span>
        </div>
        <hr className="t-divider" />
        <div className="t-empty" style={{ padding: '48px 24px' }}>
          <Users
            size={28}
            aria-hidden="true"
            style={{ color: 'var(--sokrat-fg3)' }}
          />
          <div className="t-empty__title">Пока нет учеников</div>
          <div className="t-empty__body">
            Добавьте первого ученика, и здесь появится недельная активность.
          </div>
          {onAddStudent && (
            <div className="t-empty__cta">
              <Button
                size="default"
                onClick={onAddStudent}
                className="text-white"
                style={{
                  background: 'var(--sokrat-green-700)',
                  touchAction: 'manipulation',
                }}
              >
                <UserPlus aria-hidden="true" />
                Добавить ученика
              </Button>
            </div>
          )}
        </div>
      </section>
    );
  }

  return (
    <section className="t-section">
      <div className="t-section__header">
        <h2>Активность учеников</h2>
        <span className="t-section__meta">{metaLabel}</span>
        <div
          style={{
            marginLeft: 'auto',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <Button
            variant="ghost"
            size="default"
            onClick={onOpenAll}
            aria-label="Открыть всех учеников"
            style={{ touchAction: 'manipulation' }}
          >
            Все ученики
          </Button>
        </div>
      </div>
      <hr className="t-divider" />
      <div
        className="t-table-wrap"
        style={{
          border: 0,
          borderRadius: 0,
          overflowX: 'auto',
          touchAction: 'pan-x',
        }}
      >
        <table className="t-table home-activity-table">
          <thead>
            <tr>
              <th>Ученик</th>
              <th>Последние 5 недель</th>
              <th className="is-num">Ø балл ДЗ</th>
              <th>Тренд</th>
              <th className="is-num">Пробник</th>
              <th>Сигнал</th>
              <th className="is-actions" aria-label="Действия" />
            </tr>
          </thead>
          <tbody>
            {sorted.map((student) => (
              <ActivityRow
                key={student.id}
                student={student}
                onOpen={onOpenStudent}
              />
            ))}
          </tbody>
        </table>
      </div>
      <hr className="t-divider" />
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 16,
          padding: '10px 16px',
          fontSize: 12,
          color: 'var(--sokrat-fg3)',
        }}
      >
        <span>Условные обозначения:</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span
            aria-hidden="true"
            style={{
              width: 10,
              height: 10,
              borderRadius: 2,
              background: CELL_LEGEND_COLOR.ok,
              display: 'inline-block',
            }}
          />
          вовремя
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span
            aria-hidden="true"
            style={{
              width: 10,
              height: 10,
              borderRadius: 2,
              background: CELL_LEGEND_COLOR.late,
              display: 'inline-block',
            }}
          />
          позже / частично
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span
            aria-hidden="true"
            style={{
              width: 10,
              height: 10,
              borderRadius: 2,
              background: CELL_LEGEND_COLOR.miss,
              display: 'inline-block',
            }}
          />
          не сдано
        </span>
        <span style={{ marginLeft: 'auto' }}>
          Клик по строке открывает статистику.
        </span>
      </div>
    </section>
  );
}

export const StudentsActivityBlock = memo(StudentsActivityBlockImpl);
