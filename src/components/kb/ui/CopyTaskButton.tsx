/**
 * Copy task text to clipboard.
 * Job: E2 — переиспользовать задачу за пределами Сократа (doc 16, принцип 17)
 */

import { useState, useCallback } from 'react';
import { Check, Copy } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { KBTask } from '@/types/kb';

const IMAGE_ONLY_MARKERS = ['[Задача на фото]', '[задача на фото]'];

function isImageOnlyTask(task: KBTask): boolean {
  return !task.text?.trim()
    || IMAGE_ONLY_MARKERS.includes(task.text.trim())
    || (task.text.trim().length < 20 && !!task.attachment_url);
}

interface CopyTaskButtonProps {
  task: KBTask;
  className?: string;
}

export function CopyTaskButton({ task, className }: CopyTaskButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    let text: string;

    if (isImageOnlyTask(task)) {
      text = '(см. изображение задачи)';
    } else {
      text = task.text || '';
      // Append image placeholder for mixed text+image tasks
      if (task.attachment_url) {
        text += '\n\n[см. рисунок]';
      }
    }

    if (task.answer) {
      text += `\n\nОтвет: ${task.answer}`;
    }

    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API may fail in insecure context — silently ignore
    }
  }, [task]);

  const Icon = copied ? Check : Copy;

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={cn(
        'inline-flex items-center justify-center rounded-xl border border-slate-200 p-2 text-slate-500 transition-all duration-200 hover:border-slate-300 hover:text-slate-700',
        copied && 'border-socrat-primary/30 text-socrat-primary',
        className,
      )}
      title="Копировать"
      aria-label="Копировать задачу"
    >
      <Icon className="h-3.5 w-3.5" />
    </button>
  );
}
