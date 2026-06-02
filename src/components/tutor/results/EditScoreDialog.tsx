import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { setTutorScoreOverride } from '@/lib/tutorHomeworkApi';
import { reopenReview, reviewTask } from '@/lib/tutorProgressApi';
import { trackGuidedHomeworkEvent } from '@/lib/homeworkTelemetry';

// ─── EditScoreDialog (Homework Results v2 P0-5 / AC-5 + 2026-05-16 force-complete) ─
//
// Manual score override modal. Tutor enters a value in [0..max_score] (step
// 0.1) and optional comment. Override is the FINAL displayed score — when
// set, it wins over earned_score/ai_score for both tutor and student.
//
// Header explains the spread between AI raw score and current displayed
// value (degradation for hints/wrong attempts) so the tutor understands why
// "AI: 1/1" can sit next to a displayed "0.8/1". Field is prefilled with
// the current displayed value, NOT ai_score — common case is "I want to
// override the displayed value" not "I want to match AI".
//
// On success: invalidate the three React Query keys per AC-5 so HeatmapGrid,
// header metrics and the open thread viewer all refresh without reload.
//
// 2026-05-16 (lexical-brewing-gadget):
//   - `force_complete` action: для status='active' рендерится **один**
//     primary CTA + checkbox «Закрыть задачу после сохранения» (default ON).
//     Это ближе к реальному use-case репетитора («поставил балл → закрыл»)
//     и не плодит 5 кнопок в footer на mobile (см. code review P1).
//   - Для force-completed задач рендерится отдельная ghost CTA «Открыть
//     задачу обратно» (только для force-completed; AI-CORRECT не reopen'абельны).
//   - Re-close CTA gate (P1 fix): checkbox показывается ТОЛЬКО при
//     status='active'. Для already-closed (через тутора или AI) — без него,
//     иначе backend branch `existing.status === "active"` молча no-op'нет.
//   - Reopen preserves current override (P1 bug fix): mode='reopen' использует
//     `currentOverride`, не `numericValue` — иначе bulk-closed задача без
//     override приобрела бы phantom override=max при reopen.

interface EditScoreDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  assignmentId: string;
  studentId: string;
  task: {
    id: string;
    order_num: number;
    max_score: number;
  };
  /** AI-evaluated raw score (read-only). May be null on tasks not yet checked. */
  aiScore: number | null;
  /** AI's comment to its own score. Tutor-facing only (never sent to student). */
  aiScoreComment: string | null;
  /**
   * Currently displayed final_score for this (student, task). Used both for
   * the prefill value and for the "Текущий балл" header. Equals
   * `tutor_score_override ?? earned_score ?? ai_score ?? status fallback`.
   */
  finalScore: number | null;
  /** Current tutor override on the task_state, if any. */
  currentOverride: number | null;
  /** Current tutor override comment, if any. Visible to student. */
  currentComment: string | null;
  /**
   * 2026-05-16: task_state.status — required (P3 fix). Future callsites без
   * этого prop'а получат type error, что предотвращает рендер «закрыть»
   * CTA на completed задачах.
   */
  status: 'active' | 'completed' | 'locked' | 'skipped';
  /**
   * 2026-05-16: ISO timestamp когда задача была force-completed репетитором,
   * либо null. Используется для решения, рендерить ли reopen CTA. Required
   * (P3 fix) — null явное значение, не undefined.
   */
  tutorForceCompletedAt: string | null;
  /**
   * 2026-06-02 (student-progress R1): ISO timestamp когда задача подтверждена
   * репетитором («проверено»), либо null. Required — null явное значение.
   * isReviewed=true → скрыть чекбокс «Подтвердить задачу», показать ghost
   * «Снять подтверждение». Ортогонально status / tutorForceCompletedAt.
   */
  tutorReviewedAt: string | null;
}

function formatScore(value: number): string {
  // Trim trailing zero so 2.5 stays 2.5 but 2.0 → 2.
  return value.toFixed(1).replace(/\.0$/, '');
}

