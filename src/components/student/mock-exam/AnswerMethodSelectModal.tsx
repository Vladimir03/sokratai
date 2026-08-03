import { useState } from 'react';
import { CheckCircle2, FileText, Keyboard, Pencil } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { MockExamAnswerMethod } from '@/types/mockExam';

interface AnswerMethodSelectModalProps {
  open: boolean;
  /** Currently persisted method (if any) — для выделения выбранной карточки при switch'е. */
  currentMethod?: MockExamAnswerMethod | null;
  /** Скрыть/показать confirm shortcut (switch flow vs first open). */
  confirmLabel?: string;
  isSubmitting?: boolean;
  onSelect: (method: MockExamAnswerMethod) => void;
  /** First open — не позволяем закрыть, ученик должен выбрать. Switch — есть Cancel. */
  onCancel?: () => void;
  /**
   * Способ по умолчанию + бейдж «Рекомендуем» (репорт Ульяны 2026-08-02).
   * Раньше `blank` был захардкожен и преселекчен ВСЕГДА — независимо от
   * предмета и от режима, который выбрал репетитор. Ученик по химии просто
   * нажимал «Начать» и попадал в бланк-режим, для которого у его варианта нет
   * ни официального бланка, ни PDF с условиями.
   */
  recommended?: MockExamAnswerMethod;
  /**
   * Есть ли официальный PDF бланка ФИПИ (сейчас только физика ЕГЭ). Без него
   * обещание «скачай официальный бланк» — ложь: ученик пишет на обычном листе.
   */
  blankHasOfficialPdf?: boolean;
}

function buildMethodCards(blankHasOfficialPdf: boolean): Array<{
  method: MockExamAnswerMethod;
  title: string;
  icon: typeof Pencil;
  description: string;
  highlights: string[];
}> {
  return [
    {
      method: 'blank',
      title: blankHasOfficialPdf
        ? 'Заполнить бланк ФИПИ от руки'
        : 'Написать ответы от руки',
      icon: Pencil,
      description: blankHasOfficialPdf
        ? 'Тренировка как на настоящем ЕГЭ. Скачай официальный бланк, заполни ручкой, сфотографируй.'
        : 'Запиши ответы Части 1 на листе (номер задания → ответ) и сфотографируй. Официального бланка для этого предмета у нас пока нет.',
      highlights: [
        blankHasOfficialPdf
          ? 'Привыкаешь к настоящему формату'
          : 'Ближе к тому, как пишешь на экзамене',
        'На экзамене одна ошибка в клеточке = минус балл',
        'Условия задач видны на экране, скрыты только поля ввода',
      ],
    },
    {
      method: 'form',
      title: 'Ввести ответы цифрой',
      icon: Keyboard,
      description: 'Удобно для быстрой проверки. Часть 1 вводится через поля на экране.',
      highlights: [
        'Быстрее без печати бланка',
        'Ответы проверятся автоматически сразу после сдачи',
        'Переключиться на бланк можно в любой момент',
      ],
    },
  ];
}

export function AnswerMethodSelectModal({
  open,
  currentMethod = null,
  confirmLabel = 'Начать',
  isSubmitting = false,
  onSelect,
  onCancel,
  recommended = 'blank',
  blankHasOfficialPdf = true,
}: AnswerMethodSelectModalProps) {
  const [pending, setPending] = useState<MockExamAnswerMethod | null>(
    currentMethod ?? recommended,
  );
  const methodCards = buildMethodCards(blankHasOfficialPdf);

  const handleConfirm = () => {
    if (!pending) return;
    onSelect(pending);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && onCancel) onCancel();
      }}
    >
      <DialogContent
        className="max-w-2xl sm:max-w-3xl"
        onInteractOutside={(e) => {
          if (!onCancel) e.preventDefault();
        }}
        onEscapeKeyDown={(e) => {
          if (!onCancel) e.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold">
            Как будешь отвечать?
          </DialogTitle>
          <DialogDescription className="text-base text-slate-600">
            Выбери способ для Части 1. Часть 2 в обоих вариантах — фото решений.
            Переключиться можно в любой момент.
          </DialogDescription>
        </DialogHeader>

        <div className="my-2 grid gap-3 md:grid-cols-2">
          {methodCards.map((card) => {
            const Icon = card.icon;
            const isPending = pending === card.method;
            const isRecommended = card.method === recommended;
            return (
              <button
                key={card.method}
                type="button"
                onClick={() => setPending(card.method)}
                aria-pressed={isPending}
                className={cn(
                  'group relative flex w-full flex-col gap-3 rounded-lg border-2 bg-white p-4 text-left transition-all',
                  'min-h-[200px] touch-manipulation',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2',
                  isPending
                    ? 'border-emerald-600 bg-emerald-50 shadow-md'
                    : 'border-slate-200 hover:border-emerald-300 hover:bg-emerald-50/30',
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  {isRecommended ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-600 px-2 py-0.5 text-xs font-semibold text-white">
                      Рекомендуем
                    </span>
                  ) : (
                    <span aria-hidden />
                  )}
                  {isPending && (
                    <CheckCircle2
                      className="h-5 w-5 flex-shrink-0 text-emerald-600"
                      aria-hidden
                    />
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Icon className="h-6 w-6 flex-shrink-0 text-emerald-700" aria-hidden />
                  <h3 className="text-base font-semibold text-slate-900">{card.title}</h3>
                </div>
                <p className="text-sm text-slate-700 leading-6">{card.description}</p>
                <ul className="space-y-1 text-sm text-slate-600">
                  {card.highlights.map((h, i) => (
                    <li key={i} className="flex gap-2">
                      <FileText className="mt-0.5 h-4 w-4 flex-shrink-0 text-slate-400" aria-hidden />
                      <span>{h}</span>
                    </li>
                  ))}
                </ul>
              </button>
            );
          })}
        </div>

        <DialogFooter className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          {onCancel && (
            <Button
              type="button"
              variant="outline"
              onClick={onCancel}
              disabled={isSubmitting}
            >
              Отмена
            </Button>
          )}
          <Button
            type="button"
            onClick={handleConfirm}
            disabled={!pending || isSubmitting}
            className="bg-emerald-600 hover:bg-emerald-700"
          >
            {isSubmitting ? 'Сохраняем…' : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
