import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Check, Copy, ExternalLink, Eye, Link2Off, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabaseClient';
import { fetchPublicStudentReport } from '@/lib/publicReportApi';
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

// «Отчёт родителю» (Phase 2c) — share-ссылка на публичный read-only отчёт
// (/p/report/:slug). slug = bearer: знание ссылки = доступ; «Отозвать» гасит её
// (страница покажет «ссылка больше не действует»). Создание/отзыв — PostgREST + RLS
// (owns_tutor_student); публичное чтение — service_role edge (anti-leak whitelist).

// Родителю шлём ПРОД-домен (ссылка живёт у родителя в чате).
const REPORT_BASE_URL = 'https://sokratai.ru';

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

  const linkQuery = useQuery({
    queryKey: ['tutor', 'report-link', tutorStudentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('student_report_links')
        .select('slug, created_at')
        .eq('tutor_student_id', tutorStudentId)
        .is('revoked_at', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw new Error('Не удалось загрузить ссылку.');
      return data; // null = активной ссылки нет
    },
    enabled: open,
    refetchOnWindowFocus: false,
  });

  const createLink = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase
        .from('student_report_links')
        .insert({ tutor_student_id: tutorStudentId })
        .select('slug')
        .single();
      if (error) {
        console.error('createReportLink error:', error);
        throw new Error('Не удалось создать ссылку.');
      }
      return data.slug as string;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tutor', 'report-link', tutorStudentId] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Не удалось создать ссылку.'),
  });

  const revokeLink = useMutation({
    mutationFn: async (slug: string) => {
      const { error } = await supabase
        .from('student_report_links')
        .update({ revoked_at: new Date().toISOString() })
        .eq('slug', slug);
      if (error) throw new Error('Не удалось отозвать ссылку.');
    },
    onSuccess: () => {
      toast.success('Ссылка отозвана — отчёт по ней больше не открывается');
      qc.invalidateQueries({ queryKey: ['tutor', 'report-link', tutorStudentId] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Не удалось отозвать ссылку.'),
  });

  const slug = linkQuery.data?.slug ?? null;
  const url = slug ? `${REPORT_BASE_URL}/p/report/${slug}` : null;

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
        <div className="space-y-3 py-2">
          <p className="text-sm text-muted-foreground">
            Страница для родителя: прогресс (цель, балл, последние работы) и баланс
            с выпиской. Без решений задач и критериев. Открывается без входа — по ссылке.
          </p>

          {linkQuery.isLoading ? (
            <div className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Загружаю ссылку…
            </div>
          ) : url ? (
            <div className="space-y-2">
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
          ) : (
            <Button onClick={() => createLink.mutate()} disabled={createLink.isPending} className="min-h-[44px]">
              {createLink.isPending ? (
                <><Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Создаю…</>
              ) : (
                'Создать ссылку для родителя'
              )}
            </Button>
          )}
        </div>
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