export function EditScoreDialog({
  open,
  onOpenChange,
  assignmentId,
  studentId,
  task,
  aiScore,
  aiScoreComment,
  finalScore,
  currentOverride,
  currentComment,
  status,
  tutorForceCompletedAt,
  tutorReviewedAt,
}: EditScoreDialogProps) {
  const queryClient = useQueryClient();
  // Prefill priority: existing override → current displayed final_score → AI
  // raw score → 0. We deliberately prefer finalScore over aiScore: tutor
  // usually wants to "fix what the student sees", not "set to AI's value".
  const initialValue = currentOverride ?? finalScore ?? aiScore ?? 0;
  const [valueText, setValueText] = useState<string>(String(initialValue));
  const [comment, setComment] = useState<string>(currentComment ?? '');
  // Default ON — типичный use-case репетитора: поставил балл → закрыл.
  // Если репетитор лишь хочет обновить балл уже-закрытой или active задачи
  // без закрытия — снимет галочку.
  const [closeAfterSave, setCloseAfterSave] = useState<boolean>(true);
  const [reopenConfirmOpen, setReopenConfirmOpen] = useState(false);
  // R1 «проверено»: default ON, чтобы «Сохранить и подтвердить» был дефолтным
  // терминальным действием. Скрыт, если задача уже reviewed.
  const [reviewAfterSave, setReviewAfterSave] = useState<boolean>(true);
  const [reviewReopenConfirmOpen, setReviewReopenConfirmOpen] = useState(false);

  // Reset form whenever the dialog is (re)opened for a new task.
  useEffect(() => {
    if (open) {
      setValueText(String(currentOverride ?? finalScore ?? aiScore ?? 0));
      setComment(currentComment ?? '');
      setCloseAfterSave(true);
      setReopenConfirmOpen(false);
      setReviewAfterSave(true);
      setReviewReopenConfirmOpen(false);
    }
  }, [open, currentOverride, finalScore, aiScore, currentComment]);

  const numericValue = useMemo(() => {
    const n = Number(valueText.replace(',', '.'));
    return Number.isFinite(n) ? n : NaN;
  }, [valueText]);

  const validationError = useMemo(() => {
    if (Number.isNaN(numericValue)) return 'Введите число';
    if (numericValue < 0) return 'Минимум 0';
    if (numericValue > task.max_score) return `Максимум ${task.max_score}`;
    // Step 0.1 (post-pilot 2026-05-09 — parity with AI prompt). Tolerance
    // 1e-9 защищает от floating-point junk типа `1.7 * 10 = 16.999...` в
    // некоторых JS-движках.
    const scaled = numericValue * 10;
    if (Math.abs(scaled - Math.round(scaled)) > 1e-9) return 'Шаг 0.1';
    return null;
  }, [numericValue, task.max_score]);

  // "Unchanged" relative to the persisted override only. When no override
  // exists yet, ANY submit is a real change (even if the value happens to
  // equal AI/finalScore — it still creates the override row, which fixes
  // the displayed score from earned/ai chain to a sticky tutor value).
  const trimmedComment = comment.trim();
  const isUnchanged =
    !validationError &&
    currentOverride !== null &&
    numericValue === currentOverride &&
    trimmedComment === (currentComment ?? '');

  // Difference between current displayed score and AI raw score — if any,
  // explain it in the header. earned_score-driven degradation is the only
  // reason for the spread today (override is exposed separately).
  const aiDegradationText = useMemo(() => {
    if (currentOverride !== null) return null; // already a manual override
    if (aiScore == null || finalScore == null) return null;
    const drop = Math.round((aiScore - finalScore) * 100) / 100;
    if (drop <= 0) return null;
    const dropText = formatScore(drop);
    return `снижено на ${dropText} за подсказки/неверные попытки`;
  }, [aiScore, finalScore, currentOverride]);

  // 2026-05-16: derived flags для force-complete UX.
  const isForceCompletedByTutor =
    status === 'completed' && tutorForceCompletedAt != null;
  // Checkbox «Закрыть задачу после сохранения» — ТОЛЬКО для active задач.
  // Для already-completed (AI-CORRECT OR force-completed) повторное закрытие
  // не имеет семантики (backend branch `existing.status === "active"`
  // молча no-op'нет marker update). См. code review P1.
  const showCloseCheckbox = status === 'active';
  // P3 fix (code review round 2): derived flag — учитывает И state checkbox'а
  // И его видимость. Когда checkbox скрыт (completed task), closeAfterSave
  // остаётся true (default), но это не должно влиять на label / className /
  // disabled-logic. Без этого primary CTA на completed задаче рендерилась бы
  // «Сохранить и закрыть» (confusing — close action не выполняется).
  const willCloseAfterSave = showCloseCheckbox && closeAfterSave;
  // Reopen CTA — только для force-completed (НЕ для AI-CORRECT).
  const showReopenCta = isForceCompletedByTutor;

  // ── R1 «проверено» derived flags ──────────────────────────────────────────
  const isReviewed = tutorReviewedAt != null;
  // Чекбокс «Подтвердить задачу» — пока задача не подтверждена.
  const showReviewCheckbox = !isReviewed;
  const willReview = showReviewCheckbox && reviewAfterSave;
  // Когда подтверждаем — review-RPC сам закроет active-задачу, поэтому
  // отдельный force-complete чекбокс прячем (иначе два конкурирующих close).
  const showCloseCheckboxEffective = showCloseCheckbox && !willReview;
  // Балл реально менялся относительно текущего отображаемого (override → final → ai).
  // Для confirm без правки → не создаём override (AI-балл не перезаписывается).
  const effectiveCurrentScore = currentOverride ?? finalScore ?? aiScore ?? null;
  const scoreChanged = !Number.isNaN(numericValue) && numericValue !== effectiveCurrentScore;
  const commentChanged = trimmedComment !== (currentComment ?? '') && trimmedComment.length > 0;
  // КРИТИЧНО (manual/no-AI): когда AI-вердикта НЕТ, `finalScore` приходит как 0
  // (fallback), поэтому ввод балла «0» выглядел бы как «не изменилось» → score:null →
  // force_complete без override → итог fallback'ился в max_score. Нет AI = нечего
  // сохранять, поэтому ВСЕГДА персистим введённый балл (включая 0).
  const reviewWantsOverride = scoreChanged || commentChanged || aiScore == null;

  type Mode = 'save' | 'reset' | 'reopen' | 'review-reopen';

  const saveMutation = useMutation({
    mutationFn: async (mode: Mode) => {
      // R1 «проверено» — снять подтверждение (status НЕ трогаем).
      if (mode === 'review-reopen') {
        return reopenReview({ assignmentId, studentId, taskId: task.id });
      }
      // R1 «проверено» — подтвердить (+опц. override). Для active-задачи
      // backend сам закроет её. AI-балл не перезаписывается, если не менялся.
      if (mode === 'save' && willReview) {
        return reviewTask({
          assignmentId,
          studentId,
          taskId: task.id,
          score: reviewWantsOverride ? numericValue : null,
          comment: reviewWantsOverride ? (trimmedComment || null) : null,
        });
      }
      // P1 fix: reopen НЕ должен silently писать override=numericValue,
      // если у задачи override=null (bulk-closed без override → finalScore=max
      // через fallback → user открывает диалог → numericValue=max). Reopen
      // сохраняет существующий override без изменений.
      let overrideForCall: number | null;
      let commentForCall: string | null;
      if (mode === 'reset') {
        overrideForCall = null;
        commentForCall = null;
      } else if (mode === 'reopen') {
        overrideForCall = currentOverride;
        commentForCall = currentComment;
      } else {
        // mode === 'save'
        overrideForCall = numericValue;
        commentForCall = trimmedComment || null;
      }
      const forceCompleteForCall: 'completed' | 'active' | null =
        mode === 'save' && willCloseAfterSave
          ? 'completed'
          : mode === 'reopen'
          ? 'active'
          : null;
      return setTutorScoreOverride({
        assignmentId,
        studentId,
        taskId: task.id,
        tutorScoreOverride: overrideForCall,
        comment: commentForCall,
        forceComplete: forceCompleteForCall,
      });
    },
    onSuccess: (_data, mode) => {
      const isReset = mode === 'reset';
      const reviewedTask = mode === 'save' && willReview;
      // force-complete close ТОЛЬКО когда НЕ подтверждаем (review-RPC сам закроет).
      const closedTask = mode === 'save' && !willReview && willCloseAfterSave;
      // Existing AC-10 event — emit only когда override меняется через
      // setTutorScoreOverride путь (save без review / reset). Review-save идёт
      // через reviewTask → отдельное событие task_reviewed, не manual_score_override.
      if ((mode === 'save' && !willReview) || mode === 'reset') {
        trackGuidedHomeworkEvent('manual_score_override_saved', {
          assignmentId,
          taskId: task.id,
          aiScore: aiScore ?? null,
          tutorScore: mode === 'reset' ? null : numericValue,
          hadComment: mode !== 'reset' && trimmedComment.length > 0,
        });
      }
      // 2026-05-16 events for force-complete surface.
      if (closedTask) {
        trackGuidedHomeworkEvent('homework_task_force_completed', {
          assignmentId,
          studentId,
          taskId: task.id,
          source: 'dialog',
          hadScore: !isReset,
        });
      } else if (mode === 'reopen') {
        trackGuidedHomeworkEvent('homework_task_reopened', {
          assignmentId,
          studentId,
          taskId: task.id,
        });
      }
      // R1 «проверено» events.
      if (reviewedTask) {
        trackGuidedHomeworkEvent('task_reviewed', {
          assignmentId,
          studentId,
          taskId: task.id,
          source: 'dialog',
          hadOverride: reviewWantsOverride,
        });
      } else if (mode === 'review-reopen') {
        trackGuidedHomeworkEvent('task_review_reopened', {
          assignmentId,
          studentId,
          taskId: task.id,
        });
      }

      // Invalidate the three React Query keys required by AC-5.
      queryClient.invalidateQueries({
        queryKey: ['tutor', 'homework', 'results', assignmentId],
      });
      queryClient.invalidateQueries({
        queryKey: ['tutor', 'homework', 'detail', assignmentId],
      });
      // Precise key — GuidedThreadViewer keys its query by
      // [..., assignmentId, studentId] (see GuidedThreadViewer.tsx).
      queryClient.invalidateQueries({
        queryKey: ['tutor', 'homework', 'thread', assignmentId, studentId],
      });

      if (mode === 'save' && willReview) {
        toast.success(reviewWantsOverride ? 'Балл сохранён, задача подтверждена' : 'Задача подтверждена');
      } else if (mode === 'review-reopen') {
        toast.success('Подтверждение снято');
      } else if (closedTask) {
        toast.success('Балл сохранён, задача закрыта');
      } else if (mode === 'reopen') {
        toast.success('Задача открыта обратно');
      } else if (isReset) {
        toast.success('Правка сброшена');
      } else {
        toast.success('Балл обновлён');
      }
      onOpenChange(false);
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : 'Не удалось сохранить';
      toast.error(message);
    },
  });

  const isPending = saveMutation.isPending;
  const primaryLabel = willReview
    ? (aiScore == null
        ? 'Поставить балл и подтвердить'
        : reviewWantsOverride
        ? 'Сохранить и подтвердить'
        : 'Подтвердить')
    : willCloseAfterSave
    ? 'Сохранить и закрыть задачу'
    : 'Сохранить балл';
  // Зелёный (success-семантика, rule 90) для подтверждения и для закрытия.
  const primaryIsSuccess = willReview || willCloseAfterSave;
  // Disabled для unchanged — только когда нет ни close, ни review (оба — meaningful action).
  const primaryDisabled =
    isPending || validationError !== null || (isUnchanged && !willCloseAfterSave && !willReview);

  return (
    <>
      <Dialog open={open} onOpenChange={(next) => (!isPending ? onOpenChange(next) : null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Задача №{task.order_num} — изменить балл</DialogTitle>
            <DialogDescription>
              Балл репетитора — итоговый балл, который видит ученик. AI-оценка не перезаписывается.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700 space-y-1">
              <div>
                Текущий балл:{' '}
                <span className="font-semibold">
                  {finalScore != null ? `${formatScore(finalScore)}/${task.max_score}` : '—'}
                </span>
                {aiScore != null && (currentOverride !== null || aiDegradationText) ? (
                  <>
                    {' '}
                    (AI: {formatScore(aiScore)}/{task.max_score}
                    {aiDegradationText ? `, ${aiDegradationText}` : null}
                    {currentOverride !== null ? ', ручная правка' : null})
                  </>
                ) : aiScore != null ? (
                  <span className="text-slate-500"> · AI: {formatScore(aiScore)}/{task.max_score}</span>
                ) : null}
              </div>
              {aiScoreComment ? (
                <div className="text-xs text-slate-500">
                  <span className="font-medium">AI:</span> {aiScoreComment}
                </div>
              ) : null}
              {isForceCompletedByTutor ? (
                <div className="text-xs text-emerald-700">
                  Задача закрыта вами вручную.
                </div>
              ) : null}
              {isReviewed ? (
                <div className="text-xs text-emerald-700">
                  Задача подтверждена — ученик видит «Проверено».
                </div>
              ) : aiScore == null ? (
                <div className="text-xs text-slate-500">
                  AI-вердикта нет — оцените задачу вручную.
                </div>
              ) : null}
            </div>

            <div className="space-y-1">
              <label htmlFor="edit-score-value" className="text-sm font-medium text-slate-700">
                Балл репетитора (итог)
              </label>
              <input
                id="edit-score-value"
                type="number"
                inputMode="decimal"
                step={0.1}
                min={0}
                max={task.max_score}
                value={valueText}
                onChange={(e) => setValueText(e.target.value)}
                disabled={isPending}
                className="w-full rounded-md border border-slate-200 px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent"
              />
              <p className="text-xs text-slate-500">
                {validationError
                  ? validationError
                  : `0..${task.max_score}, шаг 0.1`}
              </p>
            </div>

            <div className="space-y-1">
              <label htmlFor="edit-score-comment" className="text-sm font-medium text-slate-700">
                Комментарий (опционально, увидит ученик)
              </label>
              <textarea
                id="edit-score-comment"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                disabled={isPending}
                maxLength={1000}
                rows={3}
                className="w-full rounded-md border border-slate-200 px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent"
                placeholder="Например: засчитал полный балл — ход решения правильный"
              />
            </div>

            {showReviewCheckbox ? (
              <label className="flex items-start gap-2 text-sm text-slate-700 cursor-pointer">
                <Checkbox
                  checked={reviewAfterSave}
                  onCheckedChange={(next) => setReviewAfterSave(next === true)}
                  disabled={isPending}
                  className="mt-0.5"
                />
                <span>
                  Подтвердить задачу
                  <span className="block text-xs text-slate-500">
                    {status === 'active'
                      ? 'Ученик увидит балл и «проверено». Задача будет закрыта.'
                      : 'Ученик увидит балл и «проверено репетитором».'}
                  </span>
                </span>
              </label>
            ) : null}

            {showCloseCheckboxEffective ? (
              <label className="flex items-start gap-2 text-sm text-slate-700 cursor-pointer">
                <Checkbox
                  checked={closeAfterSave}
                  onCheckedChange={(next) => setCloseAfterSave(next === true)}
                  disabled={isPending}
                  className="mt-0.5"
                />
                <span>
                  Закрыть задачу после сохранения
                  <span className="block text-xs text-slate-500">
                    Ученик увидит «закрыто репетитором» и перейдёт к следующей задаче.
                  </span>
                </span>
              </label>
            ) : null}

            {/* Anti-leak плашка (rule 45 / spec §5) — нейтральный фон, не зелёный. */}
            <div className="flex items-start gap-2 rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
              <span>
                Ученик видит только итоговый балл и «проверено». AI-рубрика,
                подсказки и решение не раскрываются.
              </span>
            </div>
          </div>

          <DialogFooter className="flex-col gap-2 md:flex-row md:justify-between">
            <div className="flex flex-wrap gap-2">
              {currentOverride != null ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={isPending}
                  onClick={() => saveMutation.mutate('reset')}
                >
                  Сбросить правку
                </Button>
              ) : null}
              {showReopenCta ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={isPending}
                  onClick={() => setReopenConfirmOpen(true)}
                >
                  Открыть задачу обратно
                </Button>
              ) : null}
              {isReviewed ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={isPending}
                  onClick={() => setReviewReopenConfirmOpen(true)}
                >
                  Снять подтверждение
                </Button>
              ) : null}
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={isPending}
                onClick={() => onOpenChange(false)}
              >
                Отмена
              </Button>
              <Button
                type="button"
                disabled={primaryDisabled}
                onClick={() => saveMutation.mutate('save')}
                className={primaryIsSuccess ? 'bg-emerald-600 text-white hover:bg-emerald-700' : undefined}
              >
                {isPending && saveMutation.variables === 'save' ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                {primaryLabel}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reopen confirmation. Отдельный AlertDialog — explicit confirmation
          уменьшает риск accidental reopen после force-complete. */}
      <AlertDialog
        open={reopenConfirmOpen}
        onOpenChange={(next) => (!isPending ? setReopenConfirmOpen(next) : null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Открыть задачу обратно?</AlertDialogTitle>
            <AlertDialogDescription>
              Задача снова станет активной для ученика. Балл репетитора и комментарий сохранятся —
              их можно отдельно сбросить кнопкой «Сбросить правку».
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Отмена</AlertDialogCancel>
            <AlertDialogAction
              disabled={isPending}
              onClick={(e) => {
                e.preventDefault();
                saveMutation.mutate('reopen');
                setReopenConfirmOpen(false);
              }}
            >
              {isPending && saveMutation.variables === 'reopen' ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Открыть обратно
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Снять подтверждение «проверено» (R1). Чистит только флаг review —
          status задачи НЕ меняется (ортогонально). */}
      <AlertDialog
        open={reviewReopenConfirmOpen}
        onOpenChange={(next) => (!isPending ? setReviewReopenConfirmOpen(next) : null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Снять подтверждение?</AlertDialogTitle>
            <AlertDialogDescription>
              Задача вернётся в очередь «требует проверки», у ученика пропадёт пометка
              «Проверено». Балл и статус задачи не изменятся.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Отмена</AlertDialogCancel>
            <AlertDialogAction
              disabled={isPending}
              onClick={(e) => {
                e.preventDefault();
                saveMutation.mutate('review-reopen');
                setReviewReopenConfirmOpen(false);
              }}
            >
              {isPending && saveMutation.variables === 'review-reopen' ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Снять подтверждение
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
