import { useMemo, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, BadgeCheck, BookOpen, ClipboardCheck, Clock, Loader2, Pencil, SquarePen,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Sparkline } from '@/components/tutor/home/primitives/Sparkline';
import { getCellStyle } from '@/components/tutor/results/heatmapStyles';
import {
  getStudentProgress, updateStudentTarget, reviewAllAi,
  type ProgressWork, type StudentProgress,
} from '@/lib/tutorProgressApi';
import {
  rollupByScoreKind, formatScoreNumber, goalScaleForTrack, type ScoreKind,
} from '@/lib/scoreScales';

// ─── Страница ученика «Прогресс» (student-progress R2, TASK-7) ────────────────
//
// Агрегат всех работ в РОДНОЙ шкале (score_kind), цвет ячеек = % от max. Цель в
// родной единице по треку. Drill-down работы → существующий /tutor/homework/:id
// (?student=) — переиспользует R1 HeatmapGrid + подтверждение. Mock → mock detail.

const TRACK_LABEL: Record<string, string> = { ege: 'ЕГЭ', oge: 'ОГЭ', school: 'Школа' };

function WorkCard({ work, onOpen }: { work: ProgressWork; onOpen: (w: ProgressWork) => void }) {
  const rollup = rollupByScoreKind(work.score_kind as ScoreKind, work.raw, work.raw_max);
  const Icon = work.kind === 'mock' ? ClipboardCheck : BookOpen;

  const statusBadge = (() => {
    if (work.status === 'verified') {
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 ring-1 ring-emerald-200">
          <BadgeCheck className="h-3 w-3" /> Проверено
        </span>
      );
    }
    if (work.status === 'review') {
      const n = work.pending_review_count ?? 0;
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 ring-1 ring-amber-200">
          <Clock className="h-3 w-3" /> На проверке{n > 0 ? ` · ${n}` : ''}
        </span>
      );
    }
    if (work.status === 'manual') {
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
          <SquarePen className="h-3 w-3" /> Ручная оценка
        </span>
      );
    }
    return <span className="text-[11px] text-slate-400">Не сдано</span>;
  })();

  return (
    <button
      type="button"
      onClick={() => onOpen(work)}
      className="w-full rounded-xl border border-slate-200 bg-white p-3 text-left transition-shadow hover:shadow-md touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
          <Icon className="h-[18px] w-[18px]" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-slate-900 truncate">{work.title}</span>
            <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
              {work.kind === 'mock' ? 'Пробник' : 'ДЗ'}
            </span>
          </div>
          {/* mini-map cells — цвет = score/max */}
          {work.cells.length > 0 ? (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {work.cells.map((c, i) => {
                const { className } = getCellStyle(c.score, c.max);
                return (
                  <span
                    key={i}
                    className={cn('inline-flex h-5 min-w-[1.75rem] items-center justify-center rounded text-[10px] font-semibold', className)}
                  >
                    {c.score == null ? '—' : formatScoreNumber(c.score)}
                  </span>
                );
              })}
            </div>
          ) : null}
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <div className="text-right">
            <span className="text-sm font-bold tabular-nums text-slate-900">{rollup.main}</span>
            {rollup.suffix ? <span className="text-xs text-slate-400"> {rollup.suffix}</span> : null}
            {rollup.sub ? <div className="text-[11px] text-slate-500">{rollup.sub}</div> : null}
          </div>
          {statusBadge}
        </div>
      </div>
    </button>
  );
}

