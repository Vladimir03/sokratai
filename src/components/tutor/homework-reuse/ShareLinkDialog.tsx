import { useCallback, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Copy,
  ExternalLink,
  Loader2,
  Share2,
  Trash2,
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { ru } from 'date-fns/locale';
import { toast } from 'sonner';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import {
  createHomeworkShareLink,
  deleteHomeworkShareLink,
  listHomeworkShareLinks,
  type HomeworkShareLink,
} from '@/lib/tutorHomeworkApi';
import { trackGuidedHomeworkEvent } from '@/lib/homeworkTelemetry';
import { cn } from '@/lib/utils';

interface ShareLinkDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  assignmentId: string;
  assignmentTitle: string;
}

const DEFAULT_EXPIRY_DAYS = 30;

/**
 * Share link creation + management dialog (homework-reuse-v1 TASK-7, AC-6).
 *
 * Two sections:
 *   1. «Новая ссылка» — toggles for show_answers / show_solutions / expiry,
 *      primary CTA «Создать ссылку». After create the URL appears inline with
 *      copy + open-in-new-tab buttons (not a separate modal to avoid nav churn).
 *   2. «Существующие ссылки» — list of all links for this assignment with
 *      flags chips, creation date, trash icon. Multiple links per assignment
 *      are intentional (родителю без ответов, коллеге с ответами).
 *
 * Telemetry (`homework_share_link_created`) fires exactly once per successful
 * create with a PII-free payload (no slug, no url). Delete is silent — product
 * decision: deletion is a cleanup, not an engagement signal worth tracking.
 *
 * Clipboard fallback: `navigator.clipboard.writeText` requires a secure context
 * (HTTPS or localhost). On preview deploys without HTTPS we fall back to the
 * legacy `document.execCommand('copy')` path via a hidden textarea so Safari
 * preview parity survives.
 */
