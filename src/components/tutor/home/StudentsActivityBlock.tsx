import { memo, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { AlertTriangle, ChevronRight, FolderTree, UserPlus, Users } from 'lucide-react';
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

// TASK-10: добавлен режим 'groups' — группы как заголовки, ученики под ними.
// Default режим = 'groups' когда у репетитора есть хотя бы одна группа;
// fallback на 'attention' при отсутствии групп (см. useState инициализацию).
export type ActivitySortMode = 'groups' | 'attention' | 'delta' | 'name';

const UNASSIGNED_GROUP_LABEL = 'Без группы';
const UNASSIGNED_GROUP_KEY = '__unassigned__';

export interface StudentsActivityBlockProps {
  items: StudentActivity[];
  totalCount: number;
  onOpenStudent: (id: string) => void;
  onOpenAll: () => void;
  onAddStudent?: () => void;
}

interface SortSegmentItem {
  value: ActivitySortMode;
  label: ReactNode;
  ariaLabel: string;
}

interface SortSegmentProps {
  value: ActivitySortMode;
  onChange: (next: ActivitySortMode) => void;
  items: SortSegmentItem[];
  ariaLabel: string;
}

function SortSegment({
  value,
  onChange,
  items,
  ariaLabel,
}: SortSegmentProps) {
  return (
    <div className="t-seg" role="group" aria-label={ariaLabel}>
      {items.map((item) => {
        const isActive = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            className="t-seg__item"
            aria-pressed={isActive}
            aria-label={item.ariaLabel}
            onClick={() => onChange(item.value)}
            style={{ touchAction: 'manipulation' }}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
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

// TASK-10: фрагмент для группы — header row + student rows. React.memo
// не применяется намеренно: section передаётся как новый объект из
// useMemo родителя при каждом ребилде sorted; внутренние ActivityRow
// уже memoised поштучно. Оборачивать всю группу в memo без стабильного
// section identity бесполезно.
function GroupRowsFragment({
  section,
  onOpenStudent,
}: {
  section: { key: string; label: string; students: StudentActivity[] };
  onOpenStudent: (id: string) => void;
}) {
  // Review fix: `rowheader` — ARIA cell role, не row role. Переделали
  // под корректную table-semantic: `<th scope="colgroup" colSpan={7}>`
  // описывает ближайшую группу строк-учеников. aria-label на `<tr>`
  // (default role='row') поднимает announce когда screen reader
  // перепрыгивает по строкам, не погружаясь в cell.
  return (
    <>
      <tr
        className="home-activity-group-header"
        aria-label={`Группа ${section.label}, ${section.students.length} ${pluralize(
          section.students.length,
          PLURAL_STUDENTS,
        )}`}
      >
        <th colSpan={7} scope="colgroup">
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 12,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              color: 'var(--sokrat-fg2)',
            }}
          >
            <FolderTree
              size={14}
              aria-hidden="true"
              style={{ color: 'var(--sokrat-fg3)' }}
            />
            <span>{section.label}</span>
            <span
              className="t-chip t-chip--count"
              style={{ marginLeft: 4, textTransform: 'none', letterSpacing: 0 }}
            >
              {section.students.length}
            </span>
          </span>
        </th>
      </tr>
      {section.students.map((student) => (
        <ActivityRow
          key={student.id}
          student={student}
          onOpen={onOpenStudent}
        />
      ))}
    </>
  );
}

function StudentsActivityBlockImpl({
  items,
  totalCount,
  onOpenStudent,
  onOpenAll,
  onAddStudent,
}: StudentsActivityBlockProps) {
  // TASK-10: default sort = 'groups' когда у репетитора есть ≥ 1 group.
  //
  // Cold-load race (review fix, 2026-04-22): Home page рендерит блок как
  // только `anySettled=true` — это часто момент когда useTutorStudents
  // уже вернул студентов, а useTutorStudentActivity ещё стрим-ит данные.
  // items приходит пустым первый раз → useState инициализация выставит
  // 'attention'. Когда activity fetch settle-ит, hasAnyGroup становится
  // true, но sort уже зафиксирован в 'attention'. Fix — promote 'groups'
  // один раз после первого non-empty payload, пока tutor сам не кликнет
  // Segment (user intent overrides default).
  const hasAnyGroup = useMemo(
    () => items.some((s) => s.groupId !== null),
    [items],
  );
  const [sort, setSort] = useState<ActivitySortMode>('attention');
  const userChangedSortRef = useRef(false);
  const autoPromotedRef = useRef(false);
  useEffect(() => {
    if (userChangedSortRef.current) return;
    if (autoPromotedRef.current) return;
    if (!hasAnyGroup) return;
    autoPromotedRef.current = true;
    setSort('groups');
  }, [hasAnyGroup]);

  const handleSortChange = useCallback((next: ActivitySortMode) => {
    userChangedSortRef.current = true;
    setSort(next);
  }, []);

  const attentionCount = useMemo(
    () => items.filter((s) => s.attention).length,
    [items],
  );

  const sorted = useMemo(() => {
    const clone = items.slice();
    clone.sort((a, b) => {
      if (sort === 'attention') {
        // attention desc: true first
        const aAttention = a.attention ? 0 : 1;
        const bAttention = b.attention ? 0 : 1;
        if (aAttention !== bAttention) return aAttention - bAttention;
        // hwAvgDelta desc: higher delta first (per spec §AC-9).
        const deltaDiff = (b.hwAvgDelta ?? 0) - (a.hwAvgDelta ?? 0);
        if (deltaDiff !== 0) return deltaDiff;
        return a.name.localeCompare(b.name, 'ru');
      }
      if (sort === 'delta') {
        // hwAvgDelta asc — worst/most declining first.
        const deltaDiff = (a.hwAvgDelta ?? 0) - (b.hwAvgDelta ?? 0);
        if (deltaDiff !== 0) return deltaDiff;
        return a.name.localeCompare(b.name, 'ru');
      }
      // 'name' and 'groups' both use alphabetical within-scope ordering.
      return a.name.localeCompare(b.name, 'ru');
    });
    return clone;
  }, [items, sort]);

  // Grouping meta: только для режима 'groups'. Строится из `sorted` так что
  // внутри каждой группы ученики уже отсортированы alphabetically.
  // Group order — alphabetically by name; «Без группы» в конце.
  type GroupSection = {
    key: string;
    label: string;
    students: StudentActivity[];
  };
  const groupSections: GroupSection[] = useMemo(() => {
    if (sort !== 'groups') return [];
    const sectionsByKey = new Map<string, GroupSection>();
    for (const s of sorted) {
      const key = s.groupId ?? UNASSIGNED_GROUP_KEY;
      const label =
        s.groupShortName?.trim() || s.groupName?.trim() || UNASSIGNED_GROUP_LABEL;
      const bucket = sectionsByKey.get(key);
      if (bucket) {
        bucket.students.push(s);
      } else {
        sectionsByKey.set(key, { key, label, students: [s] });
      }
    }
    const all = Array.from(sectionsByKey.values());
    // Alphabetical by label, but push «Без группы» to the end regardless.
    all.sort((a, b) => {
      if (a.key === UNASSIGNED_GROUP_KEY) return 1;
      if (b.key === UNASSIGNED_GROUP_KEY) return -1;
      return a.label.localeCompare(b.label, 'ru');
    });
    return all;
  }, [sort, sorted]);

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
            flexWrap: 'wrap',
          }}
        >
          <SortSegment
            value={sort}
            onChange={handleSortChange}
            ariaLabel="Сортировка учеников"
            items={[
              // TASK-10: «Группы» — default когда hasAnyGroup=true. Если у
              // репетитора нет групп, кнопка всё равно доступна, но
              // покажет одну секцию «Без группы».
              {
                value: 'groups',
                ariaLabel: 'Сортировка: по группам',
                label: (
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                    }}
                  >
                    <FolderTree size={12} aria-hidden="true" />
                    Группы
                  </span>
                ),
              },
              {
                value: 'attention',
                ariaLabel: `Сортировка: требующие внимания (${attentionCount})`,
                label: (
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                    }}
                  >
                    <AlertTriangle
                      size={12}
                      aria-hidden="true"
                      style={{ color: 'var(--sokrat-state-warning-fg)' }}
                    />
                    {attentionCount}
                  </span>
                ),
              },
              {
                value: 'delta',
                ariaLabel: 'Сортировка: по тренду балла',
                label: 'По тренду',
              },
              {
                value: 'name',
                ariaLabel: 'Сортировка: по алфавиту',
                label: 'А→Я',
              },
            ]}
          />
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
      {/* `touch-pan-x` обязателен — иначе row `onClick` может съесть
          touchstart на iOS и блокировать horizontal swipe (rule 80 +
          HeatmapGrid pattern). */}
      <div
        className="t-table-wrap overflow-x-auto touch-pan-x"
        style={{
          border: 0,
          borderRadius: 0,
        }}
      >
        {/* `width: max-content` + `min-width: 100%` = на десктопе таблица
            занимает всю ширину .t-table-wrap, на мобиле — растёт до
            интринсиковой ширины и активируется horizontal scroll родителя.
            Идентично HeatmapGrid pattern (rule 80 cross-browser). */}
        <table
          className="t-table home-activity-table"
          style={{ width: 'max-content', minWidth: '100%' }}
        >
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
            {sort === 'groups' ? (
              // TASK-10: grouped render — один tbody с interleaved header
              // rows. HTML-wise это валидно: group-header rows помечены
              // `role="rowheader"` для скринридеров, colSpan=7 закрывает
              // все колонки. Student rows рендерятся через memoised
              // ActivityRow без изменений.
              groupSections.map((section) => (
                <GroupRowsFragment
                  key={`group-${section.key}`}
                  section={section}
                  onOpenStudent={onOpenStudent}
                />
              ))
            ) : (
              sorted.map((student) => (
                <ActivityRow
                  key={student.id}
                  student={student}
                  onOpen={onOpenStudent}
                />
              ))
            )}
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
