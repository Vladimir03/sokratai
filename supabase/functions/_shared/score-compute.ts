// Shared final-score priority chain (student-progress R2 extracted from
// homework-api so the per-student aggregate reuses it — NOT duplicated).
//
// Priority: tutor_score_override → best_earned_score → earned_score → ai_score
//           → (completed ? max : 0).
// Mirror of the original homework-api local function; both import this now.
//
// `best_earned_score` (2026-07-25, метрика «% самостоятельности»): балл задачи =
// ЛУЧШИЙ за все попытки, а не последний. Стоит ВЫШЕ `earned_score`, чтобы
// повторный, менее удачный прогон не понижал уже заработанное. Fail-safe:
// колонка, забытая в SELECT, приходит `undefined` → цепочка молча ведёт себя
// как до релиза. Ручной балл репетитора в `best_earned_score` не пишется —
// иначе override остался бы «липким» после сброса.

export interface FinalScoreFields {
  tutor_score_override?: number | null;
  best_earned_score?: number | null;
  earned_score?: number | null;
  ai_score?: number | null;
  status?: string | null;
}

export function computeFinalScore(ts: FinalScoreFields, maxScore: number): number {
  if (ts.tutor_score_override != null) return Number(ts.tutor_score_override);
  if (ts.best_earned_score != null) return Number(ts.best_earned_score);
  if (ts.earned_score != null) return Number(ts.earned_score);
  if (ts.ai_score != null) return Number(ts.ai_score);
  if (ts.status === "completed") return maxScore;
  return 0;
}

// ─── «% самостоятельности» ───────────────────────────────────────────────────
//
// ЕДИНСТВЕННЫЙ источник формулы (модель утверждена владельцем 2026-07-25):
//   самостоятельность задачи = 100% − 10 п.п. × обращений к помощи AI, floor 0.
// Обращение = разбор ошибки (одна сдача = один минус) / подсказка по кнопке /
// ответ Сократа в обсуждении. НЕ считается: подтверждение верного ответа,
// авто-вступление, техсбой проверки, реплики живого репетитора.
//
// Новую поверхность с этой метрикой считать ТОЛЬКО через эти хелперы: формула
// продублированная в UI разойдётся с бэкендом на первом же изменении шкалы.

/** Штраф за одно обращение к помощи AI, в процентных пунктах. */
export const INDEPENDENCE_PENALTY_PP = 10;

/**
 * Процент самостоятельности задачи по числу обращений к AI.
 * `null`/`undefined` (нет данных: работа до релиза, force-complete) → `null`,
 * а НЕ 100%: «неизвестно» нельзя показывать как «сделал сам».
 */
export function computeIndependencePct(events: number | null | undefined): number | null {
  if (events == null || !Number.isFinite(Number(events))) return null;
  const n = Math.max(0, Math.floor(Number(events)));
  return Math.max(0, 100 - INDEPENDENCE_PENALTY_PP * n);
}

/**
 * ОЦЕНКА самостоятельности для работ, выполненных ДО релиза метрики (2026-07-26),
 * где `ai_help_events` не писался. Считается из legacy-счётчиков:
 * `100% − 10 п.п. × (подсказки + неверные попытки)`.
 *
 * Решение владельца 2026-07-27: показывать оценку со знаком «≈» вместо прочерка —
 * иначе репетиторы видят «—» на всех работах, начатых раньше, и читают это как
 * «метрика не работает» (репорт Елены).
 *
 * ⚠️ Оценка ЗАВЫШЕНА: ответы Сократа в обсуждении в legacy-полях не сохранялись,
 * а они тоже считаются обращением. Поэтому результат обязан выводиться в UI с
 * префиксом «≈» и пояснением — иначе цифру примут за точную.
 *
 * `null` — активности не было вовсе (не приступал / задача закрыта массово):
 * оценивать нечего, в UI остаётся «—».
 */
export function estimateIndependencePctLegacy(
  hintCount: number | null | undefined,
  wrongCount: number | null | undefined,
  attempts?: number | null | undefined,
): number | null {
  const hints = Math.max(0, Math.floor(Number(hintCount ?? 0)) || 0);
  const wrong = Math.max(0, Math.floor(Number(wrongCount ?? 0)) || 0);
  const tries = Math.max(0, Math.floor(Number(attempts ?? 0)) || 0);
  if (hints === 0 && wrong === 0 && tries === 0) return null;
  return Math.max(0, 100 - INDEPENDENCE_PENALTY_PP * (hints + wrong));
}

/**
 * Разрешить метрику по задаче: точный расчёт, если счётчик есть; иначе оценка по
 * legacy-счётчикам. ЕДИНСТВЕННАЯ точка этой развилки — вызывать её из всех
 * эндпоинтов, иначе одна поверхность покажет «—», а другая «≈90%» по тем же данным.
 */
export function resolveIndependencePct(state: {
  ai_help_events?: number | null;
  hint_count?: number | null;
  wrong_answer_count?: number | null;
  attempts?: number | null;
}): { pct: number | null; isEstimate: boolean } {
  const exact = computeIndependencePct(state.ai_help_events);
  if (exact != null) return { pct: exact, isEstimate: false };
  const estimated = estimateIndependencePctLegacy(
    state.hint_count,
    state.wrong_answer_count,
    state.attempts,
  );
  return { pct: estimated, isEstimate: estimated != null };
}

/**
 * Агрегат по работе — средневзвешенное по `max_score` задач (решение владельца:
 * «сложные задачи занимают больше времени и усилий, поэтому весят больше»).
 * Задачи без данных (pct === null) и с нулевым весом не входят ни в числитель,
 * ни в знаменатель. Нет ни одной задачи с данными → `null` (в UI «—»).
 */
export function aggregateIndependencePct(
  items: Array<{ pct: number | null; weight: number | null | undefined }>,
): number | null {
  let weighted = 0;
  let weightSum = 0;
  for (const item of items) {
    if (item.pct == null) continue;
    const weight = Number(item.weight ?? 0);
    if (!Number.isFinite(weight) || weight <= 0) continue;
    weighted += item.pct * weight;
    weightSum += weight;
  }
  if (weightSum <= 0) return null;
  return weighted / weightSum;
}
