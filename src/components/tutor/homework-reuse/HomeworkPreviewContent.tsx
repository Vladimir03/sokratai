/**
 * Shared preview content component for homework-reuse-v1.
 *
 * Used by:
 * - `/tutor/homework/:id/preview` (TASK-3, TutorHomeworkPreview)
 * - `/p/:slug` (TASK-4, PublicHomeworkShare) — wire-format matches
 *   `PublicShareTask` in `src/lib/publicShareApi.ts` exactly.
 *
 * Stateless — no data fetching, no auth context, no dependency on
 * TutorHomeworkDetail. All image refs are pre-resolved to direct/signed
 * URLs by the caller before the task shape is passed in.
 *
 * AC-2: вертикальный scroll, MathText, картинки max-height: 300px, click →
 *       fullscreen zoom (via shared PhotoGallery).
 * AC-3: showAnswers / showSolutions флаги управляют видимостью correct_answer
 *       и solution block.
 * AC-12: rubric_* НЕ в типе — не попадает сюда ни на одном из путей.
 */

import { memo } from 'react';
import { MathText } from '@/components/kb/ui/MathText';
import { PhotoGallery } from '@/components/homework/shared/PhotoGallery';

export interface HomeworkPreviewTask {
  id: string;
  order_num: number;
  task_text: string;
  max_score: number;
  /** KIM number when origin ДЗ сохранил provenance к KB (public path). Tutor path передаёт null. */
  kim_number: number | null;
  check_format: 'short_answer' | 'detailed_solution' | null;
  /** Already resolved direct/signed URLs ready for `<img>`. */
  task_image_urls: string[];
  correct_answer?: string | null;
  solution_text?: string | null;
  /** Already resolved direct/signed URLs ready for `<img>`. */
  solution_image_urls?: string[];
}

export interface HomeworkPreviewContentProps {
  title: string;
  tasks: HomeworkPreviewTask[];
  showAnswers: boolean;
  showSolutions: boolean;
}

function scoreNoun(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return 'баллов';
  if (mod10 === 1) return 'балл';
  if (mod10 >= 2 && mod10 <= 4) return 'балла';
  return 'баллов';
}

const PreviewTaskCard = memo(function PreviewTaskCard({
  task,
  showAnswers,
  showSolutions,
}: {
  task: HomeworkPreviewTask;
  showAnswers: boolean;
  showSolutions: boolean;
}) {
  const hasSolutionBlock =
    showSolutions &&
    ((task.solution_text && task.solution_text.trim().length > 0) ||
      (task.solution_image_urls?.length ?? 0) > 0);

  return (
    <article
      className="preview-task rounded-lg border border-slate-200 bg-white p-5 sm:p-6"
      aria-label={`Задача ${task.order_num}`}
    >
      <header className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-slate-900">
        <h2 className="text-lg font-semibold tabular-nums">
          Задача №{task.order_num}
        </h2>
        {task.kim_number != null ? (
          <span className="text-sm text-slate-500 tabular-nums">
            · ЕГЭ №{task.kim_number}
          </span>
        ) : null}
        <span className="text-sm text-slate-500 tabular-nums">
          · {task.max_score} {scoreNoun(task.max_score)}
        </span>
      </header>

      <MathText
        text={task.task_text}
        className="text-base leading-relaxed text-slate-900 whitespace-pre-wrap break-words"
      />

      {task.task_image_urls.length > 0 ? (
        <div className="preview-task-images mt-3">
          <PhotoGallery
            images={task.task_image_urls}
            dialogTitle={`Задача №${task.order_num}`}
            dialogDescription="Изображение условия задачи"
            imageAltPrefix={`Задача ${task.order_num}, фото`}
            singleThumbnailClassName="max-h-[300px] w-auto max-w-full rounded-md object-contain"
            multiThumbnailClassName="h-[200px] w-auto max-w-[260px] rounded-md border border-slate-200 bg-white object-contain"
          />
        </div>
      ) : null}

      {showAnswers && task.correct_answer ? (
        <div className="mt-4 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          <span className="font-semibold">Ответ:</span>{' '}
          <MathText text={task.correct_answer} as="span" className="font-mono" />
        </div>
      ) : null}

      {hasSolutionBlock ? (
        <section className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3">
          <h3 className="mb-2 text-sm font-semibold text-slate-700">Решение</h3>
          {task.solution_text ? (
            <MathText
              text={task.solution_text}
              className="text-sm leading-relaxed text-slate-800 whitespace-pre-wrap break-words"
            />
          ) : null}
          {(task.solution_image_urls?.length ?? 0) > 0 ? (
            <div className="preview-task-images mt-3">
              <PhotoGallery
                images={task.solution_image_urls ?? []}
                dialogTitle={`Задача №${task.order_num} — решение`}
                dialogDescription="Изображение эталонного решения"
                imageAltPrefix={`Задача ${task.order_num}, фото решения`}
                singleThumbnailClassName="max-h-[300px] w-auto max-w-full rounded-md object-contain"
                multiThumbnailClassName="h-[200px] w-auto max-w-[260px] rounded-md border border-slate-200 bg-white object-contain"
              />
            </div>
          ) : null}
        </section>
      ) : null}
    </article>
  );
});

PreviewTaskCard.displayName = 'PreviewTaskCard';

export const HomeworkPreviewContent = memo(function HomeworkPreviewContent({
  title,
  tasks,
  showAnswers,
  showSolutions,
}: HomeworkPreviewContentProps) {
  if (tasks.length === 0) {
    return (
      <div className="mx-auto max-w-[800px] px-4 py-10 text-center text-slate-500">
        <p className="text-base">Это ДЗ пустое. Добавьте задачи в редакторе.</p>
      </div>
    );
  }

  return (
    <div className="preview-root mx-auto max-w-[800px] px-4 py-6 sm:px-6">
      <h1 className="mb-6 text-2xl font-semibold text-slate-900 sm:text-[1.75rem]">
        {title}
      </h1>
      <div className="space-y-5">
        {tasks.map((task) => (
          <PreviewTaskCard
            key={task.id}
            task={task}
            showAnswers={showAnswers}
            showSolutions={showSolutions}
          />
        ))}
      </div>
    </div>
  );
});

HomeworkPreviewContent.displayName = 'HomeworkPreviewContent';
