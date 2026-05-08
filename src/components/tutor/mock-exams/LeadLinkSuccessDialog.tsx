// Mock Exams v1 — FIX-4a: lead-link success modal.
//
// Job: после создания пробника + публичной ссылки репетитор должен
// успеть скопировать ссылку и отправить родителю/ученику ДО навигации
// на detail-страницу. Toast'а недостаточно — он автоматически исчезает,
// и репетитор не успевает скопировать URL вручную, если writeText
// заблокирован браузером.
//
// Контракт:
// - Открывается, когда `url` непустой и `open=true`.
// - Closeable только через явное действие (`onClose`) — не через
//   `onOpenChange(false)` snap-close, чтобы случайный клик мимо не
//   потерял ссылку (редактору важно сначала её сохранить).
// - При close → caller делает navigate на detail-страницу.

import { useState } from 'react';
import { Check, Copy, ExternalLink, Link2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

async function copyToClipboard(text: string): Promise<boolean> {
  // Primary: Async Clipboard API (HTTPS / localhost).
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
      // fall through to legacy
    }
  }
  // Fallback: legacy execCommand для http preview / Safari < 15.4.
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

function pluralStudents(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return 'ученику';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20))
    return 'ученикам';
  return 'ученикам';
}

export interface LeadLinkSuccessDialogProps {
  open: boolean;
  url: string;
  studentCount: number;
  onClose: () => void;
}

export function LeadLinkSuccessDialog({
  open,
  url,
  studentCount,
  onClose,
}: LeadLinkSuccessDialogProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!url) return;
    const ok = await copyToClipboard(url);
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    }
  };

  const studentLine =
    studentCount > 0
      ? `Пробник назначен ${studentCount} ${pluralStudents(studentCount)}.`
      : 'Пробник создан.';

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="h-5 w-5 text-accent" aria-hidden="true" />
            Публичная ссылка готова
          </DialogTitle>
          <DialogDescription>
            {studentLine} Кроме твоих учеников, пробник теперь доступен по ссылке
            ниже — её можно отправить родителям и потенциальным ученикам.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Ссылка
            </p>
            <p
              className="mt-1 break-all font-mono text-sm text-slate-900 dark:text-slate-100"
              data-testid="mock-exam-lead-link-url"
            >
              {url || '—'}
            </p>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              type="button"
              variant="outline"
              className="flex-1 touch-manipulation"
              onClick={() => void handleCopy()}
              disabled={!url}
            >
              {copied ? (
                <>
                  <Check
                    className="h-4 w-4 mr-2 text-emerald-600"
                    aria-hidden="true"
                  />
                  Скопировано
                </>
              ) : (
                <>
                  <Copy className="h-4 w-4 mr-2" aria-hidden="true" />
                  Скопировать ссылку
                </>
              )}
            </Button>
            <Button
              type="button"
              variant="outline"
              asChild
              className="flex-1 touch-manipulation"
              disabled={!url}
            >
              <a href={url} target="_blank" rel="noreferrer">
                <ExternalLink className="h-4 w-4 mr-2" aria-hidden="true" />
                Открыть превью
              </a>
            </Button>
          </div>

          <div
            className={cn(
              'rounded-md border p-3 text-sm leading-relaxed',
              'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200',
            )}
          >
            <p className="font-medium">Что увидит человек по ссылке</p>
            <ul className="mt-1.5 space-y-1 list-disc list-inside">
              <li>
                Пройдёт пробник без регистрации — оставит имя, телефон и согласие
                на обработку данных.
              </li>
              <li>
                Часть 1 проверится автоматически и появится сразу.
              </li>
              <li>
                Часть 2 уйдёт тебе на проверку — отправится по результату только
                после твоего подтверждения.
              </li>
            </ul>
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            className="touch-manipulation"
            onClick={onClose}
          >
            Перейти к пробнику
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
