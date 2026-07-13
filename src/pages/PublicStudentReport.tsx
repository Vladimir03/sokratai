import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { format, parseISO } from 'date-fns';
import { ru } from 'date-fns/locale';
import {
  AlertCircle, AlertTriangle, BookOpen, CheckCircle2, ClipboardCheck, FileQuestion,
  Link2Off, MessageSquare, TrendingUp, Wallet,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatCurrency } from '@/lib/formatters';
import { getSubjectLabel } from '@/types/homework';
import { rollupByScoreKind, formatScoreNumber, type ScoreKind } from '@/lib/scoreScales';
import {
  fetchPublicStudentReport,
  type PublicStudentReportData,
  type ReportStatementEntry,
  type ReportVerdict,
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

// Вердикт-чип «молодец / ругать» — ставит тренер (ОС Елены). Палитра emerald/amber/rose =
// статусная семантика (rule 90 waiver). Иконки Lucide (не эмодзи — rule 90).
const VERDICT_CONFIG: Record<ReportVerdict, { label: string; icon: typeof CheckCircle2; box: string; iconColor: string }> = {
  good: { label: 'Молодец', icon: CheckCircle2, box: 'border-emerald-200 bg-emerald-50 text-emerald-900', iconColor: 'text-emerald-600' },
  ok: { label: 'Есть над чем поработать', icon: TrendingUp, box: 'border-amber-200 bg-amber-50 text-amber-900', iconColor: 'text-amber-600' },
  attention: { label: 'Нужен контроль', icon: AlertTriangle, box: 'border-rose-200 bg-rose-50 text-rose-900', iconColor: 'text-rose-600' },
};

function StatCard({ value, label, sub }: { value: string; label: string; sub?: string | null }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 text-center">
      <p className="text-2xl font-bold tabular-nums text-slate-900">{value}</p>
      <p className="mt-0.5 text-xs font-medium text-slate-500">{label}</p>
      {sub ? <p className="mt-0.5 text-[11px] leading-tight text-muted-foreground">{sub}</p> : null}
    </div>
  );
}

function reportPeriodLabel(period: PublicStudentReportData['period']): string | null {
  if (!period || (!period.start && !period.end)) return null;
  if (period.start && period.end) {
    const s = parseISO(period.start);
    const e = parseISO(period.end);
    // Один месяц (напр. текущий месяц) → компактно «за 1–13 июня 2026».
    if (s.getFullYear() === e.getFullYear() && s.getMonth() === e.getMonth()) {
      return `за ${format(s, 'd', { locale: ru })}–${format(e, 'd MMMM yyyy', { locale: ru })}`;
    }
    return `за ${format(s, 'd MMM', { locale: ru })} – ${format(e, 'd MMM yyyy', { locale: ru })}`;
  }
  if (period.start) return `с ${format(parseISO(period.start), 'd MMM yyyy', { locale: ru })}`;
  if (period.end) return `по ${format(parseISO(period.end), 'd MMM yyyy', { locale: ru })}`;
  return null;
}

