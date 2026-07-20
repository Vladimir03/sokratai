// Единый helper «полностью ли проверено ДЗ ученика». Источник истины для:
// блока «Требует проверки» на главной (исключение проверенных), бейджа
// «✓ Проверено» в таблице результатов и роллапа списка ДЗ. Запрос Елены
// (2026-06-18) — дезинформация на главной.
//
// «Проверено» для задачи = tutor_reviewed_at ИЛИ tutor_force_completed_at
// (решение владельца 2026-07-20): задача, закрытая репетитором вручную
// (force-close), — уже принятое решение репетитора; раньше такие задачи
// (ai_score=NULL) были невидимы кнопкам подтверждения и навсегда блокировали
// бейдж («ДЗ висит как будто незакрытым» — репорт Елены).

interface TaskRef {
  task_id: string;
}
interface ReviewableTaskScore {
  task_id: string;
  tutor_reviewed_at?: string | null;
  tutor_force_completed_at?: string | null;
}

/**
 * «Задача проверена репетитором»: явное подтверждение (tutor_reviewed_at)
 * ИЛИ ручное закрытие (tutor_force_completed_at). Оба поля optional —
 * deploy-skew-safe: источник без поля → undefined → прежнее поведение.
 * Deno-зеркало условия — homework-api/index.ts::handleListAssignments (роллап).
 */
export function isTaskScoreReviewed(ts: {
  tutor_reviewed_at?: string | null;
  tutor_force_completed_at?: string | null;
}): boolean {
  return ts.tutor_reviewed_at != null || ts.tutor_force_completed_at != null;
}

/**
 * true, если у ученика КАЖДАЯ задача ДЗ (`allTasks`) имеет проверенный
 * task_score (см. isTaskScoreReviewed). Консервативно: задача без task_score
 * (ученик не дошёл / нет состояния) → считается непроверенной → false.
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
    taskScores.filter(isTaskScoreReviewed).map((ts) => ts.task_id),
  );
  return allTasks.every((t) => reviewedTaskIds.has(t.task_id));
}
