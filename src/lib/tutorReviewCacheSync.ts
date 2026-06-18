import type { QueryClient } from '@tanstack/react-query';

/**
 * Инвалидация всех поверхностей, зависящих от состояния проверки/закрытия ДЗ
 * (tutor_reviewed_at, force-complete): детали + результаты + тред конкретного
 * ученика, ПЛЮС главная (блок «Требует проверки» = `review-queue`) и список ДЗ
 * (`review_pending_count` на карточке).
 *
 * Запрос Елены (2026-06-18): подтверждение проверки должно убирать работу с
 * главной и обновлять отметку «Проверено». Раньше review-мутации не трогали
 * `['tutor','home','review-queue']` → блок показывал устаревшие данные.
 */
/**
 * Только главная-зависимые поверхности: блок «Требует проверки» (review-queue)
 * + список ДЗ (review_pending_count). Отдельно от {@link invalidateAfterReview}
 * для bulk-кейсов, затрагивающих несколько ДЗ сразу (StudentProgressPanel).
 */
export function invalidateReviewHomeSurfaces(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: ['tutor', 'home', 'review-queue'] });
  void queryClient.invalidateQueries({ queryKey: ['tutor', 'homework', 'assignments'] });
}

export function invalidateAfterReview(
  queryClient: QueryClient,
  params: { assignmentId: string; studentId?: string },
): void {
  const { assignmentId, studentId } = params;
  void queryClient.invalidateQueries({ queryKey: ['tutor', 'homework', 'results', assignmentId] });
  void queryClient.invalidateQueries({ queryKey: ['tutor', 'homework', 'detail', assignmentId] });
  if (studentId) {
    void queryClient.invalidateQueries({
      queryKey: ['tutor', 'homework', 'thread', assignmentId, studentId],
    });
  }
  invalidateReviewHomeSurfaces(queryClient);
}
