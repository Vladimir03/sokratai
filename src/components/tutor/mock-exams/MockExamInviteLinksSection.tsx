// Mock Exams v1 — FIX-4b: история публичных ссылок в кабинете.
//
// Job: репетитор хочет видеть все ранее созданные lead-ссылки на пробник
// и иметь возможность создать новую (если забыл при назначении или
// захотел сделать вторую). Без секции репетитор теряет ссылку из toast'а
// или из модалки и не может её восстановить.
//
// Контракт:
// - Используется в TutorMockExamDetail. НЕ рендерится для mode='manual_entry'
//   (на этих assignment'ах backend отклоняет invite-link с INVALID_MODE).
// - React Query key: ['tutor','mock-exams','invite-links', assignmentId]
//   (см. .claude/rules/performance.md §2c — обязательный tutor-prefix).
// - Создание новой ссылки → cache invalidation + LeadLinkSuccessDialog с
//   новой ссылкой, с copy button.
// - Revoke / expiry editor — Phase 2 (отдельная итерация).

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Check,
  Copy,
  ExternalLink,
  Link2,
  Loader2,
  Plus,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  createMockExamInviteLink,
  listMockExamInviteLinks,
  MockExamApiError,
} from '@/lib/mockExamApi';
import type { MockExamInviteLink } from '@/types/mockExam';
import { LeadLinkSuccessDialog } from './LeadLinkSuccessDialog';
import { cn } from '@/lib/utils';

const QUERY_KEY = (assignmentId: string) =>
  ['tutor', 'mock-exams', 'invite-links', assignmentId] as const;

async function copyToClipboard(text: string): Promise<boolean> {
  if (
    typeof navigator !== 'undefined' &&
    navigator.clipboard &&
    typeof window !== 'undefined' &&
    window.isSecureContext
  ) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fall through
    }
  }
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'absolute';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

function formatDateTime(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return iso;
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(ms);
}

function formatExpiry(iso: string | null): string {
  if (!iso) return 'без срока';
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return iso;
  if (ms < Date.now()) return 'истекла';
  return `до ${new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'short',
  }).format(ms)}`;
}

interface InviteLinkRowProps {
  item: MockExamInviteLink;
}

function InviteLinkRow({ item }: InviteLinkRowProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    const ok = await copyToClipboard(item.url);
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    }
  };

  const expiresAt = item.expires_at ?? null;
  const isExpired = expiresAt
    ? Date.parse(expiresAt) < Date.now()
    : false;

  return (
    <div
      className={cn(
        'rounded-md border p-3 sm:p-3.5',
        isExpired
          ? 'border-slate-200 bg-slate-50 opacity-70'
          : 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900',
      )}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1">
          <p
            className="break-all font-mono text-xs text-slate-700 dark:text-slate-200"
            title={item.url}
          >
            {item.url}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Создана {formatDateTime(item.created_at)} ·{' '}
            <span className={isExpired ? 'text-rose-600' : ''}>
              {formatExpiry(expiresAt)}
            </span>
          </p>
        </div>
        <div className="flex flex-shrink-0 items-center gap-1.5">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="touch-manipulation"
            onClick={() => void handleCopy()}
            aria-label="Скопировать ссылку"
          >
            {copied ? (
              <Check className="h-4 w-4 text-emerald-600" aria-hidden="true" />
            ) : (
              <Copy className="h-4 w-4" aria-hidden="true" />
            )}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            asChild
            className="touch-manipulation"
            aria-label="Открыть превью ссылки"
          >
            <a href={item.url} target="_blank" rel="noreferrer">
              <ExternalLink className="h-4 w-4" aria-hidden="true" />
            </a>
          </Button>
        </div>
      </div>
    </div>
  );
}

export interface MockExamInviteLinksSectionProps {
  assignmentId: string;
  /**
   * Mode assignment'а — для скрытия секции на manual_entry, где invite-link
   * не разрешены (см. handleCreateInviteLink → INVALID_MODE).
   */
  mode: 'blank' | 'form' | 'manual_entry';
}

export function MockExamInviteLinksSection({
  assignmentId,
  mode,
}: MockExamInviteLinksSectionProps) {
  const queryClient = useQueryClient();
  const [successLink, setSuccessLink] = useState<MockExamInviteLink | null>(
    null,
  );

  const isAvailable = mode !== 'manual_entry';

  const query = useQuery({
    queryKey: QUERY_KEY(assignmentId),
    queryFn: () => listMockExamInviteLinks(assignmentId),
    enabled: isAvailable && Boolean(assignmentId),
    staleTime: 60_000,
  });

  const createMutation = useMutation({
    mutationFn: () => createMockExamInviteLink(assignmentId, {}),
    onSuccess: async (link) => {
      // Best-effort copy сразу — модалка всё равно покажет ссылку.
      void copyToClipboard(link.url);
      setSuccessLink(link);
      await queryClient.invalidateQueries({
        queryKey: QUERY_KEY(assignmentId),
      });
    },
    onError: (err) => {
      const msg =
        err instanceof MockExamApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Не удалось создать ссылку';
      toast.error(`Публичная ссылка не создана: ${msg}`);
    },
  });

  if (!isAvailable) return null;

  const items = query.data ?? [];

  return (
    <>
      <Card animate={false}>
        <CardContent className="space-y-3 p-5">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900 dark:text-slate-100">
                <Link2 className="h-4 w-4 text-accent" aria-hidden="true" />
                Публичные ссылки
              </h3>
              <p className="mt-0.5 text-xs text-muted-foreground leading-relaxed">
                Можно отправить родителям и потенциальным ученикам. Часть 1
                проверится автоматически, Часть 2 уйдёт тебе на подтверждение.
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="flex-shrink-0 touch-manipulation"
              onClick={() => createMutation.mutate()}
              disabled={createMutation.isPending}
            >
              {createMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" aria-hidden="true" />
              ) : (
                <Plus className="h-4 w-4 mr-1.5" aria-hidden="true" />
              )}
              {createMutation.isPending ? 'Создаём…' : 'Создать ссылку'}
            </Button>
          </div>

          {query.isLoading && (
            <div className="space-y-2">
              <Skeleton className="h-14 w-full rounded-md" />
              <Skeleton className="h-14 w-full rounded-md" />
            </div>
          )}

          {!query.isLoading && query.error && (
            <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">
              Не удалось загрузить ссылки.{' '}
              <button
                type="button"
                onClick={() => void query.refetch()}
                className="underline underline-offset-2 hover:no-underline"
              >
                Повторить
              </button>
            </div>
          )}

          {!query.isLoading && !query.error && items.length === 0 && (
            <p className="text-sm text-muted-foreground py-1">
              Пока ни одной публичной ссылки. Нажми «Создать ссылку» — её можно
              сразу скопировать и отправить.
            </p>
          )}

          {!query.isLoading && !query.error && items.length > 0 && (
            <div className="space-y-2">
              {items.map((item) => (
                <InviteLinkRow key={item.slug} item={item} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <LeadLinkSuccessDialog
        open={successLink !== null}
        url={successLink?.url ?? ''}
        studentCount={0}
        onClose={() => setSuccessLink(null)}
      />
    </>
  );
}
