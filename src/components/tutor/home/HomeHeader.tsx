import { memo } from 'react';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { CalendarPlus, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  pluralize,
  PLURAL_LESSONS,
  PLURAL_WORKS,
  PLURAL_STUDENTS_ATTENTION,
} from '@/lib/ru/pluralize';

export interface HomeHeaderSummary {
  lessons: number;
  toReview: number;
  attention: number;
}

export interface HomeHeaderProps {
  tutorName: string;
  todaySummary: HomeHeaderSummary;
  onNewLesson: () => void;
  onAddStudent: () => void;
  /** Override the reference date; defaults to `new Date()`. Used for tests. */
  now?: Date;
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}

function formatTodayMeta(now: Date, summary: HomeHeaderSummary): string {
  const weekday = capitalize(format(now, 'EEEE', { locale: ru }));
  const date = format(now, 'd MMMM', { locale: ru });
  const parts = [
    `${weekday}, ${date}`,
    `${summary.lessons} ${pluralize(summary.lessons, PLURAL_LESSONS)} сегодня`,
    `${summary.toReview} ${pluralize(summary.toReview, PLURAL_WORKS)} на проверке`,
    `${summary.attention} ${pluralize(summary.attention, PLURAL_STUDENTS_ATTENTION)}`,
  ];
  return parts.join(' · ');
}

function HomeHeaderImpl({
  tutorName,
  todaySummary,
  onNewLesson,
  onAddStudent,
  now,
}: HomeHeaderProps) {
  const meta = formatTodayMeta(now ?? new Date(), todaySummary);
  const greeting = tutorName.trim().length > 0
    ? `Добро пожаловать, ${tutorName}`
    : 'Добро пожаловать';

  return (
    <div className="home-header">
      <div style={{ flex: 1, minWidth: 0 }}>
        <h1
          style={{
            margin: 0,
            fontSize: 24,
            fontWeight: 600,
            letterSpacing: '-0.005em',
            color: 'var(--sokrat-fg1)',
          }}
        >
          {greeting}
        </h1>
        <div className="t-muted" style={{ fontSize: 13, marginTop: 4 }}>
          {meta}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, flex: 'none' }}>
        <Button
          variant="outline"
          size="default"
          onClick={onNewLesson}
          style={{ touchAction: 'manipulation' }}
        >
          <CalendarPlus aria-hidden="true" />
          Новое занятие
        </Button>
        <Button
          size="default"
          onClick={onAddStudent}
          className="text-white hover:brightness-110"
          style={{
            background: 'var(--sokrat-green-700)',
            touchAction: 'manipulation',
          }}
        >
          <UserPlus aria-hidden="true" />
          Добавить ученика
        </Button>
      </div>
    </div>
  );
}

export const HomeHeader = memo(HomeHeaderImpl);
