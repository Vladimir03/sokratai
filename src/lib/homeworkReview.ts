// Единый helper «полностью ли проверено ДЗ ученика» (все задачи имеют
// tutor_reviewed_at). Источник истины для: блока «Требует проверки» на главной
// (исключение проверенных), бейджа «✓ Проверено» в таблице результатов и
// роллапа списка ДЗ. Запрос Елены (2026-06-18) — дезинформация на главной.

interface TaskRef {
  task_id: string;
}
interface ReviewableTaskScore {
  task_id: string;
  tutor_reviewed_at?: string | null;
}

/**
 * true, если у ученика КАЖДАЯ задача ДЗ (`allTasks`) имеет task_score с непустым
 * `tutor_reviewed_at`. Консервативно: задача без task_score (ученик не дошёл /
 * нет состояния) → считается непроверенной → false.
 *
 * Пустой `allTasks` (ДЗ без задач — edge, см. code review P2) → vacuously TRUE:
 * проверять нечего → работа НЕ висит вечно «на проверку» (иначе застревала бы в
 * очереди и в review_pending_count). Реальные ДЗ всегда имеют ≥1 задачу.
 */
export function isStudentWorkFullyReviewed(
  allTasks: TaskRef[],
  taskScores: ReviewableTaskScore[],
): boolean {
  if (allTasks.length === 0) return true;
  const reviewedTaskIds = new Set(
    taskScores
      .filter((ts) => ts.tutor_reviewed_at != null)
      .map((ts) => ts.task_id),
  );
  return allTasks.every((t) => reviewedTaskIds.has(t.task_id));
}
