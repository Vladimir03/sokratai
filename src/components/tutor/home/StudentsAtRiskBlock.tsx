import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowRight, ChevronRight } from 'lucide-react';
import { getStudentsProgressOverview, type ProgressOverviewItem } from '@/lib/tutorProgressApi';

// ─── «Ученики отстают» — entry point на Главной (student-progress R2 §4.0) ─────
//
// Триаж «кто отстаёт от цели» (риск удержания — боль Елены). Reuses the SAME
// React Query cache key as the «Успеваемость» tab (['tutor','students','overview'])
// → нет лишнего запроса. Скрыт, если отстающих нет (не плодим пустую секцию).

const MAX_VISIBLE = 5;
const BEHIND = 50;

function riskScore(s: ProgressOverviewItem): number | null {
  const pct = s.pct_to_goal;
  const examTrack = s.track === 'ege' || s.track === 'oge';
  const behind = pct != null && pct < BEHIND;
  const risk = behind || (pct != null && pct < 62 && s.signals.declining && examTrack);
  if (!risk) return null;
  return 10000 + (100 - (pct ?? 0)) * 10 + (s.signals.declining ? 300 : 0);
}

export function StudentsAtRiskBlock() {
  const navigate = useNavigate();
  const query = useQuery({
    queryKey: ['tutor', 'students', 'overview'],
    queryFn: getStudentsProgressOverview,
    refetchOnWindowFocus: false,
    staleTime: 10 * 60 * 1000,
  });

  const atRisk = useMemo(() => {
    const items = query.data?.items ?? [];
    return items
      .map((s) => ({ s, score: riskScore(s) }))
      .filter((x): x is { s: ProgressOverviewItem; score: number } => x.score !== null)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.s);
  }, [query.data]);

  // Скрываем блок, пока грузится или если отстающих нет.
  if (query.isLoading || atRisk.length === 0) return null;

  const visible = atRisk.slice(0, MAX_VISIBLE);

  return (
    <div className="mb-4 rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-red-50 text-red-600">
            <AlertTriangle className="h-4 w-4" />
          </span>
          <h2 className="text-sm font-semibold text-slate-800">
            Ученики отстают <span className="text-slate-400">· {atRisk.length}</span>
          </h2>
        </div>
        <button
          type="button"
          onClick={() => navigate('/tutor/students?view=progress')}
          className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline touch-manipulation"
        >
          Успеваемость <ArrowRight className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="space-y-1.5">
        {visible.map((s) => (
          <button
            key={s.tutor_student_id}
            type="button"
            onClick={() => navigate(`/tutor/students/${s.tutor_student_id}/progress`)}
            className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-slate-50 touch-manipulation"
          >
            <span className="h-2 w-2 shrink-0 rounded-full bg-red-500" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800">{s.name}</span>
            <span className="shrink-0 text-xs font-semibold tabular-nums text-red-600">
              {s.pct_to_goal != null ? `${s.pct_to_goal}% к цели` : 'нужен пробник'}
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" aria-hidden="true" />
          </button>
        ))}
      </div>
    </div>
  );
}

export default StudentsAtRiskBlock;