export function ShareLinkDialog({
  open,
  onOpenChange,
  assignmentId,
  assignmentTitle,
}: ShareLinkDialogProps) {
  const queryClient = useQueryClient();
  const [showAnswers, setShowAnswers] = useState(false);
  const [showSolutions, setShowSolutions] = useState(false);
  const [hasExpiry, setHasExpiry] = useState(false);
  const [creating, setCreating] = useState(false);
  const [lastCreated, setLastCreated] = useState<HomeworkShareLink | null>(null);
  const [deletingSlug, setDeletingSlug] = useState<string | null>(null);

  const listQuery = useQuery({
    queryKey: ['tutor', 'homework', 'share-links', assignmentId],
    queryFn: () => listHomeworkShareLinks(assignmentId),
    enabled: open && Boolean(assignmentId),
    staleTime: 30_000,
  });

  // Reset transient state whenever the dialog re-opens so a previous session's
  // toggles / lastCreated don't bleed across opens.
  useEffect(() => {
    if (open) {
      setShowAnswers(false);
      setShowSolutions(false);
      setHasExpiry(false);
      setLastCreated(null);
    }
  }, [open]);

  const handleCreate = useCallback(async () => {
    if (creating) return;
    setCreating(true);
    try {
      const link = await createHomeworkShareLink(assignmentId, {
        show_answers: showAnswers,
        show_solutions: showSolutions,
        expires_in_days: hasExpiry ? DEFAULT_EXPIRY_DAYS : undefined,
      });
      setLastCreated(link);
      trackGuidedHomeworkEvent('homework_share_link_created', {
        assignmentId,
        showAnswers,
        showSolutions,
        hasExpiry,
      });
      queryClient.invalidateQueries({
        queryKey: ['tutor', 'homework', 'share-links', assignmentId],
      });
      toast.success('Ссылка создана');
    } catch (err) {
      toast.error('Не удалось создать ссылку');
      console.error('share_link_create_failed', err);
    } finally {
      setCreating(false);
    }
  }, [assignmentId, creating, hasExpiry, queryClient, showAnswers, showSolutions]);

  const handleDelete = useCallback(
    async (slug: string) => {
      if (deletingSlug) return;
      setDeletingSlug(slug);
      try {
        await deleteHomeworkShareLink(slug);
        if (lastCreated?.slug === slug) setLastCreated(null);
        queryClient.invalidateQueries({
          queryKey: ['tutor', 'homework', 'share-links', assignmentId],
        });
        toast.success('Ссылка удалена');
      } catch (err) {
        toast.error('Не удалось удалить ссылку');
        console.error('share_link_delete_failed', err);
      } finally {
        setDeletingSlug(null);
      }
    },
    [assignmentId, deletingSlug, lastCreated?.slug, queryClient],
  );

  const copyToClipboard = useCallback(async (value: string) => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(value);
        toast.success('Ссылка скопирована');
        return;
      }
    } catch {
      // fall through to legacy path
    }
    // Legacy fallback for insecure contexts (e.g. http preview on iOS Safari).
    try {
      const textarea = document.createElement('textarea');
      textarea.value = value;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.top = '0';
      textarea.style.left = '0';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(textarea);
      if (ok) {
        toast.success('Ссылка скопирована');
      } else {
        toast.error('Не удалось скопировать. Скопируйте вручную.');
      }
    } catch {
      toast.error('Не удалось скопировать. Скопируйте вручную.');
    }
  }, []);

  const items = listQuery.data ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Share2 className="h-5 w-5 text-accent" aria-hidden="true" />
            Поделиться ссылкой
          </DialogTitle>
          <DialogDescription>
            Публичная read-only ссылка на ДЗ «{assignmentTitle}». Можно создать
            несколько ссылок с разными настройками.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* Section 1 — new link */}
          <section className="space-y-4" aria-labelledby="share-new-heading">
            <h3
              id="share-new-heading"
              className="text-sm font-semibold text-slate-900"
            >
              Новая ссылка
            </h3>

            <div className="space-y-3">
              <ToggleRow
                id="share-show-answers"
                label="С ответами"
                description="Включит correct_answer в публичную страницу"
                checked={showAnswers}
                onCheckedChange={setShowAnswers}
                disabled={creating}
              />
              <ToggleRow
                id="share-show-solutions"
                label="С решениями"
                description="Включит текст и фото эталонного решения"
                checked={showSolutions}
                onCheckedChange={setShowSolutions}
                disabled={creating}
              />
              <ToggleRow
                id="share-has-expiry"
                label={`Истекает через ${DEFAULT_EXPIRY_DAYS} дней`}
                description="Ссылка перестанет открываться после срока"
                checked={hasExpiry}
                onCheckedChange={setHasExpiry}
                disabled={creating}
              />
            </div>

            <Button
              type="button"
              onClick={handleCreate}
              disabled={creating}
              className="w-full"
            >
              {creating ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Создаём...
                </>
              ) : (
                'Создать ссылку'
              )}
            </Button>

            {lastCreated ? (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2">
                <Label
                  htmlFor="share-link-result"
                  className="text-xs font-medium text-slate-600"
                >
                  Готово — скопируйте ссылку
                </Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="share-link-result"
                    readOnly
                    value={lastCreated.url}
                    className="flex-1 text-base tabular-nums"
                    onFocus={(e) => e.currentTarget.select()}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() => copyToClipboard(lastCreated.url)}
                    aria-label="Скопировать ссылку"
                    title="Скопировать ссылку"
                    className="shrink-0"
                  >
                    <Copy className="h-4 w-4" aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    asChild
                    className="shrink-0"
                  >
                    <a
                      href={lastCreated.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label="Открыть в новой вкладке"
                      title="Открыть в новой вкладке"
                    >
                      <ExternalLink className="h-4 w-4" aria-hidden="true" />
                    </a>
                  </Button>
                </div>
              </div>
            ) : null}
          </section>

          {/* Section 2 — existing links */}
          <section className="space-y-3" aria-labelledby="share-list-heading">
            <h3
              id="share-list-heading"
              className="text-sm font-semibold text-slate-900"
            >
              Существующие ссылки
            </h3>

            {listQuery.isLoading ? (
              <div className="text-sm text-slate-500 py-4 text-center">
                Загружаем...
              </div>
            ) : items.length === 0 ? (
              <p className="text-sm text-slate-500">
                Пока нет активных ссылок.
              </p>
            ) : (
              <ul className="space-y-2 max-h-64 overflow-y-auto">
                {items.map((item) => (
                  <ShareLinkRow
                    key={item.slug}
                    item={item}
                    onCopy={copyToClipboard}
                    onDelete={handleDelete}
                    isDeleting={deletingSlug === item.slug}
                  />
                ))}
              </ul>
            )}
          </section>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Закрыть
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface ToggleRowProps {
  id: string;
  label: string;
  description?: string;
  checked: boolean;
  onCheckedChange: (value: boolean) => void;
  disabled?: boolean;
}