export function ReportBody({ data }: { data: PublicStudentReportData }) {
  const { student, tutor, summary, works, balance, statement } = data;
  const examLabel = student.track === 'ege' ? 'ЕГЭ'
    : student.track === 'oge' ? 'ОГЭ'
    : (student.track || '').toUpperCase();
  const subjectLabel = student.subject ? getSubjectLabel(student.subject) : null;

  const trend = summary.trend ?? [];
  const trendDelta = trend.length >= 2 ? trend[trend.length - 1] - trend[trend.length - 2] : null;

  // v2 (ОС Елены) — все поля optional: старый edge их не шлёт, фронт деградирует мягко.
  const metrics = data.metrics ?? { mock_score: true, hw_done: true, hw_success: true };
  const verdict = data.verdict ?? null;
  const comment = (data.tutor_comment ?? '').trim();
  const attention = data.attention ?? [];
  const periodLabel = reportPeriodLabel(data.period);
  // Оплата: старый edge без show_debt_line → показываем (как раньше), если есть баланс.
  const showDebt = (data.show_debt_line ?? true) && balance != null;
  const bal = balance ?? 0;

  // Числа сверху — только включённые галочками метрики и при наличии данных (ОС Елены, Q2).
  const stats: { value: string; label: string; sub?: string | null }[] = [];
  if (metrics.mock_score && summary.current_level != null) {
    const goalSub = summary.target != null
      ? `цель ${formatScoreNumber(summary.target)}${trendDelta ? `, ${trendDelta > 0 ? '+' : ''}${formatScoreNumber(trendDelta)} за пробник` : ''}`
      : null;
    stats.push({ value: `≈${formatScoreNumber(summary.current_level)}`, label: 'Балл за пробник', sub: goalSub });
  }
  if (metrics.hw_done && (summary.hw_total ?? 0) > 0) {
    stats.push({ value: `${summary.hw_done ?? 0} из ${summary.hw_total}`, label: 'Сделано ДЗ' });
  }
  if (metrics.hw_success && summary.hw_success_pct != null) {
    stats.push({ value: `${summary.hw_success_pct}%`, label: 'Верных ответов' });
  }
  // Фолбэк ТОЛЬКО для старого edge (нет поля metrics) — иначе уважаем выбор тренера
  // (снял все галочки → чисел нет). Новый edge всегда шлёт metrics.
  if (stats.length === 0 && data.metrics == null && summary.total > 0) {
    stats.push({ value: `${summary.done} из ${summary.total}`, label: 'Сдано работ' });
  }

  const VC = verdict ? VERDICT_CONFIG[verdict] : null;

  return (
    <div className="space-y-5">
      {/* Шапка: предмет КРУПНО — родитель сразу понимает, о чём отчёт (ОС Елены, Гр.1) */}
      <div>
        {examLabel && (
          <p className="text-xs font-semibold uppercase tracking-wide text-accent">{examLabel}</p>
        )}
        <h1 className="text-2xl font-bold leading-tight text-slate-900">
          {subjectLabel ?? 'Отчёт по ученику'}
        </h1>
        <p className="mt-1 text-base font-medium text-slate-900">
          {student.name}
          {student.grade_class ? <span className="font-normal text-muted-foreground"> · {student.grade_class}</span> : null}
        </p>
        <p className="text-sm text-muted-foreground">
          {periodLabel ?? 'за всё время'}
          {tutor.name ? ` · Репетитор: ${tutor.name}` : ''}
        </p>
      </div>

      {/* Вердикт-чип + комментарий тренера — ответ «молодец или ругать?» */}
      {(VC || comment) && (
        <section className="space-y-3">
          {VC && (
            <div className={cn('flex items-center gap-2 rounded-xl border px-3.5 py-2.5', VC.box)}>
              <VC.icon className={cn('h-5 w-5 shrink-0', VC.iconColor)} aria-hidden="true" />
              <span className="text-base font-semibold">{VC.label}</span>
            </div>
          )}
          {comment && (
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />
                Комментарий репетитора
              </div>
              <p className="mt-1.5 whitespace-pre-wrap text-[15px] leading-relaxed text-slate-800">{comment}</p>
            </div>
          )}
        </section>
      )}

      {/* Числа сверху */}
      {stats.length > 0 && (
        <div className={cn('grid gap-2', stats.length === 1 ? 'grid-cols-1' : stats.length === 2 ? 'grid-cols-2' : 'grid-cols-3')}>
          {stats.map((st, i) => <StatCard key={i} {...st} />)}
        </div>
      )}

      {/* Что требует внимания (авто-факты) / всё ок */}
      {attention.length > 0 ? (
        <section className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-amber-900">
            <AlertTriangle className="h-4 w-4" aria-hidden="true" /> Что требует внимания
          </h2>
          <ul className="mt-2 space-y-1">
            {attention.map((a, i) => (
              <li key={i} className="flex gap-2 text-sm text-amber-900">
                <span aria-hidden="true">•</span><span>{a}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : (summary.hw_total ?? 0) > 0 ? (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-sm font-medium text-emerald-800">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
          Все задания выполнены вовремя
        </div>
      ) : null}

      {/* Оплата — одна строка, ответ «должен или ок?» (ОС Елены, Гр.4) */}
      {showDebt && (
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-3">
            <Wallet className="h-5 w-5 shrink-0 text-slate-400" aria-hidden="true" />
            <div>
              <p className={cn('text-xl font-bold tabular-nums', bal < 0 ? 'text-rose-600' : bal > 0 ? 'text-emerald-600' : 'text-slate-900')}>
                {bal < 0 ? `Задолженность ${formatCurrency(Math.abs(bal))}` : bal > 0 ? `Предоплата ${formatCurrency(bal)}` : 'Оплат хватает'}
              </p>
              <p className="text-xs text-muted-foreground">
                {bal < 0 ? 'нужно пополнить баланс' : bal > 0 ? 'на балансе есть средства' : 'задолженности нет'}
              </p>
            </div>
          </div>
          {statement.length > 0 && (
            <details className="mt-3 border-t border-slate-100 pt-2">
              <summary className="cursor-pointer list-none text-sm font-medium text-accent">Подробнее: история оплат</summary>
              <div className="mt-2 divide-y divide-slate-100">
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
              </div>
            </details>
          )}
        </section>
      )}

      {/* Подробнее: работы (свёрнуто — 90% родителей темы не интересны, ОС Елены, Гр.5) */}
      {works.length > 0 && (
        <details className="rounded-xl border border-slate-200 bg-white p-4">
          <summary className="cursor-pointer list-none text-sm font-medium text-accent">
            Подробнее: работы ({works.length})
          </summary>
          <p className="mt-2 text-xs text-muted-foreground">Сдано {summary.done} из {summary.total}</p>
          <div className="mt-1 divide-y divide-slate-100">
            {works.map((w, i) => <WorkRow key={i} work={w} />)}
          </div>
        </details>
      )}

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
