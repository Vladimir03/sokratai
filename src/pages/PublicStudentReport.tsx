import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { format, parseISO } from 'date-fns';
import { ru } from 'date-fns/locale';
import {
  AlertCircle, BookOpen, ClipboardCheck, FileQuestion, Link2Off, Target, Wallet,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatCurrency } from '@/lib/formatters';
import { getSubjectLabel } from '@/types/homework';
import { rollupByScoreKind, formatScoreNumber, type ScoreKind } from '@/lib/scoreScales';
import {
  fetchPublicStudentReport,
  type PublicStudentReportData,
  type ReportStatementEntry,
  type ReportWork,
} from '@/lib/publicReportApi';

// «Отчёт родителю» (Phase 2c) — публичная страница вне AppFrame (/p/report/:slug).
// Родитель не логинится. Только итоги и баллы — без решений задач и критериев
// (anti-leak обеспечен edge-функцией public-student-report; здесь чистый рендер).

function statementLabel(e: ReportStatementEntry): string {
  if (e.source_kind === 'lesson') return 'Занятие';
  if (e.source_kind === 'topup') return 'Оплата';
  return e.kind === 'credit' ? 'Оплата (история)' : 'Начисление (история)';
}

function WorkRow({ work }: { work: ReportWork }) {
  const rollup = rollupByScoreKind(work.score_kind as ScoreKind, work.raw, work.raw_max);
  const Icon = work.kind === 'mock' ? ClipboardCheck : BookOpen;
  return (
    <div className="flex items-center gap-3 py-2.5">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100">
        <Icon className="h-[18px] w-[18px] text-slate-500" aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-slate-900">{work.title}</p>
        <p className="text-xs text-muted-foreground">
          {work.kind === 'mock' ? 'Пробник' : 'Домашнее задание'}
          {' · '}
          {format(parseISO(work.date), 'd MMMM', { locale: ru })}
        </p>
      </div>
      <div className="text-right">
        <span className="text-sm font-bold tabular-nums text-slate-900">{rollup.main}</span>
        {rollup.suffix ? <span className="text-xs text-slate-400"> {rollup.suffix}</span> : null}
        {rollup.sub ? <div className="text-[11px] text-muted-foreground">{rollup.sub}</div> : null}
      </div>
    </div>
  );
}

