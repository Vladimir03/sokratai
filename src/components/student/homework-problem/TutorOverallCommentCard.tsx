import { MessageSquare } from 'lucide-react';

/**
 * Phase 12 (2026-06-07): общий комментарий репетитора ко ВСЕМУ ДЗ для этого
 * ученика (per-student wrap-up, напр. «Вася, ты молодец, но было две ошибки на
 * закон Ома, повтори его»). Read-only для ученика.
 *
 * Рендерится на экране задачи (`HomeworkProblem`): в left aside на
 * desktop/tablet + в mobile peek. Возвращает `null`, если комментария нет —
 * безопасно вызывать всегда. Plain text (`whitespace-pre-wrap`); LaTeX не
 * рендерим (комментарий — человеческая обратная связь, не формулы).
 */
export function TutorOverallCommentCard({
  comment,
}: {
  comment: string | null | undefined;
}) {
  if (!comment || comment.trim().length === 0) return null;
  return (
    <div className="rounded-xl border border-accent/30 bg-accent/5 p-3">
      <div className="mb-1.5 flex items-center gap-1.5 text-[13px] font-bold text-accent">
        <MessageSquare className="h-4 w-4" aria-hidden="true" />
        Комментарий репетитора
      </div>
      <p className="m-0 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
        {comment}
      </p>
    </div>
  );
}