function GoalCard({
  data, onEdit,
}: { data: StudentProgress; onEdit: () => void }) {
  const track = data.target.track;
  const scale = goalScaleForTrack(track);
  const current = data.summary.current_level;
  const target = data.target.target_score;
  const range = scale.ceil - scale.floor || 1;
  const pos = (v: number) => `${Math.max(0, Math.min(100, ((v - scale.floor) / range) * 100))}%`;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Прогресс к цели</p>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-3xl font-bold tabular-nums text-slate-900">
              {current != null ? (track === 'ege' ? `≈${current}` : formatScoreNumber(current)) : '—'}
            </span>
            <span className="text-slate-400">→</span>
            <span className="text-2xl font-semibold tabular-nums text-accent">
              {target != null ? formatScoreNumber(target) : '—'}
            </span>
            <span className="text-sm text-slate-400">{scale.noun}</span>
          </div>
          {current == null ? (
            <p className="mt-1 text-xs text-amber-600">Нужен подтверждённый пробник, чтобы оценить уровень.</p>
          ) : null}
        </div>
        <div className="flex items-center gap-3">
          {data.summary.trend.length >= 2 ? (
            <Sparkline values={data.summary.trend} stroke="var(--accent, #1B6B4A)" ariaLabel="Динамика по пробникам" />
          ) : null}
          <Button variant="outline" size="sm" className="h-8 px-2 touch-manipulation" onClick={onEdit} aria-label="Изменить цель">
            <Pencil className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* progress bar with threshold ticks (ЕГЭ — 36 аттестат / 39 вуз) */}
      <div className="relative mt-4 h-2 rounded-full bg-slate-100">
        {target != null ? (
          <div className="absolute inset-y-0 left-0 rounded-full bg-accent" style={{ width: pos(current ?? scale.floor) }} />
        ) : null}
        {scale.thresholds.map((t) => (
          <span
            key={t.v}
            className="absolute top-1/2 h-3 w-0.5 -translate-y-1/2 bg-slate-300"
            style={{ left: pos(t.v) }}
            title={`${t.label} (${t.v})`}
            aria-label={`${t.label}: ${t.v}`}
          />
        ))}
      </div>
      {scale.thresholds.length > 0 ? (
        <div className="mt-1 flex gap-3 text-[10px] text-slate-400">
          {scale.thresholds.map((t) => (
            <span key={t.v}>{t.label} · {t.v}</span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function EditTargetDialog({
  open, onOpenChange, data, tutorStudentId,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  data: StudentProgress;
  tutorStudentId: string;
}) {
  const queryClient = useQueryClient();
  const track = data.target.track;
  const scale = goalScaleForTrack(track);
  const [valueText, setValueText] = useState<string>(
    data.target.target_score != null ? String(data.target.target_score) : '',
  );

  const num = Number(valueText.replace(',', '.'));
  const invalid = valueText.trim() === '' || !Number.isFinite(num) || num < scale.floor || num > scale.ceil;

  const mutation = useMutation({
    mutationFn: () => updateStudentTarget({ tutorStudentId, targetScore: num, track }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tutor', 'students', 'progress', tutorStudentId] });
      queryClient.invalidateQueries({ queryKey: ['tutor', 'students', 'overview'] });
      toast.success('Цель обновлена');
      onOpenChange(false);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Не удалось сохранить цель'),
  });

  return (
    <Dialog open={open} onOpenChange={(n) => (!mutation.isPending ? onOpenChange(n) : null)}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Цель ученика</DialogTitle>
        </DialogHeader>
        <div className="space-y-2 py-2">
          <label htmlFor="target-input" className="text-sm font-medium text-slate-700">
            {track === 'ege' ? 'Тестовый балл ЕГЭ (0–100)' : `Целевая оценка (${scale.floor}–${scale.ceil})`}
          </label>
          <input
            id="target-input"
            type="number"
            inputMode="numeric"
            min={scale.floor}
            max={scale.ceil}
            value={valueText}
            onChange={(e) => setValueText(e.target.value)}
            disabled={mutation.isPending}
            className="w-full rounded-md border border-slate-200 px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent"
          />
          <p className="text-xs text-slate-500">
            {invalid ? `Введите число ${scale.floor}…${scale.ceil}` : 'Цель видна в прогрессе и отчёте.'}
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={mutation.isPending} onClick={() => onOpenChange(false)}>Отмена</Button>
          <Button disabled={mutation.isPending || invalid} onClick={() => mutation.mutate()}>
            {mutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Сохранить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function StudentProgressPage() {
  const { tutorStudentId } = useParams<{ tutorStudentId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get('tab') === 'report' ? 'report' : 'progress';
  const [editOpen, setEditOpen] = useState(false);
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);

  const query = useQuery({
    queryKey: ['tutor', 'students', 'progress', tutorStudentId],
    queryFn: () => getStudentProgress(tutorStudentId as string),
    enabled: Boolean(tutorStudentId),
    refetchOnWindowFocus: false,
    staleTime: 10 * 60 * 1000,
  });

  const data = query.data;

  // bulk «Подтвердить всё, что AI проверил» — Σ pending по ДЗ-работам.
  const pendingTotal = useMemo(
    () => (data?.works ?? [])
      .filter((w) => w.kind === 'homework')
      .reduce((s, w) => s + (w.pending_review_count ?? 0), 0),
    [data],
  );

  const bulkReview = useMutation({
    mutationFn: async () => {
      const studentId = data!.student.student_id;
      const targets = (data?.works ?? []).filter((w) => w.kind === 'homework' && (w.pending_review_count ?? 0) > 0);
      let reviewed = 0;
      let lastErr: unknown = null;
      // Loop per assignment — best-effort. 409 NOTHING_TO_REVIEW/ALREADY_REVIEWED на
      // отдельной работе (кто-то подтвердил параллельно) = пропускаем, не валим весь bulk.
      for (const w of targets) {
        try {
          const res = await reviewAllAi({ assignmentId: w.id, studentId });
          reviewed += res.reviewed_count;
        } catch (e) {
          const code = (e as { code?: string })?.code;
          if (code !== 'NOTHING_TO_REVIEW' && code !== 'ALREADY_REVIEWED') lastErr = e;
        }
      }
      if (reviewed === 0 && lastErr) throw lastErr;
      return reviewed;
    },
    onSuccess: (reviewed) => {
      queryClient.invalidateQueries({ queryKey: ['tutor', 'students', 'progress', tutorStudentId] });
      queryClient.invalidateQueries({ queryKey: ['tutor', 'students', 'overview'] });
      toast.success(reviewed > 0 ? `Подтверждено задач: ${reviewed}` : 'Нечего подтверждать — обновлено');
      setBulkConfirmOpen(false);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Не удалось подтвердить'),
  });

  const handleOpenWork = (w: ProgressWork) => {
    if (!data) return;
    if (w.kind === 'homework') {
      navigate(`/tutor/homework/${w.id}?student=${encodeURIComponent(data.student.student_id)}`);
    } else if (w.assignment_id) {
      navigate(`/tutor/mock-exams/${w.assignment_id}`);
    }
  };

  if (query.isLoading) {
    return (
      <div className="flex items-center justify-center py-20 text-slate-400">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }
  if (query.isError || !data) {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <Button variant="ghost" size="sm" onClick={() => navigate('/tutor/students')} className="mb-4">
          <ArrowLeft className="mr-1 h-4 w-4" /> К ученикам
        </Button>
        <div className="rounded-lg border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
          Не удалось загрузить прогресс ученика.
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-4 md:p-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0 touch-manipulation" onClick={() => navigate('/tutor/students')} aria-label="Назад к ученикам">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-bold text-slate-900">{data.student.name}</h1>
          <p className="text-xs text-slate-500">
            {TRACK_LABEL[data.student.track] ?? data.student.track}
            {data.student.grade_class ? ` · ${data.student.grade_class}` : ''}
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div role="tablist" aria-label="Разделы ученика" className="flex gap-1 border-b border-slate-200">
        {([{ key: 'progress', label: 'Прогресс' }, { key: 'report', label: 'Отчёт' }] as const).map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setSearchParams(t.key === 'progress' ? {} : { tab: 'report' }, { replace: true })}
            className={cn(
              'min-h-[40px] px-4 text-sm font-medium transition-colors touch-manipulation border-b-2 -mb-px',
              tab === t.key ? 'border-accent text-accent' : 'border-transparent text-slate-500 hover:text-slate-700',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'report' ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-10 text-center text-sm text-slate-500">
          Отчёт родителю появится в следующей версии (v1.1).
        </div>
      ) : (
        <>
          <GoalCard data={data} onEdit={() => setEditOpen(true)} />

          {/* Metrics */}
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-xl border border-slate-200 bg-white p-3 text-center">
              <div className="text-lg font-bold tabular-nums text-slate-900">{data.summary.done}/{data.summary.total}</div>
              <div className="text-[11px] text-slate-500">Сдано</div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-3 text-center">
              <div className="text-lg font-bold tabular-nums text-slate-900">{data.summary.reviewed_pct != null ? `${data.summary.reviewed_pct}%` : '—'}</div>
              <div className="text-[11px] text-slate-500">Проверено</div>
            </div>
            <div className={cn('rounded-xl border p-3 text-center', data.summary.needs_attention ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-white')}>
              <div className={cn('text-lg font-bold', data.summary.needs_attention ? 'text-amber-700' : 'text-slate-900')}>
                {data.summary.needs_attention ? 'Да' : 'Нет'}
              </div>
              <div className="text-[11px] text-slate-500">Внимание</div>
            </div>
          </div>

          {/* Bulk review CTA — с подтверждением (spec §4.3: «AI-баллы остаются как есть»). */}
          {pendingTotal > 0 ? (
            <Button
              onClick={() => setBulkConfirmOpen(true)}
              disabled={bulkReview.isPending}
              className="w-full bg-emerald-600 text-white hover:bg-emerald-700 touch-manipulation"
            >
              {bulkReview.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <BadgeCheck className="mr-2 h-4 w-4" />}
              Подтвердить всё, что AI проверил ({pendingTotal})
            </Button>
          ) : null}

          {/* Works */}
          <div className="space-y-2">
            <h2 className="text-sm font-semibold text-slate-700">Работы</h2>
            {data.works.length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-400">Пока нет работ.</p>
            ) : (
              data.works.map((w) => (
                <WorkCard key={`${w.kind}-${w.id}`} work={w} onOpen={handleOpenWork} />
              ))
            )}
          </div>
        </>
      )}

      <EditTargetDialog open={editOpen} onOpenChange={setEditOpen} data={data} tutorStudentId={tutorStudentId as string} />

      <AlertDialog open={bulkConfirmOpen} onOpenChange={(o) => (!bulkReview.isPending ? setBulkConfirmOpen(o) : null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Подтвердить {pendingTotal} {pendingTotal === 1 ? 'задачу' : 'задач'}, проверенных AI?</AlertDialogTitle>
            <AlertDialogDescription>
              Ученику откроются баллы и пометка «проверено». AI-баллы остаются как есть —
              если с каким-то не согласны, поправьте его отдельно через «Изменить балл».
              Решение и AI-рубрика ученику не показываются.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkReview.isPending}>Отмена</AlertDialogCancel>
            <AlertDialogAction
              disabled={bulkReview.isPending}
              onClick={(e) => { e.preventDefault(); bulkReview.mutate(); }}
              className="bg-emerald-600 text-white hover:bg-emerald-700"
            >
              {bulkReview.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Подтвердить ({pendingTotal})
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