export function ReportBody({ data }: { data: PublicStudentReportData }) {
  const { student, tutor, summary, works, balance, statement } = data;
  const examLabel = student.track === 'ege' ? 'ЕГЭ'
    : student.track === 'oge' ? 'ОГЭ'
    : (student.track || '').toUpperCase();
  const trend = summary.trend ?? [];
  const trendDelta = trend.length >= 2 ? trend[trend.length - 1] - trend[trend.length - 2] : null;
  const balanceTone = balance < 0 ? 'text-rose-600' : balance > 0 ? 'text-emerald-600' : 'text-slate-900';

  return (
    <div className="space-y-6">
      {/* Шапка отчёта */}
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Отчёт по ученику</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {student.name}
          {student.subject ? ` · ${getSubjectLabel(student.subject)}` : ''}
          {examLabel ? ` · ${examLabel}` : ''}
          {student.grade_class ? ` · ${student.grade_class}` : ''}
        </p>
        {tutor.name && (
          <p className="text-sm text-muted-foreground">Репетитор: {tutor.name}</p>
        )}
      </div>

      {/* Прогресс */}
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Прогресс</h2>
        {(summary.current_level != null || summary.target != null) && (
          <div className="mt-3 flex items-center gap-3 rounded-lg bg-socrat-surface px-3 py-2.5">
            <Target className="h-5 w-5 shrink-0 text-accent" aria-hidden="true" />
            <p className="text-sm text-slate-800">
              {summary.current_level != null ? (
                <>Текущий уровень: <span className="font-semibold tabular-nums">≈{formatScoreNumber(summary.current_level)}</span></>
              ) : (
                'Текущий уровень появится после первого подтверждённого пробника'
              )}
              {summary.target != null && (
                <> · цель <span className="font-semibold tabular-nums">{formatScoreNumber(summary.target)}</span>{student.track === 'ege' ? ' баллов ЕГЭ' : ''}</>
              )}
              {trendDelta != null && trendDelta !== 0 && (
                <span className={cn('ml-1 font-medium', trendDelta > 0 ? 'text-emerald-600' : 'text-rose-600')}>
                  ({trendDelta > 0 ? '+' : ''}{formatScoreNumber(trendDelta)} за последний пробник)
                </span>
              )}
            </p>
          </div>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          Сдано работ: {summary.done} из {summary.total}
        </p>
        {works.length > 0 ? (
          <div className="mt-1 divide-y divide-slate-100">
            {works.map((w, i) => <WorkRow key={i} work={w} />)}
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">Работ пока нет.</p>
        )}
      </section>

      {/* Баланс и оплаты */}
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Баланс и оплаты</h2>
        <div className="mt-3 flex items-center gap-3">
          <Wallet className="h-5 w-5 shrink-0 text-slate-400" aria-hidden="true" />
          <p className={cn('text-2xl font-bold tabular-nums', balanceTone)}>{formatCurrency(balance)}</p>
          <span className="text-sm text-muted-foreground">
            {balance < 0 ? 'задолженность' : balance > 0 ? 'предоплата' : 'нет задолженности'}
          </span>
        </div>
        {statement.length > 0 && (
          <div className="mt-3 divide-y divide-slate-100">
            {statement.map((e, i) => (
              <div key={i} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="text-muted-foreground">
                  {format(parseISO(e.occurred_on), 'd MMMM yyyy', { locale: ru })}
                  {' · '}
                  <span className="text-slate-700">{statementLabel(e)}</span>
                </span>
                <span className={cn('font-semibold tabular-nums', e.kind === 'credit' ? 'text-emerald-600' : 'text-slate-900')}>
                  {e.kind === 'credit' ? '+' : '−'}{formatCurrency(e.amount)}
                </span>
              </div>
            ))}
            <div className="flex items-center justify-between gap-3 py-2 text-sm font-semibold">
              <span>Итоговый баланс</span>
              <span className={cn('tabular-nums', balanceTone)}>{formatCurrency(balance)}</span>
            </div>
          </div>
        )}
      </section>

      <p className="text-xs text-muted-foreground">
        Для родителя — только итоги и баллы. Без решений задач и критериев.
        {' '}Сформировано в Сократ AI · {format(parseISO(data.generated_at), 'd MMMM yyyy', { locale: ru })}.
      </p>
    </div>
  );
}

function StateScreen({ icon: Icon, title, text }: { icon: typeof FileQuestion; title: string; text: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-center">
      <Icon className="h-10 w-10 text-slate-300" aria-hidden="true" />
      <p className="text-lg font-semibold text-slate-900">{title}</p>
      <p className="max-w-sm text-sm text-muted-foreground">{text}</p>
    </div>
  );
}

export default function PublicStudentReport() {
  const { slug } = useParams<{ slug: string }>();
  const { data: result, isLoading } = useQuery({
    queryKey: ['public', 'student-report', slug],
    queryFn: () => fetchPublicStudentReport(slug ?? ''),
    enabled: Boolean(slug),
    refetchOnWindowFocus: false,
  });

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-2xl items-center gap-2 px-4 py-3">
          <img src="/sokrat-logo.png" alt="" className="h-7 w-auto" />
          <span className="text-lg font-semibold text-slate-900">Сократ AI</span>
        </div>
      </header>
      <main className="mx-auto max-w-2xl px-4 py-6">
        {isLoading || !result ? (
          <div className="space-y-4">
            <div className="h-6 w-64 animate-pulse rounded bg-slate-200" />
            <div className="h-40 animate-pulse rounded-xl bg-slate-100" />
            <div className="h-40 animate-pulse rounded-xl bg-slate-100" />
          </div>
        ) : result.status === 'ok' ? (
          <ReportBody data={result.data} />
        ) : result.status === 'revoked' ? (
          <StateScreen
            icon={Link2Off}
            title="Ссылка больше не действует"
            text="Репетитор отозвал эту ссылку. Попросите прислать новую."
          />
        ) : result.status === 'error' ? (
          <StateScreen icon={AlertCircle} title="Не удалось загрузить отчёт" text={result.message} />
        ) : (
          <StateScreen
            icon={FileQuestion}
            title="Отчёт не найден"
            text="Проверьте ссылку — возможно, она скопирована не полностью."
          />
        )}
      </main>
    </div>
  );
}
