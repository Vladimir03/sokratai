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
