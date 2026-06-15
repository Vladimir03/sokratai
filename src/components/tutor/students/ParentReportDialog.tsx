import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format, subDays } from 'date-fns';
import {
  AlertCircle, Check, Copy, ExternalLink, Eye, Link2Off, Loader2,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { supabase } from '@/lib/supabaseClient';
import { fetchPublicStudentReport, type ReportVerdict } from '@/lib/publicReportApi';
import { ReportBody } from '@/pages/PublicStudentReport';

// Предпросмотр «как видит родитель» — тот же ReportBody + тот же публичный endpoint.
function ReportPreviewDialog({
  open, onOpenChange, slug,
}: { open: boolean; onOpenChange: (o: boolean) => void; slug: string }) {
  const { data: result, isLoading } = useQuery({
    queryKey: ['public', 'student-report', slug],
    queryFn: () => fetchPublicStudentReport(slug),
    enabled: open,
    refetchOnWindowFocus: false,
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Предпросмотр — как видит родитель</DialogTitle>
        </DialogHeader>
        <div className="rounded-xl bg-slate-50 p-3">
          {isLoading || !result ? (
            <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Загружаю отчёт…
            </div>
          ) : result.status === 'ok' ? (
            <ReportBody data={result.data} />
          ) : (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <AlertCircle className="h-8 w-8 text-slate-300" aria-hidden="true" />
              <p className="text-sm text-muted-foreground">
                Не удалось загрузить предпросмотр. Сохраните изменения и попробуйте ещё раз.
              </p>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Закрыть</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// «Отчёт родителю» (Phase 2c + v2 по ОС Елены) — конструктор отчёта + share-ссылка на
// публичный read-only отчёт (/p/report/:slug). slug = bearer; «Отозвать» гасит ссылку.
// Тренер задаёт: вердикт-чип, комментарий словами, период, какие числа показать, оплату.
// Конфиг хранится на student_report_links (PostgREST + RLS owns_tutor_student); публичное
// чтение — service_role edge (anti-leak whitelist). Одна активная ссылка на ученика
// (редактируемая); revoke → следующее сохранение создаёт новую.

// Родителю шлём ПРОД-домен (ссылка живёт у родителя в чате).
const REPORT_BASE_URL = 'https://sokratai.ru';

type PeriodKind = 'all' | 'last_month';

const VERDICTS: { value: ReportVerdict; label: string; selectedCls: string }[] = [
  { value: 'good', label: 'Молодец', selectedCls: 'border-emerald-400 bg-emerald-50 text-emerald-800' },
  { value: 'ok', label: 'Есть над чем поработать', selectedCls: 'border-amber-400 bg-amber-50 text-amber-800' },
  { value: 'attention', label: 'Нужен контроль', selectedCls: 'border-rose-400 bg-rose-50 text-rose-800' },
];

function Pill({
  active, onClick, children,
}: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      style={{ touchAction: 'manipulation' }}
      className={cn(
        'min-h-[36px] rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30',
        active
          ? 'border-accent bg-accent/10 text-accent'
          : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50',
      )}
    >
      {children}
    </button>
  );
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (window.isSecureContext && navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* fallthrough to legacy fallback */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

export default function ParentReportDialog({
  open, onOpenChange, tutorStudentId,
}: { open: boolean; onOpenChange: (o: boolean) => void; tutorStudentId: string }) {
  const qc = useQueryClient();
  const [copied, setCopied] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  // Форма-конструктор.
  const [verdict, setVerdict] = useState<ReportVerdict | null>(null);
  const [showMockScore, setShowMockScore] = useState(true);
  const [showHwDone, setShowHwDone] = useState(true);
  const [showHwSuccess, setShowHwSuccess] = useState(true);
  const [periodKind, setPeriodKind] = useState<PeriodKind>('last_month');
  const [comment, setComment] = useState('');
  const [showDebt, setShowDebt] = useState(true);

  const linkQuery = useQuery({
    queryKey: ['tutor', 'report-link', tutorStudentId],
    queryFn: async () => {
      // Активная ссылка — ≤1 (partial unique index uq_student_report_links_active).
      // Отдельный запрос, НЕ .limit(10) по всем (мог скрыть старую активную при >10 ссылках).
      const { data: active, error: activeErr } = await supabase
        .from('student_report_links')
        .select('slug, verdict, show_mock_score, show_hw_done, show_hw_success, tutor_comment, period_kind, show_debt_line')
        .eq('tutor_student_id', tutorStudentId)
        .is('revoked_at', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (activeErr) throw new Error('Не удалось загрузить ссылку.');

      // Префилл комментария — из последнего отчёта (любого), если у активного его нет.
      let prefillComment = (active?.tutor_comment ?? '').trim();
      if (!prefillComment) {
        const { data: lastComment } = await supabase
          .from('student_report_links')
          .select('tutor_comment')
          .eq('tutor_student_id', tutorStudentId)
          .not('tutor_comment', 'is', null)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        prefillComment = (lastComment?.tutor_comment ?? '').trim();
      }

      // Память выбора «показывать оплату» (tutor-level) — для нового отчёта.
      const { data: sess } = await supabase.auth.getSession();
      const uid = sess.session?.user?.id ?? null;
      let debtDefault = true;
      if (uid) {
        const { data: t } = await supabase
          .from('tutors')
          .select('report_show_debt_default')
          .eq('user_id', uid)
          .maybeSingle();
        if (typeof t?.report_show_debt_default === 'boolean') debtDefault = t.report_show_debt_default;
      }
      return { activeLink: active ?? null, prefillComment, debtDefault, uid };
    },
    enabled: open,
    refetchOnWindowFocus: false,
  });

  // Seed формы из активной ссылки (или дефолтов), один раз на открытие.
  const seededRef = useRef(false);
  useEffect(() => {
    if (!open) { seededRef.current = false; return; }
    if (seededRef.current || linkQuery.isLoading) return;
    const d = linkQuery.data;
    if (!d) return;
    const a = d.activeLink;
    if (a) {
      setVerdict((a.verdict as ReportVerdict | null) ?? null);
      setShowMockScore(a.show_mock_score !== false);
      setShowHwDone(a.show_hw_done !== false);
      setShowHwSuccess(a.show_hw_success !== false);
      setPeriodKind(a.period_kind === 'all' ? 'all' : 'last_month');
      setComment(a.tutor_comment ?? '');
      setShowDebt(a.show_debt_line !== false);
    } else {
      setVerdict(null);
      setShowMockScore(true);
      setShowHwDone(true);
      setShowHwSuccess(true);
      setPeriodKind('last_month');
      setComment(d.prefillComment ?? '');
      setShowDebt(d.debtDefault);
    }
    seededRef.current = true;
  }, [open, linkQuery.isLoading, linkQuery.data]);

  const activeLink = linkQuery.data?.activeLink ?? null;
  const slug = activeLink?.slug ?? null;
  const url = slug ? `${REPORT_BASE_URL}/p/report/${slug}` : null;

  const commentRequired = verdict === 'ok' || verdict === 'attention';
  const commentMissing = commentRequired && comment.trim() === '';
  const verdictMissing = verdict === null;

  const saveLink = useMutation({
    mutationFn: async () => {
      if (verdict === null) throw new Error('Выберите вердикт.');
      if ((verdict === 'ok' || verdict === 'attention') && comment.trim() === '') {
        throw new Error('Добавьте комментарий — объясните родителю, на что обратить внимание.');
      }
      let periodStart: string | null = null;
      let periodEnd: string | null = null;
      if (periodKind === 'last_month') {
        // 30 календарных дат включительно: [today-29 … today].
        periodEnd = format(new Date(), 'yyyy-MM-dd');
        periodStart = format(subDays(new Date(), 29), 'yyyy-MM-dd');
      }
      const config = {
        verdict,
        show_mock_score: showMockScore,
        show_hw_done: showHwDone,
        show_hw_success: showHwSuccess,
        tutor_comment: comment.trim() || null,
        period_kind: periodKind,
        period_start: periodStart,
        period_end: periodEnd,
        show_debt_line: showDebt,
      };

      let resultSlug: string;
      if (activeLink) {
        // .is('revoked_at', null) + maybeSingle: если ссылку отозвали в другой вкладке,
        // UPDATE матчит 0 строк → upd=null → явная ошибка (а не «сохранилось вникуда»).
        const { data: upd, error } = await supabase
          .from('student_report_links')
          .update(config)
          .eq('slug', activeLink.slug)
          .is('revoked_at', null)
          .select('slug')
          .maybeSingle();
        if (error) {
          console.error('updateReportLink error:', error);
          throw new Error('Не удалось сохранить отчёт.');
        }
        if (!upd) throw new Error('Ссылка изменилась в другой вкладке — обновите страницу.');
        resultSlug = upd.slug;
      } else {
        const { data, error } = await supabase
          .from('student_report_links')
          .insert({ tutor_student_id: tutorStudentId, ...config })
          .select('slug')
          .single();
        if (error) {
          console.error('createReportLink error:', error);
          // 23505 = гонка двух вкладок против partial unique index (уже есть активная).
          if ((error as { code?: string }).code === '23505') {
            throw new Error('Ссылка уже создана в другой вкладке — обновите страницу.');
          }
          throw new Error('Не удалось создать ссылку.');
        }
        resultSlug = data.slug as string;
      }

      // Запомнить выбор «показывать оплату» (best-effort, не блокирует сохранение).
      const uid = linkQuery.data?.uid ?? null;
      if (uid) {
        await supabase.from('tutors').update({ report_show_debt_default: showDebt }).eq('user_id', uid);
      }
      return resultSlug;
    },
    onSuccess: (resultSlug) => {
      toast.success(activeLink ? 'Отчёт обновлён' : 'Ссылка создана — отправьте её родителю');
      qc.invalidateQueries({ queryKey: ['tutor', 'report-link', tutorStudentId] });
      // Свежий предпросмотр должен подтянуть новый конфиг.
      qc.invalidateQueries({ queryKey: ['public', 'student-report', resultSlug] });
    },
    onError: (e) => {
      toast.error(e instanceof Error ? e.message : 'Не удалось сохранить отчёт.');
      // На конфликте/устаревании перезагружаем активную ссылку (форма отразит факт).
      qc.invalidateQueries({ queryKey: ['tutor', 'report-link', tutorStudentId] });
    },
  });

  const revokeLink = useMutation({
    mutationFn: async (s: string) => {
      const { error } = await supabase
        .from('student_report_links')
        .update({ revoked_at: new Date().toISOString() })
        .eq('slug', s);
      if (error) throw new Error('Не удалось отозвать ссылку.');
    },
    onSuccess: () => {
      toast.success('Ссылка отозвана — отчёт по ней больше не открывается');
      qc.invalidateQueries({ queryKey: ['tutor', 'report-link', tutorStudentId] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Не удалось отозвать ссылку.'),
  });

  const handleCopy = async () => {
    if (!url) return;
    const ok = await copyToClipboard(url);
    if (ok) {
      setCopied(true);
      toast.success('Ссылка скопирована — отправьте её родителю');
      setTimeout(() => setCopied(false), 2000);
    } else {
      toast.error('Не удалось скопировать — выделите ссылку вручную');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Отчёт родителю</DialogTitle>
        </DialogHeader>

        {linkQuery.isLoading ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Загружаю…
          </div>
        ) : linkQuery.isError && !linkQuery.data ? (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <AlertCircle className="h-8 w-8 text-slate-300" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">Не удалось загрузить. Проверьте интернет и повторите.</p>
            <Button variant="outline" size="sm" onClick={() => linkQuery.refetch()}>Повторить</Button>
          </div>
        ) : (
          <div className="space-y-4 py-1">
            <p className="text-sm text-muted-foreground">
              Родитель открывает по ссылке (без входа) и сразу видит: молодец или нужен контроль,
              ключевые числа и нужно ли платить. Без решений задач и критериев.
            </p>

            {/* Вердикт (обязателен) */}
            <div>
              <label className="text-sm font-medium text-slate-700">Вердикт для родителя</label>
              <div className="mt-1.5 flex flex-wrap gap-2">
                {VERDICTS.map((v) => (
                  <button
                    key={v.value}
                    type="button"
                    onClick={() => setVerdict(v.value)}
                    aria-pressed={verdict === v.value}
                    style={{ touchAction: 'manipulation' }}
                    className={cn(
                      'min-h-[40px] rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30',
                      verdict === v.value
                        ? v.selectedCls
                        : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50',
                    )}
                  >
                    {v.label}
                  </button>
                ))}
              </div>
              {verdictMissing && (
                <p className="mt-1 text-xs text-rose-500">Выберите вердикт — это первое, что видит родитель.</p>
              )}
            </div>

            {/* Комментарий */}
            <div>
              <label htmlFor="report-comment" className="text-sm font-medium text-slate-700">
                Комментарий словами{commentRequired ? ' *' : ' (по желанию)'}
              </label>
              <textarea
                id="report-comment"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={3}
                placeholder="Напр.: Вася стал лучше решать механику, но в термодинамике пока много ошибок. Повторите с ним газовые законы."
                className={cn(
                  'mt-1.5 w-full resize-y rounded-lg border bg-white px-3 py-2 text-base text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-accent/30',
                  commentMissing ? 'border-rose-300' : 'border-slate-200',
                )}
              />
              {commentMissing && (
                <p className="mt-1 text-xs text-rose-500">
                  Добавьте пару фраз — родителю важно понять, на что обратить внимание.
                </p>
              )}
            </div>

            {/* Период */}
            <div>
              <label className="text-sm font-medium text-slate-700">Период</label>
              <div className="mt-1.5 flex flex-wrap gap-2">
                <Pill active={periodKind === 'last_month'} onClick={() => setPeriodKind('last_month')}>
                  За последний месяц
                </Pill>
                <Pill active={periodKind === 'all'} onClick={() => setPeriodKind('all')}>
                  За всё время
                </Pill>
              </div>
            </div>

            {/* Какие числа показать */}
            <div>
              <label className="text-sm font-medium text-slate-700">Показывать числа</label>
              <div className="mt-1.5 flex flex-wrap gap-2">
                <Pill active={showMockScore} onClick={() => setShowMockScore((v) => !v)}>Балл за пробник</Pill>
                <Pill active={showHwDone} onClick={() => setShowHwDone((v) => !v)}>Сделано ДЗ</Pill>
                <Pill active={showHwSuccess} onClick={() => setShowHwSuccess((v) => !v)}>Средний % верных</Pill>
              </div>
            </div>

            {/* Оплата */}
            <div>
              <label className="text-sm font-medium text-slate-700">Строка оплаты</label>
              <div className="mt-1.5 flex flex-wrap gap-2">
                <Pill active={showDebt} onClick={() => setShowDebt(true)}>Показывать</Pill>
                <Pill active={!showDebt} onClick={() => setShowDebt(false)}>Скрыть</Pill>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Скройте, если ведёте оплаты вне Сократа. Выбор запомнится для следующих отчётов.
              </p>
            </div>

            <Button
              onClick={() => saveLink.mutate()}
              disabled={saveLink.isPending || verdictMissing || commentMissing}
              className="min-h-[44px] w-full"
            >
              {saveLink.isPending ? (
                <><Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Сохраняю…</>
              ) : activeLink ? (
                'Сохранить изменения'
              ) : (
                'Создать ссылку для родителя'
              )}
            </Button>

            {/* Активная ссылка: копировать / предпросмотр / отозвать */}
            {url && (
              <div className="space-y-2 border-t border-slate-100 pt-3">
                <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-socrat-surface px-3 py-2">
                  <span className="min-w-0 flex-1 truncate text-sm tabular-nums text-slate-700">{url}</span>
                  <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-label="Скопировать ссылку" onClick={handleCopy}>
                    {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
                  </Button>
                  <a href={url} target="_blank" rel="noreferrer" aria-label="Открыть отчёт" className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md hover:bg-slate-100">
                    <ExternalLink className="h-4 w-4 text-slate-600" />
                  </a>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => setPreviewOpen(true)}>
                    <Eye className="mr-1.5 h-3.5 w-3.5" /> Предпросмотр
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground"
                    onClick={() => slug && revokeLink.mutate(slug)}
                    disabled={revokeLink.isPending}
                  >
                    <Link2Off className="mr-1.5 h-3.5 w-3.5" />
                    {revokeLink.isPending ? 'Отзываю…' : 'Отозвать ссылку'}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Закрыть</Button>
        </DialogFooter>
      </DialogContent>
      {slug && (
        <ReportPreviewDialog open={previewOpen} onOpenChange={setPreviewOpen} slug={slug} />
      )}
    </Dialog>
  );
}
