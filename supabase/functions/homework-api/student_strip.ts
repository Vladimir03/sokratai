/**
 * Anti-leak стрипы student-ответов треда ДЗ — вынесены из `index.ts`
 * (2026-08-05), чтобы их покрывали unit-тесты: `index.ts` исполняет
 * `Deno.serve` на верхнем уровне и в vitest не импортируется.
 *
 * Все три функции ЧИСТЫЕ (без БД и env). Служат вторым слоем анти-утечки
 * (rule 40): service_role обходит RLS, поэтому фильтрация — только здесь.
 * Новое tutor-only поле в `THREAD_SELECT` → добавить и в стрип, и в тест
 * `student_strip.test.ts`.
 */

/**
 * Strip hidden tutor notes from thread data before returning to student.
 * Service-role key bypasses RLS, so we must filter server-side.
 */
export function stripHiddenMessages(thread: Record<string, unknown>): Record<string, unknown> {
  const messages = thread.homework_tutor_thread_messages;
  if (!Array.isArray(messages)) return thread;
  return {
    ...thread,
    homework_tutor_thread_messages: messages.filter(
      (m: Record<string, unknown>) => m.visible_to_student !== false,
    ),
  };
}

/**
 * Remove tutor-facing draft commentary from student responses.
 */
export function stripStudentSensitiveTaskStateFields(
  thread: Record<string, unknown>,
): Record<string, unknown> {
  const taskStates = thread.homework_tutor_task_states;
  if (!Array.isArray(taskStates)) return thread;
  return {
    ...thread,
    homework_tutor_task_states: taskStates.map((taskState) => {
      if (!taskState || typeof taskState !== "object") return taskState;
      // tutor_force_completed_at / tutor_reviewed_at — оставляем (ученик видит бейдж).
      // tutor_force_completed_by / tutor_reviewed_by — strip (UUID туторa, audit-only).
      const {
        ai_score_comment: _aiScoreComment,
        tutor_force_completed_by: _forceCompletedBy,
        tutor_reviewed_by: _reviewedBy,
        ...safeTaskState
      } = taskState as Record<string, unknown>;
      return safeTaskState;
    }),
  };
}

/**
 * homework-work-modes (Т5): state-aware reveal самостоятельной работы.
 * До `thread.status === 'completed'` ученик не видит вердикты:
 *  - assistant/system-сообщения (check_result / ai_reply / интро) фильтруются;
 *    остаются свои user-сообщения и человеческие tutor-сообщения;
 *  - в task_states зануляются все балл/вердикт-носители. Остаются
 *    id/task_id/status/attempts/hint_count — status нужен UI для «Сдано»/лока
 *    ввода, вердикт из него не выводится (задача закрывается ЛЮБЫМ вердиктом).
 * После завершения — полный reveal (эта функция не вызывается).
 */
export function stripIndependentPreRevealFields(
  thread: Record<string, unknown>,
): Record<string, unknown> {
  const messages = Array.isArray(thread.homework_tutor_thread_messages)
    ? (thread.homework_tutor_thread_messages as Record<string, unknown>[])
    : [];
  const taskStates = Array.isArray(thread.homework_tutor_task_states)
    ? (thread.homework_tutor_task_states as Record<string, unknown>[])
    : [];
  return {
    ...thread,
    homework_tutor_thread_messages: messages.filter(
      (m) => m && typeof m === "object" && (m.role === "user" || m.role === "tutor"),
    ),
    homework_tutor_task_states: taskStates.map((ts) => {
      if (!ts || typeof ts !== "object") return ts;
      return {
        ...ts,
        // required-number поля клиентского типа → 0 (не null), optional → null.
        best_score: 0,
        wrong_answer_count: 0,
        available_score: null,
        earned_score: null,
        // P0 anti-leak (2026-07-25): `best_earned_score` — такой же носитель
        // балла, как `earned_score`. Без зануления балл самостоятельной утёк бы
        // ученику ДО сдачи работы прямо в payload'е треда.
        best_earned_score: null,
        // `ai_help_events` в самостоятельной всегда 0 и метрика не показывается,
        // но зануляем ради инварианта «до раскрытия — ни одного балл-носителя».
        ai_help_events: null,
        ai_score: null,
        tutor_score_override: null,
        tutor_score_override_comment: null,
        tutor_score_override_at: null,
        ai_criteria_json: null,
        ai_nodes_json: null,
      };
    }),
  };
}