function ToggleRow({
  id,
  label,
  description,
  checked,
  onCheckedChange,
  disabled,
}: ToggleRowProps) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0 space-y-0.5">
        <Label htmlFor={id} className="text-sm font-medium text-slate-900 cursor-pointer">
          {label}
        </Label>
        {description ? (
          <p className="text-xs text-slate-500">{description}</p>
        ) : null}
      </div>
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        className="mt-0.5 shrink-0"
      />
    </div>
  );
}

interface ShareLinkRowProps {
  item: HomeworkShareLink;
  onCopy: (value: string) => void;
  onDelete: (slug: string) => void;
  isDeleting: boolean;
}

function ShareLinkRow({ item, onCopy, onDelete, isDeleting }: ShareLinkRowProps) {
  const expiryLabel = formatExpiryLabel(item.expires_at);
  const createdLabel = formatCreatedAt(item.created_at);

  return (
    <li className="rounded-lg border border-slate-200 p-3 space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {item.show_answers ? (
          <FlagChip tone="amber">С ответами</FlagChip>
        ) : null}
        {item.show_solutions ? (
          <FlagChip tone="rose">С решениями</FlagChip>
        ) : null}
        {expiryLabel ? (
          <FlagChip tone="slate">{expiryLabel}</FlagChip>
        ) : null}
        {!item.show_answers && !item.show_solutions && !expiryLabel ? (
          <FlagChip tone="slate">Только условия</FlagChip>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        <code className="flex-1 truncate text-xs text-slate-600 bg-slate-50 rounded px-2 py-1">
          {item.url}
        </code>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => onCopy(item.url)}
          aria-label="Скопировать ссылку"
          title="Скопировать ссылку"
          className="shrink-0 h-8 w-8"
        >
          <Copy className="h-4 w-4" aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => onDelete(item.slug)}
          disabled={isDeleting}
          aria-label="Удалить ссылку"
          title="Удалить ссылку"
          className={cn('shrink-0 h-8 w-8', 'text-red-600 hover:bg-red-50 hover:text-red-700')}
        >
          {isDeleting ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          )}
        </Button>
      </div>
      {createdLabel ? (
        <p className="text-xs text-slate-400">Создана {createdLabel}</p>
      ) : null}
    </li>
  );
}

interface FlagChipProps {
  tone: 'amber' | 'rose' | 'slate';
  children: React.ReactNode;
}

function FlagChip({ tone, children }: FlagChipProps) {
  const toneClass =
    tone === 'amber'
      ? 'bg-amber-100 text-amber-900 border-amber-200'
      : tone === 'rose'
      ? 'bg-rose-100 text-rose-900 border-rose-200'
      : 'bg-slate-100 text-slate-700 border-slate-200';
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium',
        toneClass,
      )}
    >
      {children}
    </span>
  );
}

function safeFormat(iso: string | null, pattern: string): string | null {
  if (!iso) return null;
  try {
    return format(parseISO(iso), pattern, { locale: ru });
  } catch {
    return null;
  }
}

function formatExpiryLabel(isoOrNull: string | null): string | null {
  const formatted = safeFormat(isoOrNull, 'd MMMM');
  return formatted ? `Истекает ${formatted}` : null;
}

function formatCreatedAt(iso: string): string {
  return safeFormat(iso, 'd MMMM, HH:mm') ?? iso;
}
